const cds = require('@sap/cds');
const llm = require('./llm-client');

const LOG = cds.log('ai.embedder');

// -----------------------------------------------------------------------------
// Embedding + vector retrieval over the curated KnowledgeDocument corpus (§15).
//
// Only curated knowledge is embedded here — never uploaded source documents (§15).
// Storage note: the Vector(3072) column round-trips as a JSON string on the dev
// sqlite driver, so read-back is parsed and similarity is computed in JS. That is
// correct and portable at PoC corpus size (§30); on HANA, push COSINE_SIMILARITY
// into SQL for scale.
// -----------------------------------------------------------------------------

const MAX_EMBED_CHARS = 8000;

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

// Compute + store the embedding for a single KnowledgeDocument.
async function indexDocument(id) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  const doc = await SELECT.one.from(KnowledgeDocument).where({ ID: id });
  if (!doc) throw new Error(`KnowledgeDocument ${id} not found`);
  const vector = await embed(embeddableText(doc));
  await UPDATE(KnowledgeDocument).set({ embedding: vector }).where({ ID: id });
  return { id, dimensions: vector.length };
}

// (Re)embed the corpus. onlyMissing skips documents that already have a vector.
async function reindex({ onlyMissing = false } = {}) {
  const { KnowledgeDocument } = cds.entities('sourcing');
  const rows = await SELECT.from(KnowledgeDocument).columns('ID', 'title', 'content', 'embedding');
  let indexed = 0;
  for (const doc of rows) {
    if (onlyMissing && toVector(doc.embedding)) continue;
    const vector = await embed(embeddableText(doc));
    await UPDATE(KnowledgeDocument).set({ embedding: vector }).where({ ID: doc.ID });
    indexed++;
  }
  LOG.info(`reindexed ${indexed}/${rows.length} knowledge document(s)`);
  return { total: rows.length, indexed };
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
async function search(queryText, { category, topK = 5, minScore = -Infinity } = {}) {
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
  return rankBySimilarity(queryVector, candidates, { topK, minScore }).map((r) => {
    const result = { ...r.doc, score: r.score };
    delete result.embedding;
    return result;
  });
}

module.exports = {
  embed,
  indexDocument,
  reindex,
  search,
  cosine,
  toVector,
  rankBySimilarity,
  embeddableText,
};
