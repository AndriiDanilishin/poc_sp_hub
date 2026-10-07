// PDF parsing (§17): text-layer extraction, with a vision-model OCR fallback for
// scanned PDFs (no text layer). The library is lazily required so the rest of
// the parser registry works even if the dependency is absent.

const llm = require('../llm-client');

async function parse(input = {}) {
  let PDFParse;
  try {
    ({ PDFParse } = require('pdf-parse'));
  } catch {
    throw new Error("PDF parsing requires the 'pdf-parse' package (not installed) (Phase 2, §17)");
  }
  if (!input.buffer) {
    throw new Error('pdf parser requires a file buffer');
  }

  // pdf-parse v2 exposes a PDFParse class (v1's callable default export is gone)
  // and returns { text, total, pages: [{ num, text }] } — so page segmentation is
  // exact here, rather than v1's inferred form-feed splitting.
  const parser = new PDFParse({ data: input.buffer });
  let result;
  try {
    result = await parser.getText();
  } finally {
    // Releases the worker; skipping this leaks a handle per parsed document.
    await parser.destroy();
  }

  const pages = Array.isArray(result.pages) ? result.pages : [];
  const segments = pages
    .map((p) => ({ text: (p.text || '').trim(), location: `page ${p.num}` }))
    .filter((s) => s.text);

  if (!segments.length) {
    // A scanned PDF has no text layer. OCR costs an LLM call, so callers that
    // only want a cheap preview (the upload hook) pass ocr: false.
    if (input.ocr === false) {
      throw new Error('PDF has no text layer; run extraction to OCR it');
    }
    return ocr(input);
  }

  // Prefer joining the per-page text: result.text interleaves "-- 1 of 2 --"
  // page markers that would otherwise reach the extraction prompt as noise.
  return { text: segments.map((s) => s.text).join('\n\n'), segments };
}

async function ocr(input) {
  const { pages } = await llm.transcribe({
    buffer: input.buffer,
    mimeType: 'application/pdf',
    filename: input.fileName,
  });
  const segments = pages
    .map((p, i) => ({
      text: (p.text || '').trim(),
      location: `page ${Number.isInteger(p.page) ? p.page : i + 1}`,
    }))
    .filter((s) => s.text);
  if (!segments.length) {
    throw new Error('PDF has no text layer and OCR found no readable text');
  }
  return { text: segments.map((s) => s.text).join('\n\n'), segments, meta: { ocr: true } };
}

module.exports = { parse };
