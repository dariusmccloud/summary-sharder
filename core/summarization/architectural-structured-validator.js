import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import {
    ARCHITECTURAL_SOURCE_REF_PATTERN,
    ARCHITECTURAL_WEIGHT_BY_EMOJI,
    parseArchitecturalDecisionRecord,
    parseArchitecturalDialogueRecord,
    parseArchitecturalEventRecord,
    parseArchitecturalThreadRecord,
} from './architectural-record-parser.js';
import {
    ARCHITECTURAL_DECISION_NEW_ID_LIMITS,
    ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD,
    buildArchitecturalBaselineLedger,
    mergeArchitecturalDecisionLedger,
    normalizeArchitecturalBaselineLedger,
} from './architectural-decision-ledger.js';

export const ARCHITECTURAL_DECISION_TYPES = Object.freeze([
    'GOVERNANCE',
    'JURISDICTION',
    'HIERARCHY',
    'CORRECTION',
    'REPLACEMENT',
    'RENAME',
    'SCOPE',
    'DIAGNOSTIC',
    'IMPLEMENTATION',
    'STRATEGY',
    'COMMITMENT',
    'PROCEDURE',
]);

export const ARCHITECTURAL_DECISION_STATUSES = Object.freeze([
    'PROPOSED',
    'ACCEPTED',
    'SEALED',
    'SUPERSEDED',
]);

export const ARCHITECTURAL_THREAD_STATUSES = Object.freeze([
    'UNRESOLVED',
    'DEVELOPING',
    'ACTIVE',
    'RESOLVED',
]);

export const ARCHITECTURAL_SECTION_CAPS = Object.freeze({
    timeline: 15,
    decisions: 12,
    events: 12,
    developments: 10,
    dialogue: 8,
    threads: 8,
    current: 1,
});

const DECISION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ALLOWED_TRANSITIONS = new Set([
    'PROPOSED->PROPOSED',
    'PROPOSED->ACCEPTED',
    'PROPOSED->SEALED',
    'PROPOSED->SUPERSEDED',
    'ACCEPTED->ACCEPTED',
    'ACCEPTED->SEALED',
    'ACCEPTED->SUPERSEDED',
    'SEALED->SEALED',
    'SEALED->SUPERSEDED',
    'SUPERSEDED->SUPERSEDED',
]);

const EXPLICIT_DECISION_EVENT_PATTERNS = [
    /\bdecision accepted\b/i,
    /\bdecision adopted\b/i,
    /\bdecision sealed\b/i,
    /\bdecision superseded\b/i,
    /\bclassification corrected\b/i,
    /\breclassified\b/i,
    /\bjurisdiction corrected\b/i,
    /\bhierarchy changed\b/i,
    /\bmechanism replaced\b/i,
    /\bcriteria replaced\b/i,
    /\bauthority hardened\b/i,
    /\bwording hardened\b/i,
    /\bgoverning rule changed\b/i,
];

function buildDiagnostic(level, code, message, extra = {}) {
    return {
        level,
        code,
        message,
        ...extra,
    };
}

function selectedItems(items) {
    return (Array.isArray(items) ? items : []).filter((item) => item?.selected !== false);
}

export function indexedSelectedItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) => item?.selected !== false);
}

function getDecisionField(record, field) {
    const value = record.fields?.[field];
    return Array.isArray(value) ? value[0] : value;
}

function recordHasCanonicalMarkers(lines = []) {
    const normalized = Array.isArray(lines) ? lines.map((line) => String(line || '').trim()) : [];
    return normalized.includes(`Profile: ${ARCHITECTURAL_PROFILE_MARKER}`)
        && normalized.includes(`Schema: ${ARCHITECTURAL_SCHEMA_MARKER}`);
}

function isCanonicalArchitecturalShardContent(content) {
    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const parsed = parseArchitecturalExtractionResponse(String(content || ''), registry);
    return recordHasCanonicalMarkers(parsed?._metadata?.keyLines);
}

