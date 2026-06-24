import {
    ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION,
    ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
    ARCHITECTURAL_DIALOGUE_NORMALIZATION_VERSION,
    TIER2_AUTHORITY_CLASS,
    TIER2_CLAIM_CLASS,
    TIER2_CLAIM_RELATIONSHIP,
    TIER2_CLAIM_STATE,
    TIER2_CLAIM_ZONE_CLASS,
    TIER2_CONFIDENCE_CLASS,
    TIER2_EXTRACTION_MODE,
    TIER2_RECONCILIATION_BASIS,
    TIER2_REVIEW_KIND,
    buildDeterministicHashId,
    stableStringify,
} from './architectural-rebuild-protocol.js';

const CONTEXT_DEPENDENT_PATTERNS = Object.freeze([
    /^(?:agree|agreed|that works|do that|sounds good|yes,? do that)[.!]*$/iu,
    /^replace the earlier one[.!]*$/iu,
]);

const PURE_MENTION_PREFIXES = Object.freeze([
    { pattern: /^example\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_EXAMPLE },
    { pattern: /^for example\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_EXAMPLE },
    { pattern: /^hypothetical(?:ly)?\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_EXAMPLE },
    { pattern: /^rejected alternative\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_REJECTED_ALTERNATIVE },
    { pattern: /^ruled[- ]out\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_REJECTED_ALTERNATIVE },
    { pattern: /^quoted(?: report| dialogue)?\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_ATTRIBUTED },
    { pattern: /^coder report\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_ATTRIBUTED },
    { pattern: /^archivist feedback\s*:/iu, zone: TIER2_CLAIM_ZONE_CLASS.MENTION_ATTRIBUTED },
]);

const EXPLICIT_RULES = Object.freeze([
    {
        id: 'tier2-explicit-decision-approved-v1',
        match(text) {
            const match = text.match(/^(?:approved|accepted)\s*:\s*(.+?)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.DECISION,
                explicitLifecycleState: TIER2_CLAIM_STATE.ACCEPTED,
                normalizedClaimPayload: {
                    decisionText: normalizeSentence(match[1]),
                    explicitDecisionId: null,
                },
            };
        },
    },
    {
        id: 'tier2-explicit-decision-should-v1',
        match(text) {
            const match = text.match(/^(?:we|i)\s+should\s+(.+?)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.DECISION,
                explicitLifecycleState: TIER2_CLAIM_STATE.PROPOSED,
                normalizedClaimPayload: {
                    decisionText: normalizeSentence(match[1]),
                    explicitDecisionId: null,
                },
            };
        },
    },
    {
        id: 'tier2-explicit-decision-id-v1',
        match(text) {
            const match = text.match(/^decision\s+([a-z0-9][a-z0-9-]*)\s*:\s*(.+?)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.DECISION,
                explicitLifecycleState: null,
                normalizedClaimPayload: {
                    decisionText: normalizeSentence(match[2]),
                    explicitDecisionId: sanitizeDecisionId(match[1]),
                },
            };
        },
    },
    {
        id: 'tier2-explicit-correction-v1',
        match(text) {
            let match = text.match(/^correction\s*:\s*(.+?)[.?!]*$/iu);
            if (match) {
                return {
                    claimClass: TIER2_CLAIM_CLASS.CORRECTION,
                    explicitLifecycleState: null,
                    normalizedClaimPayload: {
                        correctionText: normalizeSentence(match[1]),
                        targetDecisionId: null,
                    },
                };
            }
            match = text.match(/^decision\s+([a-z0-9][a-z0-9-]*)\s+was\s+wrong;\s*(.+?)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.CORRECTION,
                explicitLifecycleState: null,
                normalizedClaimPayload: {
                    correctionText: normalizeSentence(match[2]),
                    targetDecisionId: sanitizeDecisionId(match[1]),
                },
            };
        },
    },
    {
        id: 'tier2-explicit-supersession-v1',
        match(text) {
            const match = text.match(/^(?:decision\s+)?([a-z0-9][a-z0-9-]*)\s+(?:replaces|supersedes)\s+(?:decision\s+)?([a-z0-9][a-z0-9-]*)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.SUPERSESSION,
                explicitLifecycleState: null,
                normalizedClaimPayload: {
                    replacementDecisionId: sanitizeDecisionId(match[1]),
                    supersededDecisionId: sanitizeDecisionId(match[2]),
                },
            };
        },
    },
    {
        id: 'tier2-explicit-unresolved-commitment-v1',
        match(text) {
            const match = text.match(/^(?:we\s+still\s+need\s+to|i\s+still\s+need\s+to|still\s+need\s+to|todo\s*:)\s+(.+?)[.?!]*$/iu);
            if (!match) return null;
            return {
                claimClass: TIER2_CLAIM_CLASS.UNRESOLVED_COMMITMENT,
                explicitLifecycleState: TIER2_CLAIM_STATE.UNRESOLVED,
                normalizedClaimPayload: {
                    commitmentText: normalizeSentence(match[1]),
                },
            };
        },
    },
]);

