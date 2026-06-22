import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    ARCHITECTURAL_SCHEMA_VERSION,
    NARRATIVE_PROFILE,
    getSharderContentSections,
    getSharderSectionRegistry,
    normalizeSharderProfile,
} from './sharder-section-registry.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import { parseArchitecturalDecisionRecord } from './architectural-record-parser.js';

export const SAVED_SHARD_CLASSIFICATIONS = Object.freeze({
    ARCHITECTURAL: 'architectural',
    NARRATIVE: 'narrative',
    LEGACY: 'legacy',
    UNKNOWN: 'unknown',
});

export const SAVED_SHARD_FORMATS = Object.freeze({
    ARCHITECTURAL_BRACKET: 'architectural-bracket',
    NARRATIVE_EMOJI: 'narrative-emoji',
    LEGACY_BRACKET: 'legacy-bracket',
    UNKNOWN: 'unknown',
});

const MEMORY_SHARD_WRAPPER_REGEX = /^\[MEMORY SHARD:\s*Messages\s*(\d+)\s*[-–]\s*(\d+)\]\s*\n\n([\s\S]*)$/i;
const PROFILE_LINE_REGEX = /^Profile\s*:\s*(.+?)\s*$/i;
const SCHEMA_LINE_REGEX = /^Schema\s*:\s*(.+?)\s*$/i;
const BRACKET_HEADER_REGEX = /^\[([A-Z][A-Z0-9 _-]*)\]\s*$/;
const NARRATIVE_HEADER_PREFIX_REGEX = /^###\s+/;
const BRACKET_SECTION_NAMES = new Set([
    'KEY',
    ...getSharderContentSections(ARCHITECTURAL_PROFILE)
        .map((section) => String(section?.name || '').trim().toUpperCase())
        .filter(Boolean),
]);
const LEGACY_NARRATIVE_BRACKET_NAMES = new Set([
    'KEY',
    'SHARD KEY',
    'TONE',
    'CHARACTERS',
    'CHARACTER REGISTRY',
    'CHR',
    'WORLD',
    'WORLD STATE',
    'WLD',
    'TIMELINE',
    'EVENTS',
    'STATES',
    'RELATIONSHIPS',
    'REL',
    'DEVELOPMENTS',
    'DEV',
    'NSFW REGISTRY',
    'NSFW',
    'DIALOGUE KEYS',
    'DIALOGUE',
    'DIA',
    'CALLBACKS',
    'CBK',
    'LOOSE THREADS',
    'THREADS',
    'THR',
    'SCENES EXPANDED',
    'SCENES',
    'SCN',
    'CURRENT STATE',
    'CURRENT',
    'CUR',
    'SOURCE MAP',
    'SCENE CODE MAP',
]);

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function parseSavedMemoryShardWrapper(text) {
    const raw = normalizeText(text);
    const match = raw.match(MEMORY_SHARD_WRAPPER_REGEX);
    if (!match) {
        return null;
    }

    return {
        startIndex: parseInt(match[1], 10),
        endIndex: parseInt(match[2], 10),
        body: normalizeText(match[3]),
    };
}

export function parseManagedMemoryShardComment(comment) {
    const match = String(comment || '').match(/memory\s+shard\s*(\d+)\s*[-–]\s*(\d+)/i);
    if (!match) {
        return null;
    }

    return {
        startIndex: parseInt(match[1], 10),
        endIndex: parseInt(match[2], 10),
    };
}

