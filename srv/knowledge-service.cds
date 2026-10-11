using {sourcing as db} from '../db/sourcing-schema';

// The curated RAG corpus (§15): what enrichment and project drafting ground on.
// Readable by any authenticated user; only the Knowledge Curator may change it.
// Served to the Knowledge Base app (app/document-manager).
service KnowledgeService @(path: '/api/knowledge', requires: 'authenticated-user') {

    // Draft-enabled so the Knowledge Base Object Page offers Create / Edit / Save
    // (a non-draft FE v4 Object Page is display-only). Saving a changed title,
    // category or content re-embeds the document (knowledge-service.js), so the
    // vector always matches what a curator sees.
    //
    // '*' for the curator covers the draft events (NEW, EDIT, PATCH, activate,
    // DISCARD) as well as plain CREATE/UPDATE/DELETE and the media-stream PUT.
    @odata.draft.enabled
    @restrict: [
        {grant: 'READ'},
        {grant: '*', to: 'KnowledgeCurator'}
    ]
    entity KnowledgeDocuments  as
        projection on db.KnowledgeDocument {
            *,
            // Filled in JS after READ, not by a SQL CASE: on a draft-enabled entity
            // CAP re-renders a CASE for the _drafts table with bound literals, which
            // HANA rejects (see SourcingProjects in sourcing-project-service.cds).
            virtual indexCriticality : Integer
        }
        // The embedding vector is managed internally, never exposed over OData.
        excluding {
            embedding
        }
        actions {
            // Re-embed this one document now (e.g. after a FAILED index).
            @(requires: 'KnowledgeCurator')
            @Common.SideEffects: {TargetProperties: [
                '_it/indexStatus',
                '_it/indexedAt',
                '_it/indexError',
                '_it/indexCriticality'
            ]}
            // Only on the saved document, never inside an open edit draft.
            @Core.OperationAvailable: {$edmJson: {$Path: 'in/IsActiveEntity'}}
            action reindexDocument() returns KnowledgeDocuments;
        };

    // Fixed list of corpus categories — the value help for `category`. Served from
    // the same constant the write validation uses (knowledge-service.js), so the
    // dropdown can never offer a value the server would refuse.
    @cds.persistence.skip
    @readonly
    entity KnowledgeCategories {
        key code        : String(30);
            description : String(100);
    }

    // A retrieval hit: what RAG would ground on for a query.
    type KnowledgeHit {
        ID        : UUID;
        category  : String(30);
        title     : String(200);
        sourceRef : String(255);
        score     : Double;
        excerpt   : String(500);
    }

    // Register a curated text document in the corpus. Embedded immediately; the
    // returned row's indexStatus says whether that succeeded.
    @(requires: 'KnowledgeCurator')
    action   indexDocument(category: String, title: String, content: LargeString, sourceRef: String) returns KnowledgeDocuments;

    // Create a corpus document for a file. The bytes follow as a media-stream
    // PUT to KnowledgeDocuments(ID=<id>,IsActiveEntity=true)/contentBinary, which
    // parses the file into `content` and embeds it (same two-step pattern as
    // IntakeService.uploadDocument; CAP's JSON body limit rules out an action payload).
    @(requires: 'KnowledgeCurator')
    action   createFromFile(category: String, title: String, sourceRef: String, fileName: String, fileSize: Integer) returns KnowledgeDocuments;

    // (Re)compute embeddings for the corpus. onlyMissing=true only embeds documents
    // that are not INDEXED yet. Continue-on-failure: `failed` counts documents left
    // FAILED (each with its indexError), the rest are still indexed.
    @(requires: 'KnowledgeCurator')
    action   reindex(onlyMissing: Boolean)                                                            returns {
        documentsQueued : Integer;
        failed          : Integer;
    };

    // List curated documents of a given category.
    function listByCategory(category: String)                                                         returns many KnowledgeDocuments;

    // Retrieval test: the documents RAG would ground on for `query`, with scores.
    // No LLM call — one embedding of the query. minScore omitted = the provider-aware
    // default floor used by enrichment/drafting.
    function searchKnowledge(query: String, category: String, topK: Integer, minScore: Double)       returns many KnowledgeHit;

    // Grounded answer from the corpus, citing the documents it used. Informational
    // only — it never creates or changes anything (§25). An action, not a function:
    // it calls the LLM, and a question does not belong in a GET URL.
    action   askKnowledge(question: String, category: String, topK: Integer)                          returns {
        answer    : LargeString;
        answered  : Boolean;
        citations : many KnowledgeHit;
        retrieved : many KnowledgeHit;
    };
}

// Media-stream plumbing for file uploads (see SourceDocuments in
// intake-service.cds). Downloads come back as an attachment under the original
// file name. @odata.draft.skip keeps the file out of edit drafts: draft
// activation then never rewrites the stored bytes, so the only way to change them
// is the stream PUT, which re-parses and re-embeds.
annotate KnowledgeService.KnowledgeDocuments with {
    contentBinary @Core.MediaType                   : mediaType
                  @Core.ContentDisposition.Filename : fileName
                  @Core.ContentDisposition.Type     : 'attachment'
                  @odata.draft.skip;
    mediaType     @Core.IsMediaType;
    // Required on every save (draft activation asserts them). createFromFile rows
    // start without content; the upload fills it in from the parsed file.
    title         @mandatory;
    category      @mandatory;
    content       @mandatory;
    // System-maintained by srv/ai/embedder.js — never client input.
    indexStatus   @readonly;
    indexedAt     @readonly;
    indexError    @readonly;
    fileName      @readonly;
};
