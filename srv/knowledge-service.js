const cds = require('@sap/cds');
const embedder = require('./ai/embedder');
const knowledgeQa = require('./ai/knowledge-qa');
const { parseDocument } = require('./ai/document-parsers');
const { makeAuditWriter } = require('./lib/audit');
const { readBinaryColumn } = require('./lib/binary');

const LOG = cds.log('knowledge');

// Only these curated categories feed RAG (§15); uploaded source documents do not.
// Also served as the KnowledgeCategories value help, so the dropdown and the
// validation can never disagree.
const CATEGORIES = [
  { code: 'Policy', description: 'Procurement policy' },
  { code: 'MaterialGroupCatalog', description: 'Material group catalog' },
  { code: 'CommodityTaxonomy', description: 'Commodity taxonomy (UNSPSC)' },
  { code: 'PastProject', description: 'Past sourcing project' },
  { code: 'SupplierProfile', description: 'Supplier profile' },
  { code: 'Guideline', description: 'Sourcing guideline' },
];
const CATEGORY_CODES = CATEGORIES.map((c) => c.code);

// Same cap as Intake uploads; enforced here as well as in the browser.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// File extension → parser registry key (srv/ai/document-parsers). Images are
// absent on purpose: image OCR is still a Phase-2 stub there.
const PARSER_BY_EXTENSION = {
  pdf: 'Pdf',
  csv: 'Excel',
  tsv: 'Excel',
  eml: 'Email',
  json: 'RestApi',
  txt: 'Text',
  md: 'Text',
};
const ACCEPTED_EXTENSIONS = Object.keys(PARSER_BY_EXTENSION);

// Content types a stream PUT may declare. Stored in `mediaType` and served back on
// download, so script-capable types (text/html, image/svg+xml) stay out.
const ALLOWED_MEDIA_TYPES = [
  'application/pdf',
  'application/octet-stream',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'message/rfc822',
];

// The fields whose text is embedded (embedder.embeddableText). A change to any of
// them makes the stored vector stale.
const EMBEDDED_FIELDS = ['title', 'content'];

const INDEX_CRITICALITY = { INDEXED: 3, PENDING: 2, FAILED: 1 };

const extensionOf = (fileName) => {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
};