function hasDecisionMandatoryFields(record) {
    const mandatory = ['ID', 'TYPE', 'DECISION', 'WHY', 'SCOPE', 'STATUS', 'EVIDENCE'];
    return mandatory.every((field) => {
        const value = getDecisionField(record, field);
        return value !== undefined && String(value).trim();
    });
}

function decisionTypesAreCanonical(record) {
    const typeValue = getDecisionField(record, 'TYPE');
    const types = typeof typeValue === 'string'
        ? typeValue.split(',').map((entry) => entry.trim()).filter(Boolean)
        : [];

    return types.length > 0 && types.every((type) => ARCHITECTURAL_DECISION_TYPES.includes(type));
}

export function buildArchitecturalBaselineFromShards(existingShards = []) {
    const ledger = buildArchitecturalBaselineLedger(existingShards);
    return {
        decisions: ledger.decisionsById,
        orderedIds: ledger.orderedIds,
        diagnostics: ledger.diagnostics,
        ledger,
    };
}

function validateDecisionWeight(record, diagnostics, itemIndex) {
    if (!record.weightRaw) {
        diagnostics.push(buildDiagnostic(
            'warning',
            'ARCH_DECISION_WEIGHT_MISSING',
            'Decision record is missing a canonical weight.',
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null }
        ));
        return;
    }

    if (!ARCHITECTURAL_WEIGHT_BY_EMOJI[record.weightRaw]) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_WEIGHT_INVALID',
            `Decision record uses an unknown weight marker: ${record.weightRaw}.`,
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null }
        ));
    }
}

function validateDecisionRecord(record, itemIndex, diagnostics) {
    validateDecisionWeight(record, diagnostics, itemIndex);

    record.errors.forEach((error) => {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_MALFORMED',
            error.message,
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null }
        ));
    });
    record.warnings.forEach((warning) => {
        diagnostics.push(buildDiagnostic(
            'warning',
            warning.code === 'NONCANONICAL_FIELD_CASE' ? 'ARCH_DECISION_FIELD_CASE_NORMALIZED' : 'ARCH_DECISION_WARNING',
            warning.message,
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null, field: warning.field }
        ));
    });

    if (record.unknownFields.length > 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_UNKNOWN_FIELD',
            `Decision record contains unsupported field(s): ${[...new Set(record.unknownFields)].join(', ')}.`,
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null }
        ));
    }

    if (record.duplicateFields.length > 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_DUPLICATE_FIELD',
            `Decision record repeats field(s): ${[...new Set(record.duplicateFields)].join(', ')}.`,
            { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null }
        ));
    }

    const mandatory = ['ID', 'TYPE', 'DECISION', 'WHY', 'SCOPE', 'STATUS', 'EVIDENCE'];
    mandatory.forEach((field) => {
        const value = getDecisionField(record, field);
        if (value === undefined) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_DECISION_MISSING_FIELD',
                `Decision record is missing required field ${field}.`,
                { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null, field }
            ));
            return;
        }
        if (!String(value).trim()) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_DECISION_EMPTY_FIELD',
                `Decision record field ${field} cannot be empty.`,
                { sectionKey: 'decisions', itemIndex, recordId: record.decisionId || null, field }
            ));
        }
    });

    const decisionId = getDecisionField(record, 'ID');
    if (decisionId && !DECISION_ID_PATTERN.test(decisionId)) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_INVALID_ID',
            `Decision ID must use lowercase kebab-case: ${decisionId}.`,
            { sectionKey: 'decisions', itemIndex, recordId: decisionId, field: 'ID' }
        ));
    }

    const why = getDecisionField(record, 'WHY');
    if (why !== undefined && !String(why).trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_WHY_REQUIRED',
            'Decision WHY must be explicit or exactly WHY:unstated.',
            { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field: 'WHY' }
        ));
    }

    const status = getDecisionField(record, 'STATUS');
    if (status !== undefined && !ARCHITECTURAL_DECISION_STATUSES.includes(status)) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_STATUS_INVALID',
            `Decision STATUS is invalid: ${status}.`,
            { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field: 'STATUS' }
        ));
    }

    const typeValue = getDecisionField(record, 'TYPE');
    const types = typeof typeValue === 'string'
        ? typeValue.split(',').map((entry) => entry.trim()).filter(Boolean)
        : [];

    if (typeValue !== undefined && types.length === 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DECISION_TYPE_EMPTY',
            'Decision TYPE must contain one or more canonical values.',
            { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field: 'TYPE' }
        ));
    }

    const seenTypes = new Set();
    for (const type of types) {
        if (!ARCHITECTURAL_DECISION_TYPES.includes(type)) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_DECISION_TYPE_INVALID',
                `Decision TYPE is invalid: ${type}.`,
                { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field: 'TYPE' }
            ));
            continue;
        }

        if (seenTypes.has(type)) {
            diagnostics.push(buildDiagnostic(
                'warning',
                'ARCH_DECISION_TYPE_DUPLICATE',
                `Decision TYPE repeats canonical value ${type}.`,
                { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field: 'TYPE' }
            ));
        }
        seenTypes.add(type);
    }

    ['SUPERSEDES', 'SUPERSEDED-BY'].forEach((field) => {
        const value = getDecisionField(record, field);
        if (value === undefined || value === null || String(value).trim() === '') return;
        if (!DECISION_ID_PATTERN.test(String(value).trim())) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_SUPERSESSION_INVALID_ID',
                `${field} must reference a valid stable decision ID.`,
                { sectionKey: 'decisions', itemIndex, recordId: decisionId || null, field }
            ));
        }
    });
}

