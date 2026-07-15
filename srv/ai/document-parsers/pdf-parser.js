// PDF parsing (§17): text-layer extraction first, OCR fallback for scanned PDFs.
// Text extraction needs a binary-capable library; it is lazily required so the
// rest of the module works without the dependency installed.

async function parse(input = {}) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    throw new Error("PDF parsing requires the 'pdf-parse' package (not installed) (Phase 2, §17)");
  }
  if (!input.buffer) {
    throw new Error('pdf parser requires a file buffer');
  }

  const data = await pdfParse(input.buffer);
  const text = data.text || '';
  if (!text.trim()) {
    // A scanned PDF with no text layer needs OCR, which is not built yet.
    throw new Error('PDF has no text layer; OCR fallback is not implemented yet (Phase 2, §17)');
  }

  const segments = text
    .split('\f') // form feed = page break in pdf-parse output
    .map((t, i) => ({ text: t.trim(), location: `page ${i + 1}` }))
    .filter((s) => s.text);
  return { text, segments };
}

module.exports = { parse };
