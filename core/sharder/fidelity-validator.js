/**
 * Deterministic fidelity validator for sharder output.
 */

import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    getSharderContentSections,
    getSharderSectionRegistry,
    parseSceneCodes,
} from '../summarization/sharder-pipeline.js';

/**
 * @typedef {{ level: 'error'|'warning'|'info', code: string, message: string }} Diagnostic
 */

/**
 * Build inherited prefix set from existing shards and any pre-built set.
 * @param {Object} context
 * @returns {Set<number>}
 */
function resolveInheritedPrefixes(context) {
    const inherited = context.inheritedPrefixes instanceof Set
        ? new Set(context.inheritedPrefixes)
        : new Set();

    const shards = Array.isArray(context.existingShards) ? context.existingShards : [];
    for (const shard of shards) {
        if (Number.isFinite(shard?.messageRangeStart)) {
            inherited.add(shard.messageRangeStart);
        }
        const content = String(shard?.content || '');
        for (const sc of parseSceneCodes(content)) {
            inherited.add(sc.startMsg);
        }
    }

    return inherited;
}

/**
 * Validate section structure and hard formatting constraints.
 * @param {Object} sections
 * @param {{startIndex?: number, endIndex?: number, existingShards?: Array, inheritedPrefixes?: Set<number>}} context
 * @returns {{ diagnostics: Diagnostic[], stats: Object }}
 */
export function validateSinglePassOutput(sections, context = {}) {
    const diagnostics = [];
    const registry = getSharderSectionRegistry(context.sectionRegistry || context.profile);
    const requiredSectionKeys = getSharderContentSections(registry).map((s) => s.key);

    if (!sections || typeof sections !== 'object') {
        diagnostics.push({
            level: 'error',
            code: 'INVALID_SECTIONS',
            message: 'sharder output could not be parsed into section data.'
        });
        return {
            diagnostics,
            stats: { sectionsPresent: 0, selectedItems: 0, sceneCodes: 0 }
        };
    }

    const inherited = resolveInheritedPrefixes(context);
    const rangeStart = context.startIndex;
    const rangeEnd = context.endIndex !== undefined ? context.endIndex : rangeStart;

    let sectionsPresent = 0;
    let selectedItems = 0;
    let sceneCodes = 0;

    requiredSectionKeys.forEach((key) => {
        const items = sections[key];
        if (!Array.isArray(items)) {
            diagnostics.push({
                level: 'error',
                code: 'MISSING_SECTION',
                message: `Missing section array: ${key}`
            });
            return;
        }

        if (items.length > 0) sectionsPresent++;

        items.forEach((item, idx) => {
            if (item?.selected !== false) selectedItems++;
            const content = String(item?.content || '').trim();
            if (!content) {
                diagnostics.push({
                    level: 'warning',
                    code: 'EMPTY_ITEM',
                    message: `${key}[${idx}] is empty.`
                });
            }

            const codes = parseSceneCodes(content);
            sceneCodes += codes.length;

            if (rangeStart !== undefined) {
                for (const sc of codes) {
                    const inRange = sc.startMsg >= rangeStart && sc.startMsg <= rangeEnd;
                    const isInherited = inherited.has(sc.startMsg);

                    if (!inRange && !isInherited) {
                        diagnostics.push({
                            level: 'error',
                            code: 'SCENE_PREFIX_MISMATCH',
                            message: `${sc.code} prefix S${sc.startMsg} is outside processed range ${rangeStart}-${rangeEnd} and not inherited from existing shards`
                        });
                    }
                }
            }
        });
    });

    if (registry.profile === ARCHITECTURAL_PROFILE) {
        validateArchitecturalShell(sections, diagnostics);
    }

    if (sectionsPresent < 3) {
        diagnostics.push({
            level: 'warning',
            code: 'LOW_SECTION_DENSITY',
            message: `Only ${sectionsPresent} section(s) populated; output may be under-extracted.`
        });
    }

    if (selectedItems < 5) {
        diagnostics.push({
            level: 'warning',
            code: 'LOW_ITEM_COUNT',
            message: `Only ${selectedItems} selected item(s); continuity fidelity may be weak.`
        });
    }

    if (sceneCodes === 0) {
        diagnostics.push({
            level: 'warning',
            code: 'NO_SCENE_CODES',
            message: 'No scene codes detected in output.'
        });
    }

    return {
        diagnostics,
        stats: {
            sectionsPresent,
            selectedItems,
            sceneCodes
        }
    };
}

