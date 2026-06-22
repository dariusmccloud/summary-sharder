/**
 * Shared mode resolution for UI displays.
 */

import {
    ARCHITECTURAL_DISPLAY_NAME,
    ARCHITECTURAL_PROFILE,
    NARRATIVE_DISPLAY_NAME,
    normalizeSharderProfile,
} from '../../core/summarization/sharder-section-registry.js';

export function isSharderMode(settings) {
    return settings?.sharderMode === true;
}

export function getSharderProfileLabel(settings) {
    const profile = normalizeSharderProfile(settings?.sharderProfile);
    return profile === ARCHITECTURAL_PROFILE
        ? ARCHITECTURAL_DISPLAY_NAME
        : NARRATIVE_DISPLAY_NAME;
}

export function getStatusMode(settings) {
    return isSharderMode(settings) ? 'sharder' : 'regular';
}

export function getStatusModeLabel(settings) {
    return isSharderMode(settings) ? 'Sharder' : 'Regular';
}

export function getPipelineLabel(settings) {
    if (!isSharderMode(settings)) {
        return 'Basic Summary';
    }

    return getSharderProfileLabel(settings);
}

export function getActiveApiFeature(settings) {
    if (!isSharderMode(settings)) {
        return 'summary';
    }

    return 'sharder';
}

export function getActivePromptLabel(settings) {
    if (!isSharderMode(settings)) {
        return settings?.activePromptName || 'Default Prompt';
    }

    return getSharderProfileLabel(settings);
}
