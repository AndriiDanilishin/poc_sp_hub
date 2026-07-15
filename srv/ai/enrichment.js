const cds = require('@sap/cds');
const llm = require('./llm-client');
const embedder = require('./embedder');

const LOG = cds.log('ai.enrichment');

// -----------------------------------------------------------------------------
// Requirement enrichment (docs/solution-architecture.md §5, §15, §16).
//
// RAG-grounded: retrieve curated knowledge per category via the embedder, then
// ask the LLM for ranked Material Group / Commodity Code / Supplier candidates,
// each with a confidence and a citation back to the knowledge sourceRef. Proposes
// only (§25); the human accepts/edits/rejects in the Requirement Workspace.
// -----------------------------------------------------------------------------

// Which curated KnowledgeDocument category grounds each recommendation type (§15).
const CATEGORY_FOR = {
  materialGroups: 'MaterialGroupCatalog',
  commodityCodes: 'CommodityTaxonomy',
  suppliers: 'SupplierProfile',
};

const SYSTEM_PROMPT = [
  'You recommend procurement metadata for a single requirement.',
  'You propose values for a human to review. You never decide, approve, or submit anything.',
  'Use ONLY the retrieved knowledge provided as grounding — do not invent codes or suppliers.',
  'For each recommendation give a confidence between 0 and 1 and cite the sourceRef of the',
  'knowledge item it is based on (or null if none applies). Return an empty array for a type',
  'when the retrieved knowledge supports nothing relevant.',
].join(' ');

const ENRICHMENT_SCHEMA = {
  type: 'object',
  required: ['materialGroups', 'commodityCodes', 'suppliers'],
  properties: {
    materialGroups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'confidence'],
        properties: {
          code: { type: ['string', 'null'] },
          name: { type: 'string' },
          confidence: { type: 'number' },
          citation: { type: ['string', 'null'] },
        },
      },
    },
    commodityCodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'confidence'],
        properties: {
          code: { type: ['string', 'null'] },
          description: { type: 'string' },
          confidence: { type: 'number' },
          citation: { type: ['string', 'null'] },
        },
      },
    },
    suppliers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'confidence'],
        properties: {
          id: { type: ['string', 'null'] },
          name: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: ['string', 'null'] },
          citation: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

function formatContext(groups) {
  const parts = [];
  for (const [label, docs] of Object.entries(groups)) {
    if (!docs.length) {
      parts.push(`${label}: (no relevant knowledge found)`);
      continue;
    }
    const lines = docs
      .map((d) => `- [${d.sourceRef || d.ID}] ${d.title}: ${String(d.content || '').slice(0, 200)}`)
      .join('\n');
    parts.push(`${label}:\n${lines}`);
  }
  return parts.join('\n\n');
}

function normalizeList(list, maxPerType) {
  return (list || [])
    .map((item) => ({
      ...item,
      confidence: clamp01(item.confidence),
      citation: item.citation ?? null,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxPerType);
}

/**
 * @param {{description?, normalizedDescription?}} requirement
 * @param {object} [opts]
 * @param {number} [opts.topK=5]        retrieved knowledge items per category
 * @param {number} [opts.maxPerType=3]  recommendations returned per type
 * @returns {Promise<{materialGroups, commodityCodes, suppliers, grounding}>}
 */
async function enrichRequirement(requirement, opts = {}) {
  const { topK = 5, maxPerType = 3 } = opts;
  const description = String(
    requirement.normalizedDescription || requirement.description || '',
  ).trim();
  if (!description) {
    throw new Error('enrichRequirement requires a description');
  }

  // RAG retrieval — one grounded search per recommendation type (§15).
  const [materialGroupCtx, commodityCtx, supplierCtx] = await Promise.all([
    embedder.search(description, { category: CATEGORY_FOR.materialGroups, topK }),
    embedder.search(description, { category: CATEGORY_FOR.commodityCodes, topK }),
    embedder.search(description, { category: CATEGORY_FOR.suppliers, topK }),
  ]);

  const context = formatContext({
    'Material Groups': materialGroupCtx,
    'Commodity Codes': commodityCtx,
    Suppliers: supplierCtx,
  });

  const result = await llm.chat({
    system: SYSTEM_PROMPT,
    user: `Requirement:\n${description}\n\nRetrieved knowledge:\n${context}`,
    schema: ENRICHMENT_SCHEMA,
    temperature: 0.3,
  });

  const enriched = {
    materialGroups: normalizeList(result.materialGroups, maxPerType),
    commodityCodes: normalizeList(result.commodityCodes, maxPerType),
    suppliers: normalizeList(result.suppliers, maxPerType),
    // Which knowledge grounded the request — kept for auditability/explainability.
    grounding: {
      materialGroups: materialGroupCtx.map((d) => d.sourceRef || d.ID),
      commodityCodes: commodityCtx.map((d) => d.sourceRef || d.ID),
      suppliers: supplierCtx.map((d) => d.sourceRef || d.ID),
    },
  };

  LOG.info(
    `enriched "${description.slice(0, 40)}": ` +
      `${enriched.materialGroups.length} MG, ${enriched.commodityCodes.length} CC, ` +
      `${enriched.suppliers.length} suppliers`,
  );
  return enriched;
}

module.exports = { enrichRequirement, ENRICHMENT_SCHEMA, SYSTEM_PROMPT, CATEGORY_FOR };
