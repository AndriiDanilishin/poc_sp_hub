using {sourcing as db} from '../db/sourcing-schema';

service WorkspaceService @(path: '/api/workspace') {

    entity RequirementWorkspaces as projection on db.RequirementWorkspace;
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

    // Combine the selected requirements into one, unioning their source links.
    action   merge(ids: many UUID)                      returns WorkspaceRequirements;

    // Duplicate a requirement so quantity/description can be divided across two.
    action   split(id: UUID)                            returns WorkspaceRequirements;

    // Clear the AI-proposed enrichment on a requirement, leaving it for manual entry.
    action   reject(id: UUID)                           returns WorkspaceRequirements;

    // Re-invoke AI enrichment for a single requirement, RAG-grounded (§15).
    action   regenerate(id: UUID)                       returns WorkspaceRequirements;

    // Promote accepted requirements of a workspace into a draft Sourcing Project.
    action   promoteToSourcingProject(workspaceId: UUID) returns {
        sourcingProjectId  : UUID;
        requirementsCopied : Integer;
    };
}
