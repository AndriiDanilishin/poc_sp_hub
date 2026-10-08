using {sourcing as db} from '../db/sourcing-schema';

service SourcingProjectService @(path: '/api/sourcing', requires: 'authenticated-user') {

    // Draft-enabled so the Object Page offers Edit / Save / Cancel: unit price and
    // delivery date must be entered by a human before approve can pass the S/4HANA
    // readiness check. Editing is limited to DRAFT projects — UI.UpdateHidden hides the
    // button, and the EDIT handler rejects it server-side (the approval freeze, §25).
    @odata.draft.enabled
    entity SourcingProjects           as
        projection on db.SourcingProject {
            *,
            // The submission log is a system-written audit trail, not user content: as a
            // composition it would be copied into every edit draft and written back on
            // save. An association keeps it out of the draft; it stays readable.
            requisitionLog : Association to many PurchaseReqLogs
                                 on requisitionLog.project = $self,
            // Searched CASE, not `case status when 'DRAFT'`: on a draft-enabled entity CAP
            // re-renders this for the _drafts table, and its HANA renderer turns a simple
            // CASE into `when ? = true` — a HANA syntax error that made the whole list
            // fail with 500 on BTP (SQLite accepts it, so local tests passed).
            case
                when status = 'DRAFT'      then 2 // yellow: work in progress
                when status = 'APPROVED'   then 3 // green: signed off
                when status = 'SUBMITTING' then 2 // yellow: S/4HANA call in flight
                when status = 'SUBMITTED'  then 3 // green: sent to S/4HANA
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
            // Only on the saved project (IsActiveEntity), never inside an open edit.
            @Core.OperationAvailable: {$edmJson: {$And: [
                {$Eq: [{$Path: 'in/status'}, 'DRAFT']},
                {$Path: 'in/IsActiveEntity'}
            ]}}
            action generateDraft() returns SourcingProjects;

            // Procurement Manager signs off; DRAFT -> APPROVED. Human-only, no AI.
            // Role-gated: this is the sign-off that gates S/4HANA submission — only a
            // ProcurementManager may approve (a plain authenticated requester cannot).
            @(requires: 'ProcurementManager')
            @Common.SideEffects: {TargetProperties: ['_it/status']}
            // Only on the saved project (IsActiveEntity), never inside an open edit.
            @Core.OperationAvailable: {$edmJson: {$And: [
                {$Eq: [{$Path: 'in/status'}, 'DRAFT']},
                {$Path: 'in/IsActiveEntity'}
            ]}}
            action approve()       returns SourcingProjects;

            // Create the Purchase Requisition in SAP S/4HANA Cloud (§21, submitToS4.md).
            // Role-gated: only a ProcurementManager may push an approved project to S/4HANA.
            // Also offered while SUBMITTING: the handler refuses a live lock (409) but lets
            // a stale one — a request that died mid-flight — be taken over and reconciled.
            @(requires: 'ProcurementManager')
            @Common.SideEffects: {
                TargetProperties: ['_it/status', '_it/s4RequisitionNumber'],
                TargetEntities  : ['_it/requisitionLog']
            }
            @Core.OperationAvailable: {$edmJson: {$Or: [
                {$Eq: [{$Path: 'in/status'}, 'APPROVED']},
                {$Eq: [{$Path: 'in/status'}, 'SUBMITTING']}
            ]}}
            action submitToS4()    returns {
                s4RequisitionNumber : String;
                status              : String;
            };
        };

    entity Requirements               as projection on db.Requirement;

    entity Risks                      as
        projection on db.Risk {
            *,
            // Searched CASE — Risks is a draft child; see statusCriticality above.
            case
                when severity = 'Critical' then 1 // red
                when severity = 'High'     then 1 // red
                when severity = 'Medium'   then 2 // yellow
                when severity = 'Low'      then 3 // green
                else 0
            end as severityCriticality : Integer
        };

    entity SourcingProjectSuppliers   as projection on db.SourcingProjectSupplier;
    entity SourcingProjectCommodities as projection on db.SourcingProjectCommodity;
    entity Attachments                as projection on db.Attachment;

    // Submission history is a system-written audit trail, never edited by hand.
    @readonly
    entity PurchaseReqLogs            as
        projection on db.PurchaseReqLog {
            *,
            case status
                when 'SUCCESS'   then 3 // green: requisition created
                when 'VALIDATED' then 3 // green: accepted in validation-only mode
                when 'PENDING'   then 2 // yellow: call in flight
                when 'UNKNOWN'   then 2 // yellow: reconciled on the next submit
                when 'FAILED'    then 1 // red
                else 0
            end as statusCriticality : Integer
        };

    // Master data mirrored from S/4HANA, exposed read-only for value help.
    @readonly
    entity MaterialGroups             as projection on db.MaterialGroup;

    @readonly
    entity CommodityCodes             as projection on db.CommodityCode;

    @readonly
    entity Suppliers                  as projection on db.Supplier;
}
