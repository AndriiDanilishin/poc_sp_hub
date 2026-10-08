'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('s4');

// -----------------------------------------------------------------------------
// S/4HANA Purchase Requisition client (§21) — the single place that talks to
// S/4HANA. Same provider pattern as srv/ai/llm-client.js:
//
//   mock         (default) offline, deterministic enough for dev/CI and api.http.
//                Test triggers in an item text: "[s4-reject]" → S/4-style 400,
//                "[s4-timeout]" → the PR is created but the response is "lost".
//   destination  BTP destination (S4HANA_PR, BasicAuthentication) via the SAP
//                Cloud SDK, which also handles the CSRF token + session cookie.
//
// Errors are thrown as S4Error with an `outcome`:
//   REJECTED  S/4HANA answered and refused — nothing was created.
//   UNKNOWN   no usable answer (timeout, network, 502-504) — S/4HANA may have
//             created the requisition; the caller must reconcile before retrying.
// -----------------------------------------------------------------------------

class S4Error extends Error {
  constructor(message, { outcome, status = null, code = null, responseBody = null } = {}) {
    super(message);
    this.name = 'S4Error';
    this.outcome = outcome;
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
  }
}

function parseBool(value, fallback) {
  if (value === undefined || value === '') return !!fallback;
  return /^(1|true|yes)$/i.test(String(value));
}

/** Effective config: cds.env.s4 overridden by S4_* environment variables. */
function getConfig() {
  const env = cds.env.s4 || {};
  return {
    ...env,
    provider: process.env.S4_PROVIDER || env.provider || 'mock',
    destinationName: process.env.S4_DESTINATION_NAME || env.destinationName || 'S4HANA_PR',
    servicePath: env.servicePath || '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV',
    validateOnly: parseBool(process.env.S4_VALIDATE_ONLY, env.validateOnly),
    timeoutMs: Number(process.env.S4_TIMEOUT_MS) || env.timeoutMs || 30000,
  };
}

/**
 * Turn an S/4HANA OData V2 error body into one readable sentence:
 * the main message plus any distinct detail messages, with the message code.
 */
function parseS4ErrorMessage(body) {
  let data = body;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return data.slice(0, 300) || null;
    }
  }
  const err = data?.error;
  if (!err) return null;
  const main = err.message?.value || err.message || '';
  const details = (err.innererror?.errordetails || [])
    .filter((x) => x?.message && x.severity !== 'info' && x.message !== main)
    .map((x) => x.message);
  const text = [main, ...new Set(details)].filter(Boolean).join(' ');
  return err.code ? `${text} (${err.code})` : text;
}

/** Find the HTTP response on an SDK/axios error, which may be wrapped in causes. */
function responseOf(error) {
  for (let e = error, depth = 0; e && depth < 5; e = e.cause || e.rootCause, depth++) {
    if (e.response) return e.response;
  }
  return null;
}

function toS4Error(error) {
  if (error instanceof S4Error) return error;
  const res = responseOf(error);
  const status = res?.status ?? null;
  if (!res || [502, 503, 504].includes(status)) {
    return new S4Error(`No answer from S/4HANA (${status ? `HTTP ${status}` : error.message}).`, {
      outcome: 'UNKNOWN',
      status,
    });
  }
  const parsed = parseS4ErrorMessage(res.data);
  return new S4Error(parsed || `HTTP ${status} from S/4HANA.`, {
    outcome: 'REJECTED',
    status,
    code: res.data?.error?.code ?? null,
    responseBody: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
  });
}

// ---- destination provider ---------------------------------------------------

async function destinationRequest(config, requestConfig) {
  const { getDestination } = require('@sap-cloud-sdk/connectivity');
  const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
  const { timeout } = require('@sap-cloud-sdk/resilience');

  // Resolved up front so a missing destination is a clear configuration error,
  // never mistaken for an unknown outcome.
  const destination = await getDestination({ destinationName: config.destinationName });
  if (!destination) {
    throw new S4Error(
      `The S/4HANA connection is not configured (BTP destination "${config.destinationName}" not found).`,
      { outcome: 'REJECTED' },
    );
  }
  try {
    const res = await executeHttpRequest(
      destination,
      {
        ...requestConfig,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        middleware: [timeout(config.timeoutMs)],
      },
      { fetchCsrfToken: requestConfig.method !== 'GET' },
    );
    return res.data;
  } catch (error) {
    throw toS4Error(error);
  }
}