function validateArchitecturalShell(sections, diagnostics) {
    const keyLines = Array.isArray(sections?._metadata?.keyLines) ? sections._metadata.keyLines : [];
    const keyPresent = sections?._metadata?.architectural?.keyPresent === true;
    const profileLines = keyLines.filter((line) => /^Profile\s*:/i.test(line));
    const schemaLines = keyLines.filter((line) => /^Schema\s*:/i.test(line));
    const currentItems = Array.isArray(sections?.current) ? sections.current : [];
    const selectedCurrent = currentItems.filter((item) => item?.selected !== false);
    const terminatorCount = sections?._metadata?.architectural?.terminatorCount ?? 0;
    const unknownHeaders = sections?._metadata?.architectural?.unknownSectionHeaders || [];

    if (!keyPresent) {
        diagnostics.push({ level: 'warning', code: 'ARCH_KEY_RECOVERED', message: 'Architectural KEY metadata was missing; canonical output will emit a protected KEY block.' });
    }
    if (profileLines.length !== 1 || !/^Profile\s*:\s*architectural-memory\s*$/i.test(profileLines[0] || '')) {
        diagnostics.push({ level: 'warning', code: 'ARCH_KEY_PROFILE_RECOVERED', message: `Architectural KEY profile marker was missing or invalid; canonical output will emit Profile: ${ARCHITECTURAL_PROFILE_MARKER}.` });
    }
    if (schemaLines.length !== 1 || !/^Schema\s*:\s*architectural-memory\/v1\s*$/i.test(schemaLines[0] || '')) {
        diagnostics.push({ level: 'warning', code: 'ARCH_KEY_SCHEMA_RECOVERED', message: `Architectural KEY schema marker was missing or invalid; canonical output will emit Schema: ${ARCHITECTURAL_SCHEMA_MARKER}.` });
    }
    if (!currentItems.length) {
        diagnostics.push({ level: 'error', code: 'ARCH_CURRENT_MISSING', message: 'Architectural CURRENT section is missing.' });
    } else if (selectedCurrent.length === 0) {
        diagnostics.push({ level: 'error', code: 'ARCH_CURRENT_EMPTY', message: 'Architectural CURRENT requires one selected entry.' });
    } else if (selectedCurrent.length > 1) {
        diagnostics.push({ level: 'error', code: 'ARCH_CURRENT_MULTIPLE', message: 'Architectural CURRENT must contain exactly one selected entry.' });
    }
    if (terminatorCount !== 1) {
        diagnostics.push({ level: 'warning', code: 'ARCH_TERMINATOR_RECOVERED', message: 'Architectural terminator was missing or duplicated; canonical output will emit exactly one ===END===.' });
    }
    unknownHeaders.forEach((header) => {
        diagnostics.push({ level: 'warning', code: 'ARCH_UNKNOWN_SECTION_IGNORED', message: `Ignored unsupported Architectural section header: [${header}]` });
    });
}

/**
 * @param {Diagnostic[]} diagnostics
 * @returns {'error'|'warning'|'info'|'none'}
 */
export function getSinglePassSeverity(diagnostics) {
    if (!diagnostics || diagnostics.length === 0) return 'none';
    if (diagnostics.some((d) => d.level === 'error')) return 'error';
    if (diagnostics.some((d) => d.level === 'warning')) return 'warning';
    return 'info';
}

