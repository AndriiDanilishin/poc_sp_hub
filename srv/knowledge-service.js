const cds = require('@sap/cds');
const embedder = require('./ai/embedder');

// Only these curated categories feed RAG (§15); uploaded source documents do not.
const CATEGORIES = [
  'Policy',
  'MaterialGroupCatalog',
  'CommodityTaxonomy',
  'PastProject',
  'SupplierProfile',
  'Guideline',
];

module.exports = class KnowledgeService extends cds.ApplicationService {
  async init() {
    const { KnowledgeDocuments } = this.entities;

    this.on('indexDocument', async (req) => {
      const { category, title, content, sourceRef } = req.data;
      if (!CATEGORIES.includes(category)) {
        return req.reject(400, `category must be one of: ${CATEGORIES.join(', ')}`);
      }
      if (!title) {
        return req.reject(400, 'title is required');
      }
      if (!content) {
        return req.reject(400, 'content is required');
      }

      const id = cds.utils.uuid();
      // Store the curated content now; the embedding is computed by reindex
      // (srv/ai/embedder.js), not on insert, so indexing can be batched/retried.
      await INSERT.into(KnowledgeDocuments).entries({
        ID: id,
        category,
        title,
        content,
        sourceRef,
      });
      return SELECT.one.from(KnowledgeDocuments).where({ ID: id });
    });

    this.on('reindex', async (req) => {
      const { onlyMissing } = req.data;
      const { indexed } = await embedder.reindex({ onlyMissing });
      return { documentsQueued: indexed };
    });

    this.on('listByCategory', async (req) => {
      const { category } = req.data;
      if (!CATEGORIES.includes(category)) {
        return req.reject(400, `category must be one of: ${CATEGORIES.join(', ')}`);
      }
      return SELECT.from(KnowledgeDocuments).where({ category });
    });

    await super.init();
  }
};
