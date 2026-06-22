import { parseArchitecturalDecisionRecord, parseArchitecturalDialogueRecord, parseArchitecturalEventRecord, parseArchitecturalThreadRecord } from './architectural-record-parser.js';
import { ARCHITECTURAL_SECTION_CAPS, indexedSelectedItems } from './architectural-structured-validator.js';

export const ARCHITECTURAL_PRUNING_CLASSIFICATIONS = Object.freeze({
    LOW_RISK: 'low-risk',
    REVIEW: 'review',
    PROTECTED: 'protected',
});

export const ARCHITECTURAL_PRUNING_REASON_CODES = Object.freeze({
    DIALOGUE_DUPLICATE_TO_EVIDENCE: 'DIALOGUE_DUPLICATE_TO_EVIDENCE',
    EVENT_DUPLICATE: 'EVENT_DUPLICATE',
    TIMELINE_REDUNDANT: 'TIMELINE_REDUNDANT',
    THREAD_RESOLVED_AND_PROMOTED: 'THREAD_RESOLVED_AND_PROMOTED',
    MINOR_IMPLEMENTATION_DECISION: 'MINOR_IMPLEMENTATION_DECISION',
    DECISION_SUPERSEDED_POTENTIALLY_OBSOLETE: 'DECISION_SUPERSEDED_POTENTIALLY_OBSOLETE',
    CURRENT_MANDATORY: 'CURRENT_MANDATORY',
    DECISION_ACTIVE_GOVERNING: 'DECISION_ACTIVE_GOVERNING',
    DECISION_REFERENCED: 'DECISION_REFERENCED',
    DECISION_CORRECTION_CHAIN_MEMBER: 'DECISION_CORRECTION_CHAIN_MEMBER',
    DECISION_HAS_ACTIVE_SUPERSESSION_LINKS: 'DECISION_HAS_ACTIVE_SUPERSESSION_LINKS',
    DECISION_HAS_RULED_OUT_REASONING: 'DECISION_HAS_RULED_OUT_REASONING',
    DECISION_BASELINE_INHERITED: 'DECISION_BASELINE_INHERITED',
    DECISION_BASELINE_UPDATED: 'DECISION_BASELINE_UPDATED',
    THREAD_UNRESOLVED: 'THREAD_UNRESOLVED',
    UNIQUE_STRUCTURAL_REASONING: 'UNIQUE_STRUCTURAL_REASONING',
});

export const ARCHITECTURAL_DEFERRED_REASON_CODES = Object.freeze({
    PARTIALLY_DUPLICATED_CONTENT: 'PARTIALLY_DUPLICATED_CONTENT',
});

const NON_GOVERNING_LOCAL_DECISION_TYPES = new Set([
    'IMPLEMENTATION',
    'STRATEGY',
    'PROCEDURE',
]);

const GOVERNING_DECISION_TYPES = new Set([
    'GOVERNANCE',
    'JURISDICTION',
    'HIERARCHY',
    'CORRECTION',
    'REPLACEMENT',
    'RENAME',
    'SCOPE',
    'DIAGNOSTIC',
    'COMMITMENT',
]);

const SECTION_ORDER = ['timeline', 'decisions', 'events', 'developments', 'dialogue', 'threads', 'current'];
const DECISION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeQuotedValue(value) {
    let normalized = normalizeWhitespace(value);
    if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalizeWhitespace(normalized);
}

function normalizeFieldValue(value) {
    return normalizeWhitespace(value);
}

function normalizeComparableSet(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => normalizeFieldValue(value))
        .filter(Boolean))]
        .sort();
}

function extractLeadingSourceRef(text) {
    const match = String(text || '').trim().match(/^(?:\[(S\d+:\d+)\]|\((S\d+:\d+)\))\s*(.*)$/s);
    if (!match) {
        return {
            sourceRef: null,
            sourceRefRaw: null,
            body: String(text || '').trim(),
        };
    }

    return {
        sourceRef: match[1] || match[2] || null,
        sourceRefRaw: match[0].slice(0, match[0].length - match[3].length).trim(),
        body: String(match[3] || '').trim(),
    };
}

function firstFieldValue(fields, key) {
    const value = fields?.[key];
    return Array.isArray(value) ? value[0] : value;
}

