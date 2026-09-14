using IntakeService as service from '../../srv/intake-service';

annotate service.SourceDocuments with @(
    UI.HeaderInfo             : {
        TypeName      : 'Source Document',
        TypeNamePlural: 'Source Documents',
        Title         : {Value: fileName},
        Description   : {Value: originType},
    },
    UI.SelectionFields        : [
        originType,
        fileType,
        status
    ],
    // No per-item Label: each duplicated the @title annotated below. Importance
    // drives which columns the ResponsiveTable keeps on narrow screens and which
    // ones pop in — file name and status are what identify and triage a row.
    // fileType is dropped: it restates the file name's extension. fileSize earns
    // the slot instead, since nothing else surfaces it in the list.
    UI.LineItem               : [
        {
            Value                     : fileName,
            ![@UI.Importance]         : #High
        },
        {Value: originType},
        {
            Value                     : status,
            Criticality               : statusCriticality,
            ![@UI.Importance]         : #High
        },
        {Value: fileSize},
        {Value: createdAt},
    ],
    UI.FieldGroup #GeneralInfo: {Data: [
        {Value: originType, Label: 'Origin Type'},
        {Value: fileName, Label: 'File Name'},
        {Value: fileType, Label: 'File Type'},
        {Value: fileSize, Label: 'File Size (bytes)'},
        {
            Value      : status,
            Label      : 'Status',
            Criticality: statusCriticality
        },
        {Value: errorMsg, Label: 'Error Message'},
        // No workspaceTitle field here any more — it moved to the
        // WorkspaceLinkFacet custom facet below, rendered as a clickable link.
    ]},
    // Raw extraction preview (§26): the document text that parsing/extraction
    // will run over. Seeded demo rows predate the content field and show empty.
    UI.FieldGroup #Content    : {Data: [{
        Value: content,
        Label: 'Raw Content'
    }]},
    // WorkspaceLinkFacet (the clickable workspace name) is NOT declared here:
    // custom-fragment Object Page sections are wired in manifest.json's
    // content.body.sections (see document-manager's ChatSection for the
    // established pattern in this repo), not via a CDS UI.Facets entry — a
    // ReferenceFacet's Target must be an OData AnnotationPath, not a fragment
    // reference.
    UI.Facets                 : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'GeneralInfoFacet',
            Label : 'General Information',
            Target: '@UI.FieldGroup#GeneralInfo',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'ContentFacet',
            Label : 'Document Content',
            Target: '@UI.FieldGroup#Content',
        }
    ],
);

annotate service.SourceDocuments with {
    originType     @title: 'Origin Type';
    fileName       @title: 'File Name';
    fileType       @title: 'File Type';
    content        @title: 'Content' @UI.MultiLineText;
    fileSize       @title: 'File Size (bytes)' @readonly;
    status         @title: 'Status' @readonly;
    errorMsg       @title: 'Error Message' @readonly;
    // No @title on the workspace association / its generated workspace_ID foreign
    // key: both are only read programmatically (WorkspaceLink.fragment.xml /
    // IntakeActions.js), never rendered as a labelled field — the human-readable
    // name the UI shows comes from workspaceTitle, via the WorkspaceLinkFacet
    // custom facet.
    workspaceTitle @title: 'Workspace';
    createdAt      @title: 'Uploaded At';
};
