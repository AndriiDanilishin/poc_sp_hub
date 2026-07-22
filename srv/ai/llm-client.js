const cds = require('@sap/cds');
const LOG = cds.log('ai.llm');

// -----------------------------------------------------------------------------
// LLM client adapter (docs/solution-architecture.md §14).
//
// The whole AI module talks to exactly this interface — chat() and embed() —
// never to a provider SDK directly. Swapping OpenAI for SAP Generative AI Hub
// later means adding one provider here, not touching extraction/enrichment/etc.
//
// Providers:
//   - 'openai' : real calls via native fetch (no SDK dependency); needs an API key.
//   - 'mock'   : deterministic, offline; the default so dev/CI run without a key.
// -----------------------------------------------------------------------------

// Native embedding size per model — used to default embeddingDimensions so it can't
// silently disagree with the model (requesting 3072 from -small is a 400). -small maxes
// at 1536; -large at 3072. Override explicitly via AI_EMBED_DIMENSIONS / cds.env.ai.
const MODEL_EMBED_DIMS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

function loadConfig(overrides = {}) {
  const env = cds.env.ai || {};
  const embedModel =
    process.env.AI_EMBED_MODEL || env.embedModel || 'text-embedding-3-large';
  return {
    provider: process.env.AI_PROVIDER || env.provider || 'mock',
    chatModel: process.env.AI_CHAT_MODEL || env.chatModel || 'gpt-4o-mini',
    embedModel,
    // Must match the Vector(N) column in db/sourcing-schema.cds. Defaulted from the
    // embed model (small→1536, large→3072) so model + dimensions never disagree; an
    // explicit AI_EMBED_DIMENSIONS / cds.env.ai.embeddingDimensions still wins. Change
    // the model, the dimensions, and the Vector column together when switching.
    embeddingDimensions:
      Number(process.env.AI_EMBED_DIMENSIONS) ||
      Number(env.embeddingDimensions) ||
      MODEL_EMBED_DIMS[embedModel] ||
      3072,
    // Guardrail (§25): hard cap on output tokens per call.
    maxOutputTokens: Number(env.maxOutputTokens) || 1024,
    // Guardrail: reject prompts larger than this many characters.
    maxInputChars: Number(env.maxInputChars) || 48000,
    apiKey: process.env.OPENAI_API_KEY || env.apiKey,
    baseURL: process.env.OPENAI_BASE_URL || env.baseURL || 'https://api.openai.com/v1',
    ...overrides,
  };
}

// ---- minimal JSON-schema validation (no ajv dependency) ---------------------

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

function typeMatches(expected, actual) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some((t) => {
    if (t === 'number') return actual === 'number' || actual === 'integer';
    return t === actual;
  });
}

function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema || !schema.type) return { ok: true, errors };

  const actual = typeOf(value);
  if (!typeMatches(schema.type, actual)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.type)}, got ${actual}`);
    return { ok: false, errors };
  }

  if (actual === 'object' && schema.properties) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) {
        errors.push(...validate(sub, value[key], `${path}.${key}`).errors);
      }
    }
  }

  if (actual === 'array' && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validate(schema.items, item, `${path}[${i}]`).errors);
    });
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  return { ok: errors.length === 0, errors };
}

// ---- deterministic mock provider --------------------------------------------

// FNV-1a hash → stable numeric seed for a string.
function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32 PRNG so mock output is deterministic per seed.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockEmbed(text, dims) {
  const rand = prng(hashSeed(text));
  const v = new Array(dims);
  let sumSq = 0;
  for (let i = 0; i < dims; i++) {
    const x = rand() * 2 - 1;
    v[i] = x;
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return v.map((x) => x / norm); // unit vector
}

// Produce a deterministic instance that satisfies the given schema, so downstream
// code (extraction/enrichment) actually runs offline against the mock provider.
function synthesize(schema, rand) {
  if (!schema || !schema.type) return null;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'object': {
      const obj = {};
      for (const [key, sub] of Object.entries(schema.properties || {})) {
        obj[key] = synthesize(sub, rand);
      }
      return obj;
    }
    case 'array':
      return schema.items ? [synthesize(schema.items, rand)] : [];
    case 'string':
      return schema.enum ? schema.enum[0] : `mock-${Math.floor(rand() * 1e6)}`;
    case 'integer':
      return Math.floor(rand() * 100);
    case 'number':
      return Math.round(rand() * 100) / 100;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return null;
  }
}

// ---- OpenAI provider (native fetch) -----------------------------------------

// Transient upstream failures that are worth retrying: OpenAI 5xx ("The server had
// an error while processing your request"), 429 rate limits, and 408 timeouts. A
// 400/401/403/404 is a request defect — retrying it only wastes time and money.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// OpenAI error bodies are JSON ({error:{message}}) but can be HTML from a proxy.
// Reduce either to one short line: the raw payload used to reach an end-user
// MessageBox verbatim (a 500's full JSON blob), which is noise, not information.
function briefUpstreamError(status, body) {
  let detail;
  try {
    detail = JSON.parse(body)?.error?.message || '';
  } catch {
    detail = String(body || '').replace(/\s+/g, ' ').trim();
  }
  if (detail.length > 200) detail = `${detail.slice(0, 200)}…`;
  return detail ? `${status} — ${detail}` : `${status}`;
}

/**
 * POST to the provider with bounded retries on transient failures.
 * Retries 5xx/429/408 and network errors with exponential backoff; surfaces a
 * single-line message on final failure. `label` names the operation for logs.
 */
async function openaiFetch(config, path, payload, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(`${config.baseURL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset) — same retry policy.
      lastError = new Error(`OpenAI ${label} failed: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) break;
      LOG.warn(`${label} network error (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) return res.json();

    const body = await res.text();
    lastError = new Error(`OpenAI ${label} failed: ${briefUpstreamError(res.status, body)}`);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    // Honour Retry-After when the provider sends one (429s usually do).
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : RETRY_BASE_MS * 2 ** (attempt - 1);
    LOG.warn(`${label} got ${res.status}; retrying in ${delay} ms (${attempt}/${MAX_ATTEMPTS})`);
    await sleep(delay);
  }
  throw lastError;
}

