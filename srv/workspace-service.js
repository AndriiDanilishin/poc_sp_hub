const cds = require('@sap/cds');

// Confidence below this threshold must be human-reviewed before promotion (§19).
const CONFIDENCE_REVIEW_THRESHOLD = 0.5;

module.exports = class WorkspaceService extends cds.ApplicationService {
  async init() {
    const { RequirementWorkspaces, WorkspaceRequirements, RequirementSources } = this.entities;
    const { SourcingProject, Requirement } = cds.entities('sourcing');
    const AuditLog = cds.entities('sourcing').AuditLog;

    const writeAudit = (req, entry) =>
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        actor: req.user?.id,
        aiInvolved: false,
        ...entry,
      });

    // Any inline edit that doesn't explicitly set aiStatus marks the row EDITED,
    // so later regeneration never silently overwrites human changes (§19, §25).
    this.before('UPDATE', 'WorkspaceRequirements', (req) => {
      if (req.data.aiStatus === undefined) {
        req.data.aiStatus = 'EDITED';
      }
    });

    // Record every requirement deletion in the audit trail (§19).
    this.before('DELETE', 'WorkspaceRequirements', async (req) => {
      const id = req.data.ID ?? req.params?.[req.params.length - 1]?.ID;
      if (!id) return;
      const before = await SELECT.one.from(WorkspaceRequirements).where({ ID: id });
      if (before) {
        await writeAudit(req, {
          entityName: 'WorkspaceRequirement',
          entityId: id,
          action: 'DELETE',
          before: JSON.stringify(before),
        });
      }
    });

    this.on('merge', async (req) => {
      const { ids } = req.data;
      if (!Array.isArray(ids) || ids.length < 2) {
        return req.reject(400, 'merge requires at least two requirement ids');
      }

      const items = await SELECT.from(WorkspaceRequirements).where({ ID: { in: ids } });
      if (items.length !== ids.length) {
        return req.reject(404, 'One or more requirements were not found');
      }
      const workspaceIds = [...new Set(items.map((i) => i.workspace_ID))];
      if (workspaceIds.length > 1) {
        return req.reject(400, 'All requirements must belong to the same workspace');
      }

      const [survivorId, ...mergedIds] = ids;

      // Re-point every source link of the merged rows to the survivor (§19).
      await UPDATE(RequirementSources)
        .set({ requirement_ID: survivorId })
        .where({ requirement_ID: { in: mergedIds } });

      await DELETE.from(WorkspaceRequirements).where({ ID: { in: mergedIds } });
      await UPDATE(WorkspaceRequirements).set({ aiStatus: 'EDITED' }).where({ ID: survivorId });

      await writeAudit(req, {
        entityName: 'WorkspaceRequirement',
        entityId: survivorId,
        action: 'MERGE',
        after: JSON.stringify({ survivorId, mergedIds }),
      });

      return SELECT.one.from(WorkspaceRequirements).where({ ID: survivorId });
    });

    this.on('split', async (req) => {
      const { id } = req.data;
      const original = await SELECT.one.from(WorkspaceRequirements).where({ ID: id });
      if (!original) {
        return req.reject(404, `Requirement ${id} not found`);
      }

      const copyId = cds.utils.uuid();
      await INSERT.into(WorkspaceRequirements).entries({
        ID: copyId,
        workspace_ID: original.workspace_ID,
        description: original.description,
        normalizedDescription: original.normalizedDescription,
        quantity: original.quantity,
        unit: original.unit,
        requestedDate: original.requestedDate,
        materialGroup_code: original.materialGroup_code,
        commodityCode_code: original.commodityCode_code,
        confidenceScore: original.confidenceScore,
        aiStatus: 'EDITED',
      });

      // Copy source links so both halves retain traceability to the origin.
      const sources = await SELECT.from(RequirementSources).where({ requirement_ID: id });
      if (sources.length) {
        await INSERT.into(RequirementSources).entries(
          sources.map((s) => ({
            ID: cds.utils.uuid(),
            requirement_ID: copyId,
            document_ID: s.document_ID,
            rawSnippet: s.rawSnippet,
            location: s.location,
          })),
        );
      }

      await writeAudit(req, {
        entityName: 'WorkspaceRequirement',
        entityId: copyId,
        action: 'SPLIT',
        before: JSON.stringify({ splitFrom: id }),
      });

      return SELECT.one.from(WorkspaceRequirements).where({ ID: copyId });
    });

    this.on('reject', async (req) => {
      const { id } = req.data;
      const item = await SELECT.one.from(WorkspaceRequirements).where({ ID: id });
      if (!item) {
        return req.reject(404, `Requirement ${id} not found`);
      }

      // Clear the AI-proposed enrichment, leaving the field blank for manual entry (§19).
      await UPDATE(WorkspaceRequirements)
        .set({
          aiStatus: 'REJECTED',
          normalizedDescription: null,
          materialGroup_code: null,
          commodityCode_code: null,
          confidenceScore: null,
        })
        .where({ ID: id });

      await writeAudit(req, {
        entityName: 'WorkspaceRequirement',
        entityId: id,
        action: 'REJECT_AI',
        before: JSON.stringify(item),
      });

      return SELECT.one.from(WorkspaceRequirements).where({ ID: id });
    });

    this.on('regenerate', async (req) => {
      const { id } = req.data;
      const item = await SELECT.one.from(WorkspaceRequirements).where({ ID: id });
      if (!item) {
        return req.reject(404, `Requirement ${id} not found`);
      }
      // AI-backed enrichment lands in Phase 3 (docs/solution-architecture.md §14, §15).
      return req.reject(501, 'AI regeneration is not implemented yet (Phase 3)');
    });

    this.on('promoteToSourcingProject', async (req) => {
      const { workspaceId } = req.data;
      const workspace = await SELECT.one.from(RequirementWorkspaces).where({ ID: workspaceId });
      if (!workspace) {
        return req.reject(404, `Workspace ${workspaceId} not found`);
      }
      if (workspace.sourcingProject_ID) {
        return req.reject(
          409,
          `Workspace ${workspaceId} has already been promoted to a Sourcing Project`,
        );
      }

      const items = await SELECT.from(WorkspaceRequirements).where({ workspace_ID: workspaceId });

      // Gate: no low-confidence item may still be unreviewed (§19).
      const unreviewed = items.filter(
        (i) => i.aiStatus === 'PROPOSED' && (i.confidenceScore ?? 0) < CONFIDENCE_REVIEW_THRESHOLD,
      );
      if (unreviewed.length) {
        return req.reject(
          409,
          `${unreviewed.length} low-confidence requirement(s) still need review before promotion`,
        );
      }

      // Only accepted / edited requirements are carried into the project (§20).
      const toCopy = items.filter((i) => i.aiStatus === 'ACCEPTED' || i.aiStatus === 'EDITED');
      if (!toCopy.length) {
        return req.reject(400, 'No accepted requirements to promote');
      }

      const projectId = cds.utils.uuid();
      await INSERT.into(SourcingProject).entries({
        ID: projectId,
        title: workspace.title || 'Untitled Sourcing Project',
        status: 'DRAFT',
      });

      // Copy — not reference — so later workspace edits can't alter the project (§20).
      await INSERT.into(Requirement).entries(
        toCopy.map((i) => ({
          ID: cds.utils.uuid(),
          project_ID: projectId,
          description: i.normalizedDescription || i.description,
          quantity: i.quantity,
          unit: i.unit,
          aiGenerated: i.aiStatus === 'ACCEPTED',
        })),
      );

      await UPDATE(RequirementWorkspaces)
        .set({ sourcingProject_ID: projectId, status: 'ARCHIVED' })
        .where({ ID: workspaceId });

      await writeAudit(req, {
        entityName: 'SourcingProject',
        entityId: projectId,
        action: 'PROMOTE',
        after: JSON.stringify({ workspaceId, requirementsCopied: toCopy.length }),
      });

      return { sourcingProjectId: projectId, requirementsCopied: toCopy.length };
    });

    await super.init();
  }
};
