using SourcingProjectService as service from '../../srv/sourcing-project-service';

// ---------------------------------------------------------------------------
// Sourcing Project — List Report + Object Page
// ---------------------------------------------------------------------------
annotate service.SourcingProjects with @(
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
    UI.LineItem           : [
        {Value: title, Label: 'Title'},
        {Value: category, Label: 'Category'},
        {
            Value      : status,
            Label      : 'Status',
            Criticality: statusCriticality
        },
        {Value: priority, Label: 'Priority'},
        {Value: budgetAmount, Label: 'Budget'},
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
        {Value: title, Label: 'Title'},
        {Value: description, Label: 'Description'},
        {Value: category, Label: 'Category'},
        {
            Value      : status,
            Label      : 'Status',
            Criticality: statusCriticality
        },
        {Value: priority, Label: 'Priority'},
    ]},
    UI.FieldGroup #Timeline: {Data: [
        {Value: timelineStart, Label: 'Timeline Start'},
        {Value: timelineEnd, Label: 'Timeline End'},
        {Value: budgetAmount, Label: 'Budget Amount'},
        {Value: budgetCurrency, Label: 'Currency'},
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
};

// ---------------------------------------------------------------------------
// Composition children — line items shown as Object Page tables
// ---------------------------------------------------------------------------
annotate service.Requirements with @(UI.LineItem: [
    {Value: description, Label: 'Description'},
    {Value: quantity, Label: 'Quantity'},
    {Value: unit, Label: 'Unit'},
    {Value: materialGroup_code, Label: 'Material Group'},
    {Value: commodityCode_code, Label: 'Commodity'},
    {Value: aiGenerated, Label: 'AI Generated'},
]) {
    description   @title: 'Description';
    quantity      @title: 'Quantity';
    unit          @title: 'Unit';
    materialGroup @title: 'Material Group';
    commodityCode @title: 'Commodity';
    aiGenerated   @title: 'AI Generated';
};

annotate service.Risks with @(UI.LineItem: [
    {Value: description, Label: 'Risk'},
    {
        Value      : severity,
        Label      : 'Severity',
        Criticality: severityCriticality
    },
    {Value: category, Label: 'Category'},
    {Value: mitigation, Label: 'Mitigation'},
    {Value: aiGenerated, Label: 'AI Generated'},
]) {
    description @title: 'Risk';
    severity    @title: 'Severity';
    category    @title: 'Category';
    mitigation  @title: 'Mitigation';
    aiGenerated @title: 'AI Generated';
};

annotate service.SourcingProjectSuppliers with @(UI.LineItem: [
    {Value: supplier_ID, Label: 'Supplier'},
    {Value: rationale, Label: 'Rationale'},
    {Value: confidenceScore, Label: 'Confidence'},
    {Value: aiGenerated, Label: 'AI Generated'},
]) {
    supplier        @title: 'Supplier';
    rationale       @title: 'Rationale';
    confidenceScore @title: 'Confidence';
    aiGenerated     @title: 'AI Generated';
};

annotate service.SourcingProjectCommodities with @(UI.LineItem: [
    {Value: commodityCode_code, Label: 'Commodity Code'},
    {Value: aiGenerated, Label: 'AI Generated'},
]) {
    commodityCode @title: 'Commodity Code';
    aiGenerated   @title: 'AI Generated';
};

annotate service.Attachments with @(UI.LineItem: [
    {Value: fileName, Label: 'File Name'},
    {Value: fileType, Label: 'File Type'},
    {Value: fileSize, Label: 'Size'},
    {Value: url, Label: 'URL'},
]) {
    fileName @title: 'File Name';
    fileType @title: 'File Type';
    fileSize @title: 'Size';
    url      @title: 'URL';
};
