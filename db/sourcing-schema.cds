namespace sourcing;

using {
    cuid,
    managed
} from '@sap/cds/common';

// -----------------------------------------------------------------------------
// Intake
// -----------------------------------------------------------------------------

entity SourceDocument : cuid, managed {
    originType : String(10) enum {
        Email;
        Pdf;
        Image;
        Excel;
        RestApi;
    };
    fileName   : String(255);
    fileType   : String(10);
    // Raw text content to parse/extract from (email body, CSV/TSV text, structured
    // REST payload). Binary formats (PDF bytes, .xlsx, images) aren't stored here
    // yet — their parsers are still Phase-2 stubs (see srv/ai/document-parsers/);
    // adding binary storage is deferred until that parsing is real (§17, §21 notes
    // BTP Object Store for attachments as the eventual home for binary content).
    content    : LargeString;
    status     : String(20) default 'UPLOADED'; // UPLOADED, EXTRACTING, EXTRACTED, FAILED
    errorMsg   : String(1000);
    workspace  : Association to RequirementWorkspace;
}

// -----------------------------------------------------------------------------
// Requirement Workspace - the working area before a Sourcing Project exists
// -----------------------------------------------------------------------------

entity RequirementWorkspace : cuid, managed {
    title           : String(200);
    status          : String(20) default 'OPEN'; // OPEN, MERGED, ARCHIVED
    sourcingProject : Association to SourcingProject;
    documents       : Composition of many SourceDocument on documents.workspace = $self;
    items           : Composition of many WorkspaceRequirement on items.workspace = $self;
}

entity WorkspaceRequirement : cuid, managed {
    workspace             : Association to RequirementWorkspace @mandatory;
    description           : String(1000);
    normalizedDescription : String(1000);
    quantity              : Decimal(15, 3);
    unit                  : String(10);
    requestedDate         : Date;
    materialGroup         : Association to MaterialGroup;
    commodityCode         : Association to CommodityCode;
    confidenceScore       : Decimal(3, 2); // 0.00 - 1.00
    aiStatus              : String(10) default 'PROPOSED'; // PROPOSED, ACCEPTED, EDITED, REJECTED
    duplicateOf           : Association to WorkspaceRequirement;
    sources               : Composition of many RequirementSource on sources.requirement = $self;
}

entity RequirementSource : cuid {
    requirement : Association to WorkspaceRequirement @mandatory;
    document    : Association to SourceDocument @mandatory;
    rawSnippet  : LargeString;
    location    : String(100); // page / cell / paragraph reference
}

// -----------------------------------------------------------------------------
// Sourcing Project - created from accepted Workspace items, sent to S/4HANA
// -----------------------------------------------------------------------------

entity SourcingProject : cuid, managed {
    title              : String(200);
    description        : LargeString;
    category           : String(50);
    materialGroup      : Association to MaterialGroup;
    status             : String(20) default 'DRAFT'; // DRAFT, APPROVED, SUBMITTED
    priority           : String(10);
    timelineStart      : Date;
    timelineEnd        : Date;
    budgetAmount       : Decimal(15, 2);
    budgetCurrency     : String(3);
    requirements       : Composition of many Requirement on requirements.project = $self;
    commodityCodes     : Composition of many SourcingProjectCommodity on commodityCodes.project = $self;
    suggestedSuppliers : Composition of many SourcingProjectSupplier on suggestedSuppliers.project = $self;
    risks              : Composition of many Risk on risks.project = $self;
    attachments        : Composition of many Attachment on attachments.project = $self;
    requisitionLog     : Composition of many PurchaseReqLog on requisitionLog.project = $self;
}

entity Requirement : cuid {
    project     : Association to SourcingProject @mandatory;
    description : String(1000);
    quantity    : Decimal(15, 3);
    unit        : String(10);
    aiGenerated : Boolean default false;
}

entity SourcingProjectCommodity : cuid {
    project       : Association to SourcingProject @mandatory;
    commodityCode : Association to CommodityCode @mandatory;
    aiGenerated   : Boolean default false;
}

entity SourcingProjectSupplier : cuid {
    project         : Association to SourcingProject @mandatory;
    supplier        : Association to Supplier @mandatory;
    rationale       : String(1000);
    confidenceScore : Decimal(3, 2);
    aiGenerated     : Boolean default true;
}

entity Risk : cuid {
    project     : Association to SourcingProject @mandatory;
    description : String(1000);
    category    : String(50);
    severity    : String(10) enum {
        Low;
        Medium;
        High;
        Critical;
    };
    mitigation  : String(1000);
    aiGenerated : Boolean default false;
}

entity Attachment : cuid, managed {
    project  : Association to SourcingProject @mandatory;
    fileName : String(255);
    fileType : String(10);
    fileSize : Integer;
    url      : String(1000);
}

entity PurchaseReqLog : cuid, managed {
    project             : Association to SourcingProject @mandatory;
    s4RequisitionNumber : String(10);
    payloadSent         : LargeString;
    responseReceived    : LargeString;
    status              : String(15) default 'PENDING'; // PENDING, SUCCESS, FAILED
    errorMsg            : String(1000);
}

// -----------------------------------------------------------------------------
// Master / reference data, mirrored read-only from SAP S/4HANA Cloud
// -----------------------------------------------------------------------------

entity MaterialGroup {
    key code     : String(18);
        name     : String(120);
        category : String(60);
}

entity CommodityCode {
    key code        : String(10); // UNSPSC
        description : String(200);
}

entity Supplier {
    key ID     : String(10); // S/4HANA business partner number
        name   : String(200);
        rating : Decimal(2, 1);
}

// -----------------------------------------------------------------------------
// Curated RAG knowledge base - deliberately NOT every uploaded SourceDocument,
// only reviewed policies, catalogs, taxonomies, past projects and supplier profiles
// -----------------------------------------------------------------------------

entity KnowledgeDocument : cuid, managed {
    category  : String(30); // Policy, MaterialGroupCatalog, CommodityTaxonomy, PastProject, SupplierProfile, Guideline
    title     : String(200);
    content   : LargeString;
    embedding : Vector(3072);
    sourceRef : String(255);
}

// -----------------------------------------------------------------------------
// Audit trail - append-only
// -----------------------------------------------------------------------------

entity AuditLog : cuid {
    entityName : String(60);
    entityId   : UUID;
    action     : String(30);
    actor      : String(255);
    aiInvolved : Boolean default false;
    before     : LargeString;
    after      : LargeString;
    timestamp  : Timestamp @cds.on.insert: $now;
}