function extractKeyBlockLines(body) {
    const lines = normalizeText(body).split('\n');
    let inKeyBlock = false;
    const keyLines = [];

    for (const rawLine of lines) {
        const line = String(rawLine || '');
        const trimmed = line.trim();

        if (!inKeyBlock) {
            if (/^\[KEY\]\s*$/i.test(trimmed) || /^###\s*[^A-Za-z0-9]*\s*KEY\b/i.test(trimmed)) {
                inKeyBlock = true;
            }
            continue;
        }

        if (BRACKET_HEADER_REGEX.test(trimmed) || (NARRATIVE_HEADER_PREFIX_REGEX.test(trimmed) && !/^###\s*[^A-Za-z0-9]*\s*KEY\b/i.test(trimmed))) {
            break;
        }

        if (trimmed) {
            keyLines.push(trimmed);
        }
    }

    return keyLines;
}

function extractBracketHeaders(body) {
    const headers = [];
    for (const rawLine of normalizeText(body).split('\n')) {
        const match = String(rawLine || '').trim().match(BRACKET_HEADER_REGEX);
        if (!match) continue;
        headers.push(match[1].trim().toUpperCase());
    }
    return headers;
}

function countNarrativeHeaders(body) {
    const sections = getSharderContentSections(NARRATIVE_PROFILE);
    let count = 0;

    for (const section of sections) {
        const canonical = new RegExp(`^###\\s*${escapeRegex(section.emoji)}\\s*${escapeRegex(section.name)}\\s*$`, 'im');
        if (canonical.test(body)) {
            count += 1;
            continue;
        }

        const altNames = Array.isArray(section.altNames) ? section.altNames : [];
        if (altNames.some((altName) => new RegExp(`^###\\s*${escapeRegex(section.emoji)}\\s*${escapeRegex(altName)}\\s*$`, 'im').test(body))) {
            count += 1;
        }
    }

    return count;
}

function inspectArchitecturalKeyLines(keyLines) {
    const profileLines = [];
    const schemaLines = [];

    for (const line of keyLines) {
        const profileMatch = String(line || '').match(PROFILE_LINE_REGEX);
        if (profileMatch) {
            profileLines.push(profileMatch[1].trim());
        }

        const schemaMatch = String(line || '').match(SCHEMA_LINE_REGEX);
        if (schemaMatch) {
            schemaLines.push(schemaMatch[1].trim());
        }
    }

    const hasExactProfile = profileLines.some((value) => value === ARCHITECTURAL_PROFILE_MARKER);
    const hasExactSchema = schemaLines.some((value) => value === ARCHITECTURAL_SCHEMA_MARKER);
    const hasAnyProfileLike = profileLines.length > 0;
    const hasAnySchemaLike = schemaLines.length > 0;

    return {
        keyLines,
        profileLines,
        schemaLines,
        hasExactProfile,
        hasExactSchema,
        hasValidArchitecturalIdentity: hasExactProfile && hasExactSchema,
        hasMalformedArchitecturalIdentity: (hasAnyProfileLike || hasAnySchemaLike) && !(hasExactProfile && hasExactSchema),
    };
}

function detectContentFormat(body, keyInspection, bracketHeaders, narrativeHeaderCount) {
    if (keyInspection.hasValidArchitecturalIdentity) {
        return SAVED_SHARD_FORMATS.ARCHITECTURAL_BRACKET;
    }

    if (narrativeHeaderCount > 0) {
        return SAVED_SHARD_FORMATS.NARRATIVE_EMOJI;
    }

    if (keyInspection.hasMalformedArchitecturalIdentity) {
        return SAVED_SHARD_FORMATS.ARCHITECTURAL_BRACKET;
    }

    if (bracketHeaders.some((header) => LEGACY_NARRATIVE_BRACKET_NAMES.has(header))) {
        return SAVED_SHARD_FORMATS.LEGACY_BRACKET;
    }

    if (bracketHeaders.some((header) => BRACKET_SECTION_NAMES.has(header))) {
        return SAVED_SHARD_FORMATS.ARCHITECTURAL_BRACKET;
    }

    return SAVED_SHARD_FORMATS.UNKNOWN;
}

export function classifySavedShardText(text) {
    const wrapper = parseSavedMemoryShardWrapper(text);
    const body = wrapper ? wrapper.body : normalizeText(text);
    const keyLines = extractKeyBlockLines(body);
    const bracketHeaders = extractBracketHeaders(body);
    const narrativeHeaderCount = countNarrativeHeaders(body);
    const keyInspection = inspectArchitecturalKeyLines(keyLines);
    const contentFormat = detectContentFormat(body, keyInspection, bracketHeaders, narrativeHeaderCount);

    let classification = SAVED_SHARD_CLASSIFICATIONS.UNKNOWN;
    let profile = null;
    let schemaVersion = null;

    if (keyInspection.hasValidArchitecturalIdentity) {
        classification = SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL;
        profile = ARCHITECTURAL_PROFILE;
        schemaVersion = ARCHITECTURAL_SCHEMA_VERSION;
    } else if (keyInspection.hasMalformedArchitecturalIdentity) {
        classification = SAVED_SHARD_CLASSIFICATIONS.UNKNOWN;
    } else if (contentFormat === SAVED_SHARD_FORMATS.NARRATIVE_EMOJI) {
        classification = SAVED_SHARD_CLASSIFICATIONS.NARRATIVE;
        profile = NARRATIVE_PROFILE;
    } else if (wrapper || contentFormat === SAVED_SHARD_FORMATS.LEGACY_BRACKET) {
        classification = SAVED_SHARD_CLASSIFICATIONS.LEGACY;
    }

    return {
        raw: String(text || ''),
        body,
        wrapperType: wrapper ? 'memory-shard' : null,
        startIndex: wrapper?.startIndex ?? null,
        endIndex: wrapper?.endIndex ?? null,
        classification,
        profile,
        schemaVersion,
        contentFormat,
        bracketHeaders,
        narrativeHeaderCount,
        keyMetadata: {
            ...keyInspection,
        },
    };
}

export function isSavedShardCompatibleWithProfile(shardInfo, activeProfile = NARRATIVE_PROFILE) {
    const classification = String(shardInfo?.classification || '');
    const resolvedProfile = normalizeSharderProfile(activeProfile);

    if (resolvedProfile === ARCHITECTURAL_PROFILE) {
        return classification === SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL;
    }

    return classification === SAVED_SHARD_CLASSIFICATIONS.NARRATIVE
        || classification === SAVED_SHARD_CLASSIFICATIONS.LEGACY;
}

export function buildSavedShardCandidate(content, options = {}) {
    const {
        comment = '',
        activeProfile = NARRATIVE_PROFILE,
    } = options;

    const shardInfo = classifySavedShardText(content);
    if (!isSavedShardCompatibleWithProfile(shardInfo, activeProfile)) {
        return null;
    }

    const commentRange = parseManagedMemoryShardComment(comment);
    const startIndex = shardInfo.startIndex ?? commentRange?.startIndex ?? null;
    const endIndex = shardInfo.endIndex ?? commentRange?.endIndex ?? null;

    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
        return null;
    }

    return {
        ...shardInfo,
        startIndex,
        endIndex,
        text: shardInfo.body,
    };
}

export function buildArchitecturalShardMetadata(text) {
    const shardInfo = classifySavedShardText(text);
    if (shardInfo.classification !== SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL) {
        return {};
    }

    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const sections = parseArchitecturalExtractionResponse(shardInfo.body, registry);
    const sectionKeys = registry.contentSections
        .filter((section) => Array.isArray(sections?.[section.key]) && sections[section.key].length > 0)
        .map((section) => section.key);
    const stableDecisionIds = [];

    for (const item of (sections?.decisions || [])) {
        const record = parseArchitecturalDecisionRecord(item?.content || '');
        const id = String(record?.fields?.ID || '').trim();
        if (id && !stableDecisionIds.includes(id)) {
            stableDecisionIds.push(id);
        }
    }

    return {
        shardProfile: 'architectural',
        schemaVersion: ARCHITECTURAL_SCHEMA_VERSION,
        sectionKeys,
        stableDecisionIds,
    };
}
