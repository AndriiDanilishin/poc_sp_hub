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
    UI.LineItem               : [
        {Value: fileName, Label: 'File Name'},
        {Value: originType, Label: 'Origin'},
        {Value: fileType, Label: 'File Type'},
        {
            Value      : status,
            Label      : 'Status',
            Criticality: statusCriticality
        },
        {Value: createdAt, Label: 'Uploaded At'},
    ],
    UI.FieldGroup #GeneralInfo: {Data: [
        {Value: originType, Label: 'Origin Type'},
        {Value: fileName, Label: 'File Name'},
        {Value: fileType, Label: 'File Type'},
        {
            Value      : status,
            Label      : 'Status',
            Criticality: statusCriticality
        },
        {Value: errorMsg, Label: 'Error Message'},
        {Value: workspace_ID, Label: 'Workspace ID'},
    ]},
    UI.Facets                 : [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'GeneralInfoFacet',
        Label : 'General Information',
        Target: '@UI.FieldGroup#GeneralInfo',
    }],
);

annotate service.SourceDocuments with {
    originType     @title: 'Origin Type';
    fileName       @title: 'File Name';
    fileType       @title: 'File Type';
    content        @title: 'Content' @UI.MultiLineText;
    status         @title: 'Status' @readonly;
    errorMsg       @title: 'Error Message' @readonly;
    workspace_ID   @title: 'Workspace ID';
    createdAt      @title: 'Uploaded At';
};
