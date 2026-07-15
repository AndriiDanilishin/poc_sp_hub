const cds = require('@sap/cds');

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
      // Store the curated content now; the embedding is computed later by the
      // Phase 2 embedder (srv/lib/embedder.js) via reindex.
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
      // Vectorization needs the embedder (Phase 2, docs/solution-architecture.md §15).
      return req.reject(501, 'Knowledge re-indexing (embedding) is not implemented yet (Phase 2)');
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
