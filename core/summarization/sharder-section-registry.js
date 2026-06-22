/**
 * Pure sharder section registry definitions and accessors.
 *
 * This module intentionally has no SillyTavern, UI, API, persistence, or RAG
 * imports so registry behavior can be tested independently.
 */

export const NARRATIVE_PROFILE = 'narrative';
export const NARRATIVE_DISPLAY_NAME = 'Narrative Memory';
export const ARCHITECTURAL_PROFILE = 'architectural';
export const ARCHITECTURAL_DISPLAY_NAME = 'Architectural Memory';
export const ARCHITECTURAL_SCHEMA_VERSION = 1;
export const ARCHITECTURAL_PROFILE_MARKER = 'architectural-memory';
export const ARCHITECTURAL_SCHEMA_MARKER = 'architectural-memory/v1';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }

    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
    return value;
}

function cloneSection(section) {
    const copy = { ...section };
    if (Array.isArray(section.altNames)) {
        copy.altNames = [...section.altNames];
    }
    return copy;
}

function cloneSections(sections) {
    return sections.map(cloneSection);
}

function cloneRegistry(registry) {
    return {
        profile: registry.profile,
        displayName: registry.displayName,
        schemaVersion: registry.schemaVersion,
        profileMarker: registry.profileMarker,
        schemaMarker: registry.schemaMarker,
        renderFormat: registry.renderFormat,
        terminator: registry.terminator,
        metadataSections: cloneSections(registry.metadataSections),
        contentSections: cloneSections(registry.contentSections),
        freeformSectionKeys: [...registry.freeformSectionKeys],
    };
}

function assertContentSections(contentSections) {
    if (!Array.isArray(contentSections) || contentSections.length === 0) {
        throw new TypeError('Sharder section registry requires a non-empty contentSections array.');
    }

    contentSections.forEach((section, index) => {
        if (!section || typeof section !== 'object') {
            throw new TypeError(`Sharder content section at index ${index} must be an object.`);
        }
        if (typeof section.key !== 'string' || !section.key.trim()) {
            throw new TypeError(`Sharder content section at index ${index} requires a non-empty key.`);
        }
        if (typeof section.name !== 'string' || !section.name.trim()) {
            throw new TypeError(`Sharder content section "${section.key}" requires a non-empty name.`);
        }
        if (typeof section.emoji !== 'string' || !section.emoji.trim()) {
            throw new TypeError(`Sharder content section "${section.key}" requires a non-empty emoji.`);
        }
        if (section.altNames !== undefined && !Array.isArray(section.altNames)) {
            throw new TypeError(`Sharder content section "${section.key}" altNames must be an array when provided.`);
        }
    });
}

function normalizeRegistryObject(registry) {
    assertContentSections(registry?.contentSections);

    const metadataSections = registry.metadataSections === undefined ? [] : registry.metadataSections;
    const freeformSectionKeys = registry.freeformSectionKeys === undefined ? [] : registry.freeformSectionKeys;

    if (!Array.isArray(metadataSections)) {
        throw new TypeError('Sharder section registry metadataSections must be an array when provided.');
    }
    if (!Array.isArray(freeformSectionKeys)) {
        throw new TypeError('Sharder section registry freeformSectionKeys must be an array when provided.');
    }

    return {
        profile: typeof registry.profile === 'string' && registry.profile.trim()
            ? registry.profile
            : NARRATIVE_PROFILE,
        displayName: typeof registry.displayName === 'string' && registry.displayName.trim()
            ? registry.displayName
            : registry.profile || NARRATIVE_DISPLAY_NAME,
        metadataSections: cloneSections(metadataSections),
        contentSections: cloneSections(registry.contentSections),
        freeformSectionKeys: [...freeformSectionKeys],
    };
}

const NARRATIVE_CONTENT_SECTIONS = deepFreeze([
    { emoji: '🎨', name: 'TONE', key: 'tone' },
    { emoji: '👤', name: 'CHARACTERS', key: 'characterNotes', altNames: ['CHARACTER NOTES'] },
    { emoji: '🌍', name: 'WORLD', key: 'worldState', altNames: ['WORLD STATE'] },
    { emoji: '📍', name: 'TIMELINE', key: 'sceneBreaks', altNames: ['SCENE BREAKS'] },
    { emoji: '⚖️', name: 'EVENTS', key: 'events' },
    { emoji: '🔞', name: 'NSFW', key: 'nsfwContent', altNames: ['NSFW CONTENT'] },
    { emoji: '💬', name: 'DIALOGUE', key: 'keyDialogue', altNames: ['KEY DIALOGUE'] },
    { emoji: '🗣️', name: 'VOICE', key: 'voice' },
    { emoji: '🎭', name: 'STATES', key: 'characterStates', altNames: ['CHARACTER STATES'] },
    { emoji: '🔗', name: 'RELATIONSHIPS', key: 'relationshipShifts', altNames: ['RELATIONSHIP SHIFTS'] },
    { emoji: '🌱', name: 'DEVELOPMENTS', key: 'developments' },
    { emoji: '🎣', name: 'CALLBACKS', key: 'callbacks' },
    { emoji: '🧵', name: 'THREADS', key: 'looseThreads', altNames: ['LOOSE THREADS'] },
    { emoji: '🎬', name: 'SCENES', key: 'scenes' },
    { emoji: '⚓', name: 'ANCHORS', key: 'anchors' },
    { emoji: '📍', name: 'CURRENT', key: 'currentState', altNames: ['CURRENT STATE'], isLast: true },
]);

