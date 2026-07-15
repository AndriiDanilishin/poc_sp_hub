const cds = require('@sap/cds');

const ALLOWED_ORIGIN_TYPES = ['Email', 'Pdf', 'Image', 'Excel', 'RestApi'];

module.exports = class IntakeService extends cds.ApplicationService {
  async init() {
    const { SourceDocuments } = this.entities;

    this.on('uploadDocument', async (req) => {
      const { originType, fileName, fileType } = req.data;

      if (!ALLOWED_ORIGIN_TYPES.includes(originType)) {
        return req.reject(400, `originType must be one of: ${ALLOWED_ORIGIN_TYPES.join(', ')}`);
      }
      if (!fileName) {
        return req.reject(400, 'fileName is required');
      }

      const document = {
        ID: cds.utils.uuid(),
        originType,
        fileName,
        fileType,
        status: 'UPLOADED',
      };
      await INSERT.into(SourceDocuments).entries(document);
      return SELECT.one.from(SourceDocuments).where({ ID: document.ID });
    });

    this.on('extractRequirements', async (req) => {
      const { documentId } = req.data;
      const document = await SELECT.one.from(SourceDocuments).where({ ID: documentId });
      if (!document) {
        return req.reject(404, `SourceDocument ${documentId} not found`);
      }

      // AI-backed extraction lands in Phase 2 (docs/solution-architecture.md §18).
      return req.reject(501, 'Requirement extraction is not implemented yet (Phase 2)');
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