function normalizeText(value) {
    return String(value || '').replace(/\r\n?/gu, '\n');
}

function trimTrailingPunctuation(text) {
    return String(text || '').trim().replace(/[.?!]+$/u, '').trim();
}

function normalizeSentence(text) {
    return trimTrailingPunctuation(text).replace(/\s+/gu, ' ');
}

function countCodePoints(text) {
    return [...String(text || '')].length;
}

function sanitizeDecisionId(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]*$/u.test(normalized) ? normalized : null;
}

function normalizeClaimMessageText(messageText) {
    return normalizeText(messageText).trim();
}

function buildOccurrenceSourceId(chatInstanceId, sourceMessageId) {
    return `${String(chatInstanceId || '').trim()}:${String(sourceMessageId || '').trim()}`;
}

function buildEvidenceLineageId(memoryScopeId, lineAnchor) {
    return buildDeterministicHashId('lineage', 1, {
        memoryScopeId: String(memoryScopeId || '').trim(),
        lineAnchor: String(lineAnchor || '').trim(),
    });
}

function buildClaimIdV1(payload) {
    return buildDeterministicHashId('claim', ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION, payload);
}

function buildReviewItemId(kind, payload) {
    return buildDeterministicHashId('review', 1, {
        kind,
        payload,
    });
}

function deriveSpeakerRole(message) {
    if (message?.is_user === true) return 'user';
    if (message?.is_system === true) return 'system';
    const sourceType = String(message?.extra?.summary_sharder?.speakerIdentity?.sourceType || '').trim().toLowerCase();
    if (sourceType) {
        return sourceType;
    }
    return 'assistant';
}

function isCharacterSelfClaim(message, normalizedBody) {
    const sourceType = String(message?.extra?.summary_sharder?.speakerIdentity?.sourceType || '').trim().toLowerCase();
    if (sourceType !== 'character') {
        return false;
    }
    return /^(?:i|my|me)\b/iu.test(normalizedBody);
}

function deriveAuthorityClass(message, claimClass, normalizedBody) {
    if (message?.is_user === true) {
        return {
            authorityClass: TIER2_AUTHORITY_CLASS.USER_AUTHORITY,
            authorityBasis: 'message_is_user',
            jurisdictionScope: 'memory_scope',
        };
    }
    if (message?.is_system === true) {
        return {
            authorityClass: TIER2_AUTHORITY_CLASS.SYSTEM_GOVERNANCE_AUTHORITY,
            authorityBasis: 'message_is_system',
            jurisdictionScope: 'system_governance',
        };
    }
    if (isCharacterSelfClaim(message, normalizedBody)
        && claimClass === TIER2_CLAIM_CLASS.UNRESOLVED_COMMITMENT) {
        return {
            authorityClass: TIER2_AUTHORITY_CLASS.CHARACTER_SELF_AUTHORITY,
            authorityBasis: 'character_self_commitment',
            jurisdictionScope: 'character_self',
        };
    }
    const sourceType = String(message?.extra?.summary_sharder?.speakerIdentity?.sourceType || '').trim().toLowerCase();
    if (sourceType === 'character' || sourceType === 'assistant') {
        return {
            authorityClass: TIER2_AUTHORITY_CLASS.ASSISTANT_PROPOSAL,
            authorityBasis: 'speaker_role_default',
            jurisdictionScope: 'proposal_only',
        };
    }
    return {
        authorityClass: TIER2_AUTHORITY_CLASS.UNKNOWN_AUTHORITY,
        authorityBasis: 'speaker_role_unresolved',
        jurisdictionScope: 'unknown',
    };
}

