'use strict';
process.env.AI_PROVIDER = 'mock';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const qa = require('../../srv/ai/knowledge-qa');
const llm = require('../../srv/ai/llm-client');

const retrieved = [
  { ID: 'id-1', sourceRef: 'POL-001', title: 'Three Bids Policy' },
  { ID: 'id-2', sourceRef: 'GL-002', title: 'Framework suppliers' },
  { ID: 'id-3', sourceRef: null, title: 'No ref' },
];

test('resolveCitations keeps only retrieved documents, by sourceRef or ID', () => {
  const cited = qa.resolveCitations(['POL-001', 'INVENTED-9', 'id-3'], retrieved);
  assert.deepEqual(
    cited.map((d) => d.ID),
    ['id-1', 'id-3'],
  );
});

test('resolveCitations strips [brackets], ignores blanks and de-duplicates', () => {
  const cited = qa.resolveCitations(['[GL-002]', 'GL-002', '', null, ' POL-001 '], retrieved);
  assert.deepEqual(
    cited.map((d) => d.sourceRef),
    ['GL-002', 'POL-001'],
  );
});

test('resolveCitations tolerates a missing citation list', () => {
  assert.deepEqual(qa.resolveCitations(undefined, retrieved), []);
});

test('excerptOf collapses whitespace and truncates long content', () => {
  assert.equal(qa.excerptOf('  a\n\n b\tc  '), 'a b c');
  const long = qa.excerptOf('x'.repeat(1000));
  assert.ok(long.length <= 240);
  assert.ok(long.endsWith('…'));
  assert.equal(qa.excerptOf(null), '');
});

test('QA_SCHEMA accepts a well-formed answer and rejects a missing field', () => {
  const good = llm.validate(qa.QA_SCHEMA, {
    answer: 'yes',
    answered: true,
    citations: ['POL-001'],
  });
  assert.equal(good.ok, true);
  const bad = llm.validate(qa.QA_SCHEMA, { answer: 'yes', citations: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('answered')));
});
