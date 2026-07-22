const cds = require('@sap/cds');
const { parseDocument } = require('./ai/document-parsers');
const { extractRequirements: aiExtractRequirements } = require('./ai/extraction');

const ALLOWED_ORIGIN_TYPES = ['Email', 'Pdf', 'Image', 'Excel', 'RestApi', 'Text'];

// Upload size cap, enforced here as well as in the browser — a client-side check
// is a UX affordance, not a control. Applies to both the pasted-text payload and
// the binary media stream.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

    // Read a document's uploaded bytes as a Buffer, or null when none were
    // uploaded. A LargeBinary column does not read back uniformly: CAP streams
    // media content (Readable) on some drivers and hands back a Buffer — or a
    // base64 string — on others, so normalise all three here rather than making
    // every parser defensive.
    const readBinaryContent = async (documentId) => {
      // Read the column with plain SQL rather than through the entity.
      //
      // Reading contentBinary via SELECT.from(SourceDocuments) hands back a
      // Readable that CAP has already put in a text encoding, and draining it
      // corrupts binary input — a 1204-byte PDF came back as 901 bytes, because
      // every byte sequence that is not valid UTF-8 collapses into U+FFFD.
      // setEncoding(null) does not undo that, since the damage happens upstream.
      // The raw driver read returns the bytes untouched on both sqlite and HANA.
      const rows = await cds.run(
        `SELECT contentBinary FROM sourcing_SourceDocument WHERE ID = ?`,
        [documentId],
      );
      const value = rows?.[0]?.contentBinary ?? rows?.[0]?.CONTENTBINARY;
      if (!value) return null;

      // On sqlite, CAP stores an uploaded media stream base64-ENCODED inside the
      // blob: the column of a 901-byte PDF holds 1204 bytes reading "JVBERi0x…"
      // (base64 of "%PDF-1"), not the PDF itself. So the bytes must be decoded
      // before any parser sees them, or pdf-parse fails with "Invalid PDF
      // structure". Detected rather than assumed, since a driver that stores raw
      // bytes (HANA) must pass through untouched.
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
      const isBase64 =
        buffer.length % 4 === 0 && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(buffer.subarray(0, 64).toString('latin1'));
      return isBase64 ? Buffer.from(buffer.toString('latin1'), 'base64') : buffer;
    };

    this.on('uploadDocument', async (req) => {
      const { workspaceId, originType, fileName, fileType, content, fileSize } = req.data;

      if (!ALLOWED_ORIGIN_TYPES.includes(originType)) {
        return req.reject(400, `originType must be one of: ${ALLOWED_ORIGIN_TYPES.join(', ')}`);
      }
      if (!fileName) {
        return req.reject(400, 'fileName is required');
      }
      if (!workspaceId) {
        return req.reject(400, 'workspaceId is required');
      }
      // Reject oversize uploads before creating a row. The declared fileSize is
      // the client's claim about the bytes it is about to PUT; the stream handler
      // re-checks the actual length, since a client can under-report here.
      const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
      if (fileSize && fileSize > MAX_UPLOAD_BYTES) {
        return req.reject(400, `File exceeds the ${maxMb} MB upload limit`);
      }
      if (content && Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) {
        return req.reject(400, `Content exceeds the ${maxMb} MB upload limit`);
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
        fileSize,
        status: 'UPLOADED',
      };
      await INSERT.into(SourceDocuments).entries(document);

      await writeAudit(req, {
        entityName: 'SourceDocument',
        entityId: document.ID,
        action: 'UPLOAD',
        after: JSON.stringify({ fileName, originType, fileType, workspace_ID: workspaceId }),
      });

      return SELECT.one.from(SourceDocuments).where({ ID: document.ID });
    });

    // Binary upload: PUT /SourceDocuments(<id>)/contentBinary.
    //
    // The projection grants UPDATE (not @readonly) purely so this media-stream
    // write is reachable — @readonly blocks stream PUTs too, verified as a 405.
    // This handler is therefore what actually keeps the entity closed: it rejects
    // every UPDATE that is not exactly the content stream, so granting UPDATE
    // does not become a general write opening on status, workspace, or anything
    // else that has its own action and validation.
    this.before('UPDATE', SourceDocuments, async (req) => {
      const data = req.data || {};
      // Ignore the key, which CAP echoes into req.data on a keyed UPDATE.
      const touched = Object.keys(data).filter((k) => k !== 'ID');
      const isStreamWrite = touched.length === 1 && touched[0] === 'contentBinary';
      if (!isStreamWrite) {
        return req.reject(
          405,
          'SourceDocuments cannot be edited directly — use uploadDocument, ' +
            'changeWorkspace or extractRequirements.',
        );
      }

      const documentId = req.params?.[0]?.ID ?? req.params?.[0];
      const document = await SELECT.one
        .from(SourceDocuments)
        .where({ ID: documentId })
        .columns('ID', 'status');
      if (!document) {
        return req.reject(404, `SourceDocument ${documentId} not found`);
      }
      if (document.status === 'EXTRACTED') {
        return req.reject(
          409,
          'This document is already extracted — replacing its file would invalidate ' +
            'the requirements derived from it. Upload a new document instead.',
        );
      }

      // Enforce the cap on the bytes actually sent: uploadDocument's fileSize is
      // only the client's claim and can under-report. Content-Length is checked
      // first so an oversize body is refused before it is buffered.
      const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
      const declared = Number(req.headers?.['content-length']);
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
        return req.reject(413, `File exceeds the ${maxMb} MB upload limit`);
      }
      if (Buffer.isBuffer(data.contentBinary) && data.contentBinary.length > MAX_UPLOAD_BYTES) {
        return req.reject(413, `File exceeds the ${maxMb} MB upload limit`);
      }
    });

    // Correct fileSize to the bytes actually stored. uploadDocument recorded the
    // client's claim, which can differ from what arrived (or be absent entirely),
    // and the UI shows this value. Done after the write so it cannot interfere
    // with the stream-only guard above.
    this.after('UPDATE', SourceDocuments, async (_, req) => {
      if (!Object.prototype.hasOwnProperty.call(req.data || {}, 'contentBinary')) {
        return;
      }
      const documentId = req.params?.[0]?.ID ?? req.params?.[0];
      const buffer = await readBinaryContent(documentId);
      if (buffer) {
        await UPDATE(SourceDocuments).set({ fileSize: buffer.length }).where({ ID: documentId });
      }
    });

    this.on('createWorkspace', async (req) => {
      const title = (req.data.title || '').trim();
      if (!title) {
        return req.reject(400, 'title is required');
      }

      const workspace = {
        ID: cds.utils.uuid(),
        title,
        status: 'OPEN',
      };
      // @readonly on the RequirementWorkspaces projection blocks the generic OData
      // CRUD provider (raw POST → 405) but not this handler's own INSERT.
      await INSERT.into(RequirementWorkspace).entries(workspace);

      await writeAudit(req, {
        entityName: 'RequirementWorkspace',
        entityId: workspace.ID,
        action: 'CREATE_WORKSPACE',
        after: JSON.stringify({ title, status: 'OPEN' }),
      });

      return SELECT.one.from(RequirementWorkspace).where({ ID: workspace.ID });
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

      await UPDATE(SourceDocuments).set({ workspace_ID: newWorkspaceId }).where({ ID: documentId });

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
    //
    // A plain substring test is not enough. Table segments are rendered as
    // "description: X, quantity: 2" while the model quotes the row's bare values
    // ("X, 2, piece"), so neither string contains the other and every CSV row
    // used to degrade to 'document'. Substring matching is still tried first
    // (exact and cheapest, and what email/PDF prose hits), then the best
    // token-overlap match above a threshold — which handles the reformatted case
    // without matching unrelated rows.
    const tokenize = (text) =>
      new Set(
        (text || '')
          .toLowerCase()
          .split(/[^a-z0-9.]+/i)
          .filter((t) => t.length > 1),
      );

    const locationFor = (segments, rawSnippet) => {
      if (!rawSnippet || !segments.length) return 'document';

      const exact = segments.find(
        (s) => s.text.includes(rawSnippet) || rawSnippet.includes(s.text),
      );
      if (exact) return exact.location;

      const snippetTokens = tokenize(rawSnippet);
      if (!snippetTokens.size) return 'document';

      let best = null;
      let bestScore = 0;
      for (const segment of segments) {
        const segmentTokens = tokenize(segment.text);
        let shared = 0;
        for (const token of snippetTokens) {
          if (segmentTokens.has(token)) shared += 1;
        }
        const score = shared / snippetTokens.size;
        if (score > bestScore) {
          bestScore = score;
          best = segment;
        }
      }
      // Over half the snippet's tokens must appear in the segment: high enough to
      // reject a coincidental overlap, low enough to survive the label prefixes
      // and reordering the model introduces.
      return bestScore >= 0.5 && best ? best.location : 'document';
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
      // Either source is enough: pasted/derived text, or uploaded bytes. The
      // parsers pick whichever they can use (§17).
      const buffer = await readBinaryContent(documentId);
      if (!document.content && !buffer) {
        return req.reject(400, 'SourceDocument has no content to extract from');
      }

      await UPDATE(SourceDocuments).set({ status: 'EXTRACTING' }).where({ ID: documentId });

      let parsed;
      let extraction;
      try {
        parsed = await parseDocument({
          originType: document.originType,
          fileType: document.fileType,
          buffer,
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
