import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
    normalizeSharderProfile,
} from '../summarization/sharder-section-registry.js';
import { buildArchitecturalShardMetadata } from '../summarization/saved-shard-identity.js';

export function annotateShardIdentityMetadata(chunks, settings, shardText) {
    const list = Array.isArray(chunks) ? chunks : [];
    if (list.length === 0) {
        return list;
    }

    const activeProfile = normalizeSharderProfile(settings?.sharderProfile || NARRATIVE_PROFILE);
    if (activeProfile !== ARCHITECTURAL_PROFILE) {
        return list;
    }

    const architecturalMetadata = buildArchitecturalShardMetadata(shardText);
    if (!architecturalMetadata.shardProfile) {
        return list;
    }

    for (const chunk of list) {
        if (!chunk?.metadata) continue;
        chunk.metadata.shardProfile = architecturalMetadata.shardProfile;
        chunk.metadata.schemaVersion = architecturalMetadata.schemaVersion;
        if (Array.isArray(architecturalMetadata.sectionKeys) && architecturalMetadata.sectionKeys.length > 0) {
            chunk.metadata.sectionKeys = [...architecturalMetadata.sectionKeys];
        }
        if (Array.isArray(architecturalMetadata.stableDecisionIds) && architecturalMetadata.stableDecisionIds.length > 0) {
            chunk.metadata.stableDecisionIds = [...architecturalMetadata.stableDecisionIds];
        }
    }

    return list;
}
