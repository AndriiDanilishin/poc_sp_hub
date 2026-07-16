using {sourcing as db} from '../db/sourcing-schema';

service IntakeService @(path: '/api/intake') {

    // Read-only over plain OData CRUD — creation must go through uploadDocument()
    // so its validation (allowed originType, workspace existence) can't be bypassed
    // by a raw POST (e.g. a Fiori Elements List Report's default "Create" button).
    @readonly
    entity SourceDocuments as
        projection on db.SourceDocument {
            *,
            case status
                when 'FAILED'     then 1
                when 'EXTRACTING' then 2
                when 'EXTRACTED'  then 3
                else 0
            end as statusCriticality : Integer
        };

    // Uploads a document into a Requirement Workspace. `content` carries raw text
    // for the fully-implemented parsers (Email/RestApi/Excel CSV-TSV); binary
    // formats (PDF/Image/.xlsx) can be uploaded as metadata now and parsed once
    // their document parsers support binary content (§17).
    action   uploadDocument(workspaceId: UUID, originType: String, fileName: String, fileType: String, content: LargeString) returns SourceDocuments;

    action   extractRequirements(documentId: UUID)                                  returns {
        status      : String;
        itemsCreated: Integer;
    };

    function getExtractionStatus(documentId: UUID)                                  returns {
        status   : String;
        errorMsg : String;
    };
}
