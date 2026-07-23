'use strict';
process.env.AI_PROVIDER = 'mock'; // offline, deterministic — no key, no network
const { test } = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../../srv/ai/llm-client');

test('validate accepts a matching object', () => {
  const schema = {
    type: 'object',
    required: ['name', 'n'],
    properties: { name: { type: 'string' }, n: { type: 'number' } },
  };
  const r = llm.validate(schema, { name: 'x', n: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('validate reports missing required, wrong type, and bad enum', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      sev: { type: 'string', enum: ['Low', 'High'] },
    },
  };
  const r = llm.validate(schema, { sev: 'Nope' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /name: required/.test(e)));
  assert.ok(r.errors.some((e) => /not in enum/.test(e)));
});

test('validate treats integers as valid numbers and recurses arrays', () => {
  const schema = {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', items: { type: 'object', properties: { c: { type: 'number' } } } },
    },
  };
  assert.equal(llm.validate(schema, { items: [{ c: 3 }, { c: 1.5 }] }).ok, true);
  assert.equal(llm.validate(schema, { items: [{ c: 'x' }] }).ok, false);
});

test('redactPii scrubs email / phone / IBAN / card but keeps product text', () => {
  const out = llm.redactPii(
    'Contact jane.doe@acme.com or +1 415 555 1234. IBAN DE89370400440532013000. ' +
      'Card 4111 1111 1111 1111. Order 10 microscopes.',
  );
  assert.match(out, /\[EMAIL\]/);
  assert.match(out, /\[PHONE\]/);
  assert.match(out, /\[IBAN\]/);
  assert.match(out, /\[CARD\]/);
  // Procurement content must survive redaction.
  assert.match(out, /10 microscopes/);
  assert.doesNotMatch(out, /jane\.doe@acme\.com/);
});

test('mock chat returns a schema-valid object deterministically', async () => {
  const schema = {
    type: 'object',
    required: ['requirements'],
    properties: { requirements: { type: 'array', items: { type: 'object' } } },
  };
  const a = await llm.chat({ system: 's', user: 'u', schema });
  const b = await llm.chat({ system: 's', user: 'u', schema });
  assert.ok(Array.isArray(a.requirements));
  assert.deepEqual(a, b); // deterministic for the same input
});

test('mock embed returns a unit vector of the configured dimension', async () => {
  const v = await llm.embed('some text');
  assert.equal(v.length, 3072);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, `expected unit vector, got norm ${norm}`);
});

test('chat/embed guard rejects empty input', async () => {
  await assert.rejects(() => llm.embed(''), /non-empty string/);
  await assert.rejects(
    () => llm.chat({ system: 's', user: '', schema: { type: 'object' } }),
    /non-empty string/,
  );
});
