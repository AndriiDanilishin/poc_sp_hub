using {sourcing as db} from '../db/sourcing-schema';

// Admin-only: only the Knowledge Curator maintains the curated RAG corpus (§22).
service KnowledgeService @(path: '/api/knowledge', requires: 'KnowledgeCurator') {

    // The embedding vector is managed internally, never exposed over OData.
    entity KnowledgeDocuments as
        projection on db.KnowledgeDocument
        excluding {
            embedding
        };

    // Register a curated document in the corpus (its embedding is computed by reindex).
    action   indexDocument(category: String, title: String, content: LargeString, sourceRef: String) returns KnowledgeDocuments;

    // (Re)compute embeddings for the corpus (Phase 2).
    action   reindex()                                                                                returns {
        documentsQueued : Integer;
    };

    // List curated documents of a given category.
    function listByCategory(category: String)                                                         returns many KnowledgeDocuments;
}
