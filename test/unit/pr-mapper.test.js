'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPurchaseRequisition, correlationRef, toV2Date } = require('../../srv/s4/pr-mapper');
const { parseS4ErrorMessage, toS4Error } = require('../../srv/s4/pr-client');

const config = {
  defaults: {
    purchaseRequisitionType: 'NB',
    plant: '2610',
    companyCode: '2610',
    purchasingOrganization: '2610',
    purchasingGroup: '001',
    itemCategory: '0',
    accountAssignmentCategory: 'K',
    costCenter: '26101101',
    glAccount: '51100000',
    currency: 'PLN',
  },
  unitMap: { EA: 'PC', PC: 'PC', KG: 'KG' },
};
const today = new Date('2026-10-08T12:00:00Z');
const groups = new Map([
  ['MG-OFF-001', 'YBFA12'],
  ['MG-LAB-002', 'L004'],
]);
const project = {
  ID: 'e1000000-0000-4000-8000-000000000001',
  title: 'Office Refresh 2026',
  budgetCurrency: 'PLN',
  materialGroup_code: 'MG-OFF-001',
  timelineEnd: '2026-12-31',
  costCenter: null,
};
const chair = {
  description: 'Ergonomic office chairs',
  quantity: 20,
  unit: 'EA',
  unitPrice: 1450,
  deliveryDate: '2026-12-15',
  materialGroup_code: 'MG-OFF-001',
};

const build = (overrides = {}) =>
  buildPurchaseRequisition({
    project,
    requirements: [chair],
    materialGroups: groups,
    config,
    today,
    ...overrides,
  });

test('maps a valid project to the payload shape S/4HANA accepted (dry run 2026-10-08)', () => {
  const { payload, errors, reference } = build();
  assert.deepEqual(errors, []);
  assert.equal(reference, 'SP-E1000000');
  assert.equal(payload.PurchaseRequisitionType, 'NB');
  assert.equal(payload.PurReqnDescription, 'SP-E1000000 Office Refresh 2026');
  assert.equal(payload.PurReqnDoOnlyValidation, false);
  assert.deepEqual(payload.to_PurchaseReqnItem.results[0], {
    PurchaseRequisitionItem: '10',
    PurchaseRequisitionItemText: 'Ergonomic office chairs',
    MaterialGroup: 'YBFA12',
    Plant: '2610',
    CompanyCode: '2610',
    PurchasingOrganization: '2610',
    PurchasingGroup: '001',
    RequestedQuantity: '20.000',
    BaseUnit: 'PC',
    PurchaseRequisitionPrice: '1450.00',
    PurReqnPriceQuantity: '1',
    PurReqnItemCurrency: 'PLN',
    DeliveryDate: '/Date(1797292800000)/',
    PurchasingDocumentItemCategory: '0',
    AccountAssignmentCategory: 'K',
    to_PurchaseReqnAcctAssgmt: { results: [{ CostCenter: '26101101', GLAccount: '51100000' }] },
  });
});

test('numbers items 10, 20, 30 in the given order', () => {
  const { payload } = build({
    requirements: [chair, { ...chair, description: 'Desks' }, { ...chair, description: 'Lamps' }],
  });
  assert.deepEqual(
    payload.to_PurchaseReqnItem.results.map((i) => i.PurchaseRequisitionItem),
    ['10', '20', '30'],
  );
});

test('a project cost center overrides the default', () => {
  const { payload } = build({ project: { ...project, costCenter: ' 26109999 ' } });
  assert.equal(
    payload.to_PurchaseReqnItem.results[0].to_PurchaseReqnAcctAssgmt.results[0].CostCenter,
    '26109999',
  );
});

test('falls back to the project material group and timeline end', () => {
  const { payload, errors } = build({
    requirements: [{ ...chair, materialGroup_code: null, deliveryDate: null }],
  });
  assert.deepEqual(errors, []);
  const item = payload.to_PurchaseReqnItem.results[0];
  assert.equal(item.MaterialGroup, 'YBFA12');
  assert.equal(item.DeliveryDate, toV2Date('2026-12-31'));
});

