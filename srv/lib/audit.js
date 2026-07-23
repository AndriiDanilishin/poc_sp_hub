const cds = require('@sap/cds');

// -----------------------------------------------------------------------------
// Shared audit-log writer (§ DRY cleanup, Phase 2.2).
//
// The identical `writeAudit` closure lived in three services. Centralised here as a
// factory: pass the resolved AuditLog entity, get back a writer bound to it. The
// entity is append-only (@insertonly + server.js guard, Phase 1.4), so this only
// ever INSERTs. actor defaults to the authenticated user; aiInvolved defaults to
// false and is overridden per call for AI-driven actions.
// -----------------------------------------------------------------------------

/**
 * @param {object} AuditLog  the resolved cds entity (e.g. cds.entities('sourcing').AuditLog)
 * @returns {(req: object, entry: object) => Promise} writeAudit(req, entry)
 */
function makeAuditWriter(AuditLog) {
  return (req, entry) =>
    INSERT.into(AuditLog).entries({
      ID: cds.utils.uuid(),
      actor: req.user?.id,
      aiInvolved: false,
      ...entry,
    });
}

module.exports = { makeAuditWriter };
