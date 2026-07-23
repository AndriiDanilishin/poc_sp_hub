'use strict';
process.env.AI_PROVIDER = 'mock';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDuplicates } = require('../../srv/ai/duplicate-detection');

test('detectDuplicates rejects a non-array', async () => {
  await assert.rejects(() => detectDuplicates(null), /requires an array/);
});

test('identical requirements are flagged as a duplicate pair with reasons', async () => {
  const items = [
    { ID: 'a', description: 'nitrile gloves size M', quantity: 10, unit: 'box' },
    { ID: 'b', description: 'nitrile gloves size M', quantity: 10, unit: 'box' },
  ];
  const { pairs, assignments } = await detectDuplicates(items, { threshold: 0.5 });
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].reasons.length > 0, 'a flagged pair explains why');
  // One of the two becomes duplicateOf the other (canonical = lowest index).
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].duplicateOf, 'a');
});

test('clearly different requirements are not flagged', async () => {
  const items = [
    { ID: 'a', description: 'inverted microscope with phase contrast', quantity: 2, unit: 'ea' },
    { ID: 'b', description: 'office paper A4 white', quantity: 50, unit: 'ream' },
  ];
  const { pairs } = await detectDuplicates(items, { threshold: 0.7 });
  assert.equal(pairs.length, 0);
});

test('lexical+structural signal catches near-duplicates even under mock embeddings', async () => {
  // Mock semantic vectors are ~orthogonal, so this relies on the lexical/structural
  // blend degrading gracefully (as documented).
  const items = [
    { ID: 'a', description: 'safety goggles clear', quantity: 20, unit: 'pcs' },
    { ID: 'b', description: 'safety goggles clear anti-fog', quantity: 20, unit: 'pcs' },
  ];
  const { pairs } = await detectDuplicates(items, { threshold: 0.5 });
  assert.ok(pairs.length >= 1, 'shared tokens + same unit/qty should flag');
});
