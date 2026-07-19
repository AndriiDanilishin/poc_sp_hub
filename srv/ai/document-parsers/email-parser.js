// Dependency-free .eml (RFC 822) parsing (§17).
// Extracts headers + the text/plain body. Attachment handling (each attachment
// becoming its own SourceDocument) is a service-layer concern, not done here.

function parseHeaders(block) {
  const headers = {};
  // Unfold continuation lines (those starting with whitespace).
  const lines = block.split('\n');
  const unfolded = [];
  for (const line of lines) {
    if (/^\s/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ' ' + line.trim();
    } else {
      unfolded.push(line);
    }
  }
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return headers;
}

// Pull the first text/plain part out of a multipart body.
function extractTextPlain(raw, boundary) {
  const parts = raw.split(`--${boundary}`);
  for (const part of parts) {
    const sep = part.indexOf('\n\n');
    if (sep < 0) continue;
    const partHeaders = parseHeaders(part.slice(0, sep));
    if ((partHeaders['content-type'] || '').toLowerCase().includes('text/plain')) {
      return part.slice(sep + 2).trim();
    }
  }
  return null;
}

// A block "looks like headers" only if its first non-empty line has the
// `Name: value` shape of a real RFC-822 header. Without this guard, plain text
// with no blank-line separator (e.g. a pasted shopping list) would be parsed
// entirely as headers, leaving the body empty and extraction with nothing.
function looksLikeHeaders(block) {
  const firstLine = block.split('\n').find((l) => l.trim());
  return !!firstLine && /^[A-Za-z][A-Za-z0-9-]*:\s/.test(firstLine);
}

function parse(input = {}) {
  let raw = typeof input.text === 'string' ? input.text : input.buffer?.toString('utf8') || '';
  if (!raw.trim()) {
    throw new Error('email parser received empty input');
  }
  raw = raw.replace(/\r\n/g, '\n');

  const sep = raw.indexOf('\n\n');
  // Only treat the leading block as headers when it actually looks like headers;
  // otherwise the whole input is the body (a non-email plain-text upload).
  const hasHeaderBlock = sep >= 0 ? looksLikeHeaders(raw.slice(0, sep)) : looksLikeHeaders(raw);
  const headers = hasHeaderBlock ? parseHeaders(sep >= 0 ? raw.slice(0, sep) : raw) : {};
  let body;
  if (!hasHeaderBlock) {
    body = raw;
  } else {
    body = sep >= 0 ? raw.slice(sep + 2) : '';
  }

  const boundary = /boundary="?([^";\n]+)"?/i.exec(headers['content-type'] || '');
  if (boundary) {
    body = extractTextPlain(raw, boundary[1]) ?? body;
  }
  body = body.trim();

  const segments = [];
  if (headers.subject) segments.push({ text: headers.subject, location: 'subject' });
  body
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .forEach((text, i) => segments.push({ text, location: `body:paragraph ${i + 1}` }));

  const text = [
    headers.subject ? `Subject: ${headers.subject}` : null,
    headers.from ? `From: ${headers.from}` : null,
    '',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { text, segments, meta: headers };
}

module.exports = { parse };
