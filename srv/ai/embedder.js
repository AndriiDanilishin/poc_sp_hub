const cds = require('@sap/cds');
const llm = require('./llm-client');

const LOG = cds.log('ai.embedder');

// -----------------------------------------------------------------------------
// Embedding + vector retrieval over the curated KnowledgeDocument corpus (§15).
//
// Only curated knowledge is embedded here — never uploaded source documents (§15).
// Storage note: the Vector(N) column round-trips as a JSON string on the dev
// sqlite driver, so read-back is parsed and similarity is computed in JS. That is
// correct and portable at PoC corpus size (§30); on HANA, push COSINE_SIMILARITY
// into SQL for scale.
// -----------------------------------------------------------------------------

const MAX_EMBED_CHARS = 8000;

// RAG relevance floor (Phase 4.1). Without one, search() returned the top-K even when
// every candidate was irrelevant, so enrichment/drafting grounded on garbage. The
// floor is provider-aware: the mock provider's embeddings are random unit vectors
// whose cosine scores sit near 0, so a real floor there would (correctly) return
// nothing and break offline/CI RAG — hence default 0 for mock. Real providers get a
// modest 0.15 default. Override with AI_RAG_MIN_SCORE / cds.env.ai.ragMinScore.
function defaultMinScore() {
  const env = cds.env.ai || {};
  const explicit = process.env.AI_RAG_MIN_SCORE ?? env.ragMinScore;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n;
  }
  const provider = process.env.AI_PROVIDER || env.provider || 'mock';
  return provider === 'mock' ? 0 : 0.15;
}

// Normalize a stored embedding (JSON string on sqlite, array elsewhere) to number[].
function toVector(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null; // HANA REAL_VECTOR binary is handled by SQL-side similarity, not here
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// Thin wrapper over the adapter; truncates over-long input before embedding.
async function embed(text) {
  const input = String(text ?? '').slice(0, MAX_EMBED_CHARS);
  return llm.embed(input);
}

function embeddableText(doc) {
  return [doc.title, doc.content].filter(Boolean).join('\n');
}

// Invariant: a stored vector stays exactly as long as the text it was computed from.
// Callers that CHANGE the embedded text clear it first (markPending); callers that
// know the text cannot be embedded at all clear it via markFailed. A failed embed
// call on its own (provider outage, 429, 5xx, bad key) says nothing about the
// text, so it must not delete a vector that still matches it — otherwise a Reindex
// during an outage would empty retrieval for the whole corpus.

// Errors that mean the document's own text is unusable, so any old vector is stale.
class UnembeddableTextError extends Error {}

/**
 * What to write after a failed embed attempt. Pure — exported for testing.
 * @param {{hasVector: boolean, error: Error}} args
 * @returns {object} the column values to set on the KnowledgeDocument row
 */
function failureUpdate({ hasVector, error }) {
  const message = String(error?.message || 'indexing failed');
  if (hasVector && !(error instanceof UnembeddableTextError)) {
    // Still searchable with the embedding of the unchanged text: keep vector,
    // status and indexedAt, and surface the failure in indexError.
    return {
      indexError: `Last reindex failed (previous embedding kept): ${message}`.slice(0, 1000),
    };
  }
  return {
    embedding: null,
    indexStatus: 'FAILED',
    indexedAt: null,
    indexError: message.slice(0, 1000),
  };
}

// Record that a document's text cannot be indexed (unparseable upload, no content).
// Clears the vector: the text it was computed from is gone or invalid.
async function markFailed(id, message) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  await UPDATE(KnowledgeDocument)
    .set({
      embedding: null,
      indexStatus: 'FAILED',
      indexedAt: null,
      indexError: String(message || 'indexing failed').slice(0, 1000),
    })
    .where({ ID: id });
}

// Mark a document as needing a fresh embedding (its embedded text changed).
async function markPending(id) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  await UPDATE(KnowledgeDocument)
    .set({ embedding: null, indexStatus: 'PENDING', indexedAt: null, indexError: null })
    .where({ ID: id });
}

