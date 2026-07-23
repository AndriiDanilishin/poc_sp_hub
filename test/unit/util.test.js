'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clamp01, toIsoDateOrNull, formatContext } = require('../../srv/ai/util');

test('clamp01 bounds to 0..1 and coerces junk to 0', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01('0.3'), 0.3);
  assert.equal(clamp01('nonsense'), 0);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(null), 0);
});

test('toIsoDateOrNull accepts ISO dates in a plausible year', () => {
  assert.equal(toIsoDateOrNull('2026-09-15'), '2026-09-15');
  assert.equal(toIsoDateOrNull('2026-09-15T10:00:00Z'), '2026-09-15');
});

test('toIsoDateOrNull rejects junk the way new Date() would wrongly accept', () => {
  // The whole point of the strict helper: new Date('mock-42') → year 2041.
  assert.equal(toIsoDateOrNull('mock-42'), null);
  assert.equal(toIsoDateOrNull('mock-213161'), null);
  assert.equal(toIsoDateOrNull('not a date'), null);
  assert.equal(toIsoDateOrNull(''), null);
  assert.equal(toIsoDateOrNull(null), null);
  // Out of the plausible 1970..2100 window.
  assert.equal(toIsoDateOrNull('1850-01-01'), null);
  assert.equal(toIsoDateOrNull('2200-01-01'), null);
});

test('formatContext renders grouped docs and marks empty groups', () => {
  const out = formatContext({
    'Material Groups': [{ sourceRef: 'MG-LAB-001', title: 'Lab', content: 'microscopes' }],
    Suppliers: [],
  });
  assert.match(out, /\[MG-LAB-001\] Lab: microscopes/);
  assert.match(out, /Suppliers: \(no relevant knowledge found\)/);
});

test('formatContext falls back to ID when no sourceRef, and truncates content', () => {
  const out = formatContext({ G: [{ ID: 'abc', title: 'T', content: 'x'.repeat(500) }] });
  assert.match(out, /\[abc\] T:/);
  // content is sliced to 200 chars.
  assert.ok(out.length < 300);
});
