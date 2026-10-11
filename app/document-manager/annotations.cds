using KnowledgeService as service from '../../srv/knowledge-service';

// Knowledge Base app: the curator UI for the RAG corpus (see document-manager.md).
// Labels come from the @title annotations at the bottom rather than per-DataField
// `Label:` entries, same convention as intake-hub's annotations.cds.
annotate service.KnowledgeDocuments with @(
    UI.HeaderInfo                : {
        TypeName      : 'Knowledge Document',
        TypeNamePlural: 'Knowledge Documents',
        Title         : {Value: title},
        Description   : {Value: category},
    },
    UI.SelectionFields           : [
        category,
        indexStatus,
        sourceRef
    ],
    // Importance drives which columns the ResponsiveTable keeps on narrow
    // screens: title, category and searchability are what a curator triages by.
    UI.LineItem                  : [
        {
            $Type            : 'UI.DataField',
            Value            : title,
            ![@UI.Importance]: #High,
        },
        {
            $Type            : 'UI.DataField',
            Value            : category,
            ![@UI.Importance]: #High,
        },
        {
            $Type: 'UI.DataField',
            Value: sourceRef,
        },
        {
            $Type            : 'UI.DataField',
            Value            : indexStatus,
            Criticality      : indexCriticality,
            ![@UI.Importance]: #High,
        },
        {
            $Type: 'UI.DataField',
            Value: indexedAt,
        },
        {
            $Type: 'UI.DataField',
            Value: fileName,
        },
    ],
    // Object Page header button. OperationAvailable on the action hides it while
    // an edit draft is open.
    UI.Identification            : [{
        $Type : 'UI.DataFieldForAction',
        Action: 'KnowledgeService.reindexDocument',
        Label : 'Reindex',
    }],
    UI.DataPoint #IndexStatus    : {
        Value      : indexStatus,
        Title      : 'Search Index',
        Criticality: indexCriticality,
    },
    UI.HeaderFacets              : [{
        $Type : 'UI.ReferenceFacet',
        ID    : 'IndexStatusHeader',
        Target: '@UI.DataPoint#IndexStatus',
    }],
    UI.FieldGroup #General       : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type: 'UI.DataField',
                Value: title,
            },
            {
                $Type: 'UI.DataField',
                Value: category,
            },
            {
                $Type: 'UI.DataField',
                Value: sourceRef,
            },
        ],
    },
    UI.FieldGroup #Content       : {
        $Type: 'UI.FieldGroupType',
        Data : [{
            $Type: 'UI.DataField',
            Value: content,
        }],
    },
    UI.FieldGroup #Indexing      : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type      : 'UI.DataField',
                Value      : indexStatus,
                Criticality: indexCriticality,
            },
            {
                $Type: 'UI.DataField',
                Value: indexedAt,
            },
            {
                $Type: 'UI.DataField',
                Value: indexError,
            },
        ],
    },
    UI.FieldGroup #SourceFile    : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type: 'UI.DataField',
                Value: fileName,
            },
            // The stream renders as a download link. Hidden in an edit draft: the
            // file is @odata.draft.skip and FE would offer an upload into the
            // draft, which the service refuses (files are replaced via Upload File).
            {
                $Type            : 'UI.DataField',
                Value            : contentBinary,
                ![@UI.Hidden]    : {$edmJson: {$Not: {$Path: 'IsActiveEntity'}}},
            },
        ],
    },
    UI.Facets                    : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'GeneralFacet',
            Label : 'General Information',
            Target: '@UI.FieldGroup#General',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'ContentFacet',
            Label : 'Content',
            Target: '@UI.FieldGroup#Content',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'IndexingFacet',
            Label : 'Search Index',
            Target: '@UI.FieldGroup#Indexing',
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'SourceFileFacet',
            Label        : 'Source File',
            Target       : '@UI.FieldGroup#SourceFile',
            // Only documents created from an uploaded file have one.
            ![@UI.Hidden]: {$edmJson: {$Eq: [{$Path: 'fileName'}, null]}},
        },
    ],
);

annotate service.KnowledgeDocuments with {
    title            @title: 'Title';
    category         @title: 'Category'
                     @Common.ValueListWithFixedValues
                     @Common.ValueList: {
                         CollectionPath: 'KnowledgeCategories',
                         Parameters    : [
                             {
                                 $Type            : 'Common.ValueListParameterInOut',
                                 LocalDataProperty: category,
                                 ValueListProperty: 'code',
                             },
                             {
                                 $Type            : 'Common.ValueListParameterDisplayOnly',
                                 ValueListProperty: 'description',
                             },
                         ],
                     };
    sourceRef        @title: 'Source Reference';
    content          @title: 'Content'  @UI.MultiLineText;
    indexStatus      @title: 'Search Index';
    indexedAt        @title: 'Indexed At';
    indexError       @title: 'Index Error';
    fileName         @title: 'File Name';
    contentBinary    @title: 'Original File';
    mediaType        @title: 'Media Type';
    indexCriticality @UI.Hidden;
    createdAt        @title: 'Created At';
    modifiedAt       @title: 'Changed At';
}

annotate service.KnowledgeCategories with {
    code        @title: 'Category';
    description @title: 'Description';
}
