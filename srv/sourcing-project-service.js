const cds = require('@sap/cds');
const { draftSourcingProject } = require('./ai/project-drafting');

module.exports = class SourcingProjectService extends cds.ApplicationService {
  async init() {
    const { SourcingProjects, Requirements, Risks, SourcingProjectSuppliers } = this.entities;
    const { AuditLog, Supplier } = cds.entities('sourcing');

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

    // ---- Approval freeze (§20, §25) ---------------------------------------
    //
    // `approve` gates the DRAFT -> APPROVED transition, but that only protected
    // the *transition*: the entities stayed fully writable, so a plain OData
    // PATCH could still rewrite an approved project or any of its children.
    // Verified before this guard existed: PATCH /Risks(<risk of an APPROVED
    // project>) and PATCH /SourcingProjects(<APPROVED>) both returned 200 and
    // silently changed the data.
    //
    // That defeats the point of the sign-off — what was approved must be what
    // reaches S/4HANA — and the AuditLog records the actions, not these raw
    // writes. So the freeze is enforced on the entities themselves.
    const FROZEN_MSG = (status) =>
      `This sourcing project is ${status} and can no longer be changed. ` +
      `Only DRAFT projects are editable.`;

    const projectStatusOf = async (projectId) => {
      if (!projectId) return null;
      const row = await SELECT.one
        .from(SourcingProjects)
        .columns('status')
        .where({ ID: projectId });
      return row?.status ?? null;
    };

    // The service's own status transitions (approve, and later submitToS4) go
    // through UPDATE(SourcingProjects) on a service entity, which re-enters this
    // handler. They are legitimate, so a change consisting only of `status` is
    // let through; a user PATCH always carries other fields.
    this.before('UPDATE', SourcingProjects, async (req) => {
      const id = req.data?.ID ?? boundKey(req);
      const status = await projectStatusOf(id);
      if (!status || status === 'DRAFT') return;

      const touched = Object.keys(req.data || {}).filter((k) => k !== 'ID');
      const statusOnly = touched.length === 1 && touched[0] === 'status';
      if (statusOnly) return;

      return req.reject(409, FROZEN_MSG(status));
    });

    // Same rule for the composition children: resolve the owning project and
    // block the write once it has left DRAFT. Without this, the header could be
    // frozen while its risks/requirements/suppliers stayed editable.
    const CHILD_ENTITIES = [
      Requirements,
      Risks,
      SourcingProjectSuppliers,
      this.entities.SourcingProjectCommodities,
      this.entities.Attachments,
    ].filter(Boolean);

    const guardChild = async (req) => {
      // CREATE carries the FK in the payload; UPDATE/DELETE address an existing
      // row, so the owning project is looked up from the stored row.
      let projectId = req.data?.project_ID;
      if (!projectId) {
        const key = req.params?.[req.params.length - 1];
        const rowId = typeof key === 'object' ? key.ID : key;
        if (rowId) {
          const row = await SELECT.one
            .from(req.target)
            .columns('project_ID')
            .where({ ID: rowId });
          projectId = row?.project_ID;
        }
      }
      const status = await projectStatusOf(projectId);
      if (status && status !== 'DRAFT') {
        return req.reject(409, FROZEN_MSG(status));
      }
    };

    CHILD_ENTITIES.forEach((entity) => {
      this.before(['CREATE', 'UPDATE', 'DELETE'], entity, guardChild);
    });

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

      // Resolve each drafted supplier NAME to a real Supplier (master data keys on the BP
      // number, the AI returns a name). Case-insensitive containment match, since the AI
      // name ("Zeiss Instruments") rarely equals the legal name ("Zeiss Instruments GmbH")
      // verbatim. Only a supplier that resolves to a real Supplier.ID is written — an
      // unmatched AI name is dropped, never a dangling reference (§25).
      const supplierMaster = await SELECT.from(Supplier).columns('ID', 'name');
      const resolvedSuppliers = [];
      const seenSupplierIds = new Set();
      for (const s of draft.suppliers || []) {
        const needle = s.name.toLowerCase();
        const match = supplierMaster.find((c) => {
          const n = String(c.name || '').toLowerCase();
          return n.includes(needle) || needle.includes(n);
        });
        if (match && !seenSupplierIds.has(match.ID)) {
          seenSupplierIds.add(match.ID);
          resolvedSuppliers.push({ supplier: match, rationale: s.rationale, confidence: s.confidence });
        }
      }

      // Replace only the AI-authored supplier rows; human-added ones are kept (§25).
      await DELETE.from(SourcingProjectSuppliers).where({ project_ID: id, aiGenerated: true });
      if (resolvedSuppliers.length) {
        await INSERT.into(SourcingProjectSuppliers).entries(
          resolvedSuppliers.map((r) => ({
            ID: cds.utils.uuid(),
            project_ID: id,
            supplier_ID: r.supplier.ID,
            rationale: r.rationale,
            confidenceScore: r.confidence,
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
          suppliersProposed: (draft.suppliers || []).length,
          suppliersResolved: resolvedSuppliers.length,
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