// ---- mock provider ----------------------------------------------------------

const mockStore = new Map(); // correlation reference → PR number
let mockSeq = 9000000000 + Math.floor(Math.random() * 900000) * 1000;

function mockCreate(payload) {
  const items = payload?.to_PurchaseReqnItem?.results || [];
  if (!payload?.PurchaseRequisitionType || !items.length) {
    throw new S4Error('Mock S/4HANA: malformed payload (no type or no items).', {
      outcome: 'REJECTED',
      status: 400,
    });
  }
  const texts = items.map((i) => i.PurchaseRequisitionItemText || '').join(' ');
  if (texts.includes('[s4-reject]')) {
    const body = {
      error: {
        code: '06/026',
        message: {
          lang: 'en',
          value: 'Please enter material number or account assignment category',
        },
      },
    };
    throw new S4Error(parseS4ErrorMessage(body), {
      outcome: 'REJECTED',
      status: 400,
      code: '06/026',
      responseBody: JSON.stringify(body),
    });
  }
  if (payload.PurReqnDoOnlyValidation) {
    return {
      d: { PurchaseRequisition: '', PurchaseRequisitionType: payload.PurchaseRequisitionType },
    };
  }
  const number = String(++mockSeq);
  const reference = String(payload.PurReqnDescription || '').split(' ')[0];
  mockStore.set(reference, number);
  if (texts.includes('[s4-timeout]')) {
    // Created on the "S/4 side", but the caller never hears back.
    throw new S4Error('No answer from S/4HANA (mock timeout).', { outcome: 'UNKNOWN' });
  }
  return {
    d: {
      PurchaseRequisition: number,
      PurchaseRequisitionType: payload.PurchaseRequisitionType,
      PurReqnDescription: payload.PurReqnDescription,
    },
  };
}

// ---- public API -------------------------------------------------------------

/**
 * Create (or, in validate-only mode, just check) a Purchase Requisition.
 * @returns {Promise<{ number: string|null, validatedOnly: boolean, response: object }>}
 */
async function createPurchaseRequisition(payload) {
  const config = getConfig();
  LOG.info(
    `create PR provider=${config.provider} validateOnly=${!!payload.PurReqnDoOnlyValidation}` +
      ` items=${payload.to_PurchaseReqnItem?.results?.length ?? 0}`,
  );
  const data =
    config.provider === 'destination'
      ? await destinationRequest(config, {
          method: 'POST',
          url: `${config.servicePath}/A_PurchaseRequisitionHeader`,
          data: payload,
        })
      : mockCreate(payload);

  const number = data?.d?.PurchaseRequisition || null;
  return { number, validatedOnly: !!payload.PurReqnDoOnlyValidation && !number, response: data };
}

/**
 * Look a requisition up by the correlation reference at the start of its header
 * description. Returns the PR number, or null when S/4HANA has none.
 */
async function findByReference(reference) {
  const config = getConfig();
  if (config.provider !== 'destination') return mockStore.get(reference) || null;

  const filter = encodeURIComponent(`startswith(PurReqnDescription,'${reference}') eq true`);
  const data = await destinationRequest(config, {
    method: 'GET',
    url:
      `${config.servicePath}/A_PurchaseRequisitionHeader` +
      `?$filter=${filter}&$select=PurchaseRequisition,PurReqnDescription&$top=1`,
  });
  return data?.d?.results?.[0]?.PurchaseRequisition || null;
}

module.exports = {
  createPurchaseRequisition,
  findByReference,
  getConfig,
  parseS4ErrorMessage,
  toS4Error,
  S4Error,
};
