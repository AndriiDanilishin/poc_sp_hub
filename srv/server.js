// Custom CAP bootstrap. Its only job beyond the default is to load a local .env
// (project root) before services initialize, so AI_PROVIDER / OPENAI_API_KEY /
// AI_* from .env reach srv/ai/llm-client.js. @sap/cds does NOT auto-load .env,
// and this hook runs regardless of how the server is launched (cds watch, cds
// serve, npm start) — unlike wiring node --env-file into one npm script.
//
// Dependency-free: uses Node's built-in .env parser via loadEnvFile (Node 20.12+/
// 22+). Missing .env is fine — the mock provider is the default and needs no key.

const path = require('path');

try {
  // Node's built-in loader (no dotenv dependency). Reads KEY=value lines and
  // sets process.env for keys not already defined in the real environment
  // (real env wins, so a shell-exported OPENAI_API_KEY overrides .env).
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {
  // ENOENT: no .env present — expected in mock/CI. Anything else, log and go on.
  if (err && err.code !== 'ENOENT') {
    // eslint-disable-next-line no-console
    console.warn('[server] could not load .env:', err.message);
  }
}

// Delegate to CAP's default server implementation.
module.exports = require('@sap/cds/server');
