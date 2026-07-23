'use strict';
process.env.AI_PROVIDER = 'mock';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const embedder = require('../../srv/ai/embedder');

test('cosine returns 1 for identical vectors and ~0 for orthogonal', () => {
  assert.ok(Math.abs(embedder.cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(embedder.cosine([1, 0], [0, 1]), 0);
});

test('toVector parses JSON-string embeddings (sqlite round-trip) and rejects junk', () => {
  assert.deepEqual(embedder.toVector('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(embedder.toVector([1, 2, 3]), [1, 2, 3]);
  assert.equal(embedder.toVector('not json'), null);
  assert.equal(embedder.toVector(null), null);
});

test('rankBySimilarity orders by score, respects topK and minScore floor', () => {
  const q = [1, 0];
  const docs = [
    { ID: 'near', embedding: [0.9, 0.1] },
    { ID: 'far', embedding: [0, 1] },
    { ID: 'mid', embedding: [0.7, 0.7] },
  ];
  const ranked = embedder.rankBySimilarity(q, docs, { topK: 2 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].doc.ID, 'near'); // highest cosine first

  // A floor drops low-relevance docs.
  const floored = embedder.rankBySimilarity(q, docs, { topK: 5, minScore: 0.8 });
  assert.ok(floored.every((r) => r.score >= 0.8));
  assert.ok(floored.some((r) => r.doc.ID === 'near'));
  assert.ok(!floored.some((r) => r.doc.ID === 'far'));
});

test('defaultMinScore is 0 under mock (random vectors) and positive for real providers', () => {
  const prev = process.env.AI_PROVIDER;
  const prevOverride = process.env.AI_RAG_MIN_SCORE;
  delete process.env.AI_RAG_MIN_SCORE;

  process.env.AI_PROVIDER = 'mock';
  assert.equal(embedder.defaultMinScore(), 0);

  process.env.AI_PROVIDER = 'openai';
  assert.ok(embedder.defaultMinScore() > 0, 'real providers get a relevance floor');

  // Explicit override always wins.
  process.env.AI_RAG_MIN_SCORE = '0.42';
  assert.equal(embedder.defaultMinScore(), 0.42);

  process.env.AI_PROVIDER = prev;
  if (prevOverride === undefined) delete process.env.AI_RAG_MIN_SCORE;
  else process.env.AI_RAG_MIN_SCORE = prevOverride;
});
