#!/usr/bin/env node
/**
 * Execute every request in a .http file against a running CAP server.
 *
 * `test/api.http` is this project's only backend test surface, and CLAUDE.md's
 * Definition of Done requires executing every request in it after a backend
 * change. Until now that meant hand-rolling a throwaway runner each time — which
 * produced false failures (URL encoding, JSON bodies, capture variables) that
 * were easy to misread as regressions, and which hid a real bug for a long time:
 * four capture variables used the OData **V2** shape `{{x.response.body.d.ID}}`
 * against V4 services, so they never resolved and every dependent request was
 * silently broken.
 *
 * Usage:
 *   npm test                      # runs test/api.http against localhost:4004
 *   node test/run-http.js [file] [--host http://localhost:4004] [--verbose]
 *
 * Exit code is 0 only when every request met its expectation.
 *
 * Supported subset of the REST Client format (what api.http actually uses):
 *   @var = value                     variable definition (may reference others)
 *   # @name id                       name a request so later ones can use its body
 *   {{var}}                          variable substitution
 *   {{id.response.body.a.b}}         field from an earlier named response
 *   ### title                        request separator; the title is the test name
 *   < ./file                         request body read from a file
 *
 * Expectations come from the title: a trailing `expect <code>` (e.g.
 * "-> expect 409") asserts that exact status. Otherwise any 2xx/3xx passes.
 * This is what lets the file document deliberate guards as passes rather than
 * failures.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The URL is the REST of the line, not `\S+`: OData query options legitimately
// contain spaces (`$filter=status eq 'OPEN'`), and stopping at the first space
// silently truncated the query string. An optional trailing HTTP version is
// dropped.
// The `m` flag is required: this is matched against a whole multi-line block, so
// without it `^`/`$` anchor to the start/end of the entire string and never hit
// the request line.
const METHOD_LINE = /^(GET|POST|PATCH|PUT|DELETE|HEAD)[ \t]+(.+?)(?:[ \t]+HTTP\/[\d.]+)?[ \t]*$/m;

function parseArgs(argv) {
  const opts = { file: null, host: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--host') opts.host = argv[++i];
    else if (!a.startsWith('-') && !opts.file) opts.file = a;
  }
  opts.file = opts.file || path.join(__dirname, 'api.http');
  return opts;
}

/**
 * Split the file into request blocks, collecting `@var` definitions in order.
 * Variables are resolved lazily at request time so a definition may reference a
 * capture from a request that has not run yet at parse time.
 */
