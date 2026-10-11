const cds = require('@sap/cds');

// -----------------------------------------------------------------------------
// Read an uploaded media-stream column back as a Buffer (shared by IntakeService
// and KnowledgeService, which both accept files via PUT .../contentBinary).
// -----------------------------------------------------------------------------

/**
 * @param {string} table   physical table name, e.g. 'sourcing_SourceDocument'
 * @param {string} id      row key
 * @param {string} [column='contentBinary']
 * @returns {Promise<Buffer|null>} the bytes, or null when none were uploaded
 */
async function readBinaryColumn(table, id, column = 'contentBinary') {
  // Read the column with plain SQL rather than through the entity.
  //
  // Reading a LargeBinary via SELECT.from(<entity>) hands back a Readable that
  // CAP has already put in a text encoding, and draining it corrupts binary
  // input — a 1204-byte PDF came back as 901 bytes, because every byte sequence
  // that is not valid UTF-8 collapses into U+FFFD. setEncoding(null) does not
  // undo that, since the damage happens upstream. The raw driver read returns
  // the bytes untouched on both sqlite and HANA.
  const rows = await cds.run(`SELECT ${column} FROM ${table} WHERE ID = ?`, [id]);
  const value = rows?.[0]?.[column] ?? rows?.[0]?.[column.toUpperCase()];
  if (!value) return null;

  // On sqlite, CAP stores an uploaded media stream base64-ENCODED inside the
  // blob: the column of a 901-byte PDF holds 1204 bytes reading "JVBERi0x…"
  // (base64 of "%PDF-1"), not the PDF itself. So the bytes must be decoded
  // before any parser sees them, or pdf-parse fails with "Invalid PDF
  // structure". Detected rather than assumed, since a driver that stores raw
  // bytes (HANA) must pass through untouched.
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
  const isBase64 =
    buffer.length % 4 === 0 &&
    /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(buffer.subarray(0, 64).toString('latin1'));
  return isBase64 ? Buffer.from(buffer.toString('latin1'), 'base64') : buffer;
}

module.exports = { readBinaryColumn };
