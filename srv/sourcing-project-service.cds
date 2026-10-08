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
            // Filled in JS after READ (sourcing-project-service.js), not by a SQL CASE: on
            // a draft-enabled entity CAP re-renders a CASE for the _drafts table with its
            // literals bound as parameters, which failed on HANA twice (500 on BTP) —
            // first `when ? = true` (syntax error), then numeric branch values bound as
            // strings ("Argument must be a string"). SQLite accepted both.
            virtual statusCriticality   : Integer
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
            // Risks is a draft child: filled in JS after READ, see statusCriticality.
            virtual severityCriticality : Integer
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
