using SourcingProjectService as service from '../../srv/sourcing-project-service';

// ---------------------------------------------------------------------------
// Sourcing Project — List Report + Object Page
// ---------------------------------------------------------------------------
annotate service.SourcingProjects with @(
    // Edit only while DRAFT: approval freezes the project (§25). The EDIT handler
    // refuses it server-side as well. Projects are created by promoting a workspace,
    // so the list gets no Create button — CreateHidden, not InsertRestrictions:
    // CAP enforces the latter and would also refuse POST from API clients (405).
    UI.UpdateHidden       : {$edmJson: {$Ne: [{$Path: 'status'}, 'DRAFT']}},
    UI.CreateHidden       : true,
    UI.HeaderInfo         : {
        TypeName      : 'Sourcing Project',
        TypeNamePlural: 'Sourcing Projects',
        Title         : {Value: title},
        Description   : {Value: category},
    },
    UI.SelectionFields    : [
        status,
        priority,
        category
    ],
    // No per-item Label: each duplicated the @title annotated below. Importance
    // keeps title/status in view when the ResponsiveTable narrows on small
    // screens — they are what identify and triage a project.
    UI.LineItem           : [
        {
            Value            : title,
            ![@UI.Importance]: #High
        },
        {Value: category},
        {
            Value            : status,
            Criticality      : statusCriticality,
            ![@UI.Importance]: #High
        },
        {Value: priority},
        {Value: budgetAmount},
        {Value: s4RequisitionNumber},
        // Bound actions surface as buttons in the list toolbar too.
        {
            $Type : 'UI.DataFieldForAction',
            Label : 'Approve',
            Action: 'SourcingProjectService.approve'
        },
    ],
    // Header action buttons on the Object Page (availability gated in the service CDS).
    UI.Identification     : [
        {
            $Type : 'UI.DataFieldForAction',
            Label : 'Generate AI Draft',
            Action: 'SourcingProjectService.generateDraft'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Label : 'Approve',
            Action: 'SourcingProjectService.approve'
        },
        {
            $Type : 'UI.DataFieldForAction',
            Label : 'Submit to S/4HANA',
            Action: 'SourcingProjectService.submitToS4'
        },
    ],
    UI.FieldGroup #General: {Data: [
        {Value: title},
        {Value: description},
        {Value: category},
        {
            Value      : status,
            Criticality: statusCriticality
        },
        {Value: priority},
    ]},
    UI.FieldGroup #Timeline: {Data: [
        {Value: timelineStart},
        {Value: timelineEnd},
        {Value: budgetAmount},
        {Value: budgetCurrency},
    ]},
    // S/4HANA Purchase Requisition data (§21). The org data (plant, purchasing
    // group, G/L account) is fixed tenant config; only the cost center may differ.
    UI.FieldGroup #S4     : {Data: [
        {Value: s4RequisitionNumber},
        {Value: costCenter},
    ]},
    UI.Facets             : [
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'GeneralFacet',
            Label : 'General',
            Target: '@UI.FieldGroup#General',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'TimelineFacet',
            Label : 'Timeline & Budget',
            Target: '@UI.FieldGroup#Timeline',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'RequirementsFacet',
            Label : 'Requirements',
            Target: 'requirements/@UI.LineItem',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'RisksFacet',
            Label : 'Risks',
            Target: 'risks/@UI.LineItem',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'CommoditiesFacet',
            Label : 'Commodities',
            Target: 'commodityCodes/@UI.LineItem',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'SuppliersFacet',
            Label : 'Suggested Suppliers',
            Target: 'suggestedSuppliers/@UI.LineItem',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID    : 'AttachmentsFacet',
            Label : 'Attachments',
            Target: 'attachments/@UI.LineItem',
        },
        {
            $Type : 'UI.CollectionFacet',
            ID    : 'S4Facet',
            Label : 'S/4HANA Submission',
            Facets: [
                {
                    $Type : 'UI.ReferenceFacet',
                    ID    : 'S4DataFacet',
                    Label : 'Purchase Requisition',
                    Target: '@UI.FieldGroup#S4',
                },
                {
                    $Type : 'UI.ReferenceFacet',
                    ID    : 'S4LogFacet',
                    Label : 'Submission Log',
                    Target: 'requisitionLog/@UI.LineItem',
                },
            ],
        },
    ],
);

annotate service.SourcingProjects with {
    title          @title: 'Title';
    description    @title: 'Description'    @UI.MultiLineText;
    category       @title: 'Category';
    materialGroup  @title: 'Material Group';
    status         @title: 'Status'         @readonly;
    priority       @title: 'Priority';
    timelineStart  @title: 'Timeline Start';
    timelineEnd    @title: 'Timeline End';
    budgetAmount   @title: 'Budget Amount';
    budgetCurrency @title: 'Currency';
    costCenter     @title: 'Cost Center (S/4HANA)'
                   @Common.QuickInfo: 'Leave empty to use the default cost center';
    s4RequisitionNumber @title: 'Purchase Requisition' @readonly;
};

