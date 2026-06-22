import { ARCHITECTURAL_PROFILE, NARRATIVE_PROFILE } from './sharder-section-registry.js';

export function getActiveSharderProfile(settings) {
    return settings?.sharderProfile === ARCHITECTURAL_PROFILE ? ARCHITECTURAL_PROFILE : NARRATIVE_PROFILE;
}

export function shouldBypassShardSelectionForRag(settings) {
    if (settings?.sharderMode !== true || settings?.rag?.enabled !== true) {
        return false;
    }

    return getActiveSharderProfile(settings) !== ARCHITECTURAL_PROFILE;
}
