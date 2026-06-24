import { ARCHITECTURAL_PROFILE, getSharderSectionRegistry } from './sharder-section-registry.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import { parseArchitecturalDecisionRecord } from './architectural-record-parser.js';

export const ARCHITECTURAL_DECISION_NEW_ID_LIMITS = Object.freeze({
    normalMax: 7,
    softMax: 12,
    hardMax: 20,
});

export const ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD = 12;

const DECISION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_DECISION_FIELDS = ['ID', 'TYPE', 'DECISION', 'WHY', 'SCOPE', 'STATUS', 'EVIDENCE'];
const CANONICAL_STATUSES = new Set(['PROPOSED', 'ACCEPTED', 'SEALED', 'SUPERSEDED']);

function buildDiagnostic(level, code, message, extra = {}) {
    return {
        level,
        code,
        message,
        ...extra,
    };
}

function cloneItem(item) {
    return {
        ...item,
        selected: item?.selected !== false,
    };
}

function firstFieldValue(record, field) {
    const value = record?.fields?.[field];
    return Array.isArray(value) ? value[0] : value;
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFieldComparisonValue(record, field) {
    return normalizeText(firstFieldValue(record, field) || '');
}

function hasMandatoryFields(record) {
    return REQUIRED_DECISION_FIELDS.every((field) => normalizeFieldComparisonValue(record, field));
}

function decisionTypesArePresent(record) {
    const value = normalizeFieldComparisonValue(record, 'TYPE');
    return Boolean(value);
}

function hasValidSupersessionSemantics(record, id, status) {
    const supersedes = normalizeFieldComparisonValue(record, 'SUPERSEDES');
    const supersededBy = normalizeFieldComparisonValue(record, 'SUPERSEDED-BY');

    if (supersedes && supersedes === id) return false;
    if (supersededBy && supersededBy === id) return false;
    if (status === 'SUPERSEDED' && !supersededBy) return false;
    if (supersededBy && status !== 'SUPERSEDED') return false;
    return true;
}

function parseDecisionItem(item, sourceLabel) {
    const record = parseArchitecturalDecisionRecord(item?.content || '');
    const id = normalizeFieldComparisonValue(record, 'ID');
    const status = normalizeFieldComparisonValue(record, 'STATUS');
    const supersedes = normalizeFieldComparisonValue(record, 'SUPERSEDES');
    const supersededBy = normalizeFieldComparisonValue(record, 'SUPERSEDED-BY');
    const valid = Boolean(record.sourceRef)
        && record.errors.length === 0
        && record.duplicateFields.length === 0
        && record.unknownFields.length === 0
        && hasMandatoryFields(record)
        && decisionTypesArePresent(record)
        && DECISION_ID_PATTERN.test(id)
        && CANONICAL_STATUSES.has(status)
        && (!supersedes || DECISION_ID_PATTERN.test(supersedes))
        && (!supersededBy || DECISION_ID_PATTERN.test(supersededBy))
        && hasValidSupersessionSemantics(record, id, status);

    return {
        item,
        sourceLabel,
        record,
        id,
        status,
        valid,
    };
}

function decisionEntryFromParsed(parsed) {
    return {
        id: parsed.id,
        status: parsed.status,
        source: parsed.sourceLabel,
        content: String(parsed.item?.content || ''),
        item: cloneItem(parsed.item),
        record: parsed.record,
        authority: parsed.item?.authority || null,
    };
}

function materiallyUpdatesDecision(baselineRecord, currentRecord) {
    const comparedFields = [
        'STATUS',
        'SUPERSEDES',
        'SUPERSEDED-BY',
        'EVIDENCE',
        'RULED-OUT',
        'CHANGED',
        'SCOPE',
        'DECISION',
    ];

    return comparedFields.some((field) =>
        normalizeFieldComparisonValue(baselineRecord, field) !== normalizeFieldComparisonValue(currentRecord, field)
    );
}

export function buildArchitecturalBaselineLedger(existingShards = []) {
    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const diagnostics = [];
    const decisionsById = {};
    const orderedIds = [];
    const duplicateConflicts = new Set();

    const sortedShards = (Array.isArray(existingShards) ? existingShards : [])
        .map((shard, originalIndex) => ({ shard, originalIndex }))
        .sort((a, b) => {
            const aRange = Number.isFinite(a.shard?.messageRangeStart) ? a.shard.messageRangeStart : Number.POSITIVE_INFINITY;
            const bRange = Number.isFinite(b.shard?.messageRangeStart) ? b.shard.messageRangeStart : Number.POSITIVE_INFINITY;
            if (aRange !== bRange) return aRange - bRange;
            return a.originalIndex - b.originalIndex;
        });

    for (const { shard } of sortedShards) {
        const content = String(shard?.content || '');
        if (!content.trim()) continue;

        const parsedSections = parseArchitecturalExtractionResponse(content, registry);
        const sourceLabel = String(shard?.identifier || 'historical architectural shard');
        const items = Array.isArray(parsedSections?.decisions) ? parsedSections.decisions : [];

        for (const item of items) {
            if (item?.selected === false) continue;

            const parsed = parseDecisionItem(item, sourceLabel);
            if (!parsed.valid) {
                diagnostics.push(buildDiagnostic(
                    'warning',
                    'ARCH_BASELINE_DECISION_IGNORED',
                    `Malformed historical decision ignored from ${sourceLabel}.`,
                    { recordId: parsed.id || null }
                ));
                continue;
            }

            if (!orderedIds.includes(parsed.id)) {
                orderedIds.push(parsed.id);
            } else {
                const prior = decisionsById[parsed.id];
                if (prior && prior.content.trim() !== String(parsed.item?.content || '').trim()) {
                    duplicateConflicts.add(parsed.id);
                }
            }

            const projectionRef = shard?.projectionMetadata;
            const projectionAuthority = projectionRef?.authorityContext?.projectionState?.[parsed.id]?.authority || null;
            const currentRecordVersion = projectionAuthority?.currentRecordVersion;
            const canonicalHash = projectionAuthority?.canonicalHash || null;
            if (Number.isFinite(currentRecordVersion)) {
                parsed.item = {
                    ...parsed.item,
                    authority: {
                        memoryScopeId: projectionRef?.memoryScopeId || null,
                        currentRecordVersion,
                        canonicalHash,
                    },
                };
            }

            decisionsById[parsed.id] = decisionEntryFromParsed(parsed);
        }
    }

    for (const id of duplicateConflicts) {
        diagnostics.push(buildDiagnostic(
            'error',
            'ARCH_BASELINE_DUPLICATE_ID_CONFLICT',
            `Baseline contains conflicting records for stable decision ID ${id}.`,
            { sectionKey: 'decisions', recordId: id }
        ));
    }

    return {
        decisionsById,
        orderedIds,
        diagnostics,
    };
}

export function normalizeArchitecturalBaselineLedger(input = {}) {
    if (input?.decisionsById && Array.isArray(input?.orderedIds)) {
        return {
            decisionsById: { ...input.decisionsById },
            orderedIds: [...input.orderedIds],
            diagnostics: Array.isArray(input?.diagnostics) ? [...input.diagnostics] : [],
        };
    }

    if (input?.decisions && typeof input.decisions === 'object') {
        const decisionsById = {};
        const orderedIds = [];
        for (const [id, entry] of Object.entries(input.decisions)) {
            if (!id || !entry) continue;
            orderedIds.push(id);
            decisionsById[id] = { ...entry };
        }
        return { decisionsById, orderedIds, diagnostics: [] };
    }

    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const decisionsById = {};
        const orderedIds = [];
        for (const [id, entry] of Object.entries(input)) {
            if (!id || !entry) continue;
            orderedIds.push(id);
            decisionsById[id] = { ...entry };
        }
        return { decisionsById, orderedIds, diagnostics: [] };
    }

    return { decisionsById: {}, orderedIds: [], diagnostics: [] };
}