function parse(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let cur = null;

  for (const line of lines) {
    if (/^###/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { title: line.replace(/^#+\s*/, '').trim(), lines: [], name: null, assigns: [] };
      continue;
    }
    const mName = line.match(/^#\s*@name\s+(\S+)/);
    if (mName) {
      if (cur) cur.name = mName[1];
      continue;
    }
    const mVar = line.match(/^@([\w.-]+)\s*=\s*(.*)$/);
    if (mVar) {
      // Assignments belong to the block they follow, so they are applied only
      // after that block has run and its capture is available.
      (cur ? cur.assigns : (blocks.pre = blocks.pre || [])).push([mVar[1], mVar[2].trim()]);
      continue;
    }
    if (cur) cur.lines.push(line);
    else (blocks.preLines = blocks.preLines || []).push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function makeResolver(vars, named) {
  return function resolve(text) {
    let out = String(text);
    // Bounded passes: variables may reference other variables.
    for (let pass = 0; pass < 8; pass++) {
      const before = out;
      out = out.replace(/\{\{([^}]+)\}\}/g, (whole, expr) => {
        expr = expr.trim();
        const cap = expr.match(/^([\w-]+)\.response\.body\.(.+)$/);
        if (cap) {
          const body = named[cap[1]];
          if (body === undefined) return whole;
          const value = cap[2].split('.').reduce((o, k) => (o == null ? undefined : o[k]), body);
          return value === undefined || value === null ? whole : String(value);
        }
        return Object.prototype.hasOwnProperty.call(vars, expr) ? vars[expr] : whole;
      });
      if (out === before) break;
    }
    return out;
  };
}

/**
 * Encode spaces inside the query string. The REST Client does this for you, so
 * `$filter=status eq 'OPEN'` is written unencoded in the file; fetch() does not,
 * and the server rejects the raw space with a parse error.
 */
function encodeQuery(url) {
  const i = url.indexOf('?');
  if (i < 0) return url;
  return url.slice(0, i) + '?' + url.slice(i + 1).replace(/ /g, '%20');
}

function buildRequest(block, resolve, baseDir) {
  const text = block.lines.join('\n');
  const m = text.match(METHOD_LINE);
  if (!m) return null;

  const method = m[1];
  const url = encodeQuery(resolve(m[2]));
  const headers = {};
  const bodyLines = [];
  let seenRequestLine = false;
  let inBody = false;

  for (const line of text.split('\n')) {
    if (!seenRequestLine) {
      if (METHOD_LINE.test(line)) seenRequestLine = true;
      continue;
    }
    if (!inBody) {
      if (line.trim() === '') {
        inBody = true;
        continue;
      }
      if (/^\s*#/.test(line)) continue; // comment between headers
      const h = resolve(line).match(/^([A-Za-z0-9-]+):\s*(.*)$/);
      if (h) headers[h[1]] = h[2];
      continue;
    }
    bodyLines.push(line);
  }

  // Trailing comments after the body are not part of it.
  let body = bodyLines
    .join('\n')
    .replace(/\n#[^\n]*$/gm, '')
    .trim();
  if (body.startsWith('<')) {
    const rel = body.slice(1).trim();
    try {
      body = fs.readFileSync(path.resolve(baseDir, rel));
    } catch {
      return { method, url, headers, body: null, missingFile: rel };
    }
  } else {
    body = body ? resolve(body) : null;
  }

  return { method, url, headers, body };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.file)) {
    console.error(`No such file: ${opts.file}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(opts.file, 'utf8');
  const blocks = parse(raw);
  const baseDir = path.dirname(path.resolve(opts.file));

  const vars = {};
  const named = {};
  const resolve = makeResolver(vars, named);

  // File-level variables (everything before the first ###).
  for (const [k, v] of blocks.pre || []) vars[k] = resolve(v);
  if (opts.host) vars.host = opts.host;

  // Fail fast with a clear message rather than N connection errors.
  const host = vars.host || 'http://localhost:4004';
  try {
    await fetch(host + '/', { method: 'GET' });
  } catch {
    console.error(`Cannot reach ${host} — start the server first (cds watch).`);
    process.exit(2);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const block of blocks) {
    const req = buildRequest(block, resolve, baseDir);
    if (!req) {
      for (const [k, v] of block.assigns) vars[k] = resolve(v);
      continue;
    }

    const expectMatch = block.title.match(/expect\s+(\d{3})/i);
    const expected = expectMatch ? Number(expectMatch[1]) : null;
    const label = block.title.length > 76 ? block.title.slice(0, 73) + '...' : block.title;

    if (req.missingFile) {
      failed++;
      failures.push(`${label}\n      body file not found: ${req.missingFile}`);
      console.log(`  FAIL  (no body file)  ${label}`);
      continue;
    }

    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body || undefined,
      });

      const raw = await res.text();
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* not JSON */
        }
      }
      if (block.name) {
        named[block.name] = parsed !== null ? parsed : raw;
        if (parsed === null && opts.verbose) {
          console.log(`        note: capture "${block.name}" is not JSON (${res.status})`);
        }
      }

      const ok = expected ? res.status === expected : res.status >= 200 && res.status < 400;
      if (ok) {
        passed++;
        console.log(`  ok    ${res.status}  ${label}`);
        if (opts.verbose && raw) console.log(`        ${raw.slice(0, 200)}`);
      } else {
        failed++;
        const detail = (parsed && parsed.error && parsed.error.message) || raw.slice(0, 200);
        failures.push(
          `${label}\n      got ${res.status}${expected ? `, expected ${expected}` : ''}: ${detail}`,
        );
        console.log(`  FAIL  ${res.status}${expected ? ` (want ${expected})` : ''}  ${label}`);
      }
    } catch (err) {
      failed++;
      failures.push(`${label}\n      ${err.message}`);
      console.log(`  ERROR ${label}: ${err.message}`);
    }

    // Assignments that follow this block can now use its capture.
    for (const [k, v] of block.assigns) vars[k] = resolve(v);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
