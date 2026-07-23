using {sourcing as db} from '../db/sourcing-schema';

service IntakeService @(path: '/api/intake', requires: 'authenticated-user') {

    // Creation must go through uploadDocument() so its validation (allowed
    // originType, workspace existence, size cap) can't be bypassed by a raw POST
    // — e.g. a Fiori Elements List Report's default "Create" button.
    //
    // NOT @readonly, despite that being the goal: @readonly also blocks OData
    // media-stream writes, so PUT .../contentBinary returned 405 (verified). The
    // grant list below instead allows READ plus UPDATE — the verb a stream PUT
    // uses — while still denying CREATE and DELETE. The before-UPDATE handler in
    // intake-service.js then narrows UPDATE to contentBinary only, so this is not
    // a general write opening.
    //
    // Uploading bytes this way keeps them inside CAP's auth/CSRF handling (no
    // custom Express route) and avoids the ~33% inflation of base64-ing the file
    // through the action payload.
    // READ open to any authenticated user; UPDATE (the media-stream PUT of
    // contentBinary, narrowed further by the before-UPDATE handler) requires the
    // ProcurementRequester role. CREATE/DELETE remain denied — creation goes through
    // uploadDocument().
    @restrict: [
        {grant: 'READ'},
        {grant: 'UPDATE', to: 'ProcurementRequester'}
    ]
    entity SourceDocuments as
        projection on db.SourceDocument {
            *,
            // Workspace title exposed alongside workspace_ID so the UI can show the
            // human-readable name (e.g. "HTTP smoke ws") instead of the raw UUID,
            // via TextArrangement (see annotations.cds).
            workspace.title as workspaceTitle : String,
            // Deep link to the Requirement Workspace app, built here rather than
            // via odata.concat in the annotation: concatenating the Guid-typed
            // workspace_ID made Fiori Elements derive the link's `enabled` from a
            // Guid and throw "Don't know how to format ... Guid to boolean" on
            // every Object Page load. A ready-made String sidesteps the coercion.
            '/poc.sp.hub.requirementworkspace/index.html?workspace=' ||
            workspace.ID                     as workspaceUrl : String,
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
    @(requires: 'ProcurementRequester')
    action   createWorkspace(title: String)                                         returns RequirementWorkspaces;

    // Uploads a document into a Requirement Workspace. `content` carries raw text
    // (email body, CSV/TSV rows, JSON payload). For binary formats (PDF) the caller
    // creates the row here with `fileSize` set, then PUTs the bytes to
    // .../SourceDocuments(<id>)/contentBinary — see the media stream above.
    // Image OCR is still unimplemented, so an Image row stores bytes but cannot
    // extract yet (§17).
    @(requires: 'ProcurementRequester')
    action   uploadDocument(workspaceId: UUID, originType: String, fileName: String, fileType: String, content: LargeString, fileSize: Integer) returns SourceDocuments;

    // Move a document to a different workspace. Allowed only before extraction —
    // once EXTRACTED, the document's WorkspaceRequirement rows already live in the
    // old workspace, so moving just the document would orphan them (§18).
    @(requires: 'ProcurementRequester')
    action   changeWorkspace(documentId: UUID, newWorkspaceId: UUID)               returns SourceDocuments;

    @(requires: 'ProcurementRequester')
    action   extractRequirements(documentId: UUID)                                  returns {
        status      : String;
        itemsCreated: Integer;
    };

    function getExtractionStatus(documentId: UUID)                                  returns {
        status   : String;
        errorMsg : String;
    };
}

// Media-stream plumbing for the binary upload path. @Core.MediaType marks
// contentBinary as the stream property (its value names the column holding the
// content type), and @Core.ContentDisposition.Filename makes a download come back
// under the original file name rather than the entity key.
annotate IntakeService.SourceDocuments with {
    contentBinary @Core.MediaType                   : fileType
                  @Core.ContentDisposition.Filename : fileName
                  @Core.ContentDisposition.Type     : 'inline';
};