export function mergeArchitecturalDecisionLedger(generatedItems = [], baselineLedgerInput = {}) {
    const baselineLedger = normalizeArchitecturalBaselineLedger(baselineLedgerInput);
    const mergedEntries = new Map();
    const orderedIds = [...baselineLedger.orderedIds];
    const passthroughItems = [];
    const seenGeneratedIds = new Set();
    const classificationById = {};
    const newIdsInOrder = [];
    const updatedIdsInOrder = [];
    const inheritedIdsInOrder = [];

    for (const id of baselineLedger.orderedIds) {
        const baseline = baselineLedger.decisionsById[id];
        if (!baseline) continue;
        mergedEntries.set(id, {
            ...baseline,
            item: cloneItem(baseline.item || { content: baseline.content, selected: true }),
        });
    }

    (Array.isArray(generatedItems) ? generatedItems : []).forEach((item, itemIndex) => {
        const parsed = parseDecisionItem(item, 'generated-output');
        if (!parsed.valid || !parsed.id) {
            passthroughItems.push(cloneItem(item));
            return;
        }

        if (seenGeneratedIds.has(parsed.id)) {
            passthroughItems.push(cloneItem(item));
            return;
        }
        seenGeneratedIds.add(parsed.id);

        const nextEntry = decisionEntryFromParsed(parsed);
        const baseline = baselineLedger.decisionsById[parsed.id];

        if (baseline) {
            mergedEntries.set(parsed.id, nextEntry);
            if (materiallyUpdatesDecision(baseline.record, parsed.record)) {
                classificationById[parsed.id] = 'updated';
                updatedIdsInOrder.push(parsed.id);
            } else {
                classificationById[parsed.id] = 'inherited';
                inheritedIdsInOrder.push(parsed.id);
            }
            return;
        }

        mergedEntries.set(parsed.id, nextEntry);
        orderedIds.push(parsed.id);
        classificationById[parsed.id] = 'new';
        newIdsInOrder.push(parsed.id);
    });

    for (const id of baselineLedger.orderedIds) {
        if (classificationById[id]) continue;
        if (mergedEntries.has(id)) {
            classificationById[id] = 'inherited';
            inheritedIdsInOrder.push(id);
        }
    }

    const mergedItems = orderedIds
        .map((id) => mergedEntries.get(id))
        .filter(Boolean)
        .map((entry) => cloneItem(entry.item || { content: entry.content, selected: true }))
        .concat(passthroughItems);

    const newEntries = newIdsInOrder.map((id) => mergedEntries.get(id)).filter(Boolean);
    const excessNewEntries = newEntries.slice(ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax);
    const overrideEligible = excessNewEntries.length > 0
        && excessNewEntries.every((entry) => normalizeFieldComparisonValue(entry.record, 'STATUS') === 'PROPOSED');

    let guidanceLevel = 'normal';
    if (newIdsInOrder.length > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax) {
        guidanceLevel = 'blocked';
    } else if (newIdsInOrder.length > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.softMax) {
        guidanceLevel = 'elevated';
    } else if (newIdsInOrder.length > ARCHITECTURAL_DECISION_NEW_ID_LIMITS.normalMax) {
        guidanceLevel = 'soft';
    }

    return {
        items: mergedItems,
        orderedIds,
        classificationById,
        metrics: {
            inheritedCount: inheritedIdsInOrder.length,
            updatedCount: updatedIdsInOrder.length,
            newCount: newIdsInOrder.length,
            classificationById: { ...classificationById },
            inheritedIdsInOrder,
            updatedIdsInOrder,
            newIdsInOrder,
            normalMax: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.normalMax,
            softMax: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.softMax,
            hardMax: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax,
            guidanceLevel,
            excessNewIds: excessNewEntries.map((entry) => entry.id),
            excessNewStatuses: excessNewEntries.map((entry) => normalizeFieldComparisonValue(entry.record, 'STATUS')),
            overrideEligible,
            updateWarnThreshold: ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD,
            updateWarnTriggered: updatedIdsInOrder.length > ARCHITECTURAL_DECISION_UPDATE_WARN_THRESHOLD,
        },
    };
}