function deriveClaimState(authorityInfo, explicitLifecycleState) {
    if (explicitLifecycleState === TIER2_CLAIM_STATE.UNRESOLVED) {
        return TIER2_CLAIM_STATE.UNRESOLVED;
    }
    if (authorityInfo.authorityClass === TIER2_AUTHORITY_CLASS.ASSISTANT_PROPOSAL
        || authorityInfo.authorityClass === TIER2_AUTHORITY_CLASS.UNKNOWN_AUTHORITY) {
        return TIER2_CLAIM_STATE.PROPOSED;
    }
    if (explicitLifecycleState) {
        return explicitLifecycleState;
    }
    return TIER2_CLAIM_STATE.PROPOSED;
}

function detectPureMentionZone(normalizedText) {
    if (!normalizedText) {
        return null;
    }
    if (/^```[\s\S]*```$/u.test(normalizedText) || /^`[^`\n]+`$/u.test(normalizedText)) {
        return TIER2_CLAIM_ZONE_CLASS.MENTION_CODE;
    }
    if (/^(?:\s*>.*\n?)+$/u.test(normalizedText)) {
        return TIER2_CLAIM_ZONE_CLASS.MENTION_QUOTE;
    }
    if (/^[\[{][\s\S]*[\]}]$/u.test(normalizedText)) {
        return TIER2_CLAIM_ZONE_CLASS.MENTION_LOG;
    }
    for (const entry of PURE_MENTION_PREFIXES) {
        if (entry.pattern.test(normalizedText)) {
            return entry.zone;
        }
    }
    return null;
}

function stripExcludedZones(normalizedText) {
    let asserted = normalizedText;
    asserted = asserted.replace(/```[\s\S]*?```/gu, ' ');
    asserted = asserted.replace(/`[^`\n]+`/gu, ' ');
    asserted = asserted
        .split('\n')
        .filter((line) => !/^\s*>/u.test(line))
        .join('\n');
    return asserted.replace(/\s+/gu, ' ').trim();
}

function detectContextDependent(normalizedBody) {
    return CONTEXT_DEPENDENT_PATTERNS.some((pattern) => pattern.test(normalizedBody));
}

function createBaseDetection(context) {
    const normalizedText = normalizeClaimMessageText(context.message?.mes || '');
    const sourceMessageId = String(context.sourceMessageId || '').trim();
    const sourceRevisionHash = String(context.sourceRevisionHash || '').trim();
    const speakerEntityId = String(context.message?.extra?.summary_sharder?.speakerIdentity?.speakerEntityId || '').trim() || null;
    const lineAnchor = String(context.initFingerprint || sourceMessageId).trim() || buildOccurrenceSourceId(context.chatInstanceId, sourceMessageId);

    return {
        memoryScopeId: context.memoryScopeId,
        chatInstanceId: context.chatInstanceId,
        sourceRelativePath: String(context.sourceRelativePath || '').trim() || null,
        sourceMessageId,
        sourceRevisionHash,
        sourceTimestamp: String(context.message?.send_date || '').trim() || null,
        speakerEntityId,
        speakerRole: deriveSpeakerRole(context.message),
        sourceOccurrenceId: buildOccurrenceSourceId(context.chatInstanceId, sourceMessageId),
        evidenceLineageId: buildEvidenceLineageId(context.memoryScopeId, lineAnchor),
        normalizedText,
        claimSpan: {
            mode: 'whole_message',
            offsetUnit: 'unicode_code_point',
            startOffset: 0,
            endOffset: countCodePoints(normalizedText),
        },
    };
}

