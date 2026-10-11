const cds = require('@sap/cds');
const llm = require('./llm-client');
const embedder = require('./embedder');

const LOG = cds.log('ai.knowledge-qa');

// -----------------------------------------------------------------------------
// Grounded question answering over the curated KnowledgeDocument corpus (§15).
//
// Retrieve the closest curated documents, then ask the LLM to answer ONLY from
// them and cite the sourceRefs it used. The answer is informational — it never
// creates or changes business objects (§25). Citations are checked against the
// retrieved set: a sourceRef the model invents is dropped, the same way enrichment
// never writes a code that does not resolve against master data.
// -----------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You answer questions about the organisation's procurement knowledge base.",
  'Use ONLY the retrieved knowledge provided. If it does not contain the answer, say so',
  'plainly and set "answered" to false — never guess or use outside knowledge.',
  'Cite the sourceRef (the value in square brackets) of every knowledge item you relied on.',
  'Keep the answer short and factual.',
].join(' ');

const QA_SCHEMA = {
  type: 'object',
  required: ['answer', 'answered', 'citations'],
  properties: {
    answer: { type: 'string' },
    answered: { type: 'boolean' },
    citations: { type: 'array', items: { type: 'string' } },
  },
};

const EXCERPT_CHARS = 240;

// Per-document context budget. util.formatContext trims to 200 chars, which suits
// enrichment's short catalog entries but is too little to answer a question from a
// policy or past-project write-up.
const CONTEXT_CHARS = 1500;

function formatKnowledge(docs) {
  return docs
    .map(
      (d) =>
        `- [${d.sourceRef || d.ID}] ${d.title}: ${String(d.content || '').slice(0, CONTEXT_CHARS)}`,
    )
    .join('\n');
}

// Short, single-line preview of a document's content for result lists.
function excerptOf(content) {
  const text = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text;
}

// Shape a search hit for API consumers: no vector, no full content.
function toHit(doc) {
  return {
    ID: doc.ID,
    category: doc.category,
    title: doc.title,
    sourceRef: doc.sourceRef,
    score: Math.round(doc.score * 10000) / 10000,
    excerpt: excerptOf(doc.content),
  };
}

/**
 * Keep only citations that point at a retrieved document (by sourceRef or ID),
 * de-duplicated, in the model's order. Pure — exported for testing.
 * @returns {Array<object>} the matching retrieved documents
 */
function resolveCitations(citations, retrieved) {
  const out = [];
  for (const raw of citations || []) {
    const ref = String(raw || '')
      .replace(/^\[|\]$/g, '')
      .trim();
    if (!ref) continue;
    const doc = retrieved.find((d) => d.sourceRef === ref || d.ID === ref);
    if (doc && !out.includes(doc)) out.push(doc);
  }
  return out;
}

/**
 * Retrieval only — what RAG would ground on for this query.
 * @returns {Promise<Array<{ID, category, title, sourceRef, score, excerpt}>>}
 */
async function searchKnowledge(query, { category, topK = 5, minScore } = {}) {
  const text = String(query || '').trim();
  if (!text) throw new Error('searchKnowledge requires a query');
  const docs = await embedder.search(text, { category, topK, minScore });
  return docs.map(toHit);
}

/**
 * Answer a question from the corpus.
 * @returns {Promise<{answer: string, answered: boolean, citations: Array, retrieved: Array}>}
 */
async function askKnowledge(question, { category, topK = 5 } = {}) {
  const text = String(question || '').trim();
  if (!text) throw new Error('askKnowledge requires a question');

  const retrieved = await embedder.search(text, { category, topK });
  if (!retrieved.length) {
    // Nothing relevant to ground on: answering anyway would be the model's own
    // knowledge, which is exactly what a grounded answer must not be.
    return {
      answer: 'The knowledge base has no documents relevant to this question.',
      answered: false,
      citations: [],
      retrieved: [],
    };
  }

  const result = await llm.chat({
    system: SYSTEM_PROMPT,
    user: `Question:\n${text}\n\nRetrieved knowledge:\n${formatKnowledge(retrieved)}`,
    schema: QA_SCHEMA,
    temperature: 0.2,
  });

  const cited = resolveCitations(result.citations, retrieved);
  const dropped = (result.citations || []).length - cited.length;
  if (dropped > 0) LOG.warn(`dropped ${dropped} citation(s) not in the retrieved set`);

  return {
    answer: String(result.answer || '').trim(),
    // An answer that cites nothing it was given is not grounded, whatever the
    // model claims.
    answered: Boolean(result.answered) && cited.length > 0,
    citations: cited.map(toHit),
    retrieved: retrieved.map(toHit),
  };
}

module.exports = {
  searchKnowledge,
  askKnowledge,
  resolveCitations,
  excerptOf,
  QA_SCHEMA,
  SYSTEM_PROMPT,
};
