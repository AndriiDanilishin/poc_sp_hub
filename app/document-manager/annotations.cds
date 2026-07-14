using DocumentService as service from '../../srv/document-service';
annotate service.Documents with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Label : 'fileName',
                Value : fileName,
            },
            {
                $Type : 'UI.DataField',
                Label : 'fileType',
                Value : fileType,
            },
            {
                $Type : 'UI.DataField',
                Label : 'fileSize',
                Value : fileSize,
            },
            {
                $Type : 'UI.DataField',
                Label : 'status',
                Value : status,
            },
            {
                $Type : 'UI.DataField',
                Label : 'chunkCount',
                Value : chunkCount,
            },
            {
                $Type : 'UI.DataField',
                Label : 'errorMsg',
                Value : errorMsg,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'fileName',
            Value : fileName,
        },
        {
            $Type : 'UI.DataField',
            Label : 'fileType',
            Value : fileType,
        },
        {
            $Type : 'UI.DataField',
            Label : 'fileSize',
            Value : fileSize,
        },
        {
            $Type : 'UI.DataField',
            Label : 'status',
            Value : status,
        },
        {
            $Type : 'UI.DataField',
            Label : 'chunkCount',
            Value : chunkCount,
        },
    ],
);