function validateDecisionDuplicates(records, diagnostics) {
    const seen = new Map();

    records.forEach(({ record, itemIndex }) => {
        const id = getDecisionField(record, 'ID');
        if (!id || !DECISION_ID_PATTERN.test(id)) return;

        if (seen.has(id)) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_DECISION_DUPLICATE_ID',
                `Duplicate selected decision ID: ${id}.`,
                { sectionKey: 'decisions', itemIndex, recordId: id }
            ));
            return;
        }

        seen.set(id, itemIndex);
    });
}

function validateDecisionLifecycle(records, baselineDecisions, diagnostics) {
    records.forEach(({ record, itemIndex }) => {
        const id = getDecisionField(record, 'ID');
        const status = getDecisionField(record, 'STATUS');
        if (!id || !status || !DECISION_ID_PATTERN.test(id) || !ARCHITECTURAL_DECISION_STATUSES.includes(status)) {
            return;
        }

        const baseline = baselineDecisions[id];
        if (!baseline?.status) {
            return;
        }

        if (!ALLOWED_TRANSITIONS.has(`${baseline.status}->${status}`)) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_LIFECYCLE_INVALID_TRANSITION',
                `Decision ${id} cannot move from ${baseline.status} to ${status}.`,
                { sectionKey: 'decisions', itemIndex, recordId: id, field: 'STATUS' }
            ));
        }
    });
}

function validateBaselineDecisionPresence(records, baselineLedger, diagnostics) {
    const currentById = new Map();
    records.forEach(({ record, itemIndex }) => {
        const id = getDecisionField(record, 'ID');
        if (id && DECISION_ID_PATTERN.test(id)) {
            currentById.set(id, { record, itemIndex });
        }
    });

    baselineLedger.orderedIds.forEach((id) => {
        if (currentById.has(id)) return;
        const baseline = baselineLedger.decisionsById[id];
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_BASELINE_DECISION_REMOVED',
            `Inherited baseline decision ${id} was removed from the current merged output.`,
            {
                sectionKey: 'decisions',
                recordId: id,
                baselineStatus: baseline?.status || null,
            }
        ));
    });
}

