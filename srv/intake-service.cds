using {sourcing as db} from '../db/sourcing-schema';

service IntakeService @(path: '/api/intake') {

    // Read-only over plain OData CRUD — creation must go through uploadDocument()
    // so its validation (allowed originType, workspace existence) can't be bypassed
    // by a raw POST (e.g. a Fiori Elements List Report's default "Create" button).
    @readonly
    entity SourceDocuments as
        projection on db.SourceDocument {
            *,
            // Workspace title exposed alongside workspace_ID so the UI can show the
            // human-readable name (e.g. "HTTP smoke ws") instead of the raw UUID,
            // via TextArrangement (see annotations.cds).
            workspace.title as workspaceTitle : String,
            case status
                when 'FAILED'     then 1
                when 'EXTRACTING' then 2
                when 'EXTRACTED'  then 3
                else 0
            end as statusCriticality : Integer
        };

    // Read-only list of workspaces so the upload flow can pick a target workspace
    // for uploadDocument(workspaceId, …). Creation goes through createWorkspace()
    // below (mirrors uploadDocument): the entity stays @readonly so a raw POST is
    // blocked, but the action handler's own INSERT is unaffected by @readonly.
    @readonly
    entity RequirementWorkspaces as projection on db.RequirementWorkspace;

    // Create a new (OPEN) workspace so the user can add one without leaving the
    // Intake Hub. New workspaces are always OPEN — only promotion archives them.
    action   createWorkspace(title: String)                                         returns RequirementWorkspaces;

    // Uploads a document into a Requirement Workspace. `content` carries raw text
    // for the fully-implemented parsers (Email/RestApi/Excel CSV-TSV); binary
    // formats (PDF/Image/.xlsx) can be uploaded as metadata now and parsed once
    // their document parsers support binary content (§17).
    action   uploadDocument(workspaceId: UUID, originType: String, fileName: String, fileType: String, content: LargeString) returns SourceDocuments;

    // Move a document to a different workspace. Allowed only before extraction —
    // once EXTRACTED, the document's WorkspaceRequirement rows already live in the
    // old workspace, so moving just the document would orphan them (§18).
    action   changeWorkspace(documentId: UUID, newWorkspaceId: UUID)               returns SourceDocuments;

    action   extractRequirements(documentId: UUID)                                  returns {
        status      : String;
        itemsCreated: Integer;
    };

    function getExtractionStatus(documentId: UUID)                                  returns {
        status   : String;
        errorMsg : String;
    };
}
