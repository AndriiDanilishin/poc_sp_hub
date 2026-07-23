const cds = require('@sap/cds');
const llm = require('./llm-client');
const embedder = require('./embedder');
const { clamp01, formatContext } = require('./util');

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

// Master-data code shapes we can recognize in free text (§5). UNSPSC commodity codes
// are 8-digit numbers; material groups look like MG-XXX-NNN. Extend as catalogs grow.
const CODE_PATTERNS = [
  /\bMG-[A-Z0-9]+-\d+\b/g, // MaterialGroup, e.g. MG-LAB-001
  /\b\d{8}\b/g, // UNSPSC commodity, e.g. 41100000
];

// Pull any master-data-shaped codes out of a blob of text (title/content/sourceRef).
function extractCodes(text) {
  const s = String(text || '');
  const out = [];
  for (const re of CODE_PATTERNS) {
    const matches = s.match(re);
    if (matches) out.push(...matches);
  }
  return out;
}

// Build an ordered, de-duped list of candidate master-data codes for a recommendation,
// so the service can resolve against real master data even when the LLM echoes a
// knowledge sourceRef instead of the assignable code. Priority (most trusted first):
//   1. the code the LLM returned (may already be the real code),
//   2. the cited knowledge sourceRef (aligned to the real code for catalog docs),
//   3. any code-shaped token found in the cited grounding doc's title/content.
// Pure logic — no DB, no business decision; still proposes only (§25).
function buildCodeHints(candidate, groundingDocs) {
  const hints = [];
  const push = (v) => {
    const t = String(v || '').trim();
    if (t && !hints.includes(t)) hints.push(t);
  };

  push(candidate.code);
  push(candidate.citation);

  // Scan the doc the candidate cited (fall back to all retrieved docs) for real codes.
  const cited = (groundingDocs || []).filter(
    (d) => candidate.citation && (d.sourceRef === candidate.citation || d.ID === candidate.citation),
  );
  const scanDocs = cited.length ? cited : groundingDocs || [];
  for (const d of scanDocs) {
    for (const c of extractCodes(`${d.title || ''} ${d.content || ''} ${d.sourceRef || ''}`)) {
      push(c);
    }
  }
  return hints;
}

function normalizeList(list, maxPerType, groundingDocs) {
  return (list || [])
    .map((item) => ({
      ...item,
      confidence: clamp01(item.confidence),
      citation: item.citation ?? null,
      codeHints: buildCodeHints(item, groundingDocs),
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
    // Pass the retrieved docs so each candidate gets robust codeHints for resolution
    // against real master data (§25) — the LLM often echoes a sourceRef, not the code.
    materialGroups: normalizeList(result.materialGroups, maxPerType, materialGroupCtx),
    commodityCodes: normalizeList(result.commodityCodes, maxPerType, commodityCtx),
    suppliers: normalizeList(result.suppliers, maxPerType, supplierCtx),
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

module.exports = {
  enrichRequirement,
  ENRICHMENT_SCHEMA,
  SYSTEM_PROMPT,
  CATEGORY_FOR,
  extractCodes,
  buildCodeHints,
};
