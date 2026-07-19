const cds = require('@sap/cds');

const LOG = cds.log('ai.parsers');

// -----------------------------------------------------------------------------
// Document parser registry (docs/solution-architecture.md §17).
//
// Turns a raw source (buffer or text) into { text, segments } that extraction.js
// consumes. Each segment carries a `location` (subject / paragraph N / row N /
// page N) so a WorkspaceRequirement can trace back to exactly where it came from
// via RequirementSource (§18).
// -----------------------------------------------------------------------------

const emailParser = require('./email-parser');
const tableParser = require('./table-parser');
const textParser = require('./text-parser');
const pdfParser = require('./pdf-parser');
const imageParser = require('./image-parser');

// Keyed by SourceDocument.originType.
const PARSERS = {
  Email: emailParser,
  Excel: tableParser,
  Pdf: pdfParser,
  Image: imageParser,
  RestApi: textParser,
  Text: textParser,
};

/**
 * Parse a source document into extractable text with traceable segments.
 * @param {object} args
 * @param {string} args.originType  one of Email | Pdf | Image | Excel | RestApi
 * @param {string} [args.fileType]  hint used by some parsers (e.g. csv/tsv/xlsx)
 * @param {Buffer} [args.buffer]    raw file bytes
 * @param {string|object} [args.text]  raw text, or a structured REST payload
 * @returns {Promise<{text: string, segments: Array<{text: string, location: string}>}>}
 */
async function parseDocument({ originType, fileType, buffer, text } = {}) {
  const parser = PARSERS[originType];
  if (!parser) {
    throw new Error(`No parser registered for originType '${originType}'`);
  }

  const result = await parser.parse({ fileType, buffer, text });
  const segments = result.segments || [];
  const fullText = result.text ?? segments.map((s) => s.text).join('\n');

  LOG.info(
    `parsed originType=${originType} -> ${segments.length} segment(s), ${fullText.length} chars`,
  );
  return { text: fullText, segments, meta: result.meta };
}

module.exports = { parseDocument, PARSERS };
