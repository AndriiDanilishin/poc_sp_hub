'use strict';

// -----------------------------------------------------------------------------
// SourcingProject + Requirements → S/4HANA Purchase Requisition payload (§21).
//
// Pure logic, no DB and no HTTP, so every mapping rule is unit-testable. Builds the
// OData V2 deep insert for API_PURCHASEREQ_PROCESS_SRV (A_PurchaseRequisitionHeader
// → to_PurchaseReqnItem → to_PurchaseReqnAcctAssgmt), the exact shape validated
// against tenant my439575 (see submitToS4.md).
//
// Never throws on bad data: it returns one readable message per offending item in
// `errors`, so the caller can block the submission and tell the user what to fix
// instead of letting S/4HANA reject it with a terse message code.
// -----------------------------------------------------------------------------

// Field limits from the service $metadata.
const MAX_TEXT = 40; // PurchaseRequisitionItemText, PurReqnDescription
const MAX_PRICE = 999999999.999; // PurchaseRequisitionPrice Decimal(12,3)
const MAX_QUANTITY = 9999999999.999; // RequestedQuantity Decimal(13,3)

/** ISO date string (YYYY-MM-DD) from a CDS Date value, or null. */
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return m ? m[1] : null;
}

/** OData V2 Edm.DateTime literal for a calendar date: "/Date(<ms since epoch, UTC>)/". */
function toV2Date(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `/Date(${Date.UTC(y, m - 1, d)})/`;
}

/**
 * Correlation reference written into the PR header description. Lets a later submit
 * find a requisition S/4HANA created even though its response never arrived.
 */
function correlationRef(projectId) {
  return 'SP-' + String(projectId).replace(/-/g, '').slice(0, 8).toUpperCase();
}

function truncate(text, max) {
  const s = String(text ?? '').trim();
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

/**
 * @param {object} args
 * @param {object} args.project        SourcingProject row
 * @param {object[]} args.requirements Requirement rows, in item order
 * @param {Map<string,string>} args.materialGroups internal code → S/4 code (s4Code)
 * @param {object} args.config         cds.env.s4 (defaults + unitMap)
 * @param {boolean} [args.validateOnly] sets PurReqnDoOnlyValidation
 * @param {Date} [args.today]          injectable clock for tests
 * @returns {{ payload: object|null, errors: string[], reference: string }}
 */
function buildPurchaseRequisition({
  project,
  requirements,
  materialGroups,
  config,
  validateOnly = false,
  today = new Date(),
}) {
  const d = config.defaults || {};
  const unitMap = config.unitMap || {};
  const reference = correlationRef(project.ID);
  const todayIso = today.toISOString().slice(0, 10);
  const currency = String(project.budgetCurrency || d.currency || '').toUpperCase();
  const costCenter = String(project.costCenter || '').trim() || d.costCenter;
  const errors = [];

  if (!requirements.length) errors.push('The project has no requirements to submit.');
  if (!currency) errors.push('The project has no currency.');

  const items = requirements.map((r, idx) => {
    const problems = [];
    const text = truncate(r.description, MAX_TEXT);
    if (!text) problems.push('the description is empty');

    const quantity = Number(r.quantity);
    if (!(quantity > 0)) problems.push('the quantity must be greater than 0');
    else if (quantity > MAX_QUANTITY) problems.push('the quantity is too large for S/4HANA');

    const unit = String(r.unit || '').trim();
    const s4Unit = unitMap[unit.toUpperCase()];
    if (!unit) problems.push('the unit is missing');
    else if (!s4Unit) problems.push(`the unit "${unit}" has no S/4HANA equivalent`);

    const groupCode = r.materialGroup_code || project.materialGroup_code;
    const s4Group = groupCode ? materialGroups.get(groupCode) : null;
    if (!groupCode) problems.push('no material group is assigned');
    else if (!s4Group) problems.push(`material group ${groupCode} has no S/4HANA code`);

    const price = Number(r.unitPrice);
    if (!(price > 0)) problems.push('the unit price is missing');
    else if (price > MAX_PRICE) problems.push('the unit price is too large for S/4HANA');

    const delivery = toIsoDate(r.deliveryDate) || toIsoDate(project.timelineEnd);
    if (!delivery) problems.push('the delivery date is missing');
    else if (delivery < todayIso) problems.push(`the delivery date ${delivery} is in the past`);

    if (problems.length) {
      const label = truncate(r.description, MAX_TEXT) || `#${idx + 1}`;
      errors.push(`Item "${label}": ${problems.join(', ')}.`);
    }

    return {
      PurchaseRequisitionItem: String((idx + 1) * 10),
      PurchaseRequisitionItemText: text,
      MaterialGroup: s4Group || null,
      Plant: d.plant,
      CompanyCode: d.companyCode,
      PurchasingOrganization: d.purchasingOrganization,
      PurchasingGroup: d.purchasingGroup,
      RequestedQuantity: quantity > 0 ? quantity.toFixed(3) : null,
      BaseUnit: s4Unit || null,
      PurchaseRequisitionPrice: price > 0 ? price.toFixed(2) : null,
      PurReqnPriceQuantity: '1',
      PurReqnItemCurrency: currency,
      DeliveryDate: delivery ? toV2Date(delivery) : null,
      PurchasingDocumentItemCategory: d.itemCategory,
      AccountAssignmentCategory: d.accountAssignmentCategory,
      to_PurchaseReqnAcctAssgmt: {
        results: [{ CostCenter: costCenter, GLAccount: d.glAccount }],
      },
    };
  });

  if (errors.length) return { payload: null, errors, reference };

  return {
    payload: {
      PurchaseRequisitionType: d.purchaseRequisitionType,
      PurReqnDescription: truncate(`${reference} ${project.title || ''}`, MAX_TEXT),
      PurReqnDoOnlyValidation: !!validateOnly,
      to_PurchaseReqnItem: { results: items },
    },
    errors,
    reference,
  };
}

module.exports = { buildPurchaseRequisition, correlationRef, toV2Date, toIsoDate };