const NARRATIVE_METADATA_SECTIONS = deepFreeze([
    {
        emoji: '🔑',
        name: 'KEY',
        key: 'key',
        selectable: false,
        prunable: false,
        mandatory: true,
    },
]);

const NARRATIVE_FREEFORM_SECTION_KEYS = deepFreeze(['tone', 'currentState', 'worldState', 'scenes', 'voice']);

const ARCHITECTURAL_CONTENT_SECTIONS = deepFreeze([
    { emoji: '', name: 'TIMELINE', key: 'timeline' },
    { emoji: '', name: 'DECISIONS', key: 'decisions' },
    { emoji: '', name: 'EVENTS', key: 'events' },
    { emoji: '', name: 'DEVELOPMENTS', key: 'developments' },
    { emoji: '', name: 'DIALOGUE', key: 'dialogue' },
    { emoji: '', name: 'THREADS', key: 'threads' },
    { emoji: '', name: 'CURRENT', key: 'current', isLast: true },
]);

const ARCHITECTURAL_METADATA_SECTIONS = deepFreeze([
    {
        emoji: '',
        name: 'KEY',
        key: 'key',
        selectable: false,
        prunable: false,
        mandatory: true,
    },
]);

const ARCHITECTURAL_FREEFORM_SECTION_KEYS = deepFreeze([]);

export const NARRATIVE_SHARDER_REGISTRY = deepFreeze({
    profile: NARRATIVE_PROFILE,
    displayName: NARRATIVE_DISPLAY_NAME,
    metadataSections: NARRATIVE_METADATA_SECTIONS,
    contentSections: NARRATIVE_CONTENT_SECTIONS,
    freeformSectionKeys: NARRATIVE_FREEFORM_SECTION_KEYS,
});

export const ARCHITECTURAL_SHARDER_REGISTRY = deepFreeze({
    profile: ARCHITECTURAL_PROFILE,
    displayName: ARCHITECTURAL_DISPLAY_NAME,
    schemaVersion: ARCHITECTURAL_SCHEMA_VERSION,
    profileMarker: ARCHITECTURAL_PROFILE_MARKER,
    schemaMarker: ARCHITECTURAL_SCHEMA_MARKER,
    metadataSections: ARCHITECTURAL_METADATA_SECTIONS,
    contentSections: ARCHITECTURAL_CONTENT_SECTIONS,
    freeformSectionKeys: ARCHITECTURAL_FREEFORM_SECTION_KEYS,
    renderFormat: 'bracket',
    terminator: '===END===',
});

/**
 * Backward-compatible narrative exports. These are immutable canonical values.
 */
export const SHARDER_SECTIONS = NARRATIVE_SHARDER_REGISTRY.contentSections;
export const SHARDER_METADATA_SECTIONS = NARRATIVE_SHARDER_REGISTRY.metadataSections;
export const FREEFORM_SECTIONS = NARRATIVE_SHARDER_REGISTRY.freeformSectionKeys;

/**
 * Resolve a sharder registry. Only narrative profiles are selectable in PR 1A.
 * Unknown and missing profile IDs intentionally resolve to narrative.
 *
 * Custom registry objects are normalized and returned as defensive copies.
 *
 * @param {string|Object|null} profileOrRegistry
 * @returns {Object}
 */
export function getSharderSectionRegistry(profileOrRegistry = NARRATIVE_PROFILE) {
    if (profileOrRegistry && typeof profileOrRegistry === 'object') {
        return normalizeRegistryObject(profileOrRegistry);
    }

    if (profileOrRegistry === ARCHITECTURAL_PROFILE) {
        return cloneRegistry(ARCHITECTURAL_SHARDER_REGISTRY);
    }

    return cloneRegistry(NARRATIVE_SHARDER_REGISTRY);
}

export function normalizeSharderProfile(profile) {
    return profile === ARCHITECTURAL_PROFILE ? ARCHITECTURAL_PROFILE : NARRATIVE_PROFILE;
}

export function getSharderContentSections(registryOrProfile = NARRATIVE_PROFILE) {
    return getSharderSectionRegistry(registryOrProfile).contentSections;
}

export function getSharderMetadataSections(registryOrProfile = NARRATIVE_PROFILE) {
    return getSharderSectionRegistry(registryOrProfile).metadataSections;
}

export function getSharderFreeformSectionKeys(registryOrProfile = NARRATIVE_PROFILE) {
    return getSharderSectionRegistry(registryOrProfile).freeformSectionKeys;
}

