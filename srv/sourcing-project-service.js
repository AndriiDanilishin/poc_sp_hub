const cds = require('@sap/cds');

module.exports = class SourcingProjectService extends cds.ApplicationService {
  async init() {
    const { SourcingProjects, Requirements } = this.entities;
    const AuditLog = cds.entities('sourcing').AuditLog;

    const writeAudit = (req, entry) =>
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        actor: req.user?.id,
        aiInvolved: false,
        ...entry,
      });

    this.on('generateDraft', async (req) => {
      const { id } = req.data;
      const project = await SELECT.one.from(SourcingProjects).where({ ID: id });
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      // AI drafting lands in Phase 4 (docs/solution-architecture.md §20).
      return req.reject(501, 'AI draft generation is not implemented yet (Phase 4)');
    });

    this.on('approve', async (req) => {
      const { id } = req.data;
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
      const { id } = req.data;
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
