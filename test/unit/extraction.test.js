'use strict';
process.env.AI_PROVIDER = 'mock';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractRequirements, EXTRACTION_SCHEMA } = require('../../srv/ai/extraction');
const llm = require('../../srv/ai/llm-client');

test('extractRequirements rejects empty text', async () => {
  await assert.rejects(() => extractRequirements(''), /non-empty document text/);
  await assert.rejects(() => extractRequirements('   '), /non-empty document text/);
});

test('extractRequirements returns a normalized {requirements} shape under mock', async () => {
  const { requirements } = await extractRequirements('Order 10 laptops and 5 keyboards.');
  assert.ok(Array.isArray(requirements));
  // Mock synthesizes one placeholder item; each is normalized to the documented shape.
  for (const r of requirements) {
    assert.equal(typeof r.description, 'string');
    assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence clamped to 0..1');
    // requestedDate is either null or a strict ISO date (never junk like "mock-42").
    if (r.requestedDate !== null) assert.match(r.requestedDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the extraction schema is internally valid against a hand-built sample', () => {
  const sample = {
    requirements: [
      {
        description: 'x',
        quantity: 2,
        unit: 'pcs',
        requestedDate: null,
        rawSnippet: 's',
        confidence: 0.9,
      },
    ],
  };
  assert.equal(llm.validate(EXTRACTION_SCHEMA, sample).ok, true);
});

test('extraction schema rejects a missing required field', () => {
  const bad = { requirements: [{ quantity: 2, unit: 'pcs', confidence: 0.5 }] }; // no description
  assert.equal(llm.validate(EXTRACTION_SCHEMA, bad).ok, false);
});
