const cds = require('@sap/cds');
const { draftSourcingProject } = require('./ai/project-drafting');
const { makeAuditWriter } = require('./lib/audit');
const { buildPurchaseRequisition, correlationRef } = require('./s4/pr-mapper');
const s4 = require('./s4/pr-client');

module.exports = class SourcingProjectService extends cds.ApplicationService {
  async init() {
    const { SourcingProjects, Requirements, Risks, SourcingProjectSuppliers } = this.entities;
    const { AuditLog, Supplier } = cds.entities('sourcing');

    const writeAudit = makeAuditWriter(AuditLog);

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
          const row = await SELECT.one.from(req.target).columns('project_ID').where({ ID: rowId });
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

    // ---- Draft editing ------------------------------------------------------
    //
    // SourcingProjects is draft-enabled so the Object Page can edit the S/4HANA fields
    // (unit price, delivery date). The freeze above already refuses SAVING a draft of a
    // non-DRAFT project, but only after the user has typed their changes — refuse the
    // Edit itself. (UI.UpdateHidden hides the button; this covers direct API calls.)
    this.before('EDIT', SourcingProjects, async (req) => {
      const status = await projectStatusOf(boundKey(req));
      if (status && status !== 'DRAFT') {
        return req.reject(409, FROZEN_MSG(status));
      }
    });

    this.after('SAVE', SourcingProjects, async (project, req) => {
      await writeAudit(req, {
        entityName: 'SourcingProject',
        entityId: project?.ID ?? boundKey(req),
        action: 'EDIT',
      });
    });

    // generateDraft and approve act on the saved project. While someone has unsaved
    // edits open, approving would sign off data that is about to change (and the edit
    // could then no longer be saved), and a regenerated draft would be overwritten on
    // save. The buttons are hidden in edit mode; this covers API calls and other users.
    const rejectIfEditing = async (req, id, verb) => {
      const last = req.params?.[req.params.length - 1];
      const openDraft =
        (typeof last === 'object' && last.IsActiveEntity === false) ||
        (await SELECT.one.from(SourcingProjects.drafts).columns('ID').where({ ID: id }));
      if (openDraft) {
        req.reject(
          409,
          `This sourcing project has unsaved changes. Save or discard them before you ${verb}.`,
        );
        return true;
      }
      return false;
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
      if (await rejectIfEditing(req, id, 'generate an AI draft')) return;

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
          resolvedSuppliers.push({
            supplier: match,
            rationale: s.rationale,
            confidence: s.confidence,
          });
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

    // Build and validate the S/4HANA Purchase Requisition for a project (§21). `run`
    // executes a query: the request transaction for approve, a short committed one
    // for submitToS4. Requirement order (by description) fixes the item numbering.
    const prepareRequisition = async (project, run, validateOnly = false) => {
      const { Requirement, MaterialGroup } = cds.entities('sourcing');
      const requirements = await run(
        SELECT.from(Requirement).where({ project_ID: project.ID }).orderBy('description'),
      );
      const codes = [
        ...new Set(
          [project.materialGroup_code, ...requirements.map((r) => r.materialGroup_code)].filter(
            Boolean,
          ),
        ),
      ];
      const groups = codes.length
        ? await run(
            SELECT.from(MaterialGroup)
              .columns('code', 's4Code')
              .where({ code: { in: codes } }),
          )
        : [];
      return buildPurchaseRequisition({
        project,
        requirements,
        materialGroups: new Map(groups.filter((g) => g.s4Code).map((g) => [g.code, g.s4Code])),
        config: s4.getConfig(),
        validateOnly,
      });
    };

    this.on('approve', async (req) => {
      const id = boundKey(req);
      const project = await SELECT.one.from(SourcingProjects).where({ ID: id });
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      if (project.status !== 'DRAFT') {
        return req.reject(409, `Only DRAFT projects can be approved (current: ${project.status})`);
      }
      if (await rejectIfEditing(req, id, 'approve')) return;

      // A project with no requirements has nothing to source.
      const count = await SELECT.one
        .from(Requirements)
        .where({ project_ID: id })
        .columns('count(*) as n');
      if (!count?.n) {
        return req.reject(400, 'Cannot approve a project with no requirements');
      }

      // Approval freezes the project, so whatever S/4HANA needs must be complete NOW —
      // a missing price found only at submit time could no longer be fixed.
      const { errors } = await prepareRequisition(project, (query) => cds.run(query));
      if (errors.length) {
        return req.reject(
          400,
          `Not ready for approval — S/4HANA would refuse it: ${errors.join(' ')}`,
        );
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

    // ---- submitToS4: create the Purchase Requisition in S/4HANA (§21) --------
    //
    // CAP is the single choke point that talks to S/4HANA; the AI module has no
    // path here. Flow and status machine are documented in submitToS4.md:
    //   APPROVED → SUBMITTING (lock) → SUBMITTED | back to APPROVED
    //
    // Every DB access below runs in its OWN short committed transaction (`committed`):
    // the lock must be visible to a concurrent click before S/4HANA is called, and the
    // PurchaseReqLog trail must survive the req.reject() that reports a failure —
    // req.reject rolls back the request transaction (the extractRequirements lesson).
    // Reads go through it too, so the request transaction never opens: on SQLite it
    // would hold the single connection and the first committed() would wait forever
    // (verified — the submit hung).
    // Status codes avoid 501: UI5's V4 message parser replaces a 501's text with a
    // generic string, so the user would never see the explanation.
    const STALE_LOCK_MS = 5 * 60 * 1000; // a SUBMITTING lock older than this was abandoned
    const MAX_ERROR = 1000; // PurchaseReqLog.errorMsg
    const MAX_RESPONSE = 20000;
    const clip = (s, max) => (s && s.length > max ? s.slice(0, max) : s);

    this.on('submitToS4', async (req) => {
      const id = boundKey(req);
      const { SourcingProject, PurchaseReqLog } = cds.entities('sourcing');
      const committed = (fn) => cds.tx({ user: req.user, tenant: req.tenant }, fn);
      const read = (query) => committed((tx) => tx.run(query));

      const project = await read(SELECT.one.from(SourcingProject).where({ ID: id }));
      if (!project) {
        return req.reject(404, `Sourcing Project ${id} not found`);
      }
      // Guardrail (§25): only an approved project may reach S/4HANA.
      if (project.status !== 'APPROVED' && project.status !== 'SUBMITTING') {
        return req.reject(
          409,
          `Only APPROVED projects can be submitted (current: ${project.status})`,
        );
      }

      // Lock: only one submission per project at a time. A SUBMITTING row older than
      // STALE_LOCK_MS belongs to a request that died mid-flight and may be taken over;
      // its PENDING log is then reconciled below like any unknown outcome.
      const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
      const locked = await committed((tx) =>
        tx.run(
          UPDATE(SourcingProject).set({ status: 'SUBMITTING' })
            .where`ID = ${id} and (status = 'APPROVED' or (status = 'SUBMITTING' and modifiedAt < ${staleBefore}))`,
        ),
      );
      if (!locked) {
        return req.reject(
          409,
          'A submission to S/4HANA is already in progress for this project. ' +
            'Wait a moment and refresh.',
        );
      }

      let released = false;
      const release = (status, extra = {}) => {
        released = true;
        return committed((tx) =>
          tx.run(
            UPDATE(SourcingProject)
              .set({ status, ...extra })
              .where({ ID: id }),
          ),
        );
      };
      const insertLog = async (entry) => {
        const ID = cds.utils.uuid();
        await committed((tx) =>
          tx.run(INSERT.into(PurchaseReqLog).entries({ ID, project_ID: id, ...entry })),
        );
        return ID;
      };
      const updateLogs = (where, entry) =>
        committed((tx) => tx.run(UPDATE(PurchaseReqLog).set(entry).where(where)));
      const audit = (action, after) =>
        committed((tx) =>
          tx.run(
            writeAudit(req, {
              entityName: 'SourcingProject',
              entityId: id,
              action,
              before: JSON.stringify({ status: 'APPROVED' }),
              after: JSON.stringify(after),
            }),
          ),
        );

      try {
        const config = s4.getConfig();
        const reference = correlationRef(id);

        // Reconcile: an earlier attempt whose outcome is unknown may already have
        // created the requisition. Adopt it instead of creating a duplicate.
        const unresolved = await read(
          SELECT.from(PurchaseReqLog)
            .columns('ID')
            .where({ project_ID: id, status: { in: ['PENDING', 'UNKNOWN'] } }),
        );
        if (unresolved.length) {
          const unresolvedIds = { ID: { in: unresolved.map((l) => l.ID) } };
          let existing;
          try {
            existing = await s4.findByReference(reference);
          } catch (error) {
            await release('APPROVED');
            return req.reject(
              502,
              'An earlier submission of this project has an unknown result, and S/4HANA ' +
                `could not be checked for it (${error.message}). Nothing was sent; try again later.`,
            );
          }
          if (existing) {
            await updateLogs(unresolvedIds, {
              status: 'SUCCESS',
              s4RequisitionNumber: existing,
              responseReceived: `Recovered on resubmit: S/4HANA already holds requisition ${existing} for ${reference}.`,
            });
            await release('SUBMITTED', { s4RequisitionNumber: existing });
            await audit('SUBMIT_TO_S4', {
              status: 'SUBMITTED',
              s4RequisitionNumber: existing,
              recovered: true,
            });
            req.info(
              `Purchase Requisition ${existing} already existed in S/4HANA and is now linked.`,
            );
            return { s4RequisitionNumber: existing, status: 'SUBMITTED' };
          }
          await updateLogs(unresolvedIds, {
            status: 'FAILED',
            errorMsg: 'Not found in S/4HANA on resubmit — that attempt created nothing.',
          });
        }

        // Map + validate locally, so the user gets row-specific messages instead of
        // a terse S/4HANA message code — and S/4HANA is not called with known-bad data.
        // approve already ran the same check; this catches master data changed since.
        const { payload, errors } = await prepareRequisition(project, read, config.validateOnly);
        if (errors.length) {
          await insertLog({ status: 'FAILED', errorMsg: clip(errors.join(' '), MAX_ERROR) });
          await release('APPROVED');
          return req.reject(400, `Not sent to S/4HANA — fix these first: ${errors.join(' ')}`);
        }

        const logId = await insertLog({ status: 'PENDING', payloadSent: JSON.stringify(payload) });
        let result;
        try {
          result = await s4.createPurchaseRequisition(payload);
        } catch (error) {
          const err = s4.toS4Error(error);
          if (err.outcome === 'UNKNOWN') {
            await updateLogs(
              { ID: logId },
              { status: 'UNKNOWN', errorMsg: clip(err.message, MAX_ERROR) },
            );
            await release('APPROVED');
            return req.reject(
              504,
              "S/4HANA did not answer, so it's unclear whether the purchase requisition was " +
                'created. Submitting again is safe: it first checks S/4HANA for this ' +
                "project's requisition and won't create a duplicate.",
            );
          }
          await updateLogs(
            { ID: logId },
            {
              status: 'FAILED',
              errorMsg: clip(err.message, MAX_ERROR),
              responseReceived: clip(err.responseBody, MAX_RESPONSE),
            },
          );
          await release('APPROVED');
          // A 400 is about the data (the user can fix it); anything else — 401/403 from
          // a wrong destination password, 404 from a wrong URL — is a connection problem.
          return err.status === 400
            ? req.reject(400, `S/4HANA rejected the purchase requisition: ${err.message}`)
            : req.reject(502, `The S/4HANA call failed: ${err.message}`);
        }

        const response = clip(JSON.stringify(result.response), MAX_RESPONSE);
        if (result.validatedOnly) {
          await updateLogs({ ID: logId }, { status: 'VALIDATED', responseReceived: response });
          await release('APPROVED');
          await audit('VALIDATE_S4', { status: 'APPROVED', validatedOnly: true });
          req.info(
            'S/4HANA accepted the purchase requisition in validation-only mode — nothing was created.',
          );
          return { s4RequisitionNumber: null, status: 'VALIDATED' };
        }

        await updateLogs(
          { ID: logId },
          { status: 'SUCCESS', s4RequisitionNumber: result.number, responseReceived: response },
        );
        await release('SUBMITTED', { s4RequisitionNumber: result.number });
        await audit('SUBMIT_TO_S4', {
          status: 'SUBMITTED',
          s4RequisitionNumber: result.number,
          items: payload.to_PurchaseReqnItem.results.length,
        });
        req.info(`Purchase Requisition ${result.number} created in S/4HANA.`);
        return { s4RequisitionNumber: result.number, status: 'SUBMITTED' };
      } finally {
        // An unexpected error (a bug, a DB failure) must not leave the project locked.
        if (!released) await release('APPROVED').catch(() => {});
      }
    });

    await super.init();
  }
};