// ---------------------------------------------------------------------------
// Composition children — line items shown as Object Page tables
// ---------------------------------------------------------------------------
annotate service.Requirements with @(UI.LineItem: [
    {
        Value            : description,
        ![@UI.Importance]: #High
    },
    {Value: quantity},
    {Value: unit},
    {Value: unitPrice},
    {Value: deliveryDate},
    {Value: materialGroup_code},
    {Value: commodityCode_code},
    {Value: aiGenerated},
]) {
    description   @title: 'Description';
    quantity      @title: 'Quantity';
    unit          @title: 'Unit';
    unitPrice     @title: 'Unit Price';
    deliveryDate  @title: 'Delivery Date';
    // Value help from master data, so an edited code can't be a dangling reference.
    materialGroup @title             : 'Material Group'
                  @Common.Text       : materialGroup.name
                  @Common.TextArrangement: #TextFirst
                  @Common.ValueListWithFixedValues
                  @Common.ValueList  : {
                      CollectionPath: 'MaterialGroups',
                      Parameters    : [
                          {$Type: 'Common.ValueListParameterInOut', LocalDataProperty: materialGroup_code, ValueListProperty: 'code'},
                          {$Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name'},
                      ]
                  };
    commodityCode @title             : 'Commodity'
                  @Common.Text       : commodityCode.description
                  @Common.TextArrangement: #TextFirst
                  @Common.ValueListWithFixedValues
                  @Common.ValueList  : {
                      CollectionPath: 'CommodityCodes',
                      Parameters    : [
                          {$Type: 'Common.ValueListParameterInOut', LocalDataProperty: commodityCode_code, ValueListProperty: 'code'},
                          {$Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description'},
                      ]
                  };
    aiGenerated   @title: 'AI Generated' @readonly;
};

annotate service.Risks with @(UI.LineItem: [
    {Value: description},
    {
        Value      : severity,
        Criticality: severityCriticality
    },
    {Value: category},
    {Value: mitigation},
    {Value: aiGenerated},
]) {
    description @title: 'Risk';
    severity    @title: 'Severity';
    category    @title: 'Category';
    mitigation  @title: 'Mitigation';
    aiGenerated @title: 'AI Generated' @readonly;
};

// Supplier is keyed by its S/4HANA business-partner number, so the raw FK reads
// as e.g. "1000002" — meaningless to the manager approving the project. Text +
// TextArrangement makes Fiori Elements render "Office Supplies GmbH (1000002)"
// with no custom code. Same reasoning for the commodity/material-group codes.
annotate service.SourcingProjectSuppliers with @(UI.LineItem: [
    {Value: supplier_ID},
    {Value: rationale},
    {Value: confidenceScore},
    {Value: aiGenerated},
]) {
    supplier        @title             : 'Supplier'
                    @Common.Text       : supplier.name
                    @Common.TextArrangement: #TextFirst
                    @Common.ValueList  : {
                        CollectionPath: 'Suppliers',
                        Parameters    : [
                            {$Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID'},
                            {$Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name'},
                        ]
                    };
    rationale       @title: 'Rationale';
    confidenceScore @title: 'Confidence' @readonly;
    aiGenerated     @title: 'AI Generated' @readonly;
};

annotate service.SourcingProjectCommodities with @(UI.LineItem: [
    {Value: commodityCode_code},
    {Value: aiGenerated},
]) {
    commodityCode @title             : 'Commodity Code'
                  @Common.Text       : commodityCode.description
                  @Common.TextArrangement: #TextFirst
                  @Common.ValueListWithFixedValues
                  @Common.ValueList  : {
                      CollectionPath: 'CommodityCodes',
                      Parameters    : [
                          {$Type: 'Common.ValueListParameterInOut', LocalDataProperty: commodityCode_code, ValueListProperty: 'code'},
                          {$Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description'},
                      ]
                  };
    aiGenerated   @title: 'AI Generated' @readonly;
};

annotate service.Attachments with @(UI.LineItem: [
    {Value: fileName},
    {Value: fileType},
    {Value: fileSize},
    {Value: url},
]) {
    fileName @title: 'File Name';
    fileType @title: 'File Type';
    fileSize @title: 'Size';
    url      @title: 'URL';
};

// Submission history — every attempt to reach S/4HANA, newest first (§21).
annotate service.PurchaseReqLogs with @(
    UI.LineItem           : [
        {Value: createdAt},
        {
            Value      : status,
            Criticality: statusCriticality
        },
        {Value: s4RequisitionNumber},
        {Value: errorMsg},
        {Value: createdBy},
    ],
    UI.PresentationVariant: {
        SortOrder     : [{
            Property  : createdAt,
            Descending: true
        }],
        Visualizations: ['@UI.LineItem']
    },
) {
    createdAt           @title: 'Submitted At';
    createdBy           @title: 'Submitted By';
    status              @title: 'Result';
    s4RequisitionNumber @title: 'Purchase Requisition';
    errorMsg            @title: 'Message';
};