function buildMentionDetection(context, zoneClass) {
    const base = createBaseDetection(context);
    return {
        ...base,
        claimId: buildClaimIdV1({
            memoryScopeId: base.memoryScopeId,
            sourceRelativePath: base.sourceRelativePath,
            sourceOccurrenceId: base.sourceOccurrenceId,
            sourceMessageId: base.sourceMessageId,
            claimSpan: base.claimSpan,
            claimClass: null,
            claimState: null,
            extractionRuleId: `mention-zone:${zoneClass.toLowerCase()}`,
            extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
            normalizedClaimPayload: {
                zoneClass,
                text: base.normalizedText,
            },
        }),
        claimIdVersion: ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION,
        claimClass: null,
        claimState: null,
        authorityClass: TIER2_AUTHORITY_CLASS.UNKNOWN_AUTHORITY,
        authorityBasis: 'not_asserted',
        jurisdictionScope: 'not_asserted',
        claimZoneClass: zoneClass,
        extractionMode: TIER2_EXTRACTION_MODE.DETERMINISTIC,
        extractionRuleId: `mention-zone:${zoneClass.toLowerCase()}`,
        extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
        normalizationVersion: ARCHITECTURAL_DIALOGUE_NORMALIZATION_VERSION,
        confidenceClass: TIER2_CONFIDENCE_CLASS.NON_ADMITTED_MENTION,
        admissionStatus: 'review_only',
        admissionReason: 'mentioned_content_excluded',
        reviewKind: TIER2_REVIEW_KIND.NON_ADMITTED_MENTION,
        relatedRecordIds: [],
        normalizedClaimPayload: {
            zoneClass,
            text: base.normalizedText,
        },
        claimTextExcerpt: base.normalizedText.slice(0, 240),
    };
}

function buildContextDependentDetection(context) {
    const base = createBaseDetection(context);
    return {
        ...base,
        claimId: buildClaimIdV1({
            memoryScopeId: base.memoryScopeId,
            sourceRelativePath: base.sourceRelativePath,
            sourceOccurrenceId: base.sourceOccurrenceId,
            sourceMessageId: base.sourceMessageId,
            claimSpan: base.claimSpan,
            claimClass: null,
            claimState: null,
            extractionRuleId: 'context-dependent-v1',
            extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
            normalizedClaimPayload: {
                text: base.normalizedText,
            },
        }),
        claimIdVersion: ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION,
        claimClass: null,
        claimState: null,
        authorityClass: TIER2_AUTHORITY_CLASS.UNKNOWN_AUTHORITY,
        authorityBasis: 'context_dependent',
        jurisdictionScope: 'context_dependent',
        claimZoneClass: TIER2_CLAIM_ZONE_CLASS.ASSERTED_BODY,
        extractionMode: TIER2_EXTRACTION_MODE.DETERMINISTIC,
        extractionRuleId: 'context-dependent-v1',
        extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
        normalizationVersion: ARCHITECTURAL_DIALOGUE_NORMALIZATION_VERSION,
        confidenceClass: TIER2_CONFIDENCE_CLASS.CONTEXT_DEPENDENT,
        admissionStatus: 'review_only',
        admissionReason: 'context_dependent_candidate',
        reviewKind: TIER2_REVIEW_KIND.CONTEXT_DEPENDENT_CANDIDATE,
        relatedRecordIds: [],
        normalizedClaimPayload: {
            text: base.normalizedText,
        },
        claimTextExcerpt: base.normalizedText.slice(0, 240),
    };
}

