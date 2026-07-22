const cds = require('@sap/cds');
const { enrichRequirement } = require('./ai/enrichment');

// Confidence below this threshold must be human-reviewed before promotion (§19).
const CONFIDENCE_REVIEW_THRESHOLD = 0.5;

module.exports = class WorkspaceService extends cds.ApplicationService {
  async init() {
    const { RequirementWorkspaces, WorkspaceRequirements, RequirementSources } = this.entities;
    const { SourcingProject, Requirement, MaterialGroup, CommodityCode, SourcingProjectCommodity } =
      cds.entities('sourcing');
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

      let enrichment;
      try {
        enrichment = await enrichRequirement(item);
      } catch (err) {
        return req.reject(400, err.message);
      }

      const topMaterialGroup = enrichment.materialGroups[0];
      const topCommodity = enrichment.commodityCodes[0];

      // Resolve a recommendation to a REAL master-data code. The LLM often returns a
      // knowledge sourceRef rather than the assignable code, so try each of the
      // candidate's codeHints (LLM code → citation → codes found in grounded content)
      // in priority order and take the first that exists in master data. Only a code
      // that resolves is ever assigned — no dangling reference is written (§25). If
      // nothing resolves → null.
      const resolveAgainstMaster = async (candidate, entity) => {
        if (!candidate) return null;
        const hints =
          candidate.codeHints && candidate.codeHints.length
            ? candidate.codeHints
            : [candidate.code].filter(Boolean); // backward-compatible fallback
        for (const hint of hints) {
          // eslint-disable-next-line no-await-in-loop
          const found = await SELECT.one.from(entity).where({ code: hint });
          if (found) return found;
        }
        return null;
      };

      const [resolvedMG, resolvedCC] = await Promise.all([
        resolveAgainstMaster(topMaterialGroup, MaterialGroup),
        resolveAgainstMaster(topCommodity, CommodityCode),
      ]);

      // A fresh AI proposal needs review again, regardless of the prior aiStatus.
      await UPDATE(WorkspaceRequirements)
        .set({
          materialGroup_code: resolvedMG?.code ?? null,
          commodityCode_code: resolvedCC?.code ?? null,
          aiStatus: 'PROPOSED',
        })
        .where({ ID: id });

      await writeAudit(req, {
        entityName: 'WorkspaceRequirement',
        entityId: id,
        action: 'REGENERATE',
        aiInvolved: true,
        before: JSON.stringify({
          materialGroup_code: item.materialGroup_code,
          commodityCode_code: item.commodityCode_code,
        }),
        after: JSON.stringify({
          materialGroup: topMaterialGroup,
          commodityCode: topCommodity,
          grounding: enrichment.grounding,
        }),
      });

      return SELECT.one.from(WorkspaceRequirements).where({ ID: id });
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

      // Gate: no low-confidence item may still be unreviewed (§19). Name the
      // offending rows and the fix, so the block is actionable rather than a bare count.
      const unreviewed = items.filter(
        (i) => i.aiStatus === 'PROPOSED' && (i.confidenceScore ?? 0) < CONFIDENCE_REVIEW_THRESHOLD,
      );
      if (unreviewed.length) {
        const named = unreviewed
          .map((i) => `"${i.description}" (${Math.round((i.confidenceScore ?? 0) * 100)}%)`)
          .join(', ');
        return req.reject(
          409,
          `Review needed before promotion — the AI is unsure about ${named}. ` +
            `Accept, Edit, or Reject ${unreviewed.length === 1 ? 'it' : 'them'} first.`,
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
      // Each requirement keeps its OWN material group + commodity code (per-item
      // classification) so distinct items aren't collapsed. These codes were already
      // resolved against master data by regenerate, so they're safe to copy directly.
      await INSERT.into(Requirement).entries(
        toCopy.map((i) => ({
          ID: cds.utils.uuid(),
          project_ID: projectId,
          description: i.normalizedDescription || i.description,
          quantity: i.quantity,
          unit: i.unit,
          materialGroup_code: i.materialGroup_code || null,
          commodityCode_code: i.commodityCode_code || null,
          aiGenerated: i.aiStatus === 'ACCEPTED',
        })),
      );

      // Carry the enriched classification (§10) up to the PROJECT level, matching the
      // domain model: a SourcingProject has one materialGroup + a set of commodityCodes,
      // not per-requirement. Otherwise the workspace Enrichment (regenerate) is discarded
      // on promotion and the project shows no Material Group / Commodity.
      // Material Group: the most common non-null code among the promoted requirements.
      const mgCounts = new Map();
      for (const i of toCopy) {
        if (i.materialGroup_code) {
          mgCounts.set(i.materialGroup_code, (mgCounts.get(i.materialGroup_code) || 0) + 1);
        }
      }
      let projectMaterialGroup = null;
      for (const [code, count] of mgCounts) {
        if (!projectMaterialGroup || count > projectMaterialGroup.count) {
          projectMaterialGroup = { code, count };
        }
      }
      if (projectMaterialGroup) {
        await UPDATE(SourcingProject)
          .set({ materialGroup_code: projectMaterialGroup.code })
          .where({ ID: projectId });
      }

      // Commodity codes: one SourcingProjectCommodity per distinct code across the
      // promoted requirements.
      const distinctCommodities = [
        ...new Set(toCopy.map((i) => i.commodityCode_code).filter(Boolean)),
      ];
      if (distinctCommodities.length) {
        await INSERT.into(SourcingProjectCommodity).entries(
          distinctCommodities.map((code) => ({
            ID: cds.utils.uuid(),
            project_ID: projectId,
            commodityCode_code: code,
            aiGenerated: true,
          })),
        );
      }

      await UPDATE(RequirementWorkspaces)
        .set({ sourcingProject_ID: projectId, status: 'ARCHIVED' })
        .where({ ID: workspaceId });

      await writeAudit(req, {
        entityName: 'SourcingProject',
        entityId: projectId,
        action: 'PROMOTE',
        after: JSON.stringify({
          workspaceId,
          requirementsCopied: toCopy.length,
          materialGroup: projectMaterialGroup?.code ?? null,
          commodityCodes: distinctCommodities,
        }),
      });

      return { sourcingProjectId: projectId, requirementsCopied: toCopy.length };
    });

    await super.init();
  }
};
