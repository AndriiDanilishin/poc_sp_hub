const cds = require('@sap/cds');
const llm = require('./llm-client');
const embedder = require('./embedder');

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
  'Ground the draft in the retrieved guidelines and past projects; do not invent policy.',
  'Return named fields only: a concise title, a description, a category, a priority',
  `(one of ${PRIORITIES.join('/')}), a suggested timeline (ISO dates or null), and a list of`,
  `risks each with a severity (one of ${SEVERITIES.join('/')}) and a mitigation.`,
].join(' ');

const DRAFT_SCHEMA = {
  type: 'object',
  required: ['title', 'description', 'priority', 'timeline', 'risks'],
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
  },
};

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

function summarizeRequirements(requirements) {
  return requirements
    .map((r, i) => {
      const qty = r.quantity ? ` (qty ${r.quantity}${r.unit ? ' ' + r.unit : ''})` : '';
      return `${i + 1}. ${r.description}${qty}`;
    })
    .join('\n');
}

function normalizeDraft(result, { maxRisks, grounding }) {
  const risks = (result.risks || [])
    .map((r) => ({
      description: String(r.description || '').trim(),
      category: r.category ? String(r.category).trim() : null,
      severity: SEVERITIES.includes(r.severity) ? r.severity : 'Medium',
      mitigation: r.mitigation ? String(r.mitigation).trim() : null,
    }))
    .filter((r) => r.description.length > 0)
    .slice(0, maxRisks);

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
  const { topK = 5, maxRisks = 5, workspaceTitle } = opts;
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('draftSourcingProject requires at least one requirement');
  }

  const summary = summarizeRequirements(requirements);

  // RAG grounding from guidelines and similar past projects (§20).
  const [guidelines, pastProjects] = await Promise.all([
    embedder.search(summary, { category: 'Guideline', topK }),
    embedder.search(summary, { category: 'PastProject', topK }),
  ]);
  const context = formatContext({ Guidelines: guidelines, 'Past projects': pastProjects });

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
    grounding: [...guidelines, ...pastProjects].map((d) => d.sourceRef || d.ID),
  });

  LOG.info(
    `drafted project "${draft.title}" from ${requirements.length} requirement(s), ${draft.risks.length} risk(s)`,
  );
  return draft;
}

module.exports = { draftSourcingProject, DRAFT_SCHEMA, SYSTEM_PROMPT, PRIORITIES, SEVERITIES };