// Embed one row and store the vector with its status. On failure, records it per
// failureUpdate (keeps a still-valid vector) and rethrows. `doc` must carry
// `embedding` so the failure path knows whether a vector exists.
async function embedRow(doc) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  const text = embeddableText(doc).trim();
  try {
    if (!doc.content || !String(doc.content).trim()) {
      throw new UnembeddableTextError('document has no content to embed');
    }
    const vector = await embed(text);
    await UPDATE(KnowledgeDocument)
      .set({ embedding: vector, indexStatus: 'INDEXED', indexedAt: new Date(), indexError: null })
      .where({ ID: doc.ID });
    return vector.length;
  } catch (err) {
    const hasVector = Boolean(toVector(doc.embedding));
    await UPDATE(KnowledgeDocument)
      .set(failureUpdate({ hasVector, error: err }))
      .where({
        ID: doc.ID,
      });
    throw err;
  }
}

// Compute + store the embedding for a single KnowledgeDocument. On failure the
// error is recorded on the row (see failureUpdate) and rethrown.
async function indexDocument(id) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  const doc = await SELECT.one
    .from(KnowledgeDocument)
    .columns('ID', 'title', 'content', 'embedding')
    .where({ ID: id });
  if (!doc) throw new Error(`KnowledgeDocument ${id} not found`);
  const dimensions = await embedRow(doc);
  return { id, dimensions };
}

// (Re)embed the corpus. onlyMissing skips documents that are already INDEXED with a
// vector. Continue-on-failure: one bad document (empty content, a transient provider
// error) is recorded as FAILED on its row and no longer aborts the whole pass.
async function reindex({ onlyMissing = false } = {}) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  const rows = await SELECT.from(KnowledgeDocument).columns(
    'ID',
    'title',
    'content',
    'embedding',
    'indexStatus',
  );
  let indexed = 0;
  let failed = 0;
  for (const doc of rows) {
    if (onlyMissing && doc.indexStatus === 'INDEXED' && toVector(doc.embedding)) continue;
    try {
      await embedRow(doc);
      indexed++;
    } catch (err) {
      failed++;
      LOG.warn(`reindex: ${doc.ID} failed: ${err.message}`);
    }
  }
  LOG.info(`reindexed ${indexed}/${rows.length} knowledge document(s), ${failed} failed`);
  return { total: rows.length, indexed, failed };
}

// Pure ranking helper (exported for testing): score candidates against a query vector.
// By default there is no score floor — return the top-K and let the caller threshold.
function rankBySimilarity(queryVector, docs, { topK = 5, minScore = -Infinity } = {}) {
  return docs
    .map((d) => ({ doc: d, score: cosine(queryVector, toVector(d.embedding) || []) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * RAG retrieval primitive (§15): embed the query, return the most similar curated
 * documents. Used by enrichment/drafting to ground AI recommendations.
 */
async function search(queryText, { category, topK = 5, minScore } = {}) {
  // Apply the provider-aware relevance floor when the caller doesn't specify one.
  const floor = minScore === undefined ? defaultMinScore() : minScore;
  const { KnowledgeDocument } = cds.entities('sourcing');
  const queryVector = await embed(queryText);

  let query = SELECT.from(KnowledgeDocument).columns(
    'ID',
    'category',
    'title',
    'content',
    'sourceRef',
    'embedding',
  );
  if (category) query = query.where({ category });
  const rows = await query;

  const candidates = rows.filter((r) => toVector(r.embedding));
  return rankBySimilarity(queryVector, candidates, { topK, minScore: floor }).map((r) => {
    const result = { ...r.doc, score: r.score };
    delete result.embedding;
    return result;
  });
}

module.exports = {
  embed,
  indexDocument,
  markPending,
  markFailed,
  failureUpdate,
  UnembeddableTextError,
  reindex,
  search,
  cosine,
  toVector,
  rankBySimilarity,
  embeddableText,
  defaultMinScore,
};