function fieldValues(fields, key) {
    const value = fields?.[key];
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry));
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [String(value)];
}

function normalizeDecisionTypes(record) {
    return (Array.isArray(record?.typeValues) ? record.typeValues : [])
        .map((entry) => normalizeFieldValue(entry).toUpperCase())
        .filter(Boolean);
}

function createRecommendation(classification, sectionKey, itemIndex, item, extra = {}) {
    return {
        sectionKey,
        itemIndex,
        itemId: item?.id || `${sectionKey}-${itemIndex}`,
        sourceRef: extra.sourceRef || null,
        stableDecisionId: extra.stableDecisionId || null,
        classification,
        reasonCodes: [...new Set(extra.reasonCodes || [])],
        basis: [...new Set(extra.basis || [])],
    };
}

function sortRecommendations(recommendations = []) {
    return [...recommendations].sort((a, b) => {
        const sectionDiff = SECTION_ORDER.indexOf(a.sectionKey) - SECTION_ORDER.indexOf(b.sectionKey);
        if (sectionDiff !== 0) return sectionDiff;
        return a.itemIndex - b.itemIndex;
    });
}

function buildGroupedRecommendations(recommendations = []) {
    return {
        lowRisk: recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK),
        review: recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW),
        protected: recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED),
    };
}

function buildSectionOverCapSummary(sections, recommendationsBySection, context = {}) {
    const decisionMetrics = context?.decisionLedgerMetrics || null;
    return SECTION_ORDER
        .filter((sectionKey) => Number.isInteger(ARCHITECTURAL_SECTION_CAPS[sectionKey]))
        .map((sectionKey) => {
            const selectedCount = indexedSelectedItems(sections?.[sectionKey] || []).length;
            const cap = ARCHITECTURAL_SECTION_CAPS[sectionKey];
            const effectiveSelectedCount = sectionKey === 'decisions' && decisionMetrics
                ? (decisionMetrics.newCount || 0)
                : selectedCount;
            const effectiveCap = sectionKey === 'decisions' && decisionMetrics
                ? (decisionMetrics.hardMax || cap)
                : cap;
            const excess = Math.max(0, effectiveSelectedCount - effectiveCap);
            const recommendations = recommendationsBySection.get(sectionKey) || [];
            const lowRiskCount = recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK).length;
            const reviewCount = recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW).length;
            const protectedCount = recommendations.filter((entry) => entry.classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED).length;
            const canResolveWithLowRisk = excess > 0 && lowRiskCount >= excess;

            return {
                sectionKey,
                selectedCount,
                cap: effectiveCap,
                excess,
                lowRiskCount,
                reviewCount,
                protectedCount,
                canResolveWithLowRisk,
                requiresManualReview: excess > 0 && lowRiskCount < excess,
                message: excess > 0 && lowRiskCount < excess
                    ? sectionKey === 'decisions' && decisionMetrics
                        ? 'Inherited and updated baseline decisions are ledger-protected. Review only genuinely new decisions for consolidation.'
                        : 'No deterministic low-risk candidates are sufficient to resolve this cap. Manual consolidation or careful review is required.'
                    : '',
            };
        })
        .filter((entry) => entry.excess > 0 || entry.selectedCount === 0);
}

function buildDecisionContexts(sections) {
    return indexedSelectedItems(sections?.decisions || []).map(({ item, itemIndex }) => {
        const record = parseArchitecturalDecisionRecord(item?.content || '');
        const id = normalizeFieldValue(record?.decisionId || '');
        const status = normalizeFieldValue(record?.status || '').toUpperCase();
        const types = normalizeDecisionTypes(record);
        const evidence = fieldValues(record?.fields, 'EVIDENCE').map(normalizeQuotedValue).filter(Boolean);
        const ruledOut = normalizeFieldValue(firstFieldValue(record?.fields, 'RULED-OUT') || '');
        const changed = normalizeFieldValue(firstFieldValue(record?.fields, 'CHANGED') || '');
        const supersedes = normalizeFieldValue(firstFieldValue(record?.fields, 'SUPERSEDES') || '');
        const supersededBy = normalizeFieldValue(firstFieldValue(record?.fields, 'SUPERSEDED-BY') || '');
        return {
            item,
            itemIndex,
            record,
            id,
            status,
            types,
            evidence,
            ruledOut,
            changed,
            supersedes,
            supersededBy,
            sourceRef: record?.sourceRef || null,
            decisionText: normalizeFieldValue(firstFieldValue(record?.fields, 'DECISION') || ''),
        };
    });
}