function buildExplicitDetection(context, rule, ruleMatch, assertedBody) {
    const base = createBaseDetection(context);
    const authorityInfo = deriveAuthorityClass(context.message, ruleMatch.claimClass, assertedBody);
    const claimState = deriveClaimState(authorityInfo, ruleMatch.explicitLifecycleState);
    const normalizedClaimPayload = {
        ...ruleMatch.normalizedClaimPayload,
    };

    const claimId = buildClaimIdV1({
        memoryScopeId: base.memoryScopeId,
        sourceRelativePath: base.sourceRelativePath,
        sourceOccurrenceId: base.sourceOccurrenceId,
        sourceMessageId: base.sourceMessageId,
        claimSpan: base.claimSpan,
        claimClass: ruleMatch.claimClass,
        claimState,
        extractionRuleId: rule.id,
        extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
        normalizedClaimPayload,
    });

    return {
        ...base,
        claimId,
        claimIdVersion: ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION,
        claimClass: ruleMatch.claimClass,
        claimState,
        authorityClass: authorityInfo.authorityClass,
        authorityBasis: authorityInfo.authorityBasis,
        jurisdictionScope: authorityInfo.jurisdictionScope,
        claimZoneClass: TIER2_CLAIM_ZONE_CLASS.ASSERTED_BODY,
        extractionMode: TIER2_EXTRACTION_MODE.DETERMINISTIC,
        extractionRuleId: rule.id,
        extractionRuleVersion: ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION,
        normalizationVersion: ARCHITECTURAL_DIALOGUE_NORMALIZATION_VERSION,
        confidenceClass: TIER2_CONFIDENCE_CLASS.EXPLICIT_DETERMINISTIC,
        admissionStatus: 'admitted',
        admissionReason: 'explicit_deterministic_claim',
        reviewKind: null,
        relatedRecordIds: [],
        normalizedClaimPayload,
        claimTextExcerpt: assertedBody.slice(0, 240),
    };
}

export function extractArchitecturalDialogueClaims(messageContext) {
    const normalizedText = normalizeClaimMessageText(messageContext?.message?.mes || '');
    if (!normalizedText || messageContext?.message?.is_system === true) {
        return [];
    }

    const pureMentionZone = detectPureMentionZone(normalizedText);
    if (pureMentionZone) {
        return [buildMentionDetection(messageContext, pureMentionZone)];
    }

    const assertedBody = stripExcludedZones(normalizedText);
    if (!assertedBody) {
        return [buildMentionDetection(messageContext, TIER2_CLAIM_ZONE_CLASS.MENTION_CODE)];
    }

    if (detectContextDependent(assertedBody)) {
        return [buildContextDependentDetection(messageContext)];
    }

    for (const rule of EXPLICIT_RULES) {
        const match = rule.match(assertedBody);
        if (!match) continue;
        return [buildExplicitDetection(messageContext, rule, match, assertedBody)];
    }

    return [];
}

export function isTier2ClaimAdmitted(claim) {
    return String(claim?.admissionStatus || '') === 'admitted';
}

export function buildClaimOccurrenceKey(claim) {
    return stableStringify([
        claim?.chatInstanceId || '',
        claim?.sourceMessageId || '',
        claim?.claimId || '',
    ]);
}

export function buildTier2ClaimReviewItem(claim, reviewKind, severity = 'warning', details = {}) {
    return {
        reviewItemId: buildReviewItemId(reviewKind, {
            claimId: claim?.claimId || null,
            details,
        }),
        claimId: claim?.claimId || null,
        reviewKind,
        severity,
        details,
    };
}

export {
    TIER2_AUTHORITY_CLASS,
    TIER2_CLAIM_CLASS,
    TIER2_CLAIM_RELATIONSHIP,
    TIER2_CLAIM_STATE,
    TIER2_CLAIM_ZONE_CLASS,
    TIER2_CONFIDENCE_CLASS,
    TIER2_EXTRACTION_MODE,
    TIER2_RECONCILIATION_BASIS,
    TIER2_REVIEW_KIND,
};