function validateSupersession(records, baselineDecisions, diagnostics) {
    const currentById = new Map();
    records.forEach((entry) => {
        const id = getDecisionField(entry.record, 'ID');
        if (id && DECISION_ID_PATTERN.test(id)) {
            currentById.set(id, entry);
        }
    });

    records.forEach(({ record, itemIndex }) => {
        const id = getDecisionField(record, 'ID');
        const status = getDecisionField(record, 'STATUS');
        if (!id || !DECISION_ID_PATTERN.test(id)) return;

        const supersedes = getDecisionField(record, 'SUPERSEDES');
        const supersededBy = getDecisionField(record, 'SUPERSEDED-BY');

        if (supersedes && supersedes === id) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_SUPERSESSION_SELF_REFERENCE',
                `Decision ${id} cannot supersede itself.`,
                { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDES' }
            ));
        }
        if (supersededBy && supersededBy === id) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_SUPERSESSION_SELF_REFERENCE',
                `Decision ${id} cannot be superseded by itself.`,
                { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDED-BY' }
            ));
        }

        if (status === 'SUPERSEDED' && !String(supersededBy || '').trim()) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_SUPERSESSION_REPLACEMENT_REQUIRED',
                `Decision ${id} is SUPERSEDED and must declare SUPERSEDED-BY.`,
                { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDED-BY' }
            ));
        }

        if (supersededBy && status !== 'SUPERSEDED') {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_SUPERSESSION_STATUS_REQUIRED',
                `Decision ${id} declares SUPERSEDED-BY but STATUS is not SUPERSEDED.`,
                { sectionKey: 'decisions', itemIndex, recordId: id, field: 'STATUS' }
            ));
        }

        if (supersedes) {
            if (currentById.has(supersedes)) {
                const target = currentById.get(supersedes).record;
                const targetStatus = getDecisionField(target, 'STATUS');
                const reciprocal = getDecisionField(target, 'SUPERSEDED-BY');
                if (targetStatus !== 'SUPERSEDED' || reciprocal !== id) {
                    diagnostics.push(buildDiagnostic(
                        'error',
                        'ARCH_SUPERSESSION_RECIPROCAL_MISSING',
                        `Decision ${id} supersedes ${supersedes}, but the current output does not contain matching reciprocal supersession fields.`,
                        { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDES' }
                    ));
                }
            } else if (!baselineDecisions[supersedes]) {
                diagnostics.push(buildDiagnostic(
                    'warning',
                    'ARCH_SUPERSESSION_HISTORICAL_UNRESOLVED',
                    'Historical decision reference could not be resolved from available shards.',
                    { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDES' }
                ));
            }
        }

        if (supersededBy) {
            if (currentById.has(supersededBy)) {
                const target = currentById.get(supersededBy).record;
                const reciprocal = getDecisionField(target, 'SUPERSEDES');
                if (reciprocal !== id) {
                    diagnostics.push(buildDiagnostic(
                        'error',
                        'ARCH_SUPERSESSION_RECIPROCAL_MISSING',
                        `Decision ${id} is superseded by ${supersededBy}, but the replacement record does not contain SUPERSEDES:${id}.`,
                        { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDED-BY' }
                    ));
                }
            } else if (!baselineDecisions[supersededBy]) {
                diagnostics.push(buildDiagnostic(
                    'warning',
                    'ARCH_SUPERSESSION_HISTORICAL_UNRESOLVED',
                    'Historical decision reference could not be resolved from available shards.',
                    { sectionKey: 'decisions', itemIndex, recordId: id, field: 'SUPERSEDED-BY' }
                ));
            }
        }
    });
}

