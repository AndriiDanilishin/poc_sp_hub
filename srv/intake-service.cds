using {sourcing as db} from '../db/sourcing-schema';

service IntakeService @(path: '/api/intake') {

    entity SourceDocuments as projection on db.SourceDocument;

    action   uploadDocument(originType: String, fileName: String, fileType: String) returns SourceDocuments;

    action   extractRequirements(documentId: UUID)                                  returns {
        status      : String;
        itemsCreated: Integer;
    };

    function getExtractionStatus(documentId: UUID)                                  returns {
        status   : String;
        errorMsg : String;
    };
}
