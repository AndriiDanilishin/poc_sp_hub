const cds = require('@sap/cds');
const embedder = require('./embedder');

const LOG = cds.log('ai.dedup');

// -----------------------------------------------------------------------------
// Duplicate requirement detection (docs/solution-architecture.md §3 step 4, §18).
//
// Combines three explainable signals so it degrades gracefully:
//   - semantic  : cosine similarity of description embeddings (catches paraphrases)
//   - lexical   : Jaccard overlap of description tokens (catches near-identical text)
//   - structural: same unit + close quantity (procurement-specific corroboration)
//
// It only PROPOSES duplicates with a score and reasons; merging stays a human act
// via WorkspaceService.merge (§25). Pure logic — no database access.
// -----------------------------------------------------------------------------

const DEFAULTS = {
  threshold: 0.7, // flag a pair at or above this combined score
  structuralBoost: 0.15, // how much unit/quantity agreement lifts the base score
};

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function quantityCloseness(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0.5; // unknown → neutral
  const denom = Math.max(Math.abs(x), Math.abs(y), 1);
  return 1 - Math.min(1, Math.abs(x - y) / denom);
}

function structuralScore(a, b) {
  const unitMatch = a.unit && b.unit && a.unit.toLowerCase() === b.unit.toLowerCase() ? 1 : 0;
  return 0.5 * unitMatch + 0.5 * quantityCloseness(a.quantity, b.quantity);
}

// Union-find so transitive duplicates collapse into one group.
function makeGroups(n, pairs) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const p of pairs) parent[find(p.bIndex)] = find(p.aIndex);
  const canonical = [];
  for (let i = 0; i < n; i++) canonical[i] = find(i);
  return canonical;
}

/**
 * @param {Array<{ID?, description, quantity?, unit?, embedding?}>} requirements
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.7]
 * @returns {Promise<{pairs: Array, assignments: Array<{id, index, duplicateOf, duplicateOfIndex, score}>}>}
 */
async function detectDuplicates(requirements, opts = {}) {
  const { threshold, structuralBoost } = { ...DEFAULTS, ...opts };
  if (!Array.isArray(requirements)) {
    throw new Error('detectDuplicates requires an array of requirements');
  }

  // Resolve one embedding per requirement (use a provided one, else embed the text).
  const vectors = await Promise.all(
    requirements.map((r) => {
      const provided = embedder.toVector(r.embedding);
      if (provided) return provided;
      return r.description && String(r.description).trim()
        ? embedder.embed(r.description)
        : Promise.resolve(null);
    }),
  );

  const tokens = requirements.map((r) => tokenize(r.description));
  const pairs = [];

  for (let i = 0; i < requirements.length; i++) {
    for (let j = i + 1; j < requirements.length; j++) {
      const semantic =
        vectors[i] && vectors[j] ? Math.max(0, embedder.cosine(vectors[i], vectors[j])) : 0;
      const lexical = jaccard(tokens[i], tokens[j]);
      const structural = structuralScore(requirements[i], requirements[j]);

      const base = Math.max(semantic, lexical);
      // Only let structure lift a pair that already has some textual signal.
      const score = Math.min(1, base + (base > 0.4 ? structuralBoost * structural : 0));
      if (score < threshold) continue;

      const reasons = [];
      if (semantic > 0.01) reasons.push(`semantic cosine ${semantic.toFixed(2)}`);
      if (lexical > 0.01) reasons.push(`lexical overlap ${lexical.toFixed(2)}`);
      if (requirements[i].unit && requirements[i].unit === requirements[j].unit) {
        reasons.push(`same unit ${requirements[i].unit}`);
      }
      if (quantityCloseness(requirements[i].quantity, requirements[j].quantity) > 0.99) {
        reasons.push(`quantity match (${requirements[i].quantity} vs ${requirements[j].quantity})`);
      }

      pairs.push({
        aIndex: i,
        bIndex: j,
        aId: requirements[i].ID,
        bId: requirements[j].ID,
        score,
        semantic,
        lexical,
        structural,
        reasons,
      });
    }
  }

  // Canonical = lowest index in each duplicate group; others become duplicateOf it.
  const canonical = makeGroups(requirements.length, pairs);
  const assignments = [];
  for (let i = 0; i < requirements.length; i++) {
    if (canonical[i] !== i) {
      const best = pairs
        .filter((p) => p.bIndex === i || p.aIndex === i)
        .sort((x, y) => y.score - x.score)[0];
      assignments.push({
        id: requirements[i].ID,
        index: i,
        duplicateOf: requirements[canonical[i]].ID,
        duplicateOfIndex: canonical[i],
        score: best ? best.score : null,
      });
    }
  }

  LOG.info(`checked ${requirements.length} requirement(s): ${pairs.length} duplicate pair(s)`);
  return { pairs, assignments };
}

module.exports = { detectDuplicates, jaccard, structuralScore, tokenize, DEFAULTS };