function validateEventRecord(record, itemIndex, currentDecisionIds, diagnostics) {
    if (!record.weightRaw) {
        diagnostics.push(buildDiagnostic(
            'warning',
            'ARCH_EVENT_WEIGHT_MISSING',
            'Event record is missing a canonical weight.',
            { sectionKey: 'events', itemIndex }
        ));
    } else if (!ARCHITECTURAL_WEIGHT_BY_EMOJI[record.weightRaw]) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_EVENT_WEIGHT_INVALID',
            `Event record uses an unknown weight marker: ${record.weightRaw}.`,
            { sectionKey: 'events', itemIndex }
        ));
    }

    record.errors.forEach((error) => {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_EVENT_MALFORMED',
            error.message,
            { sectionKey: 'events', itemIndex }
        ));
    });
    record.warnings.forEach((warning) => {
        if (warning.code === 'DEC_LIST_NORMALIZED') {
            diagnostics.push(buildDiagnostic(
                'warning',
                'ARCH_EVENT_DEC_LIST_NORMALIZED',
                warning.message,
                { sectionKey: 'events', itemIndex, field: warning.field }
            ));
        }
    });

    if (!String(record.description || '').trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_EVENT_EMPTY_DESCRIPTION',
            'Event description cannot be empty.',
            { sectionKey: 'events', itemIndex }
        ));
    }

    if (record.unknownFields.length > 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_EVENT_UNKNOWN_FIELD',
            `Event record contains unsupported field(s): ${[...new Set(record.unknownFields)].join(', ')}.`,
            { sectionKey: 'events', itemIndex }
        ));
    }

    const refs = Array.isArray(record.fields.DEC) ? record.fields.DEC : [];
    refs.forEach((ref) => {
        if (!DECISION_ID_PATTERN.test(ref)) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_EVENT_DEC_ID_INVALID',
                `Event DEC reference is not a valid stable decision ID: ${ref}.`,
                { sectionKey: 'events', itemIndex, field: 'DEC' }
            ));
            return;
        }
        if (!currentDecisionIds.has(ref)) {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_EVENT_DEC_UNRESOLVED',
                `Event DEC reference does not resolve in current selected decisions: ${ref}.`,
                { sectionKey: 'events', itemIndex, field: 'DEC', recordId: ref }
            ));
        }
    });

    if (refs.length === 0 && EXPLICIT_DECISION_EVENT_PATTERNS.some((pattern) => pattern.test(record.description || ''))) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_EVENT_DEC_REQUIRED',
            'Event describes an explicit decision transition and must include DEC:<stable-id>.',
            { sectionKey: 'events', itemIndex, field: 'DEC' }
        ));
    }
}

function validateDialogueRecord(record, itemIndex, diagnostics) {
    record.errors.forEach((error) => {
        diagnostics.push(buildDiagnostic(
            'error',
            `ARCH_DIALOGUE_${error.code}`,
            error.message,
            { sectionKey: 'dialogue', itemIndex }
        ));
    });

    if (record.lineCount > 2) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_DIALOGUE_TOO_MANY_LINES',
            'Dialogue entry cannot exceed two explicit lines.',
            { sectionKey: 'dialogue', itemIndex }
        ));
    }
}

function validateThreadRecord(record, itemIndex, diagnostics) {
    record.errors.forEach((error) => {
        diagnostics.push(buildDiagnostic(
            'error',
            `ARCH_THREAD_${error.code}`,
            error.message,
            { sectionKey: 'threads', itemIndex }
        ));
    });

    if (record.unknownFields.length > 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_UNKNOWN_FIELD',
            `Thread record contains unsupported field(s): ${[...new Set(record.unknownFields)].join(', ')}.`,
            { sectionKey: 'threads', itemIndex }
        ));
    }

    if (!String(record.status || '').trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_STATUS_MISSING',
            'Thread record requires status:<STATUS>.',
            { sectionKey: 'threads', itemIndex, field: 'status' }
        ));
    } else if (!ARCHITECTURAL_THREAD_STATUSES.includes(record.status)) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_STATUS_INVALID',
            `Thread status is invalid: ${record.status}.`,
            { sectionKey: 'threads', itemIndex, field: 'status' }
        ));
    }

    if (!String(record.intro || '').trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_INTRO_MISSING',
            'Thread record requires intro:S#:#.',
            { sectionKey: 'threads', itemIndex, field: 'intro' }
        ));
    } else if (!ARCHITECTURAL_SOURCE_REF_PATTERN.test(record.intro)) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_INTRO_INVALID',
            `Thread intro source reference is invalid: ${record.intro}.`,
            { sectionKey: 'threads', itemIndex, field: 'intro' }
        ));
    }

    if (!String(record.last || '').trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_LAST_MISSING',
            'Thread record requires last:S#:#.',
            { sectionKey: 'threads', itemIndex, field: 'last' }
        ));
    } else if (!ARCHITECTURAL_SOURCE_REF_PATTERN.test(record.last)) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_LAST_INVALID',
            `Thread last source reference is invalid: ${record.last}.`,
            { sectionKey: 'threads', itemIndex, field: 'last' }
        ));
    }

    if (!String(record.notes || '').trim()) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_THREAD_NOTES_MISSING',
            'Thread record requires non-empty notes after the final |.',
            { sectionKey: 'threads', itemIndex }
        ));
    }
}