test('truncates texts to the 40-character S/4HANA limit', () => {
  const long = 'x'.repeat(60);
  const { payload } = build({
    project: { ...project, title: long },
    requirements: [{ ...chair, description: long }],
  });
  assert.equal(payload.PurReqnDescription.length, 40);
  assert.ok(payload.PurReqnDescription.startsWith('SP-E1000000 '));
  assert.equal(payload.to_PurchaseReqnItem.results[0].PurchaseRequisitionItemText.length, 40);
});

test('validateOnly sets PurReqnDoOnlyValidation', () => {
  assert.equal(build({ validateOnly: true }).payload.PurReqnDoOnlyValidation, true);
});

test('reports every problem of an item in one readable message, and no payload', () => {
  const { payload, errors } = build({
    requirements: [
      {
        description: 'Nitrile gloves',
        quantity: 0,
        unit: 'BOX',
        unitPrice: null,
        deliveryDate: '2026-01-01',
        materialGroup_code: 'MG-UNKNOWN',
      },
    ],
  });
  assert.equal(payload, null);
  assert.equal(errors.length, 1);
  const msg = errors[0];
  assert.match(msg, /^Item "Nitrile gloves": /);
  assert.match(msg, /quantity must be greater than 0/);
  assert.match(msg, /unit "BOX" has no S\/4HANA equivalent/);
  assert.match(msg, /material group MG-UNKNOWN has no S\/4HANA code/);
  assert.match(msg, /unit price is missing/);
  assert.match(msg, /delivery date 2026-01-01 is in the past/);
});

test('an empty project cannot be submitted', () => {
  const { payload, errors } = build({ requirements: [] });
  assert.equal(payload, null);
  assert.deepEqual(errors, ['The project has no requirements to submit.']);
});

test('missing delivery date with no timeline end is reported', () => {
  const { errors } = build({
    project: { ...project, timelineEnd: null },
    requirements: [{ ...chair, deliveryDate: null }],
  });
  assert.match(errors[0], /delivery date is missing/);
});

test('correlationRef and toV2Date', () => {
  assert.equal(correlationRef('abcdef12-3456-4000-8000-000000000000'), 'SP-ABCDEF12');
  assert.equal(toV2Date('2026-11-30'), '/Date(1795996800000)/');
});

test('parseS4ErrorMessage reads the real S/4HANA error shape', () => {
  const body = {
    error: {
      code: '06/026',
      message: { lang: 'en', value: 'Please enter material number or account assignment category' },
      innererror: {
        errordetails: [
          {
            code: '06/026',
            message: 'Please enter material number or account assignment category',
            severity: 'error',
          },
          { code: 'ME/083', message: 'Enter a valid cost center', severity: 'error' },
        ],
      },
    },
  };
  assert.equal(
    parseS4ErrorMessage(body),
    'Please enter material number or account assignment category Enter a valid cost center (06/026)',
  );
  assert.equal(parseS4ErrorMessage(JSON.stringify(body)).endsWith('(06/026)'), true);
  assert.equal(parseS4ErrorMessage('<html>Bad gateway</html>'), '<html>Bad gateway</html>');
});

test('toS4Error: an answer is REJECTED, no answer or a gateway error is UNKNOWN', () => {
  const rejected = toS4Error({
    response: { status: 400, data: { error: { code: 'X/1', message: { value: 'bad' } } } },
  });
  assert.equal(rejected.outcome, 'REJECTED');
  assert.equal(rejected.status, 400);
  assert.equal(rejected.message, 'bad (X/1)');

  const wrapped = toS4Error({ message: 'outer', cause: { response: { status: 401, data: '' } } });
  assert.equal(wrapped.outcome, 'REJECTED');
  assert.equal(wrapped.status, 401);

  assert.equal(toS4Error(new Error('socket hang up')).outcome, 'UNKNOWN');
  assert.equal(toS4Error({ message: 'x', response: { status: 504, data: '' } }).outcome, 'UNKNOWN');
});
