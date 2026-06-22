import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    normalizeSharderProfile,
} from './sharder-section-registry.js';

export const ARCHITECTURAL_TERMINATOR = '===END===';

const ARCHITECTURAL_PROFILE_LINE = `Profile: ${ARCHITECTURAL_PROFILE_MARKER}`;
const ARCHITECTURAL_SCHEMA_LINE = `Schema: ${ARCHITECTURAL_SCHEMA_MARKER}`;
const PROFILE_LINE_REGEX = /^Profile\s*:/i;
const SCHEMA_LINE_REGEX = /^Schema\s*:/i;

export function countStandaloneArchitecturalTerminators(response) {
    return (String(response || '').replace(/\r\n/g, '\n').match(/^[ \t]*===END===[ \t]*$/gm) || []).length;
}

export function stripStandaloneArchitecturalTerminators(response) {
    return String(response || '')
        .replace(/\r\n/g, '\n')
        .replace(/^[ \t]*===END===[ \t]*$(?:\n)?/gm, '');
}

export function normalizeArchitecturalResponse(response) {
    return stripStandaloneArchitecturalTerminators(response).trim();
}

export function normalizeArchitecturalKeyLines(keyLines = []) {
    return (Array.isArray(keyLines) ? keyLines : [])
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .filter((line) => !PROFILE_LINE_REGEX.test(line) && !SCHEMA_LINE_REGEX.test(line));
}

export function buildArchitecturalKeyLines(keyLines = []) {
    return [
        ARCHITECTURAL_PROFILE_LINE,
        ARCHITECTURAL_SCHEMA_LINE,
        ...normalizeArchitecturalKeyLines(keyLines),
    ];
}

export function validateArchitecturalShellSections(sections) {
    const diagnostics = [];
    const keyLines = Array.isArray(sections?._metadata?.keyLines) ? sections._metadata.keyLines : [];
    const keyPresent = sections?._metadata?.architectural?.keyPresent === true;
    const profileLines = keyLines.filter((line) => PROFILE_LINE_REGEX.test(line));
    const schemaLines = keyLines.filter((line) => SCHEMA_LINE_REGEX.test(line));
    const currentItems = Array.isArray(sections?.current) ? sections.current : [];
    const selectedCurrent = currentItems.filter((item) => item?.selected !== false);
    const terminatorCount = sections?._metadata?.architectural?.terminatorCount ?? 0;
    const unknownHeaders = sections?._metadata?.architectural?.unknownSectionHeaders || [];

    if (!keyPresent) {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_KEY_RECOVERED',
            message: 'Architectural KEY metadata was missing; canonical output will emit a protected KEY block.',
        });
    }
    if (profileLines.length !== 1 || !/^Profile\s*:\s*architectural-memory\s*$/i.test(profileLines[0] || '')) {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_KEY_PROFILE_RECOVERED',
            message: `Architectural KEY profile marker was missing or invalid; canonical output will emit ${ARCHITECTURAL_PROFILE_LINE}.`,
        });
    }
    if (schemaLines.length !== 1 || !/^Schema\s*:\s*architectural-memory\/v1\s*$/i.test(schemaLines[0] || '')) {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_KEY_SCHEMA_RECOVERED',
            message: `Architectural KEY schema marker was missing or invalid; canonical output will emit ${ARCHITECTURAL_SCHEMA_LINE}.`,
        });
    }
    if (!currentItems.length) {
        diagnostics.push({
            level: 'error',
            code: 'ARCH_CURRENT_MISSING',
            message: 'Architectural CURRENT section is missing.',
        });
    } else if (selectedCurrent.length === 0) {
        diagnostics.push({
            level: 'error',
            code: 'ARCH_CURRENT_EMPTY',
            message: 'Architectural CURRENT requires one selected entry.',
        });
    } else if (selectedCurrent.length > 1) {
        diagnostics.push({
            level: 'error',
            code: 'ARCH_CURRENT_MULTIPLE',
            message: 'Architectural CURRENT must contain exactly one selected entry.',
        });
    }
    if (terminatorCount !== 1) {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_TERMINATOR_RECOVERED',
            message: 'Architectural terminator was missing or duplicated; canonical output will emit exactly one ===END===.',
        });
    }
    unknownHeaders.forEach((header) => {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_UNKNOWN_SECTION_IGNORED',
            message: `Ignored unsupported Architectural section header: [${header}]`,
        });
    });

    return diagnostics;
}

export function inspectCanonicalArchitecturalOutput(output, registry) {
    const text = String(output || '').replace(/\r\n/g, '\n');
    const trimmed = text.trimEnd();
    const headerRegex = /^\[([A-Z][A-Z0-9 _-]*)\]\s*$/gm;
    const headers = [];
    let match;

    while ((match = headerRegex.exec(text)) !== null) {
        headers.push(match[1].trim().toUpperCase());
    }

    const approvedHeaders = new Set([
        'KEY',
        ...((registry?.contentSections || []).map((section) => String(section?.name || '').trim().toUpperCase()).filter(Boolean)),
    ]);
    const unsupportedHeaders = headers.filter((header) => !approvedHeaders.has(header));
    const terminatorCount = countStandaloneArchitecturalTerminators(text);
    const lastTerminatorIndex = trimmed.lastIndexOf(ARCHITECTURAL_TERMINATOR);
    const trailingContent = lastTerminatorIndex >= 0
        ? trimmed.slice(lastTerminatorIndex + ARCHITECTURAL_TERMINATOR.length).trim()
        : trimmed;

    return {
        beginsWithKey: /^\[KEY\](?:\n|$)/.test(trimmed),
        headers,
        unsupportedHeaders,
        currentHeaderCount: headers.filter((header) => header === 'CURRENT').length,
        terminatorCount,
        endsWithTerminator: trimmed.endsWith(ARCHITECTURAL_TERMINATOR),
        hasTrailingContent: trailingContent.length > 0,
    };
}

export function isWarmArchiveEligible(profileOrRegistry, ragEnabled = false) {
    const profile = typeof profileOrRegistry === 'object'
        ? profileOrRegistry?.profile
        : profileOrRegistry;

    return ragEnabled === true && normalizeSharderProfile(profile) !== ARCHITECTURAL_PROFILE;
}