function validateSectionCaps(sections, diagnostics) {
    Object.entries(ARCHITECTURAL_SECTION_CAPS).forEach(([sectionKey, cap]) => {
        if (sectionKey === 'decisions') {
            return;
        }
        const items = Array.isArray(sections?.[sectionKey]) ? sections[sectionKey] : [];
        const selected = selectedItems(items);

        indexedSelectedItems(items).forEach(({ item, itemIndex }) => {
            if (!String(item?.content || '').trim()) {
                diagnostics.push(buildDiagnostic(
                    'error',
                    'ARCH_CAP_EMPTY_SELECTED_ENTRY',
                    'Selected entries cannot be empty.',
                    { sectionKey, itemIndex }
                ));
            }
        });

        if (selected.length > cap) {
            diagnostics.push(buildDiagnostic(
                'error',
                sectionKey === 'current' ? 'ARCH_CURRENT_CAP_INVALID' : 'ARCH_CAP_EXCEEDED',
                `${sectionKey.toUpperCase()} has ${selected.length} selected entries; cap is ${cap}.`,
                { sectionKey }
            ));
        }
    });

    const currentSelected = selectedItems(sections?.current || []);
    if (currentSelected.length === 0) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_CURRENT_EMPTY',
            'Architectural CURRENT requires one selected entry.',
            { sectionKey: 'current' }
        ));
    } else if (currentSelected.length > 1) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_CURRENT_MULTIPLE',
            'Architectural CURRENT must contain exactly one selected entry.',
            { sectionKey: 'current' }
        ));
    }
}

