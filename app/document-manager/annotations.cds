using DocumentService as service from '../../srv/document-service';

// Labels come from the @title annotations below rather than per-DataField
// `Label:` entries: the generator emitted the raw property name as the label
// for every field ('fileName', 'errorMsg', 'chunkCount'), which rendered the
// schema at the user instead of describing it. Same cleanup as intake-hub's
// annotations.cds.
annotate service.Documents with @(
    UI.HeaderInfo                : {
        TypeName      : 'Document',
        TypeNamePlural: 'Documents',
        Title         : {Value: fileName},
        Description   : {Value: fileType},
    },
    UI.SelectionFields           : [
        fileType,
        status
    ],
    UI.FieldGroup #GeneratedGroup: {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type: 'UI.DataField',
                Value: fileName,
            },
            {
                $Type: 'UI.DataField',
                Value: fileType,
            },
            {
                $Type: 'UI.DataField',
                Value: fileSize,
            },
            {
                $Type: 'UI.DataField',
                Value: status,
            },
            {
                $Type: 'UI.DataField',
                Value: chunkCount,
            },
            {
                $Type: 'UI.DataField',
                Value: errorMsg,
            },
        ],
    },
    UI.Facets                    : [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'GeneratedFacet1',
        Label : 'General Information',
        Target: '@UI.FieldGroup#GeneratedGroup',
    }],
    // Importance drives which columns the ResponsiveTable keeps on narrow
    // screens: file name and status are what identify and triage a row.
    UI.LineItem                  : [
        {
            $Type            : 'UI.DataField',
            Value            : fileName,
            ![@UI.Importance]: #High,
        },
        {
            $Type: 'UI.DataField',
            Value: fileType,
        },
        {
            $Type: 'UI.DataField',
            Value: fileSize,
        },
        {
            $Type            : 'UI.DataField',
            Value            : status,
            ![@UI.Importance]: #High,
        },
        {
            $Type: 'UI.DataField',
            Value: chunkCount,
        },
    ],
);

annotate service.Documents with {
    fileName   @title: 'File Name';
    fileType   @title: 'File Type';
    fileSize   @title: 'File Size (bytes)';
    // No Criticality on status: the Phase 0 workspace namespace has no status
    // vocabulary (the seeded rows hold generator noise like 'status479'), so
    // there is nothing meaningful to colour-code yet. Intake Hub's
    // statusCriticality is the pattern to follow once it does.
    status     @title: 'Status';
    chunkCount @title: 'Chunks';
    errorMsg   @title: 'Error Message';
    createdAt  @title: 'Uploaded At';
}
