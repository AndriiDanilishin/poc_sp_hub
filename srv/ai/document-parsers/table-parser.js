// Deterministic tabular parsing (§17): CSV/TSV handled dependency-free.
// Structured cells are parsed as-is; only free-text cells are later normalized by
// AI (not re-derived) — that AI step lives in enrichment, not here.
//
// Binary .xlsx/.xls is deliberately NOT supported. The obvious library (SheetJS
// `xlsx`) is abandoned on npm at 0.18.5 with two unfixed high-severity advisories
// (prototype pollution + ReDoS) whose threat model is exactly ours: parsing
// user-uploaded files. The maintained build lives only on the vendor's own CDN,
// outside the npm audit trail. Until a vetted alternative is chosen, users export
// to CSV — which the dependency-free path below handles safely.

function parseDelimited(raw, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function parse(input = {}) {
  const fileType = (input.fileType || '').toLowerCase();
  if (fileType === 'xlsx' || fileType === 'xls') {
    throw new Error(
      `Binary Excel (${fileType}) is not supported — please re-save the sheet as CSV ` +
        'and upload that. (The npm xlsx package is unmaintained with unpatched ' +
        'high-severity advisories, so it is deliberately not a dependency; §17.)',
    );
  }

  const raw = typeof input.text === 'string' ? input.text : input.buffer?.toString('utf8') || '';
  if (!raw.trim()) {
    throw new Error('table parser received empty input');
  }

  const delim = fileType === 'tsv' || (raw.includes('\t') && !raw.includes(',')) ? '\t' : ',';
  const rows = parseDelimited(raw, delim);
  const header = rows[0] || [];

  // Each data row becomes one traceable segment, described as "col: value" pairs.
  const segments = rows.slice(1).map((cells, i) => ({
    text: header.length
      ? header.map((h, j) => `${h}: ${cells[j] ?? ''}`).join(', ')
      : cells.join(', '),
    location: `row ${i + 2}`,
  }));

  const joiner = delim === ',' ? ', ' : '\t';
  const text = rows.map((r) => r.join(joiner)).join('\n');
  return { text, segments };
}

module.exports = { parse };
