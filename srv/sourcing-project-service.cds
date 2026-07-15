using {sourcing as db} from '../db/sourcing-schema';

service SourcingProjectService @(path: '/api/sourcing') {

    entity SourcingProjects         as projection on db.SourcingProject;
    entity Requirements             as projection on db.Requirement;
    entity Risks                    as projection on db.Risk;
    entity SourcingProjectSuppliers as projection on db.SourcingProjectSupplier;
    entity SourcingProjectCommodities as projection on db.SourcingProjectCommodity;
    entity Attachments              as projection on db.Attachment;

    // Submission history is a system-written audit trail, never edited by hand.
    @readonly
    entity PurchaseReqLogs          as projection on db.PurchaseReqLog;

    // Master data mirrored from S/4HANA, exposed read-only for value help.
    @readonly
    entity MaterialGroups           as projection on db.MaterialGroup;

    @readonly
    entity CommodityCodes           as projection on db.CommodityCode;

    @readonly
    entity Suppliers                as projection on db.Supplier;

    // AI drafts title, description, timeline, priority and risks (Phase 4).
    action   generateDraft(id: UUID) returns SourcingProjects;

    // Procurement Manager signs off; DRAFT -> APPROVED. Human-only, no AI.
    action   approve(id: UUID)       returns SourcingProjects;

    // Create the Purchase Requisition in SAP S/4HANA Cloud (Phase 5).
    action   submitToS4(id: UUID)    returns {
        s4RequisitionNumber : String;
        status              : String;
    };
}
