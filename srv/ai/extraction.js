const cds = require('@sap/cds');
const llm = require('./llm-client');

const LOG = cds.log('ai.extraction');

// -----------------------------------------------------------------------------
// Requirement extraction (docs/solution-architecture.md §18).
//
// Pure AI logic: parsed document text -> proposed requirements. It returns plain
// objects and never touches the database — mapping to WorkspaceRequirement /
// RequirementSource rows is the service's job, keeping the AI module free of any
// OData/persistence knowledge (§14).
// -----------------------------------------------------------------------------

// Every AI system prompt opens with the same human-in-the-loop framing (§16, §25).
const SYSTEM_PROMPT = [
  'You extract procurement requirements from a source document.',
  'You propose values for a human to review. You never decide, approve, or submit anything.',
  'Return one entry per distinct item that needs to be procured.',
  'For each item provide: a concise description; the numeric quantity; the unit of',
  'measure; the requested delivery date if stated (ISO 8601 date, else null); the',
  'verbatim text snippet it was taken from; and a confidence between 0 and 1.',
  'If a field is not stated, use null (or 0 for an unknown quantity) — never invent data.',
].join(' ');

// Strict output contract, validated by llm-client before it returns (§16).
const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['requirements'],
  properties: {
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'quantity', 'unit', 'confidence'],
        properties: {
          description: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          requestedDate: { type: ['string', 'null'] },
          rawSnippet: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

// Strict: JS `new Date()` leniently accepts junk like "mock-42" (→ year 2041),
// so require an ISO leading date and sanity-check the year before trusting it.
function toIsoDateOrNull(value) {
  if (!value) return null;
  const str =
    value instanceof Date ? value.toISOString() : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(str)) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1970 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

// LLMs sometimes emit the literal string "null"/"none"/"n/a" instead of a JSON
// null for an absent value — normalize those to a real null.
function cleanString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str || /^(null|none|n\/a|na|unknown)$/i.test(str)) return null;
  return str;
}

function normalizeRequirement(r) {
  const quantity = Number(r.quantity);
  return {
    description: String(r.description ?? '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit: cleanString(r.unit),
    requestedDate: toIsoDateOrNull(r.requestedDate),
    rawSnippet: cleanString(r.rawSnippet) ?? '',
    // Per-requirement aggregate confidence, clamped to the documented 0..1 range.
    confidence: clamp01(r.confidence),
  };
}

/**
 * Extract proposed requirements from a document's text.
 * @param {string} text  parsed document text (from a document parser, §17)
 * @param {object} [opts]
 * @param {number} [opts.maxRequirements=50]  safety cap on returned items
 * @returns {Promise<{requirements: Array}>}
 */
async function extractRequirements(text, opts = {}) {
  const { maxRequirements = 50 } = opts;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('extractRequirements requires non-empty document text');
  }

  const result = await llm.chat({
    system: SYSTEM_PROMPT,
    user: `Source document:\n"""\n${text}\n"""`,
    schema: EXTRACTION_SCHEMA,
    temperature: 0.1,
  });

  const requirements = (result.requirements || [])
    .map(normalizeRequirement)
    .filter((r) => r.description.length > 0)
    .slice(0, maxRequirements);

  LOG.info(`extracted ${requirements.length} requirement(s) from ${text.length} chars`);
  return { requirements };
}

module.exports = { extractRequirements, EXTRACTION_SCHEMA, SYSTEM_PROMPT };