module.exports = class KnowledgeService extends cds.ApplicationService {
  async init() {
    const { KnowledgeDocuments, KnowledgeCategories, CurrentUser } = this.entities;
    const { KnowledgeDocument, AuditLog } = cds.entities('sourcing');
    const writeAudit = makeAuditWriter(AuditLog);

    // Per-request facts computed in a before-handler and consumed in the matching
    // after-handler (stream write vs. edit, whether the embedded text changed).
    const pending = new WeakMap();

    const keyOf = (req) => {
      const last = req.params?.[req.params.length - 1];
      return (typeof last === 'object' ? last?.ID : last) ?? req.data?.ID;
    };

    const rejectInvalidCategory = (req, category) => {
      if (category != null && !CATEGORY_CODES.includes(category)) {
        req.reject(400, `category must be one of: ${CATEGORY_CODES.join(', ')}`, 'category');
        return true;
      }
      return false;
    };

    // Embed now; never fail the surrounding request. A failure is already recorded
    // on the row (FAILED + indexError, vector cleared) by the embedder — rejecting
    // here would roll that record back together with the user's save.
    const indexQuietly = async (id) => {
      try {
        await embedder.indexDocument(id);
        return null;
      } catch (err) {
        LOG.warn(`indexing ${id} failed: ${err.message}`);
        return err.message;
      }
    };

    // ---- Value help ---------------------------------------------------------

    this.on('READ', KnowledgeCategories, () => CATEGORIES.map((c) => ({ ...c })));

    // ---- Current user's permissions (UI hint only; @restrict is the control) --

    this.on('READ', CurrentUser, (req) => {
      const isCurator = req.user.is('KnowledgeCurator');
      return { readOnly: !isCurator, isCurator };
    });

    // ---- Virtual display fields (filled in JS, HANA-safe) --------------------

    // virtual element → the stored column it is computed from
    const VIRTUAL_SOURCES = { indexCriticality: 'indexStatus', categoryText: 'category' };
    const CATEGORY_TEXT = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.description]));

    const selectVirtualSources = (req) => {
      const columns = req.query?.SELECT?.columns;
      if (!columns || columns.includes('*')) return;
      for (const [virtualName, source] of Object.entries(VIRTUAL_SOURCES)) {
        const wantsVirtual = columns.some((c) => c.ref?.[0] === virtualName);
        const hasSource = columns.some((c) => c.ref?.[0] === source);
        if (wantsVirtual && !hasSource) columns.push({ ref: [source] });
      }
    };
    const fillVirtuals = (rows, req) => {
      const columns = req.query?.SELECT?.columns;
      const wantsHide =
        !columns || columns.some((c) => c === '*' || c.ref?.[0] === 'hideCuratorActions');
      const hide = !req.user.is('KnowledgeCurator');
      for (const row of [].concat(rows ?? [])) {
        if (!row) continue;
        if (wantsHide) row.hideCuratorActions = hide;
        if (row.indexStatus !== undefined) {
          row.indexCriticality = INDEX_CRITICALITY[row.indexStatus] ?? 0;
        }
        if (row.category !== undefined) {
          row.categoryText = CATEGORY_TEXT[row.category] ?? row.category;
        }
      }
    };
    // The virtuals exist only after READ, so the database cannot order or filter by
    // them: $orderby on one was silently ignored (rows unsorted, no error) and
    // $filter failed with a 500. The UI no longer offers either (Capabilities
    // annotations in knowledge-service.cds), but CAP does not enforce those, so API
    // callers get an explicit 400 here instead of a wrong answer or a crash.
    const VIRTUALS = new Set([...Object.keys(VIRTUAL_SOURCES), 'hideCuratorActions']);
    const findVirtualRef = (node) => {
      if (Array.isArray(node)) {
        for (const each of node) {
          const hit = findVirtualRef(each);
          if (hit) return hit;
        }
        return null;
      }
      if (!node || typeof node !== 'object') return null;
      if (node.ref?.length === 1 && VIRTUALS.has(node.ref[0])) return node.ref[0];
      return findVirtualRef(node.xpr) || findVirtualRef(node.args);
    };
    const rejectVirtualQueries = (req) => {
      const select = req.query?.SELECT;
      if (!select) return;
      const sorted = findVirtualRef(select.orderBy);
      if (sorted) return req.reject(400, `Sorting by "${sorted}" is not supported`);
      const filtered = findVirtualRef(select.where) || findVirtualRef(select.having);
      if (filtered) return req.reject(400, `Filtering by "${filtered}" is not supported`);
    };

    for (const entity of [KnowledgeDocuments, KnowledgeDocuments.drafts]) {
      this.before('READ', entity, rejectVirtualQueries);
      this.before('READ', entity, selectVirtualSources);
      this.after('READ', entity, fillVirtuals);
    }

    // ---- Writes: validation, stream uploads, re-embedding --------------------

    this.before('CREATE', KnowledgeDocuments, (req) => {
      rejectInvalidCategory(req, req.data.category);
    });

    // Draft activation of a new document (or any direct insert) → embed it.
    this.after('CREATE', KnowledgeDocuments, async (row, req) => {
      const id = row?.ID ?? req.data?.ID;
      if (!id) return;
      await indexQuietly(id);
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: id,
        action: 'CREATE',
        aiInvolved: true,
        after: JSON.stringify({ title: req.data.title, category: req.data.category }),
      });
    });

    // An UPDATE of the active document is either the media-stream PUT of a file
    // (exactly `contentBinary`, plus the mediaType CAP copies from Content-Type)
    // or an edit (draft activation / direct PATCH). The file is immutable except
    // through the stream, so an edit never rewrites the stored bytes.
    this.before('UPDATE', KnowledgeDocuments, async (req) => {
      const data = req.data || {};
      const touched = Object.keys(data).filter(
        (k) =>
          k !== 'ID' && k !== 'IsActiveEntity' && !(k === 'mediaType' && 'contentBinary' in data),
      );
      const isStream = touched.length === 1 && touched[0] === 'contentBinary';
      const id = keyOf(req);

      const current = await SELECT.one
        .from(KnowledgeDocument)
        .columns('ID', 'title', 'content', 'fileName')
        .where({ ID: id });
      if (!current) return req.reject(404, `KnowledgeDocument ${id} not found`);

      if (isStream) {
        if (!current.fileName) {
          return req.reject(
            409,
            'This document was created as text. Upload files through "Upload File", which creates a document for them.',
          );
        }
        if (data.mediaType != null) {
          const baseType = String(data.mediaType).split(';')[0].trim().toLowerCase();
          if (!ALLOWED_MEDIA_TYPES.includes(baseType)) {
            return req.reject(415, `Unsupported Content-Type "${baseType}" for a knowledge file`);
          }
          data.mediaType = baseType;
        }
        const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
        const declared = Number(req.headers?.['content-length']);
        if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
          return req.reject(413, `File exceeds the ${maxMb} MB upload limit`);
        }
        if (Buffer.isBuffer(data.contentBinary) && data.contentBinary.length > MAX_UPLOAD_BYTES) {
          return req.reject(413, `File exceeds the ${maxMb} MB upload limit`);
        }
        pending.set(req, { stream: true, id });
        return;
      }

      delete data.contentBinary;
      if (rejectInvalidCategory(req, data.category)) return;
      for (const field of ['title', 'category', 'content']) {
        if (field in data && !String(data[field] ?? '').trim()) {
          return req.reject(400, `${field} is required`, field);
        }
      }
      const changed = EMBEDDED_FIELDS.some((f) => f in data && data[f] !== current[f]);
      pending.set(req, { stream: false, changed, id });
    });

    this.after('UPDATE', KnowledgeDocuments, async (_, req) => {
      const facts = pending.get(req);
      if (!facts) return;

      if (facts.stream) {
        await this._ingestFile(facts.id, req);
        return;
      }
      if (facts.changed) {
        // Clear the old vector first, so it cannot survive even if embedding
        // fails in a way that skips the FAILED bookkeeping.
        await embedder.markPending(facts.id);
        await indexQuietly(facts.id);
      }
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: facts.id,
        action: 'UPDATE',
        aiInvolved: facts.changed,
        after: JSON.stringify({ reembedded: facts.changed }),
      });
    });

    // Files go to the saved document only: a draft never carries the bytes
    // (@odata.draft.skip), so a stream written into a draft would be dropped on save.
    this.before(['UPDATE', 'PATCH'], KnowledgeDocuments.drafts, (req) => {
      if ('contentBinary' in (req.data || {})) {
        return req.reject(405, 'Upload files to the saved document, not to an edit draft.');
      }
    });

    this.after('DELETE', KnowledgeDocuments, async (_, req) => {
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: keyOf(req),
        action: 'DELETE',
      });
    });

    // Parse an uploaded file into `content`, then embed it. A parse failure leaves
    // the document FAILED with a readable reason; the upload itself still succeeds
    // (the bytes are stored and can be downloaded or replaced).
    this._ingestFile = async (id, req) => {
      const doc = await SELECT.one
        .from(KnowledgeDocument)
        .columns('ID', 'fileName', 'mediaType')
        .where({ ID: id });
      const buffer = await readBinaryColumn('sourcing_KnowledgeDocument', id);
      const ext = extensionOf(doc.fileName);
      const originType = PARSER_BY_EXTENSION[ext] || 'Text';

      let content = null;
      let parseError = null;
      if (!buffer) {
        parseError = 'The uploaded file is empty.';
      } else {
        try {
          // OCR (an LLM call) is allowed here: a curator upload is an explicit,
          // role-gated action and has no later "extract" step that could do it.
          const parsed = await parseDocument({
            originType,
            fileType: ext,
            fileName: doc.fileName,
            buffer,
          });
          content = parsed.text?.trim() || null;
          if (!content) parseError = 'No text could be read from the file.';
        } catch (err) {
          parseError = `Could not read the file: ${err.message}`;
        }
      }

      // New file → new text: drop the previous file's vector before anything else,
      // as the edit path does. A failed embed below keeps a vector only when the
      // text is unchanged (embedder.failureUpdate), so without this a re-upload
      // during a provider outage would leave the old file answering for the new.
      await embedder.markPending(id);
      await UPDATE(KnowledgeDocument).set({ content }).where({ ID: id });
      let indexError = parseError;
      if (parseError) {
        await embedder.markFailed(id, parseError);
      } else {
        indexError = await indexQuietly(id);
      }
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: id,
        action: 'UPLOAD',
        aiInvolved: true,
        after: JSON.stringify({
          fileName: doc.fileName,
          bytes: buffer?.length ?? 0,
          chars: content?.length ?? 0,
          indexError,
        }),
      });
    };

    // ---- Actions -------------------------------------------------------------

    this.on('indexDocument', async (req) => {
      const { category, title, content, sourceRef } = req.data;
      if (rejectInvalidCategory(req, category)) return;
      if (!title) {
        return req.reject(400, 'title is required');
      }
      if (!content) {
        return req.reject(400, 'content is required');
      }

      const id = cds.utils.uuid();
      await INSERT.into(KnowledgeDocument).entries({
        ID: id,
        category,
        title,
        content,
        sourceRef,
      });
      const indexError = await indexQuietly(id);
      if (indexError) req.warn(`Saved, but not searchable yet: ${indexError}`);
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: id,
        action: 'CREATE',
        aiInvolved: true,
        after: JSON.stringify({ title, category }),
      });
      return SELECT.one.from(KnowledgeDocuments).where({ ID: id });
    });

    this.on('createFromFile', async (req) => {
      const { category, sourceRef, fileName, fileSize } = req.data;
      if (rejectInvalidCategory(req, category)) return;
      if (!category) return req.reject(400, 'category is required');
      const name = String(fileName || '').trim();
      if (!name) return req.reject(400, 'fileName is required');
      const ext = extensionOf(name);
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        return req.reject(
          415,
          `Unsupported file type ".${ext || '?'}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}` +
            (ext === 'xlsx' || ext === 'xls' ? ' — re-save Excel files as CSV.' : ''),
        );
      }
      if (fileSize && fileSize > MAX_UPLOAD_BYTES) {
        return req.reject(
          413,
          `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit`,
        );
      }

      const id = cds.utils.uuid();
      const title = String(req.data.title || '').trim() || name.replace(/\.[^.]+$/, '');
      await INSERT.into(KnowledgeDocument).entries({
        ID: id,
        category,
        title,
        sourceRef,
        fileName: name,
        indexStatus: 'PENDING',
      });
      return SELECT.one.from(KnowledgeDocuments).where({ ID: id });
    });

    this.on('reindexDocument', KnowledgeDocuments, async (req) => {
      const id = keyOf(req);
      const exists = await SELECT.one.from(KnowledgeDocument).columns('ID').where({ ID: id });
      if (!exists) return req.reject(404, `KnowledgeDocument ${id} not found`);

      const indexError = await indexQuietly(id);
      if (indexError) req.warn(`Indexing failed: ${indexError}`);
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        entityId: id,
        action: 'REINDEX',
        aiInvolved: true,
        after: JSON.stringify({ indexError }),
      });
      return SELECT.one.from(KnowledgeDocuments).where({ ID: id });
    });

    this.on('reindex', async (req) => {
      const { onlyMissing } = req.data;
      const { indexed, failed } = await embedder.reindex({ onlyMissing });
      return { documentsQueued: indexed, failed };
    });

    this.on('listByCategory', async (req) => {
      const { category } = req.data;
      if (!CATEGORY_CODES.includes(category)) {
        return req.reject(400, `category must be one of: ${CATEGORY_CODES.join(', ')}`);
      }
      return SELECT.from(KnowledgeDocuments).where({ category });
    });

    // Shared validation for the two retrieval entry points.
    const retrievalOptions = (req) => {
      const { category, topK } = req.data;
      if (category && rejectInvalidCategory(req, category)) return null;
      const k = topK == null ? 5 : Number(topK);
      if (!Number.isInteger(k) || k < 1 || k > 20) {
        req.reject(400, 'topK must be an integer between 1 and 20');
        return null;
      }
      return { category: category || undefined, topK: k };
    };

    this.on('searchKnowledge', async (req) => {
      const query = String(req.data.query || '').trim();
      if (!query) return req.reject(400, 'query is required');
      const opts = retrievalOptions(req);
      if (!opts) return;
      const { minScore } = req.data;
      if (minScore != null && !Number.isFinite(Number(minScore))) {
        return req.reject(400, 'minScore must be a number');
      }
      return knowledgeQa.searchKnowledge(query, {
        ...opts,
        minScore: minScore == null ? undefined : Number(minScore),
      });
    });

    this.on('askKnowledge', async (req) => {
      const question = String(req.data.question || '').trim();
      if (!question) return req.reject(400, 'question is required');
      if (question.length > 2000) {
        return req.reject(400, 'question is too long (max 2000 characters)');
      }
      const opts = retrievalOptions(req);
      if (!opts) return;

      const result = await knowledgeQa.askKnowledge(question, opts);
      await writeAudit(req, {
        entityName: 'KnowledgeDocument',
        action: 'ASK_KNOWLEDGE',
        aiInvolved: true,
        before: JSON.stringify({ question, category: opts.category ?? null }),
        after: JSON.stringify({
          answered: result.answered,
          citations: result.citations.map((c) => c.sourceRef || c.ID),
          grounding: result.retrieved.map((c) => c.sourceRef || c.ID),
        }),
      });
      return result;
    });

    await super.init();
  }
};
