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
    {
        Value            : description,
        ![@UI.Importance]: #High
    },
    {Value: quantity},
    {Value: unit},
    {Value: materialGroup_code},
    {Value: commodityCode_code},
    {Value: aiGenerated},
]) {
    description   @title: 'Description';
    quantity      @title: 'Quantity';
    unit          @title: 'Unit';
    materialGroup @title             : 'Material Group'
                  @Common.Text       : materialGroup.name
                  @Common.TextArrangement: #TextFirst;
    commodityCode @title             : 'Commodity'
                  @Common.Text       : commodityCode.description
                  @Common.TextArrangement: #TextFirst;
    aiGenerated   @title: 'AI Generated';
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
    aiGenerated @title: 'AI Generated';
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
                    @Common.TextArrangement: #TextFirst;
    rationale       @title: 'Rationale';
    confidenceScore @title: 'Confidence';
    aiGenerated     @title: 'AI Generated';
};

annotate service.SourcingProjectCommodities with @(UI.LineItem: [
    {Value: commodityCode_code},
    {Value: aiGenerated},
]) {
    commodityCode @title             : 'Commodity Code'
                  @Common.Text       : commodityCode.description
                  @Common.TextArrangement: #TextFirst;
    aiGenerated   @title: 'AI Generated';
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