function buildEventContexts(sections) {
    return indexedSelectedItems(sections?.events || []).map(({ item, itemIndex }) => {
        const record = parseArchitecturalEventRecord(item?.content || '');
        return {
            item,
            itemIndex,
            record,
            sourceRef: record?.sourceRef || null,
            description: normalizeFieldValue(record?.description || ''),
            decisionRefs: normalizeComparableSet(record?.decisionRefs || []),
        };
    });
}

function buildTimelineContexts(sections) {
    return indexedSelectedItems(sections?.timeline || []).map(({ item, itemIndex }) => {
        const parsed = extractLeadingSourceRef(item?.content || '');
        return {
            item,
            itemIndex,
            sourceRef: parsed.sourceRef,
            anchorText: normalizeFieldValue(parsed.body),
        };
    });
}

function buildDevelopmentContexts(sections) {
    return indexedSelectedItems(sections?.developments || []).map(({ item, itemIndex }) => {
        const parsed = extractLeadingSourceRef(item?.content || '');
        return {
            item,
            itemIndex,
            sourceRef: parsed.sourceRef,
            body: normalizeFieldValue(parsed.body),
        };
    });
}

function buildDialogueContexts(sections) {
    return indexedSelectedItems(sections?.dialogue || []).map(({ item, itemIndex }) => {
        const record = parseArchitecturalDialogueRecord(item?.content || '');
        return {
            item,
            itemIndex,
            record,
            sourceRef: record?.sourceRef || null,
            quote: normalizeQuotedValue(record?.quote || ''),
            context: normalizeFieldValue(record?.context || ''),
        };
    });
}

function buildThreadContexts(sections) {
    return indexedSelectedItems(sections?.threads || []).map(({ item, itemIndex }) => {
        const record = parseArchitecturalThreadRecord(item?.content || '');
        return {
            item,
            itemIndex,
            record,
            sourceRef: record?.sourceRef || null,
            status: normalizeFieldValue(record?.status || '').toUpperCase(),
            subject: normalizeFieldValue(record?.subject || ''),
            notes: normalizeFieldValue(record?.notes || ''),
        };
    });
}

function buildCurrentContexts(sections) {
    return indexedSelectedItems(sections?.current || []).map(({ item, itemIndex }) => ({
        item,
        itemIndex,
    }));
}

function collectDecisionReferenceMap(eventContexts) {
    const map = new Map();
    eventContexts.forEach((eventContext) => {
        eventContext.decisionRefs.forEach((decisionId) => {
            if (!map.has(decisionId)) {
                map.set(decisionId, []);
            }
            map.get(decisionId).push(eventContext);
        });
    });
    return map;
}

function collectDecisionEvidenceCounts(decisionContexts) {
    const counts = new Map();
    decisionContexts.forEach((context) => {
        context.evidence.forEach((evidence) => {
            counts.set(evidence, (counts.get(evidence) || 0) + 1);
        });
    });
    return counts;
}

function collectDecisionChangedCounts(decisionContexts) {
    const counts = new Map();
    decisionContexts.forEach((context) => {
        if (!context.changed) return;
        counts.set(context.changed, (counts.get(context.changed) || 0) + 1);
    });
    return counts;
}

function analyzeDialogueRecommendations(dialogueContexts, decisionContexts) {
    const recommendations = [];
    const decisionEvidence = new Map();

    decisionContexts.forEach((context) => {
        context.evidence.forEach((evidence) => {
            if (!decisionEvidence.has(evidence)) {
                decisionEvidence.set(evidence, []);
            }
            decisionEvidence.get(evidence).push(context);
        });
    });

    dialogueContexts.forEach((context) => {
        if (!context.quote || context.context) {
            return;
        }

        const matches = decisionEvidence.get(context.quote) || [];
        if (!matches.length) {
            return;
        }

        recommendations.push(createRecommendation(
            ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK,
            'dialogue',
            context.itemIndex,
            context.item,
            {
                sourceRef: context.sourceRef,
                reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE],
                basis: [
                    'Exact quote is already preserved in DECISION evidence.',
                    'No additional structural context was detected in this DIALOGUE entry.',
                ],
            }
        ));
    });

    return recommendations;
}

