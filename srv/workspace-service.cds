using {sourcing as db} from '../db/sourcing-schema';

service WorkspaceService @(path: '/api/workspace', requires: 'authenticated-user') {

    // Reads are open to any authenticated user; writes (create/update/delete of a
    // requirement, e.g. the Accept/Edit inline PATCH) require the ProcurementRequester
    // role so a merely-logged-in user cannot mutate curation data.
    //
    // Ownership (Phase 1.2): RequirementWorkspace is `managed`, so every row already
    // records createdBy=$user / modifiedBy on insert/update (exposed here via `*`).
    // That is the ownership foundation. Strict per-user isolation is deliberately NOT
    // enabled yet (single-subaccount PoC, shared demo data) — when it is, add a
    // read filter here, e.g.:
    //   @(restrict: [{ grant: 'READ', where: 'createdBy = $user.id' }])
    // and the same on WorkspaceRequirements via its workspace. Left off now so the
    // shared demo flows keep working (Phase 1.2 = ownership recorded, not enforced).
    entity RequirementWorkspaces as projection on db.RequirementWorkspace;

    @(restrict: [
        {grant: 'READ'},
        {grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'ProcurementRequester'}
    ])
    entity WorkspaceRequirements as projection on db.WorkspaceRequirement;

    @readonly
    entity RequirementSources    as projection on db.RequirementSource;

    // Master data mirrored from S/4HANA, exposed read-only so the Edit dialog's
    // value help can offer valid Material Group / Commodity codes for manual
    // override. Read-only + searchable/paged on the client — scales past the
    // seed's 3 rows to production-scale UNSPSC catalogs.
    @readonly
    entity MaterialGroups        as projection on db.MaterialGroup;

    @readonly
    entity CommodityCodes        as projection on db.CommodityCode;

    // All curation actions mutate workspace data, so they require the
    // ProcurementRequester role (a plain authenticated-user can read but not curate).

    // Propose duplicate requirement groups across a workspace (§3 step 4). Read-only:
    // it explains which items look like duplicates and why, but never merges — merging
    // stays a human act via merge() (§25). Any authenticated user may run the analysis.
    action   detectDuplicates(workspaceId: UUID)        returns {
        pairs       : many {
            aId    : UUID;
            bId    : UUID;
            score  : Decimal;
            reasons: many String;
        };
        groupCount  : Integer;
    };

    // Combine the selected requirements into one, unioning their source links.
    @(requires: 'ProcurementRequester')
    action   merge(ids: many UUID)                      returns WorkspaceRequirements;

    // Duplicate a requirement so quantity/description can be divided across two.
    @(requires: 'ProcurementRequester')
    action   split(id: UUID)                            returns WorkspaceRequirements;

    // Clear the AI-proposed enrichment on a requirement, leaving it for manual entry.
    @(requires: 'ProcurementRequester')
    action   reject(id: UUID)                           returns WorkspaceRequirements;

    // Re-invoke AI enrichment for a single requirement, RAG-grounded (§15).
    @(requires: 'ProcurementRequester')
    action   regenerate(id: UUID)                       returns WorkspaceRequirements;

    // Promote accepted requirements of a workspace into a draft Sourcing Project.
    @(requires: 'ProcurementRequester')
    action   promoteToSourcingProject(workspaceId: UUID) returns {
        sourcingProjectId  : UUID;
        requirementsCopied : Integer;
    };
}