async function openaiChat(config, { system, user, schema, temperature, maxTokens }) {
  // Two things the model needs for reliable structured output:
  // 1. OpenAI's json_object response_format 400s unless the literal word "json"
  //    appears in the messages.
  // 2. Without the schema, the model invents its own field names (e.g. `items`
  //    instead of `requirements`, `deliveryDate` instead of `requestedDate`) and
  //    validation fails. Embedding the exact JSON schema fixes the field names.
  let jsonSystem = system;
  if (schema) {
    jsonSystem += `\n\nRespond with a single JSON object that strictly matches this JSON schema (use these exact field names, no others):\n${JSON.stringify(schema)}`;
  } else if (!/\bjson\b/i.test(system)) {
    jsonSystem += '\nRespond with a single valid JSON object.';
  }
  const data = await openaiFetch(
    config,
    '/chat/completions',
    {
      model: config.chatModel,
      messages: [
        { role: 'system', content: jsonSystem },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    },
    'chat',
  );
  return data.choices?.[0]?.message?.content ?? '';
}

async function openaiEmbed(config, text) {
  const data = await openaiFetch(
    config,
    '/embeddings',
    {
      model: config.embedModel,
      input: text,
      dimensions: config.embeddingDimensions,
    },
    'embed',
  );
  return data.data?.[0]?.embedding ?? [];
}

// ---- adapter ----------------------------------------------------------------

class LLMClient {
  constructor(overrides = {}) {
    this.config = loadConfig(overrides);
    if (this.config.provider === 'openai' && !this.config.apiKey) {
      LOG.warn('OpenAI provider selected but no API key configured; calls will fail.');
    }
  }

  _guardInput(text) {
    if (typeof text !== 'string' || !text.length) {
      throw new Error('LLM input must be a non-empty string');
    }
    if (text.length > this.config.maxInputChars) {
      throw new Error(
        `LLM input of ${text.length} chars exceeds cap of ${this.config.maxInputChars}`,
      );
    }
  }

  _capTokens(requested) {
    const cap = this.config.maxOutputTokens;
    if (requested && requested > cap) {
      LOG.warn(`Requested ${requested} output tokens capped to ${cap}`);
    }
    return Math.min(requested || cap, cap);
  }

  async embed(text) {
    this._guardInput(text);
    if (this.config.provider === 'mock') {
      return mockEmbed(text, this.config.embeddingDimensions);
    }
    if (this.config.provider === 'openai') {
      if (!this.config.apiKey) throw new Error('OpenAI API key is not configured');
      return openaiEmbed(this.config, text);
    }
    throw new Error(`Unknown AI provider: ${this.config.provider}`);
  }

  // chat({ system, user, schema, temperature, maxTokens }) → validated object.
  // On invalid/unparseable JSON, retries once with a stricter instruction (§16).
  async chat({ system, user, schema, temperature = 0.2, maxTokens }) {
    this._guardInput(user);
    const cap = this._capTokens(maxTokens);
    const started = Date.now();

    const call = (sys, temp) => {
      if (this.config.provider === 'mock') {
        const rand = prng(hashSeed(`${sys}\n${user}`));
        return Promise.resolve(JSON.stringify(synthesize(schema, rand)));
      }
      if (this.config.provider === 'openai') {
        if (!this.config.apiKey) throw new Error('OpenAI API key is not configured');
        return openaiChat(this.config, { system: sys, user, schema, temperature: temp, maxTokens: cap });
      }
      throw new Error(`Unknown AI provider: ${this.config.provider}`);
    };

    const parseAndCheck = (raw) => {
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        return { ok: false, errors: ['response was not valid JSON'] };
      }
      const v = validate(schema, obj);
      return { ok: v.ok, errors: v.errors, obj };
    };

    let result = parseAndCheck(await call(system, temperature));
    if (!result.ok) {
      LOG.warn(`LLM output invalid (${result.errors.join('; ')}); retrying once`);
      const stricter = `${system}\n\nRespond with ONLY valid minified JSON matching the required schema. No prose.`;
      result = parseAndCheck(await call(stricter, 0));
      if (!result.ok) {
        throw new Error(`LLM returned invalid output after retry: ${result.errors.join('; ')}`);
      }
    }

    LOG.info(`chat ok provider=${this.config.provider} ms=${Date.now() - started}`);
    return result.obj;
  }
}

module.exports = new LLMClient();
module.exports.LLMClient = LLMClient;
module.exports.validate = validate;