function analyzeEventRecommendations(eventContexts) {
    const recommendations = [];
    const firstBySignature = new Map();

    eventContexts.forEach((context) => {
        const signature = [
            context.sourceRef || '',
            context.description,
            context.decisionRefs.join('|'),
        ].join('||');

        if (!firstBySignature.has(signature)) {
            firstBySignature.set(signature, context);
            return;
        }

        const retained = firstBySignature.get(signature);
        recommendations.push(createRecommendation(
            ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK,
            'events',
            context.itemIndex,
            context.item,
            {
                sourceRef: context.sourceRef,
                reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.EVENT_DUPLICATE],
                basis: [
                    `Same occurrence, source reference, and decision references are already retained in EVENTS item ${retained.itemIndex + 1}.`,
                ],
            }
        ));
    });

    return recommendations;
}

function analyzeTimelineRecommendations(timelineContexts, eventContexts, decisionContexts) {
    const recommendations = [];
    const eventBySourceAndDescription = new Map();
    const decisionBySourceAndSummary = new Map();

    eventContexts.forEach((context) => {
        const key = `${context.sourceRef || ''}||${context.description}`;
        if (!eventBySourceAndDescription.has(key)) {
            eventBySourceAndDescription.set(key, context);
        }
    });

    decisionContexts.forEach((context) => {
        const key = `${context.sourceRef || ''}||${context.decisionText}`;
        if (!decisionBySourceAndSummary.has(key)) {
            decisionBySourceAndSummary.set(key, context);
        }
    });

    timelineContexts.forEach((context) => {
        const eventMatch = eventBySourceAndDescription.get(`${context.sourceRef || ''}||${context.anchorText}`);
        if (eventMatch) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK,
                'timeline',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.TIMELINE_REDUNDANT],
                    basis: [
                        `The same source anchor and information are already retained in EVENTS item ${eventMatch.itemIndex + 1}.`,
                    ],
                }
            ));
            return;
        }

        const decisionMatch = decisionBySourceAndSummary.get(`${context.sourceRef || ''}||${context.anchorText}`);
        if (decisionMatch) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK,
                'timeline',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: decisionMatch.id || null,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.TIMELINE_REDUNDANT],
                    basis: [
                        `The same source anchor and information are already retained in DECISION ${decisionMatch.id || `item ${decisionMatch.itemIndex + 1}`}.`,
                    ],
                }
            ));
        }
    });

    return recommendations;
}

function analyzeThreadRecommendations(threadContexts, developmentContexts, decisionContexts) {
    const recommendations = [];
    const developmentBodies = developmentContexts.map((context) => context.body);
    const decisionBodies = decisionContexts.map((context) => context.decisionText);

    threadContexts.forEach((context) => {
        if (['UNRESOLVED', 'DEVELOPING', 'ACTIVE'].includes(context.status)) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED,
                'threads',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_UNRESOLVED],
                    basis: [
                        'Thread remains open and is required for continuity of pending work.',
                    ],
                }
            ));
            return;
        }

        if (context.status !== 'RESOLVED') {
            return;
        }

        const subjectMentioned = developmentBodies.some((body) => body.includes(context.subject))
            || decisionBodies.some((body) => body.includes(context.subject));

        if (subjectMentioned && !context.notes) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK,
                'threads',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_RESOLVED_AND_PROMOTED],
                    basis: [
                        'Thread is resolved and its outcome is explicitly preserved in a retained DEVELOPMENT or DECISION.',
                    ],
                }
            ));
            return;
        }

        recommendations.push(createRecommendation(
            ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW,
            'threads',
            context.itemIndex,
            context.item,
            {
                sourceRef: context.sourceRef,
                reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_RESOLVED_AND_PROMOTED],
                basis: [
                    context.notes
                        ? 'Thread is resolved, but notes remain uniquely structured and require human review.'
                        : 'Thread is resolved, but explicit retained outcome could not be proven deterministically.',
                ],
            }
        ));
    });

    return recommendations;
}

