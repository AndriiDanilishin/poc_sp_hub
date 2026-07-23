// -----------------------------------------------------------------------------
// Shared pure helpers for the AI modules (§ DRY cleanup, Phase 2.2).
//
// These were copy-pasted across extraction.js / enrichment.js / project-drafting.js.
// Centralised here so there is one definition to reason about and test. Pure — no
// cds, no DB, no provider knowledge.
// -----------------------------------------------------------------------------

// Clamp any value to the documented 0..1 confidence range; non-numbers → 0.
function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

// Strict ISO-date normalisation. JS `new Date()` leniently accepts junk like
// "mock-42" (→ year 2041), so require an ISO leading date and a plausible year
// (1970–2100) before trusting a value; anything else → null.
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

// Render retrieved RAG knowledge, grouped by label, into a compact prompt context.
// Each doc becomes "- [sourceRef] title: <content excerpt>"; empty groups are
// explicitly marked so the model is told when nothing was retrieved.
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

module.exports = { clamp01, toIsoDateOrNull, formatContext };
