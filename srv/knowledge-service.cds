using {sourcing as db} from '../db/sourcing-schema';

// The curated RAG corpus is readable reference data; only the Knowledge Curator
// may mutate it. So the write actions are role-restricted rather than the whole
// service (§22) — this also lets the Fiori preview / read clients work in dev.
service KnowledgeService @(path: '/api/knowledge', requires: 'authenticated-user') {

    // The embedding vector is managed internally, never exposed over OData.
    entity KnowledgeDocuments as
        projection on db.KnowledgeDocument
        excluding {
            embedding
        };

    // Register a curated document in the corpus (its embedding is computed by reindex).
    @(requires: 'KnowledgeCurator')
    action   indexDocument(category: String, title: String, content: LargeString, sourceRef: String) returns KnowledgeDocuments;

    // (Re)compute embeddings for the corpus. onlyMissing=true skips documents that
    // already have a vector, so a full corpus scan isn't re-embedded every time.
    @(requires: 'KnowledgeCurator')
    action   reindex(onlyMissing: Boolean)                                                            returns {
        documentsQueued : Integer;
    };

    // List curated documents of a given category.
    function listByCategory(category: String)                                                         returns many KnowledgeDocuments;
}