function analyzeCurrentRecommendations(currentContexts) {
    return currentContexts.map((context) => createRecommendation(
        ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED,
        'current',
        context.itemIndex,
        context.item,
        {
            reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.CURRENT_MANDATORY],
            basis: [
                'CURRENT is mandatory and represents the latest project state.',
            ],
        }
    ));
}

function analyzeDecisionRecommendations(decisionContexts, eventContexts, options = {}) {
    const recommendations = [];
    const decisionById = new Map();
    const eventRefsByDecisionId = collectDecisionReferenceMap(eventContexts);
    const evidenceCounts = collectDecisionEvidenceCounts(decisionContexts);
    const changedCounts = collectDecisionChangedCounts(decisionContexts);
    const classificationById = options?.decisionLedgerMetrics?.classificationById || {};

    decisionContexts.forEach((context) => {
        if (context.id) {
            decisionById.set(context.id, context);
        }
    });

    decisionContexts.forEach((context) => {
        const reasonCodes = [];
        const basis = [];
        const eventRefs = context.id ? (eventRefsByDecisionId.get(context.id) || []) : [];
        const linkedDecision = context.supersedes
            ? decisionById.get(context.supersedes)
            : (context.supersededBy ? decisionById.get(context.supersededBy) : null);
        const hasActiveSupersessionLink = Boolean(
            (context.supersedes && decisionById.has(context.supersedes))
            || (context.supersededBy && decisionById.has(context.supersededBy))
        );
        const containsCorrection = context.types.includes('CORRECTION')
            || Boolean(linkedDecision && linkedDecision.types.includes('CORRECTION'));
        const hasUniqueEvidence = context.evidence.some((evidence) => evidenceCounts.get(evidence) === 1);
        const hasUniqueChanged = context.changed && changedCounts.get(context.changed) === 1;
        const ledgerClass = context.id ? classificationById[context.id] : null;
        const isPureLocalImplementation = context.types.length > 0
            && context.types.every((type) => NON_GOVERNING_LOCAL_DECISION_TYPES.has(type))
            && context.types.includes('IMPLEMENTATION')
            && !context.types.some((type) => GOVERNING_DECISION_TYPES.has(type))
            && eventRefs.length === 0
            && !context.supersedes
            && !context.supersededBy
            && !context.ruledOut;
        const isActiveGoverning = (
            context.status === 'SEALED'
            || (context.status === 'ACCEPTED' && !isPureLocalImplementation)
        ) && !context.supersededBy;

        if (ledgerClass === 'inherited') {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED,
                'decisions',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: context.id || null,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_BASELINE_INHERITED],
                    basis: [
                        'Baseline decision was carried forward unchanged and is protected by continuity rules.',
                    ],
                }
            ));
            return;
        }

        if (ledgerClass === 'updated') {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED,
                'decisions',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: context.id || null,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_BASELINE_UPDATED],
                    basis: [
                        'Baseline decision was updated in this run and should not be pruned to control new-ID growth.',
                    ],
                }
            ));
            return;
        }

        if (isActiveGoverning) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_ACTIVE_GOVERNING);
            basis.push(`STATUS is ${context.status}.`);
        }

        if (eventRefs.length > 0) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_REFERENCED);
            basis.push(`Referenced by EVENTS item ${eventRefs[0].itemIndex + 1}${eventRefs.length > 1 ? ` and ${eventRefs.length - 1} more` : ''}.`);
        }

        if (containsCorrection) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_CORRECTION_CHAIN_MEMBER);
            basis.push('Decision is part of a correction chain required to preserve error and correction history.');
        }

        if (hasActiveSupersessionLink) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_HAS_ACTIVE_SUPERSESSION_LINKS);
            basis.push('Decision participates in an active supersession chain and cannot be evaluated independently.');
        }

        if (context.ruledOut) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_HAS_RULED_OUT_REASONING);
            basis.push('Decision preserves an explicitly rejected alternative and its rejection basis.');
        }

        if ((hasUniqueEvidence && isActiveGoverning) || (hasUniqueChanged && containsCorrection)) {
            reasonCodes.push(ARCHITECTURAL_PRUNING_REASON_CODES.UNIQUE_STRUCTURAL_REASONING);
            basis.push(hasUniqueEvidence && isActiveGoverning
                ? 'Unique structured evidence is not preserved in another retained decision.'
                : 'Unique structured change history is not preserved in another retained decision.');
        }

        if (reasonCodes.length > 0) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED,
                'decisions',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: context.id || null,
                    reasonCodes,
                    basis,
                }
            ));
            return;
        }

        const hasSupersessionFields = Boolean(context.supersedes || context.supersededBy);
        const hasValidSupersededBy = context.status === 'SUPERSEDED'
            && DECISION_ID_PATTERN.test(context.supersededBy || '');
        const hasOnlyLocalTypes = context.types.length > 0
            && context.types.every((type) => NON_GOVERNING_LOCAL_DECISION_TYPES.has(type))
            && context.types.includes('IMPLEMENTATION')
            && !context.types.some((type) => GOVERNING_DECISION_TYPES.has(type));

        if (hasOnlyLocalTypes
            && ['PROPOSED', 'ACCEPTED'].includes(context.status)
            && eventRefs.length === 0
            && !hasSupersessionFields
            && !context.ruledOut) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW,
                'decisions',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: context.id || null,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.MINOR_IMPLEMENTATION_DECISION],
                    basis: [
                        'Local implementation choice has no incoming references, supersession links, or governing decision type.',
                    ],
                }
            ));
            return;
        }

        if (context.status === 'SUPERSEDED' && hasValidSupersededBy) {
            recommendations.push(createRecommendation(
                ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW,
                'decisions',
                context.itemIndex,
                context.item,
                {
                    sourceRef: context.sourceRef,
                    stableDecisionId: context.id || null,
                    reasonCodes: [ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_SUPERSEDED_POTENTIALLY_OBSOLETE],
                    basis: [
                        'Decision has been superseded, but historical rationale may still be required to interpret the replacement.',
                    ],
                }
            ));
        }
    });

    return recommendations;
}