function validateDecisionCapacity(decisionMetrics, diagnostics, context = {}) {
    if (!decisionMetrics) return;

    const newCount = decisionMetrics.newCount || 0;
    const updatedCount = decisionMetrics.updatedCount || 0;
    const overrideRequested = context.allowDecisionCapacityOverride === true;
    const overrideJustification = String(context.decisionCapacityOverrideJustification || '').trim();
    const excessStatuses = Array.isArray(decisionMetrics.excessNewStatuses) ? decisionMetrics.excessNewStatuses : [];

    if (newCount > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax) {
        const hasNonProposedExcess = excessStatuses.some((status) => status !== 'PROPOSED');

        if (overrideRequested && decisionMetrics.overrideEligible && overrideJustification) {
            diagnostics.push(buildDiagnostic(
                'warning',
                'ARCH_DECISION_NEW_ID_OVERRIDE_ACTIVE',
                `New decision count exceeds ${ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax}, but an explicit PROPOSED-only override is active.`,
                { sectionKey: 'decisions', newCount }
            ));
        } else {
            diagnostics.push(buildDiagnostic(
                'error',
                'ARCH_DECISION_NEW_ID_HARD_LIMIT_EXCEEDED',
                `DECISIONS introduces ${newCount} new stable IDs; hard limit is ${ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax}.`,
                { sectionKey: 'decisions', newCount, hardLimit: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax }
            ));

            if (decisionMetrics.overrideEligible) {
                diagnostics.push(buildDiagnostic(
                    'warning',
                    'ARCH_DECISION_NEW_ID_OVERRIDE_AVAILABLE',
                    'Excess new decisions are PROPOSED-only. Override is available with explicit action and written justification.',
                    { sectionKey: 'decisions', newCount }
                ));
            } else if (hasNonProposedExcess) {
                diagnostics.push(buildDiagnostic(
                    'warning',
                    'ARCH_DECISION_NEW_ID_OVERRIDE_UNAVAILABLE',
                    'Override is unavailable because excess new decisions include ACCEPTED or SEALED authority.',
                    { sectionKey: 'decisions', newCount }
                ));
            }
        }
    } else if (newCount > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.softMax) {
        diagnostics.push(buildDiagnostic(
            'warning',
            'ARCH_DECISION_NEW_ID_ELEVATED',
            `DECISIONS introduces ${newCount} new stable IDs. Consolidation review is strongly recommended.`,
            { sectionKey: 'decisions', newCount }
        ));
    } else if (newCount > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.normalMax) {
        diagnostics.push(buildDiagnostic(
            'warning',
            'ARCH_DECISION_NEW_ID_SOFT_GUIDANCE',
            `DECISIONS introduces ${newCount} new stable IDs. Growth is above the normal guidance band.`,
            { sectionKey: 'decisions', newCount }
        ));
    }

    if (updatedCount > ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD) {
        diagnostics.push(buildDiagnostic(
            'warning',
            'ARCH_DECISION_UPDATE_VOLUME_HIGH',
            `DECISIONS updates ${updatedCount} existing stable IDs in one run; review for broad regeneration or churn.`,
            { sectionKey: 'decisions', updatedCount, threshold: ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD }
        ));
    }
}

export function validateArchitecturalStructuredSections(sections, context = {}) {
    const diagnostics = [];
    const baselineLedger = normalizeArchitecturalBaselineLedger(context.baselineLedger || context.baselineDecisions);

    const decisionRecords = indexedSelectedItems(sections?.decisions || []).map(({ item, itemIndex }) => ({
        item,
        itemIndex,
        record: parseArchitecturalDecisionRecord(item?.content || ''),
    }));
    const decisionMetrics = mergeArchitecturalDecisionLedger(sections?.decisions || [], baselineLedger).metrics;

    decisionRecords.forEach(({ record, itemIndex }) => validateDecisionRecord(record, itemIndex, diagnostics));
    validateDecisionDuplicates(decisionRecords, diagnostics);
    validateDecisionLifecycle(decisionRecords, baselineLedger.decisionsById, diagnostics);
    validateBaselineDecisionPresence(decisionRecords, baselineLedger, diagnostics);
    validateSupersession(decisionRecords, baselineLedger.decisionsById, diagnostics);
    validateDecisionCapacity(decisionMetrics, diagnostics, context);
    validateSectionCaps(sections, diagnostics);

    const currentDecisionIds = new Set(
        decisionRecords
            .map(({ record }) => getDecisionField(record, 'ID'))
            .filter((id) => id && DECISION_ID_PATTERN.test(id))
    );

    indexedSelectedItems(sections?.events || []).forEach(({ item, itemIndex }) => {
        const record = parseArchitecturalEventRecord(item?.content || '');
        validateEventRecord(record, itemIndex, currentDecisionIds, diagnostics);
    });

    indexedSelectedItems(sections?.dialogue || []).forEach(({ item, itemIndex }) => {
        const record = parseArchitecturalDialogueRecord(item?.content || '');
        validateDialogueRecord(record, itemIndex, diagnostics);
    });

    indexedSelectedItems(sections?.threads || []).forEach(({ item, itemIndex }) => {
        const record = parseArchitecturalThreadRecord(item?.content || '');
        validateThreadRecord(record, itemIndex, diagnostics);
    });

    return diagnostics;
}

export function hasArchitecturalProfileMarkers(content) {
    return isCanonicalArchitecturalShardContent(content);
}
