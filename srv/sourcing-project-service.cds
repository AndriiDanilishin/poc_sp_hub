using {sourcing as db} from '../db/sourcing-schema';

service SourcingProjectService @(path: '/api/sourcing', requires: 'authenticated-user') {

    entity SourcingProjects           as
        projection on db.SourcingProject {
            *,
            case status
                when 'DRAFT'     then 2 // yellow: work in progress
                when 'APPROVED'  then 3 // green: signed off
                when 'SUBMITTED' then 3 // green: sent to S/4HANA
                else 0
            end as statusCriticality : Integer
        }
        actions {
            // AI drafts title, description, timeline, priority, risks and suggested
            // suppliers (§20). Bound: operates on this project instance; only while DRAFT.
            // SideEffects refresh the changed header fields AND the composition tables the
            // draft rewrites (risks + suggested suppliers) so they repopulate in place.
            @Common.SideEffects: {
                TargetProperties  : ['_it/status', '_it/title', '_it/priority'],
                TargetEntities    : ['_it/risks', '_it/suggestedSuppliers']
            }
            @Core.OperationAvailable: {$edmJson: {$Eq: [{$Path: 'in/status'}, 'DRAFT']}}
            action generateDraft() returns SourcingProjects;

            // Procurement Manager signs off; DRAFT -> APPROVED. Human-only, no AI.
            // Role-gated: this is the sign-off that gates S/4HANA submission — only a
            // ProcurementManager may approve (a plain authenticated requester cannot).
            @(requires: 'ProcurementManager')
            @Common.SideEffects: {TargetProperties: ['_it/status']}
            @Core.OperationAvailable: {$edmJson: {$Eq: [{$Path: 'in/status'}, 'DRAFT']}}
            action approve()       returns SourcingProjects;

            // Create the Purchase Requisition in SAP S/4HANA Cloud (Phase 5).
            // Role-gated: only a ProcurementManager may push an approved project to S/4HANA.
            @(requires: 'ProcurementManager')
            @Common.SideEffects: {TargetProperties: ['_it/status']}
            @Core.OperationAvailable: {$edmJson: {$Eq: [{$Path: 'in/status'}, 'APPROVED']}}
            action submitToS4()    returns {
                s4RequisitionNumber : String;
                status              : String;
            };
        };

    entity Requirements               as projection on db.Requirement;

    entity Risks                      as
        projection on db.Risk {
            *,
            case severity
                when 'Critical' then 1 // red
                when 'High'     then 1 // red
                when 'Medium'   then 2 // yellow
                when 'Low'      then 3 // green
                else 0
            end as severityCriticality : Integer
        };

    entity SourcingProjectSuppliers   as projection on db.SourcingProjectSupplier;
    entity SourcingProjectCommodities as projection on db.SourcingProjectCommodity;
    entity Attachments                as projection on db.Attachment;

    // Submission history is a system-written audit trail, never edited by hand.
    @readonly
    entity PurchaseReqLogs            as projection on db.PurchaseReqLog;

    // Master data mirrored from S/4HANA, exposed read-only for value help.
    @readonly
    entity MaterialGroups             as projection on db.MaterialGroup;

    @readonly
    entity CommodityCodes             as projection on db.CommodityCode;

    @readonly
    entity Suppliers                  as projection on db.Supplier;
}
