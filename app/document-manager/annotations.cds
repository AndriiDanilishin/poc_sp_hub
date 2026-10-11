using KnowledgeService as service from '../../srv/knowledge-service';

// Knowledge Base app: the curator UI for the RAG corpus (see document-manager.md).
// Labels are {i18n>…} keys resolved by CAP from ./_i18n/i18n.properties (the webapp
// bundle is not visible to CDS). Field labels come from the @title annotations at
// the bottom rather than per-DataField `Label:` entries, same as intake-hub.

// Curator-only UI is hidden for non-curators. FE does not read @restrict; the
// server still refuses with 403. Two sources of the same fact, by where FE
// evaluates the annotation (both verified on UI5 1.150):
//  - entity-set level (Create, Delete, table actions): the CurrentUser
//    singleton, by absolute path — there is no row to evaluate a relative path on.
//    DeleteHidden by that path also hides the Object Page's Delete for
//    non-curators, without path errors (verified headlessly as requester and
//    curator) — unlike UpdateHidden below, so Delete needs no per-row variant.
//  - Object Page (Edit, header actions): the per-row virtual hideCuratorActions.
//    A singleton path in UpdateHidden logs "Failed to read path …" on every
//    Object Page load, and on a header DataFieldForAction it is ignored.
annotate service.KnowledgeDocuments with @(
    UI.CreateHidden              : {$edmJson: {$Path: '/KnowledgeService.EntityContainer/CurrentUser/readOnly'}},
    UI.DeleteHidden              : {$edmJson: {$Path: '/KnowledgeService.EntityContainer/CurrentUser/readOnly'}},
    UI.UpdateHidden              : hideCuratorActions,
    UI.HeaderInfo                : {
        TypeName      : '{i18n>KnowledgeDocument}',
        TypeNamePlural: '{i18n>KnowledgeDocuments}',
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
        // Toolbar button for the selected rows (FE invokes the bound action once
        // per selected document) — e.g. after filtering Search Index = FAILED.
        {
            $Type        : 'UI.DataFieldForAction',
            Action       : 'KnowledgeService.reindexDocument',
            Label        : '{i18n>ReindexSelected}',
            ![@UI.Hidden]: {$edmJson: {$Path: '/KnowledgeService.EntityContainer/CurrentUser/readOnly'}},
        },
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
        {
            $Type: 'UI.DataField',
            Value: modifiedAt,
        },
    ],
    // Object Page header button. OperationAvailable on the action hides it while
    // an edit draft is open.
    UI.Identification            : [{
        $Type        : 'UI.DataFieldForAction',
        Action       : 'KnowledgeService.reindexDocument',
        Label        : '{i18n>Reindex}',
        // Relative path: FE ignores the singleton path on header actions.
        ![@UI.Hidden]: hideCuratorActions,
    }],
    UI.DataPoint #IndexStatus    : {
        Value      : indexStatus,
        Title      : '{i18n>SearchIndex}',
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
            // Only meaningful after a failure; an empty "Index Error" is noise.
            {
                $Type        : 'UI.DataField',
                Value        : indexError,
                ![@UI.Hidden]: (indexError is null),
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
    UI.FieldGroup #Admin         : {
        $Type: 'UI.FieldGroupType',
        Data : [
            {
                $Type: 'UI.DataField',
                Value: createdAt,
            },
            {
                $Type: 'UI.DataField',
                Value: createdBy,
            },
            {
                $Type: 'UI.DataField',
                Value: modifiedAt,
            },
            {
                $Type: 'UI.DataField',
                Value: modifiedBy,
            },
        ],
    },
    UI.Facets                    : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'GeneralFacet',
            Label : '{i18n>GeneralInformation}',
            Target: '@UI.FieldGroup#General',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'ContentFacet',
            Label : '{i18n>Content}',
            Target: '@UI.FieldGroup#Content',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'IndexingFacet',
            Label : '{i18n>SearchIndex}',
            Target: '@UI.FieldGroup#Indexing',
        },
        {
            $Type        : 'UI.ReferenceFacet',
            ID           : 'SourceFileFacet',
            Label        : '{i18n>SourceFile}',
            Target       : '@UI.FieldGroup#SourceFile',
            // Only documents created from an uploaded file have one.
            ![@UI.Hidden]: (fileName is null),
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'AdminFacet',
            Label : '{i18n>AdministrativeData}',
            Target: '@UI.FieldGroup#Admin',
        },
    ],
);

annotate service.KnowledgeDocuments with {
    title            @title: '{i18n>Title}';
    // Shown as its description ("Material group catalog"), edited via the dropdown.
    category         @title: '{i18n>Category}'
                     @Common.Text: categoryText
                     @Common.TextArrangement: #TextOnly
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
    categoryText     @title: '{i18n>Category}'  @UI.HiddenFilter;
    sourceRef        @title: '{i18n>SourceReference}';
    content          @title: '{i18n>Content}'  @UI.MultiLineText;
    indexStatus      @title: '{i18n>SearchIndex}';
    indexedAt        @title: '{i18n>IndexedAt}';
    indexError       @title: '{i18n>IndexError}';
    fileName         @title: '{i18n>FileName}';
    contentBinary    @title: '{i18n>OriginalFile}';
    mediaType        @title: '{i18n>MediaType}';
    indexCriticality @UI.Hidden;
    hideCuratorActions @UI.Hidden;
    createdAt        @title: '{i18n>CreatedAt}';
    createdBy        @title: '{i18n>CreatedBy}';
    modifiedAt       @title: '{i18n>ChangedAt}';
    modifiedBy       @title: '{i18n>ChangedBy}';
}

annotate service.KnowledgeCategories with {
    code        @title: '{i18n>Category}'  @Common.Text: description  @Common.TextArrangement: #TextOnly;
    description @title: '{i18n>Description}';
}
