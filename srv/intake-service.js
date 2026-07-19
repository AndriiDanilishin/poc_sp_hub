const cds = require('@sap/cds');
const { parseDocument } = require('./ai/document-parsers');
const { extractRequirements: aiExtractRequirements } = require('./ai/extraction');

const ALLOWED_ORIGIN_TYPES = ['Email', 'Pdf', 'Image', 'Excel', 'RestApi', 'Text'];

module.exports = class IntakeService extends cds.ApplicationService {
  async init() {
    const { SourceDocuments } = this.entities;
    const { RequirementWorkspace, WorkspaceRequirement, RequirementSource, AuditLog } =
      cds.entities('sourcing');

    const writeAudit = (req, entry) =>
      INSERT.into(AuditLog).entries({
        ID: cds.utils.uuid(),
        actor: req.user?.id,
        aiInvolved: false,
        ...entry,
      });

    this.on('uploadDocument', async (req) => {
      const { workspaceId, originType, fileName, fileType, content } = req.data;

      if (!ALLOWED_ORIGIN_TYPES.includes(originType)) {
        return req.reject(400, `originType must be one of: ${ALLOWED_ORIGIN_TYPES.join(', ')}`);
      }
      if (!fileName) {
        return req.reject(400, 'fileName is required');
      }
      if (!workspaceId) {
        return req.reject(400, 'workspaceId is required');
      }
      const workspace = await SELECT.one.from(RequirementWorkspace).where({ ID: workspaceId });
      if (!workspace) {
        return req.reject(404, `RequirementWorkspace ${workspaceId} not found`);
      }

      const document = {
        ID: cds.utils.uuid(),
        workspace_ID: workspaceId,
        originType,
        fileName,
        fileType,
        content,
        status: 'UPLOADED',
      };
      await INSERT.into(SourceDocuments).entries(document);
      return SELECT.one.from(SourceDocuments).where({ ID: document.ID });
    });

    this.on('changeWorkspace', async (req) => {
      const { documentId, newWorkspaceId } = req.data;

      const document = await SELECT.one.from(SourceDocuments).where({ ID: documentId });
      if (!document) {
        return req.reject(404, `SourceDocument ${documentId} not found`);
      }
      if (!newWorkspaceId) {
        return req.reject(400, 'newWorkspaceId is required');
      }
      const workspace = await SELECT.one.from(RequirementWorkspace).where({ ID: newWorkspaceId });
      if (!workspace) {
        return req.reject(404, `RequirementWorkspace ${newWorkspaceId} not found`);
      }
      if (document.workspace_ID === newWorkspaceId) {
        return req.reject(400, 'Document is already in that workspace');
      }
      // Block after extraction: the document's requirements already live in the old
      // workspace; moving only the document would orphan them (§18). The user must
      // curate/delete those requirements in the Workspace app first.
      if (document.status === 'EXTRACTED') {
        return req.reject(
          409,
          'This document is already extracted — its requirements live in the current ' +
            'workspace. Delete them in the Requirement Workspace first, then move the document.',
        );
      }

      await UPDATE(SourceDocuments)
        .set({ workspace_ID: newWorkspaceId })
        .where({ ID: documentId });

      await writeAudit(req, {
        entityName: 'SourceDocument',
        entityId: documentId,
        action: 'CHANGE_WORKSPACE',
        before: JSON.stringify({ workspace_ID: document.workspace_ID }),
        after: JSON.stringify({ workspace_ID: newWorkspaceId }),
      });

      return SELECT.one.from(SourceDocuments).where({ ID: documentId });
    });

    // Best-effort: locate which parser segment a requirement's snippet came from,
    // for RequirementSource traceability (§18). Falls back to a generic label.
    const locationFor = (segments, rawSnippet) => {
      if (rawSnippet) {
        const match = segments.find(
          (s) => s.text.includes(rawSnippet) || rawSnippet.includes(s.text),
        );
        if (match) return match.location;
      }
      return 'document';
    };

    this.on('extractRequirements', async (req) => {
      const { documentId } = req.data;
      const document = await SELECT.one.from(SourceDocuments).where({ ID: documentId });
      if (!document) {
        return req.reject(404, `SourceDocument ${documentId} not found`);
      }
      if (document.status === 'EXTRACTED') {
        return req.reject(409, 'Document already extracted; upload a new document to re-extract');
      }
      if (!document.workspace_ID) {
        return req.reject(400, 'SourceDocument has no workspace to add requirements to');
      }
      if (!document.content) {
        return req.reject(400, 'SourceDocument has no content to extract from');
      }

      await UPDATE(SourceDocuments).set({ status: 'EXTRACTING' }).where({ ID: documentId });

      let parsed;
      let extraction;
      try {
        parsed = await parseDocument({
          originType: document.originType,
          fileType: document.fileType,
          text: document.content,
        });
        extraction = await aiExtractRequirements(parsed.text);
      } catch (err) {
        // A parse/extraction failure is a normal business OUTCOME (§23), not an
        // HTTP error: req.reject() would roll back this whole request's
        // transaction, undoing the FAILED status write below along with it.
        await UPDATE(SourceDocuments)
          .set({ status: 'FAILED', errorMsg: err.message })
          .where({ ID: documentId });
        return { status: 'FAILED', itemsCreated: 0 };
      }

      const requirements = extraction.requirements;
      const requirementIds = requirements.map(() => cds.utils.uuid());

      if (requirements.length) {
        await INSERT.into(WorkspaceRequirement).entries(
          requirements.map((r, i) => ({
            ID: requirementIds[i],
            workspace_ID: document.workspace_ID,
            description: r.description,
            quantity: r.quantity,
            unit: r.unit,
            requestedDate: r.requestedDate,
            confidenceScore: r.confidence,
            aiStatus: 'PROPOSED',
          })),
        );
        await INSERT.into(RequirementSource).entries(
          requirements.map((r, i) => ({
            ID: cds.utils.uuid(),
            requirement_ID: requirementIds[i],
            document_ID: documentId,
            rawSnippet: r.rawSnippet,
            location: locationFor(parsed.segments, r.rawSnippet),
          })),
        );
      }

      await UPDATE(SourceDocuments)
        .set({ status: 'EXTRACTED', errorMsg: null })
        .where({ ID: documentId });

      await writeAudit(req, {
        entityName: 'SourceDocument',
        entityId: documentId,
        action: 'EXTRACT',
        aiInvolved: true,
        after: JSON.stringify({ itemsCreated: requirements.length }),
      });

      return { status: 'EXTRACTED', itemsCreated: requirements.length };
    });

    this.on('getExtractionStatus', async (req) => {
      const { documentId } = req.data;
      const document = await SELECT.one
        .from(SourceDocuments)
        .where({ ID: documentId })
        .columns('status', 'errorMsg');
      if (!document) {
        return req.reject(404, `SourceDocument ${documentId} not found`);
      }
      return document;
    });

    await super.init();
  }
};
