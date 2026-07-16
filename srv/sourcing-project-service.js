const cds = require('@sap/cds');
const { draftSourcingProject } = require('./ai/project-drafting');

module.exports = class SourcingProjectService extends cds.ApplicationService {
  async init() {
    const { SourcingProjects, Requirements, Risks } = this.entities;
    const AuditLog = cds.entities('sourcing').AuditLog;

    const writeAudit = (req, entry) =>
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        actor: req.user?.id,
        aiInvolved: false,
        ...entry,
      });

    // Bound actions carry the target instance's key in req.params (last path segment)
    // rather than as an action parameter.
    const boundKey = (req) => {
      const last = req.params?.[req.params.length - 1];
      return typeof last === 'object' ? last.ID : last;
    };

    this.on('generateDraft', async (req) => {
      const id = boundKey(req);
      const project = await SELECT.one.from(SourcingProjects).where({ ID: id });
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      // Only a DRAFT may be (re)drafted — an approved/submitted project is frozen (§20, §25).
      if (project.status !== 'DRAFT') {
        return req.reject(409, `Only DRAFT projects can be drafted (current: ${project.status})`);
      }

      const requirements = await SELECT.from(Requirements).where({ project_ID: id });
      if (!requirements.length) {
        return req.reject(400, 'Cannot generate a draft for a project with no requirements');
      }

      const draft = await draftSourcingProject(requirements, { workspaceTitle: project.title });

      await UPDATE(SourcingProjects)
        .set({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          priority: draft.priority,
          timelineStart: draft.timeline.start,
          timelineEnd: draft.timeline.end,
        })
        .where({ ID: id });

      // Replace only the AI-authored risks on regenerate; human-added risks are kept (§25).
      await DELETE.from(Risks).where({ project_ID: id, aiGenerated: true });
      if (draft.risks.length) {
        await INSERT.into(Risks).entries(
          draft.risks.map((r) => ({
            ID: cds.utils.uuid(),
            project_ID: id,
            description: r.description,
            category: r.category,
            severity: r.severity,
            mitigation: r.mitigation,
            aiGenerated: true,
          })),
        );
      }

      await writeAudit(req, {
        entityName: 'SourcingProject',
        entityId: id,
        action: 'GENERATE_DRAFT',
        aiInvolved: true,
        after: JSON.stringify({
          title: draft.title,
          priority: draft.priority,
          risksProposed: draft.risks.length,
        }),
      });

      return SELECT.one.from(SourcingProjects).where({ ID: id });
    });

    this.on('approve', async (req) => {
      const id = boundKey(req);
      const project = await SELECT.one.from(SourcingProjects).where({ ID: id });
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      if (project.status !== 'DRAFT') {
        return req.reject(409, `Only DRAFT projects can be approved (current: ${project.status})`);
      }

      // A project with no requirements has nothing to source.
      const count = await SELECT.one
        .from(Requirements)
        .where({ project_ID: id })
        .columns('count(*) as n');
      if (!count?.n) {
        return req.reject(400, 'Cannot approve a project with no requirements');
      }

      await UPDATE(SourcingProjects).set({ status: 'APPROVED' }).where({ ID: id });
      await writeAudit(req, {
        entityName: 'SourcingProject',
        entityId: id,
        action: 'APPROVE',
        before: JSON.stringify({ status: project.status }),
        after: JSON.stringify({ status: 'APPROVED' }),
      });

      return SELECT.one.from(SourcingProjects).where({ ID: id });
    });

    this.on('submitToS4', async (req) => {
      const id = boundKey(req);
      const project = await SELECT.one.from(SourcingProjects).where({ ID: id });
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      // Guardrail (§25): only an approved project may reach S/4HANA.
      if (project.status !== 'APPROVED') {
        return req.reject(
          409,
          `Only APPROVED projects can be submitted (current: ${project.status})`,
        );
      }
      // The actual S/4HANA OData call lands in Phase 5 (§21). CAP is the single
      // choke point that ever talks to S/4HANA; the AI module has no path here.
      return req.reject(501, 'SAP S/4HANA submission is not implemented yet (Phase 5)');
    });

    await super.init();
  }
};
