// Plain text and already-structured REST payloads (§17).
// REST payloads arrive structured, so this is effectively a passthrough that just
// segments the text for traceability.

function toRawString(input) {
  if (typeof input.text === 'string') return input.text;
  if (input.buffer) return input.buffer.toString('utf8');
  if (input.text != null && typeof input.text === 'object') {
    // A structured REST payload — render as pretty JSON so extraction can read it.
    return JSON.stringify(input.text, null, 2);
  }
  return '';
}

function parse(input = {}) {
  const raw = toRawString(input);
  if (!raw.trim()) {
    throw new Error('text parser received empty input');
  }
  const segments = raw
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, i) => ({ text, location: `paragraph ${i + 1}` }));
  return { text: raw, segments };
}

module.exports = { parse };