export function analyzeArchitecturalPruningAdvisor(sections, context = {}) {
    const normalizedSections = sections || {};
    const decisionContexts = buildDecisionContexts(normalizedSections);
    const eventContexts = buildEventContexts(normalizedSections);
    const timelineContexts = buildTimelineContexts(normalizedSections);
    const developmentContexts = buildDevelopmentContexts(normalizedSections);
    const dialogueContexts = buildDialogueContexts(normalizedSections);
    const threadContexts = buildThreadContexts(normalizedSections);
    const currentContexts = buildCurrentContexts(normalizedSections);

    const recommendations = sortRecommendations([
        ...analyzeDialogueRecommendations(dialogueContexts, decisionContexts),
        ...analyzeEventRecommendations(eventContexts),
        ...analyzeTimelineRecommendations(timelineContexts, eventContexts, decisionContexts),
        ...analyzeThreadRecommendations(threadContexts, developmentContexts, decisionContexts),
        ...analyzeCurrentRecommendations(currentContexts),
        ...analyzeDecisionRecommendations(decisionContexts, eventContexts, context),
    ]);

    const recommendationsBySection = new Map();
    recommendations.forEach((entry) => {
        if (!recommendationsBySection.has(entry.sectionKey)) {
            recommendationsBySection.set(entry.sectionKey, []);
        }
        recommendationsBySection.get(entry.sectionKey).push(entry);
    });

    const overCapSections = buildSectionOverCapSummary(normalizedSections, recommendationsBySection, context);
    const groups = buildGroupedRecommendations(recommendations);

    return {
        sectionOrder: [...SECTION_ORDER],
        recommendations,
        groups,
        overCapSections,
        deferredReasonCodes: [ARCHITECTURAL_DEFERRED_REASON_CODES.PARTIALLY_DUPLICATED_CONTENT],
        context: {
            ...context,
            selectedCounts: Object.fromEntries(SECTION_ORDER.map((sectionKey) => [sectionKey, indexedSelectedItems(normalizedSections?.[sectionKey] || []).length])),
        },
    };
}

export function buildArchitecturalPruningAdvisorUiModel(advisorResult) {
    const result = advisorResult || analyzeArchitecturalPruningAdvisor({});
    const groups = result.groups || buildGroupedRecommendations([]);
    return {
        hasRecommendations: result.recommendations?.length > 0,
        overCapSections: result.overCapSections || [],
        lowRisk: groups.lowRisk || [],
        review: groups.review || [],
        protected: groups.protected || [],
        deferredReasonCodes: result.deferredReasonCodes || [],
    };
}
