// Image parsing (§17): OCR or vision-model extraction of text from images.
// Not implemented yet — needs an OCR engine or a vision-capable model call
// (the current llm-client adapter is text-only). Kept as a slot for Phase 2.

// eslint-disable-next-line no-unused-vars
function parse(input = {}) {
  throw new Error('Image OCR / vision extraction is not implemented yet (Phase 2, §17)');
}

module.exports = { parse };
