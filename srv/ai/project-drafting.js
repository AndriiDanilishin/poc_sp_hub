const cds = require('@sap/cds');
const llm = require('./llm-client');
const embedder = require('./embedder');
const { clamp01, toIsoDateOrNull, formatContext } = require('./util');

const LOG = cds.log('ai.drafting');

// -----------------------------------------------------------------------------
// Sourcing Project drafting (docs/solution-architecture.md §20, §16).
//
// From the accepted requirements, propose the project's narrative fields and a
// risk list, grounded via RAG in procurement guidelines and similar past
// projects. Every field is a proposal the human edits/approves (§25); the service
// marks the persisted rows aiGenerated=true until a human changes them.
// -----------------------------------------------------------------------------

const PRIORITIES = ['Low', 'Medium', 'High'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

const SYSTEM_PROMPT = [
  'You draft a sourcing project from a set of accepted procurement requirements.',
  'You propose values for a human to review. You never decide, approve, or submit anything.',
  'Ground the draft in the retrieved guidelines, past projects and supplier profiles; do',
  'not invent policy or suppliers.',
  'Return named fields only: a concise title, a description, a category, a priority',
  `(one of ${PRIORITIES.join('/')}), a suggested timeline (ISO dates or null), a list of`,
  `risks each with a severity (one of ${SEVERITIES.join('/')}) and a mitigation, and a list`,
  'of suggested suppliers (only suppliers named in the retrieved supplier profiles), each',
  'with a confidence between 0 and 1 and a short rationale.',
].join(' ');

const DRAFT_SCHEMA = {
  type: 'object',
  required: ['title', 'description', 'priority', 'timeline', 'risks', 'suppliers'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    category: { type: ['string', 'null'] },
    priority: { type: 'string', enum: PRIORITIES },
    timeline: {
      type: 'object',
      required: ['start', 'end'],
      properties: {
        start: { type: ['string', 'null'] },
        end: { type: ['string', 'null'] },
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'severity'],
        properties: {
          description: { type: 'string' },
          category: { type: ['string', 'null'] },
          severity: { type: 'string', enum: SEVERITIES },
          mitigation: { type: ['string', 'null'] },
        },
      },
    },
    suppliers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'confidence'],
        properties: {
          name: { type: 'string' },
          confidence: { type: 'number' },
          rationale: { type: ['string', 'null'] },
          citation: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function summarizeRequirements(requirements) {
  return requirements
    .map((r, i) => {
      const qty = r.quantity ? ` (qty ${r.quantity}${r.unit ? ' ' + r.unit : ''})` : '';
      return `${i + 1}. ${r.description}${qty}`;
    })
    .join('\n');
}

function normalizeDraft(result, { maxRisks, maxSuppliers, grounding }) {
  const risks = (result.risks || [])
    .map((r) => ({
      description: String(r.description || '').trim(),
      category: r.category ? String(r.category).trim() : null,
      severity: SEVERITIES.includes(r.severity) ? r.severity : 'Medium',
      mitigation: r.mitigation ? String(r.mitigation).trim() : null,
    }))
    .filter((r) => r.description.length > 0)
    .slice(0, maxRisks);

  const suppliers = (result.suppliers || [])
    .map((s) => ({
      name: String(s.name || '').trim(),
      confidence: clamp01(s.confidence),
      rationale: s.rationale ? String(s.rationale).trim() : null,
      citation: s.citation ? String(s.citation).trim() : null,
    }))
    .filter((s) => s.name.length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxSuppliers);

  return {
    title: String(result.title || '').trim() || 'Untitled Sourcing Project',
    description: String(result.description || '').trim(),
    category: result.category ? String(result.category).trim() : null,
    priority: PRIORITIES.includes(result.priority) ? result.priority : 'Medium',
    timeline: {
      start: toIsoDateOrNull(result.timeline?.start),
      end: toIsoDateOrNull(result.timeline?.end),
    },
    risks,
    suppliers,
    grounding,
  };
}

/**
 * @param {Array<{description, quantity?, unit?}>} requirements  accepted requirements
 * @param {object} [opts]
 * @param {number} [opts.topK=5]        retrieved knowledge items per category
 * @param {number} [opts.maxRisks=5]    risks returned
 * @param {string} [opts.workspaceTitle]  optional working title hint
 * @returns {Promise<object>} the proposed draft (title, description, category, priority, timeline, risks, grounding)
 */
async function draftSourcingProject(requirements, opts = {}) {
  const { topK = 5, maxRisks = 5, maxSuppliers = 5, workspaceTitle } = opts;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('draftSourcingProject requires at least one requirement');
  }

  const summary = summarizeRequirements(requirements);

  // RAG grounding from guidelines, similar past projects and supplier profiles (§20).
  const [guidelines, pastProjects, supplierProfiles] = await Promise.all([
    embedder.search(summary, { category: 'Guideline', topK }),
    embedder.search(summary, { category: 'PastProject', topK }),
    embedder.search(summary, { category: 'SupplierProfile', topK }),
  ]);
  const context = formatContext({
    Guidelines: guidelines,
    'Past projects': pastProjects,
    'Supplier profiles': supplierProfiles,
  });

  const result = await llm.chat({
    system: SYSTEM_PROMPT,
    user:
      `${workspaceTitle ? `Working title: ${workspaceTitle}\n\n` : ''}` +
      `Accepted requirements:\n${summary}\n\nRetrieved knowledge:\n${context}`,
    schema: DRAFT_SCHEMA,
    temperature: 0.5,
  });

  const draft = normalizeDraft(result, {
    maxRisks,
    maxSuppliers,
    grounding: [...guidelines, ...pastProjects, ...supplierProfiles].map(
      (d) => d.sourceRef || d.ID,
    ),
  });

  LOG.info(
    `drafted project "${draft.title}" from ${requirements.length} requirement(s), ` +
      `${draft.risks.length} risk(s), ${draft.suppliers.length} supplier(s)`,
  );
  return draft;
}

module.exports = { draftSourcingProject, DRAFT_SCHEMA, SYSTEM_PROMPT, PRIORITIES, SEVERITIES };
