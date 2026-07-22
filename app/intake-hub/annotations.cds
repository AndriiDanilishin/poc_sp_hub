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
        {
            $Type: 'UI.DataFieldWithUrl',
            Value: workspaceTitle,
            Label: 'Workspace',
            // Url comes from the service-computed workspaceUrl String; building it
            // here with odata.concat over the Guid workspace_ID made FE try to
            // coerce a Guid to the link's boolean `enabled` property.
            Url  : workspaceUrl
        },
    ]},
    // Raw extraction preview (§26): the document text that parsing/extraction
    // will run over. Seeded demo rows predate the content field and show empty.
    UI.FieldGroup #Content    : {Data: [{
        Value: content,
        Label: 'Raw Content'
    }]},
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
    // key: workspace_ID is only ever used inside the DataFieldWithUrl $Path above
    // (never rendered as a labelled field), and the human-readable name the UI
    // shows comes from workspaceTitle. Annotating the association itself would
    // mislabel the navigation property rather than the FK.
    workspaceTitle @title: 'Workspace';
    createdAt      @title: 'Uploaded At';
};
