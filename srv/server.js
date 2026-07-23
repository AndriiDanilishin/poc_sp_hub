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

const cds = require('@sap/cds');

// Auto-embed the curated knowledge corpus on startup so RAG works on a fresh DB.
// Seeded KnowledgeDocument rows ship WITHOUT vectors (§15), and enrichment/drafting
// silently return nothing when the corpus has no embeddings — so a fresh db.sqlite
// (or a HANA deploy) would leave Material Group / Commodity recommendations blank
// until someone remembered to POST /api/knowledge/reindex by hand. This makes the
// DB self-heal: after all services are served, embed only the docs still missing a
// vector. `onlyMissing: true` makes warm restarts a no-op (no re-embed, no API cost).
//
// Deliberately FIRE-AND-FORGET. CAP awaits an async 'served' listener, so awaiting
// the reindex here would hold the port unbound for the whole run — one sequential
// network round-trip per unembedded document under AI_PROVIDER=openai. Under
// `cds watch` (a restart on every file save) that surfaced as the browser getting
// ERR_CONNECTION_REFUSED mid-restart. The listener therefore stays synchronous and
// schedules the work; embedding is a background convenience, never a startup gate.
const AUTO_EMBED_TIMEOUT_MS = 60_000;

// Append-only AuditLog (§25, Phase 1.4). The entity is not exposed over OData today,
// but this is defense in depth: on every served service, reject any UPDATE or DELETE
// that targets the sourcing.AuditLog entity, so the audit trail can only ever be
// appended to — never rewritten or erased — even if a future projection exposes it.
cds.on('served', () => {
  for (const srv of cds.services) {
    if (!(srv instanceof cds.ApplicationService)) continue;
    for (const entity of srv.entities) {
      // Match the underlying persistence entity by name, regardless of projection alias.
      if (
        entity.name?.endsWith('AuditLog') ||
        entity['@sap.persistence.name'] === 'sourcing.AuditLog'
      ) {
        srv.before(['UPDATE', 'DELETE'], entity, (req) =>
          req.reject(405, 'AuditLog is append-only and cannot be modified or deleted.'),
        );
      }
    }
  }
});

cds.once('served', () => {
  const log = cds.log('knowledge');

  const run = async () => {
    const embedder = require('./ai/embedder');
    // A hung provider call must not leave the task pending forever. The embed
    // path has no transport timeout of its own, so bound the whole pass here.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${AUTO_EMBED_TIMEOUT_MS} ms`)),
        AUTO_EMBED_TIMEOUT_MS,
      );
    });
    try {
      const { indexed, total } = await Promise.race([
        embedder.reindex({ onlyMissing: true }),
        timeout,
      ]);
      if (indexed > 0) {
        log.info(`auto-embedded ${indexed}/${total} knowledge document(s) missing a vector`);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  // Never crash the server on this — enrichment can still be reindexed manually
  // via KnowledgeService.reindex, and offline/mock or an empty corpus is normal.
  // unref() keeps a pending pass from holding the process open on shutdown.
  const kick = setTimeout(() => {
    run().catch((err) => log.warn('knowledge auto-embed skipped:', err.message));
  }, 0);
  if (typeof kick.unref === 'function') kick.unref();
});

// Delegate to CAP's default server implementation.
module.exports = require('@sap/cds/server');
