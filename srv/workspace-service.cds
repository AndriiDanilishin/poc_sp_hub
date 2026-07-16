using {sourcing as db} from '../db/sourcing-schema';

service WorkspaceService @(path: '/api/workspace') {

    entity RequirementWorkspaces as projection on db.RequirementWorkspace;
    entity WorkspaceRequirements as projection on db.WorkspaceRequirement;

    @readonly
    entity RequirementSources    as projection on db.RequirementSource;

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
