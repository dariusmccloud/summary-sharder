import fs from 'node:fs';
import crypto from 'node:crypto';

import {
    cloneJson,
    createError,
    createId,
    getAuthenticatedUserRoot,
    getStoragePaths,
    nowTimestamp,
    openOperationalDatabase,
    sanitizeIdentifier,
    snapshotOperationalDatabase,
    stableStringify,
} from './core.js';

function hashCanonical(value) {
    const content = stableStringify(value);
    const hash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
    return {
        canonical: content,
        hash,
    };
}

const ALLOWED_INTERPRETATION_TYPES = new Set([
    'ROLE_EVOLUTION',
    'PROJECT_TRANSFORMATION',
    'RELATIONAL_PROGRESSION',
    'THEMATIC_CONTINUITY',
    'PHASE_MEANING',
]);

const ALLOWED_ASSERTION_DOMAINS = new Set([
    'ROLE',
    'AUTHORITY',
    'RELATIONSHIP',
    'IDENTITY',
    'PERSONAL_HISTORY',
    'SENSITIVE_MEANING',
    'PROJECT_BEHAVIOR',
    'THEMATIC_MEANING',
]);

const ALLOWED_REVIEW_DISPOSITIONS = new Set([
    'APPROVE',
    'APPROVE_WITH_EDIT',
    'REJECT',
    'CONTEST',
    'DEFER',
    'APPROVE_FOR_SCOPE_ONLY',
]);

const ALLOWED_SUBJECT_DISPOSITION_STATES = new Set([
    'GRANTED',
    'DENIED',
    'DEFERRED',
    'CONTESTED',
]);

const ALLOWED_SYNTHESIS_RUN_STATUSES = new Set([
    'READY_FOR_SYNTHESIS',
    'REFUSED',
    'COMPLETED_ADMITTED',
    'COMPLETED_QUARANTINED',
]);

const ALLOWED_SYNTHESIS_PROPOSAL_STATUSES = new Set([
    'EMITTED',
    'ADMITTED',
    'QUARANTINED',
]);

const ALLOWED_REFERENTIAL_STATUSES = new Set([
    'VALID',
    'STALE_REVISION',
    'MISSING_BASIS',
    'OUT_OF_SCOPE',
    'IDENTITY_UNRESOLVED',
    'MALFORMED_REFERENCE',
    'SOURCE_MANIFEST_DRIFT',
]);

const ALLOWED_SYNTHESIS_SOURCE_CLASSES = new Set([
    'STRUCTURAL_RECORD',
    'SOURCE_OCCURRENCE',
]);

const POLICY_DEFINITIONS = Object.freeze([
    Object.freeze({
        validationPolicyId: 'shared-role-memory',
        policyVersion: 1,
        requiredGroundingOutcome: 'STRONGLY_SUPPORTED',
        requiredReviewers: ['MEMORY_SUBJECT', 'RELATIONAL_PARTICIPANT'],
        finalDispositionAuthority: 'MEMORY_SUBJECT',
        autoApprovalAllowed: false,
        onDisagreement: 'PRESERVE_BOTH_PERSPECTIVES',
        details: {
            policyClass: 'shared-role-memory-v1',
            description: 'Shared relationship or authority interpretation requiring subject and participant review.',
        },
    }),
    Object.freeze({
        validationPolicyId: 'subject-meaning-memory',
        policyVersion: 1,
        requiredGroundingOutcome: 'SUPPORTED',
        requiredReviewers: ['MEMORY_SUBJECT'],
        finalDispositionAuthority: 'MEMORY_SUBJECT',
        autoApprovalAllowed: false,
        onDisagreement: 'BLOCK_PUBLICATION',
        details: {
            policyClass: 'subject-meaning-memory-v1',
            description: 'Subject-centered interpretive meaning requiring direct subject disposition.',
        },
    }),
]);

function getPolicyDefinition(validationPolicyId, policyVersion) {
    return POLICY_DEFINITIONS.find((entry) => (
        entry.validationPolicyId === validationPolicyId
        && Number(entry.policyVersion) === Number(policyVersion)
    )) || null;
}

export function seedInterpretivePolicyDefinitions(adapter) {
    for (const definition of POLICY_DEFINITIONS) {
        const policyHash = hashCanonical({
            validationPolicyId: definition.validationPolicyId,
            policyVersion: definition.policyVersion,
            requiredGroundingOutcome: definition.requiredGroundingOutcome,
            requiredReviewers: definition.requiredReviewers,
            finalDispositionAuthority: definition.finalDispositionAuthority,
            autoApprovalAllowed: definition.autoApprovalAllowed,
            onDisagreement: definition.onDisagreement,
            details: definition.details,
        }).hash;
        adapter.run(
            `INSERT OR REPLACE INTO interpretation_policy_definitions (
                validation_policy_id, policy_version, policy_hash, required_grounding_outcome,
                required_reviewers_json, final_disposition_authority, auto_approval_allowed,
                on_disagreement, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                definition.validationPolicyId,
                Number(definition.policyVersion),
                policyHash,
                definition.requiredGroundingOutcome,
                stableStringify(definition.requiredReviewers),
                definition.finalDispositionAuthority,
                definition.autoApprovalAllowed ? 1 : 0,
                definition.onDisagreement,
                stableStringify(definition.details),
            ],
        );
    }
}

function normalizeStringArray(value, fieldName, allowedValues = null) {
    if (!Array.isArray(value)) {
        throw createError(400, `${fieldName} must be an array`, 'ARCH_INVALID_PAYLOAD');
    }
    const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (normalized.length === 0) {
        throw createError(400, `${fieldName} must not be empty`, 'ARCH_INVALID_PAYLOAD');
    }
    if (allowedValues) {
        for (const entry of normalized) {
            if (!allowedValues.has(entry)) {
                throw createError(400, `${fieldName} contains unsupported value ${entry}`, 'ARCH_INVALID_PAYLOAD');
            }
        }
    }
    return Array.from(new Set(normalized)).sort();
}

function normalizeStringArrayAllowEmpty(value, fieldName, allowedValues = null) {
    if (!Array.isArray(value)) {
        throw createError(400, `${fieldName} must be an array`, 'ARCH_INVALID_PAYLOAD');
    }
    const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (allowedValues) {
        for (const entry of normalized) {
            if (!allowedValues.has(entry)) {
                throw createError(400, `${fieldName} contains unsupported value ${entry}`, 'ARCH_INVALID_PAYLOAD');
            }
        }
    }
    return Array.from(new Set(normalized)).sort();
}

function normalizeReasonCodes(value, fieldName = 'reasonCodes') {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw createError(400, `${fieldName} must be an array`, 'ARCH_INVALID_PAYLOAD');
    }
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
            .map((entry) => {
                if (!/^[A-Z0-9_:-]+$/u.test(entry)) {
                    throw createError(400, `${fieldName} contains invalid code ${entry}`, 'ARCH_INVALID_PAYLOAD');
                }
                return entry;
            }),
    )).sort();
}

function normalizeOptionalCommentary(value, fieldName = 'commentary') {
    if (value === undefined || value === null) {
        return null;
    }
    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }
    if (normalized.length > 4000) {
        throw createError(400, `${fieldName} is too long`, 'ARCH_INVALID_PAYLOAD');
    }
    return normalized;
}

function normalizeBoolean(value, fieldName) {
    if (typeof value !== 'boolean') {
        throw createError(400, `${fieldName} must be a boolean`, 'ARCH_INVALID_PAYLOAD');
    }
    return value;
}

function normalizePositiveInteger(value, fieldName, minimum = 1, maximum = 1000) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
        throw createError(400, `${fieldName} is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    return normalized;
}

function normalizeOptionalPlainObject(value, fieldName) {
    if (value === undefined || value === null) {
        return {};
    }
    if (Array.isArray(value) || typeof value !== 'object') {
        throw createError(400, `${fieldName} must be an object`, 'ARCH_INVALID_PAYLOAD');
    }
    return cloneJson(value);
}

function normalizeGroundingLink(link, index) {
    const basisType = String(link?.basisType || '').trim();
    if (!['STRUCTURAL_RECORD', 'SOURCE_OCCURRENCE'].includes(basisType)) {
        throw createError(400, `groundingLinks[${index}].basisType is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    const groundingRole = String(link?.groundingRole || '').trim();
    if (!['PRIMARY', 'SUPPORTING', 'COUNTEREVIDENCE'].includes(groundingRole)) {
        throw createError(400, `groundingLinks[${index}].groundingRole is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    const groundingAssessment = String(link?.groundingAssessment || '').trim();
    if (!['SUPPORTS', 'PARTIALLY_SUPPORTS', 'CONTRADICTS', 'NEUTRAL', 'INVALID'].includes(groundingAssessment)) {
        throw createError(400, `groundingLinks[${index}].groundingAssessment is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    const speakerEntityId = sanitizeIdentifier(link?.speakerEntityId, `groundingLinks[${index}].speakerEntityId`);
    if (basisType === 'STRUCTURAL_RECORD') {
        const basisRecordId = sanitizeIdentifier(link?.basisRecordId, `groundingLinks[${index}].basisRecordId`);
        const basisRecordVersion = Number(link?.basisRecordVersion);
        if (!Number.isInteger(basisRecordVersion) || basisRecordVersion < 1) {
            throw createError(400, `groundingLinks[${index}].basisRecordVersion is invalid`, 'ARCH_INVALID_PAYLOAD');
        }
        const basisRecordHash = String(link?.basisRecordHash || '').trim();
        if (!basisRecordHash.startsWith('sha256:')) {
            throw createError(400, `groundingLinks[${index}].basisRecordHash is invalid`, 'ARCH_INVALID_PAYLOAD');
        }
        if (link?.chatInstanceId || link?.messageId || link?.messageRevisionHash) {
            throw createError(400, `groundingLinks[${index}] mixes structural and occurrence identity`, 'ARCH_INVALID_PAYLOAD');
        }
        return {
            groundingLinkId: createId('grounding'),
            basisType,
            basisRecordId,
            basisRecordVersion,
            basisRecordHash,
            chatInstanceId: null,
            messageId: null,
            messageRevisionHash: null,
            speakerEntityId,
            groundingRole,
            groundingAssessment,
            details: cloneJson(link?.details || {}),
        };
    }

    const chatInstanceId = sanitizeIdentifier(link?.chatInstanceId, `groundingLinks[${index}].chatInstanceId`);
    const messageId = sanitizeIdentifier(link?.messageId, `groundingLinks[${index}].messageId`);
    const messageRevisionHash = String(link?.messageRevisionHash || '').trim();
    if (!messageRevisionHash.startsWith('sha256:')) {
        throw createError(400, `groundingLinks[${index}].messageRevisionHash is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    if (link?.basisRecordId || link?.basisRecordVersion || link?.basisRecordHash) {
        throw createError(400, `groundingLinks[${index}] mixes occurrence and structural identity`, 'ARCH_INVALID_PAYLOAD');
    }
    return {
        groundingLinkId: createId('grounding'),
        basisType,
        basisRecordId: null,
        basisRecordVersion: null,
        basisRecordHash: null,
        chatInstanceId,
        messageId,
        messageRevisionHash,
        speakerEntityId,
        groundingRole,
        groundingAssessment,
        details: cloneJson(link?.details || {}),
    };
}

function deriveGroundingOutcome(groundingLinks) {
    const assessments = groundingLinks.map((entry) => entry.groundingAssessment);
    if (assessments.includes('INVALID')) {
        return 'INVALIDATED_SOURCE_MUTATION';
    }
    if (assessments.includes('CONTRADICTS')) {
        return 'CONTRARY_EVIDENCE_PRESENT';
    }
    if (assessments.includes('PARTIALLY_SUPPORTS')) {
        return 'PARTIALLY_SUPPORTED';
    }
    if (assessments.every((entry) => entry === 'NEUTRAL')) {
        return 'BASIS_INCOMPLETE';
    }
    const hasPrimary = groundingLinks.some((entry) => entry.groundingRole === 'PRIMARY');
    const allSupport = assessments.every((entry) => entry === 'SUPPORTS');
    if (allSupport && hasPrimary) {
        return 'STRONGLY_SUPPORTED';
    }
    if (assessments.includes('SUPPORTS')) {
        return 'SUPPORTED';
    }
    return 'UNSUPPORTED';
}

function normalizeSynthesisSourceEntry(entry, index, memoryScopeId) {
    const sourceClass = String(entry?.sourceClass || '').trim();
    if (!ALLOWED_SYNTHESIS_SOURCE_CLASSES.has(sourceClass)) {
        throw createError(400, `sourceManifestEntries[${index}].sourceClass is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    const entryMemoryScopeId = sanitizeIdentifier(
        entry?.memoryScopeId || memoryScopeId,
        `sourceManifestEntries[${index}].memoryScopeId`,
    );
    if (entryMemoryScopeId !== memoryScopeId) {
        throw createError(400, `sourceManifestEntries[${index}] escaped the requested memory scope`, 'ARCH_INVALID_PAYLOAD');
    }
    const speakerEntityId = sanitizeIdentifier(
        entry?.speakerEntityId || 'system:unknown',
        `sourceManifestEntries[${index}].speakerEntityId`,
    );
    if (sourceClass === 'STRUCTURAL_RECORD') {
        const basisRecordId = sanitizeIdentifier(entry?.basisRecordId, `sourceManifestEntries[${index}].basisRecordId`);
        const basisRecordVersion = normalizePositiveInteger(
            entry?.basisRecordVersion,
            `sourceManifestEntries[${index}].basisRecordVersion`,
            1,
            1_000_000,
        );
        const basisRecordHash = String(entry?.basisRecordHash || '').trim();
        if (!basisRecordHash.startsWith('sha256:')) {
            throw createError(400, `sourceManifestEntries[${index}].basisRecordHash is invalid`, 'ARCH_INVALID_PAYLOAD');
        }
        return {
            sourceClass,
            memoryScopeId: entryMemoryScopeId,
            speakerEntityId,
            basisRecordId,
            basisRecordVersion,
            basisRecordHash,
            chatInstanceId: null,
            messageId: null,
            messageRevisionHash: null,
        };
    }
    const chatInstanceId = sanitizeIdentifier(entry?.chatInstanceId, `sourceManifestEntries[${index}].chatInstanceId`);
    const messageId = sanitizeIdentifier(entry?.messageId, `sourceManifestEntries[${index}].messageId`);
    const messageRevisionHash = String(entry?.messageRevisionHash || '').trim();
    if (!messageRevisionHash.startsWith('sha256:')) {
        throw createError(400, `sourceManifestEntries[${index}].messageRevisionHash is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    return {
        sourceClass,
        memoryScopeId: entryMemoryScopeId,
        speakerEntityId,
        basisRecordId: null,
        basisRecordVersion: null,
        basisRecordHash: null,
        chatInstanceId,
        messageId,
        messageRevisionHash,
    };
}

function buildSynthesisPolicyRecord(payload, timestamp) {
    const synthesisPolicyId = sanitizeIdentifier(
        payload?.synthesisPolicyId || createId('synthpolicy'),
        'synthesisPolicyId',
    );
    const policyVersion = normalizePositiveInteger(payload?.policyVersion, 'policyVersion', 1, 1_000_000);
    const memorySubjectId = sanitizeIdentifier(payload?.memorySubjectId, 'memorySubjectId');
    const enabled = normalizeBoolean(payload?.enabled, 'enabled');
    const allowedTypes = normalizeStringArray(payload?.allowedTypes, 'allowedTypes', ALLOWED_INTERPRETATION_TYPES);
    const allowedAssertionDomains = normalizeStringArray(
        payload?.allowedAssertionDomains,
        'allowedAssertionDomains',
        ALLOWED_ASSERTION_DOMAINS,
    );
    const prohibitedDomains = payload?.prohibitedDomains === undefined
        ? []
        : normalizeStringArrayAllowEmpty(payload?.prohibitedDomains, 'prohibitedDomains', ALLOWED_ASSERTION_DOMAINS);
    const manualTriggerRequiredForHighRisk = normalizeBoolean(
        payload?.manualTriggerRequiredForHighRisk,
        'manualTriggerRequiredForHighRisk',
    );
    const maxCandidatesPerRun = normalizePositiveInteger(payload?.maxCandidatesPerRun, 'maxCandidatesPerRun', 1, 100);
    const details = normalizeOptionalPlainObject(payload?.details, 'details');
    const policyHash = hashCanonical({
        synthesisPolicyId,
        policyVersion,
        memorySubjectId,
        enabled,
        allowedTypes,
        allowedAssertionDomains,
        prohibitedDomains,
        manualTriggerRequiredForHighRisk,
        maxCandidatesPerRun,
        details,
    }).hash;
    return {
        synthesisPolicyId,
        policyVersion,
        memorySubjectId,
        enabled,
        allowedTypes,
        allowedAssertionDomains,
        prohibitedDomains,
        manualTriggerRequiredForHighRisk,
        maxCandidatesPerRun,
        policyHash,
        details,
        createdAt: timestamp,
    };
}

function deriveSynthesisRisk(requestedAssertionDomains, sharedRelationshipRequested, personalMeaningRequested) {
    const reasons = new Set();
    for (const domain of requestedAssertionDomains) {
        if (['ROLE', 'AUTHORITY', 'RELATIONSHIP', 'IDENTITY', 'PERSONAL_HISTORY', 'SENSITIVE_MEANING'].includes(domain)) {
            reasons.add(domain);
        }
    }
    if (sharedRelationshipRequested) {
        reasons.add('RELATIONSHIP');
    }
    if (personalMeaningRequested) {
        reasons.add('SENSITIVE_MEANING');
    }
    const riskReasons = Array.from(reasons).sort();
    return {
        highRisk: riskReasons.length > 0 || sharedRelationshipRequested || personalMeaningRequested,
        riskReasons,
    };
}

function buildFrozenSynthesisManifest(payload, timestamp) {
    const memoryScopeId = sanitizeIdentifier(payload?.memoryScopeId, 'memoryScopeId');
    const memorySubjectId = sanitizeIdentifier(payload?.memorySubjectId, 'memorySubjectId');
    const createdByEntityId = sanitizeIdentifier(payload?.createdByEntityId, 'createdByEntityId');
    const synthesisPolicyId = sanitizeIdentifier(payload?.synthesisPolicyId, 'synthesisPolicyId');
    const policyVersion = payload?.policyVersion === undefined || payload?.policyVersion === null
        ? null
        : normalizePositiveInteger(payload?.policyVersion, 'policyVersion', 1, 1_000_000);
    const requestedInterpretationTypes = normalizeStringArray(
        payload?.requestedInterpretationTypes,
        'requestedInterpretationTypes',
        ALLOWED_INTERPRETATION_TYPES,
    );
    const requestedAssertionDomains = normalizeStringArray(
        payload?.requestedAssertionDomains,
        'requestedAssertionDomains',
        ALLOWED_ASSERTION_DOMAINS,
    );
    const sharedRelationshipRequested = payload?.sharedRelationshipRequested === true;
    const personalMeaningRequested = payload?.personalMeaningRequested === true;
    const manualTriggerAcknowledged = payload?.manualTriggerAcknowledged === true;
    const maxCandidatesRequested = normalizePositiveInteger(
        payload?.maxCandidatesRequested,
        'maxCandidatesRequested',
        1,
        100,
    );
    if (!Array.isArray(payload?.sourceManifestEntries) || payload.sourceManifestEntries.length === 0) {
        throw createError(400, 'sourceManifestEntries must not be empty', 'ARCH_INVALID_PAYLOAD');
    }
    const sourceManifestEntries = payload.sourceManifestEntries
        .map((entry, index) => normalizeSynthesisSourceEntry(entry, index, memoryScopeId))
        .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
    const manifestCanonical = {
        memoryScopeId,
        memorySubjectId,
        requestedInterpretationTypes,
        requestedAssertionDomains,
        sharedRelationshipRequested,
        personalMeaningRequested,
        sourceManifestEntries,
    };
    const sourceManifestId = sanitizeIdentifier(payload?.sourceManifestId || createId('synthmanifest'), 'sourceManifestId');
    const sourceManifestHash = hashCanonical(manifestCanonical).hash;
    return {
        synthesisRunId: sanitizeIdentifier(payload?.synthesisRunId || createId('synthrun'), 'synthesisRunId'),
        memoryScopeId,
        memorySubjectId,
        synthesisPolicyId,
        policyVersion,
        requestedInterpretationTypes,
        requestedAssertionDomains,
        sharedRelationshipRequested,
        personalMeaningRequested,
        manualTriggerAcknowledged,
        maxCandidatesRequested,
        sourceManifestId,
        sourceManifestHash,
        sourceManifestEntries,
        sourceManifestCanonical: manifestCanonical,
        modelProviderId: payload?.modelProviderId ? String(payload.modelProviderId).trim() : null,
        promptVersion: payload?.promptVersion ? String(payload.promptVersion).trim() : null,
        promptHash: payload?.promptHash ? String(payload.promptHash).trim() : null,
        generationConfigHash: payload?.generationConfigHash ? String(payload.generationConfigHash).trim() : null,
        createdByEntityId,
        createdAt: timestamp,
        risk: deriveSynthesisRisk(requestedAssertionDomains, sharedRelationshipRequested, personalMeaningRequested),
    };
}

export function resolveInterpretiveRisk(candidateInput) {
    const reasons = new Set();
    for (const domain of candidateInput.assertionDomains) {
        if (domain === 'ROLE') reasons.add('ROLE');
        if (domain === 'AUTHORITY') reasons.add('AUTHORITY');
        if (domain === 'RELATIONSHIP') reasons.add('RELATIONSHIP');
        if (domain === 'IDENTITY') reasons.add('IDENTITY');
        if (domain === 'PERSONAL_HISTORY') reasons.add('PERSONAL_HISTORY');
        if (domain === 'SENSITIVE_MEANING') reasons.add('SENSITIVE_MEANING');
    }
    if (candidateInput.personalMeaningAsserted && !reasons.has('SENSITIVE_MEANING')) {
        reasons.add('SENSITIVE_MEANING');
    }
    const riskReasons = Array.from(reasons).sort();
    let riskClass = 'LOW';
    if (riskReasons.length > 0 || candidateInput.sharedRelationshipAsserted || candidateInput.personalMeaningAsserted) {
        riskClass = 'HIGH';
    } else if (candidateInput.type === 'PROJECT_TRANSFORMATION' || candidateInput.type === 'THEMATIC_CONTINUITY' || candidateInput.type === 'PHASE_MEANING') {
        riskClass = 'MEDIUM';
    }
    const resolutionInputHash = hashCanonical({
        type: candidateInput.type,
        assertionDomains: candidateInput.assertionDomains,
        sharedRelationshipAsserted: candidateInput.sharedRelationshipAsserted,
        personalMeaningAsserted: candidateInput.personalMeaningAsserted,
        materialParticipantEntityIds: candidateInput.materialParticipantEntityIds,
        memorySubjectId: candidateInput.memorySubjectId,
    }).hash;
    return {
        riskClass,
        riskReasons,
        resolutionInputHash,
    };
}

export function resolveInterpretivePolicy(candidateInput, risk) {
    const matchedRuleIds = [];
    let definition = null;
    if (candidateInput.sharedRelationshipAsserted || candidateInput.assertionDomains.includes('RELATIONSHIP')) {
        matchedRuleIds.push('shared-relationship');
    }
    if (risk.riskClass === 'HIGH' && candidateInput.assertionDomains.includes('AUTHORITY')) {
        matchedRuleIds.push('risk-high-authority');
    }
    if (matchedRuleIds.includes('shared-relationship') || matchedRuleIds.includes('risk-high-authority')) {
        definition = getPolicyDefinition('shared-role-memory', 1);
    } else {
        matchedRuleIds.push('subject-centered-default');
        definition = getPolicyDefinition('subject-meaning-memory', 1);
    }
    const resolutionInputHash = hashCanonical({
        candidateType: candidateInput.type,
        memorySubjectId: candidateInput.memorySubjectId,
        assertionDomains: candidateInput.assertionDomains,
        sharedRelationshipAsserted: candidateInput.sharedRelationshipAsserted,
        personalMeaningAsserted: candidateInput.personalMeaningAsserted,
        materialParticipantEntityIds: candidateInput.materialParticipantEntityIds,
        riskClass: risk.riskClass,
        riskReasons: risk.riskReasons,
    }).hash;
    const policyHash = hashCanonical({
        validationPolicyId: definition.validationPolicyId,
        policyVersion: definition.policyVersion,
        requiredGroundingOutcome: definition.requiredGroundingOutcome,
        requiredReviewers: definition.requiredReviewers,
        finalDispositionAuthority: definition.finalDispositionAuthority,
        autoApprovalAllowed: definition.autoApprovalAllowed,
        onDisagreement: definition.onDisagreement,
        details: definition.details,
    }).hash;
    return {
        validationPolicyId: definition.validationPolicyId,
        policyVersion: definition.policyVersion,
        policyHash,
        matchedRuleIds: matchedRuleIds.sort(),
        resolutionInputHash,
        requiredGroundingOutcome: definition.requiredGroundingOutcome,
        requiredReviewers: definition.requiredReviewers,
        finalDispositionAuthority: definition.finalDispositionAuthority,
        autoApprovalAllowed: definition.autoApprovalAllowed,
        onDisagreement: definition.onDisagreement,
    };
}

export function resolveReviewObligations(candidateInput, policy, timestamp) {
    const obligations = [];
    for (const reviewerRole of policy.requiredReviewers) {
        let reviewerEntityId = null;
        let obligationState = 'READY_TO_REQUEST';
        let blockingReason = 'NONE';
        if (reviewerRole === 'MEMORY_SUBJECT') {
            reviewerEntityId = candidateInput.memorySubjectId;
        } else if (reviewerRole === 'RELATIONAL_PARTICIPANT') {
            const participants = candidateInput.materialParticipantEntityIds
                .filter((entry) => entry !== candidateInput.memorySubjectId);
            if (participants.length === 1) {
                reviewerEntityId = participants[0];
            } else {
                obligationState = 'BLOCKED';
                blockingReason = 'REVIEWER_IDENTITY_UNRESOLVED';
            }
        } else if (reviewerRole === 'SYSTEM_GROUNDING') {
            reviewerEntityId = 'system:grounding';
        } else if (reviewerRole === 'PROJECT_AUTHORITY') {
            obligationState = 'BLOCKED';
            blockingReason = 'REVIEWER_IDENTITY_UNRESOLVED';
        }
        obligations.push({
            reviewObligationId: createId('reviewobl'),
            reviewerRole,
            reviewerEntityId,
            obligationState,
            blockingReason,
            createdAt: timestamp,
        });
    }
    return obligations;
}

function buildReviewRequests(obligations, interpretationRevisionId, reviewEnvelopeHash, timestamp) {
    return obligations
        .filter((entry) => entry.obligationState === 'READY_TO_REQUEST' && entry.reviewerEntityId)
        .map((entry) => ({
            reviewRequestId: createId('reviewreq'),
            reviewObligationId: entry.reviewObligationId,
            interpretationRevisionId,
            reviewerRole: entry.reviewerRole,
            reviewerEntityId: entry.reviewerEntityId,
            status: 'PENDING',
            reviewEnvelopeHash,
            createdAt: timestamp,
        }));
}

function normalizeGroundingLinksForEnvelopeHash(groundingLinks) {
    return groundingLinks
        .map((entry) => ({
            basisType: entry.basisType,
            basisRecordId: entry.basisRecordId,
            basisRecordVersion: entry.basisRecordVersion,
            basisRecordHash: entry.basisRecordHash,
            chatInstanceId: entry.chatInstanceId,
            messageId: entry.messageId,
            messageRevisionHash: entry.messageRevisionHash,
            speakerEntityId: entry.speakerEntityId,
            groundingRole: entry.groundingRole,
            groundingAssessment: entry.groundingAssessment,
        }))
        .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function normalizeObligationsForEnvelopeHash(obligations) {
    return obligations
        .map((entry) => ({
            reviewerRole: entry.reviewerRole,
            reviewerEntityId: entry.reviewerEntityId,
            obligationState: entry.obligationState,
            blockingReason: entry.blockingReason,
        }))
        .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function buildReviewEnvelopeHash(proposalContentHash, groundingLinks, groundingOutcome, risk, policy, obligations) {
    return hashCanonical({
        proposalContentHash,
        groundingLinks: normalizeGroundingLinksForEnvelopeHash(groundingLinks),
        groundingOutcome,
        riskClass: risk.riskClass,
        riskReasons: risk.riskReasons,
        validationPolicyId: policy.validationPolicyId,
        policyVersion: policy.policyVersion,
        policyHash: policy.policyHash,
        reviewObligations: normalizeObligationsForEnvelopeHash(obligations),
    }).hash;
}

function buildGroundingEnvelopeHash(proposalContentHash, sourceManifestHash, groundingLinks, evaluationProtocolVersion, evaluatorConfigHash) {
    return hashCanonical({
        proposalContentHash,
        sourceManifestHash,
        groundingLinks: normalizeGroundingLinksForEnvelopeHash(groundingLinks),
        evaluationProtocolVersion,
        evaluatorConfigHash,
    }).hash;
}

function deriveLifecycleStates(groundingOutcome, obligations) {
    const groundingState = ['INVALIDATED_SOURCE_MUTATION', 'UNSUPPORTED'].includes(groundingOutcome)
        ? 'FAILED'
        : 'COMPLETE';
    const blocked = obligations.some((entry) => entry.obligationState === 'BLOCKED');
    const ready = obligations.some((entry) => entry.obligationState === 'READY_TO_REQUEST');
    return {
        candidateState: groundingState === 'COMPLETE' ? 'SEALED_FOR_REVIEW' : 'SEALED_FOR_GROUNDING',
        groundingState,
        reviewState: blocked ? 'BLOCKED' : ready ? 'PENDING' : 'NOT_ROUTED',
        subjectDispositionState: 'PENDING',
        publicationState: 'NOT_PUBLISHED',
        authorityEffect: 'DESCRIPTIVE_ONLY',
    };
}

export function prepareInterpretiveCandidate(payload, timestamp = nowTimestamp(payload?.now)) {
    const interpretationId = sanitizeIdentifier(payload?.interpretationId || createId('interp'), 'interpretationId');
    const interpretationRevisionId = sanitizeIdentifier(payload?.interpretationRevisionId || createId('interprev'), 'interpretationRevisionId');
    const parentRevisionId = payload?.parentRevisionId
        ? sanitizeIdentifier(payload.parentRevisionId, 'parentRevisionId')
        : null;
    const createdFromDispositionId = payload?.createdFromDispositionId
        ? sanitizeIdentifier(payload.createdFromDispositionId, 'createdFromDispositionId')
        : null;
    const revisionReason = String(payload?.revisionReason || 'INITIAL_PROPOSAL').trim();
    if (!['INITIAL_PROPOSAL', 'SUBJECT_EDIT', 'REVIEW_REQUESTED_REVISION'].includes(revisionReason)) {
        throw createError(400, 'revisionReason is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const memoryScopeId = sanitizeIdentifier(payload?.memoryScopeId, 'memoryScopeId');
    const memorySubjectId = sanitizeIdentifier(payload?.memorySubjectId, 'memorySubjectId');
    const type = String(payload?.type || '').trim();
    if (!ALLOWED_INTERPRETATION_TYPES.has(type)) {
        throw createError(400, 'type is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const statement = String(payload?.statement || '').trim();
    if (!statement) {
        throw createError(400, 'statement is required', 'ARCH_INVALID_PAYLOAD');
    }
    const assertionDomains = normalizeStringArray(payload?.assertionDomains, 'assertionDomains', ALLOWED_ASSERTION_DOMAINS);
    const sharedRelationshipAsserted = payload?.sharedRelationshipAsserted === true;
    const personalMeaningAsserted = payload?.personalMeaningAsserted === true;
    const materialParticipantEntityIds = normalizeStringArray(
        payload?.materialParticipantEntityIds || [memorySubjectId],
        'materialParticipantEntityIds',
        null,
    ).map((entry) => sanitizeIdentifier(entry, 'materialParticipantEntityId'));
    const groundingLinks = Array.isArray(payload?.groundingLinks)
        ? payload.groundingLinks.map((entry, index) => normalizeGroundingLink(entry, index))
        : [];
    if (groundingLinks.length === 0) {
        throw createError(400, 'groundingLinks must not be empty', 'ARCH_INVALID_PAYLOAD');
    }
    const proposalContentHash = hashCanonical({
        interpretationId,
        interpretationRevisionId,
        parentRevisionId,
        createdFromDispositionId,
        revisionReason,
        memoryScopeId,
        memorySubjectId,
        type,
        statement,
        assertionDomains,
        sharedRelationshipAsserted,
        personalMeaningAsserted,
        materialParticipantEntityIds,
    }).hash;
    const input = {
        interpretationId,
        interpretationRevisionId,
        parentRevisionId,
        createdFromDispositionId,
        revisionReason,
        memoryScopeId,
        memorySubjectId,
        type,
        statement,
        assertionDomains,
        sharedRelationshipAsserted,
        personalMeaningAsserted,
        materialParticipantEntityIds,
        groundingLinks,
        proposalContentHash,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const groundingOutcome = payload?.groundingOutcomeOverride
        ? String(payload.groundingOutcomeOverride).trim()
        : deriveGroundingOutcome(groundingLinks);
    const risk = resolveInterpretiveRisk(input);
    const policy = resolveInterpretivePolicy(input, risk);
    const obligations = resolveReviewObligations(input, policy, timestamp);
    const lifecycle = deriveLifecycleStates(groundingOutcome, obligations);
    const reviewEnvelopeHash = buildReviewEnvelopeHash(
        proposalContentHash,
        groundingLinks,
        groundingOutcome,
        risk,
        policy,
        obligations,
    );
    const reviewRequests = buildReviewRequests(obligations, interpretationRevisionId, reviewEnvelopeHash, timestamp);
    return {
        candidate: {
            ...input,
            ...lifecycle,
            reviewEnvelopeHash,
        },
        groundingOutcome,
        risk,
        policy,
        obligations,
        reviewRequests,
    };
}

function createLedgerEvents(prepared, timestamp) {
    const events = [];
    events.push({
        eventId: createId('iglevent'),
        eventType: 'INTERPRETATION_PROPOSED',
        occurredAt: timestamp,
        memoryScopeId: prepared.candidate.memoryScopeId,
        interpretationId: prepared.candidate.interpretationId,
        interpretationRevisionId: prepared.candidate.interpretationRevisionId,
        payload: {
            interpretationId: prepared.candidate.interpretationId,
            interpretationRevisionId: prepared.candidate.interpretationRevisionId,
            parentRevisionId: prepared.candidate.parentRevisionId,
            createdFromDispositionId: prepared.candidate.createdFromDispositionId,
            revisionReason: prepared.candidate.revisionReason,
            memorySubjectId: prepared.candidate.memorySubjectId,
            proposalContentHash: prepared.candidate.proposalContentHash,
            type: prepared.candidate.type,
            statement: prepared.candidate.statement,
            assertionDomains: prepared.candidate.assertionDomains,
            sharedRelationshipAsserted: prepared.candidate.sharedRelationshipAsserted,
            personalMeaningAsserted: prepared.candidate.personalMeaningAsserted,
            materialParticipantEntityIds: prepared.candidate.materialParticipantEntityIds,
        },
    });
    for (const link of prepared.candidate.groundingLinks) {
        events.push({
            eventId: createId('iglevent'),
            eventType: 'GROUNDING_LINK_ATTACHED',
            occurredAt: timestamp,
            memoryScopeId: prepared.candidate.memoryScopeId,
            interpretationId: prepared.candidate.interpretationId,
            interpretationRevisionId: prepared.candidate.interpretationRevisionId,
            payload: cloneJson(link),
        });
    }
    events.push({
        eventId: createId('iglevent'),
        eventType: 'GROUNDING_EVALUATED',
        occurredAt: timestamp,
        memoryScopeId: prepared.candidate.memoryScopeId,
        interpretationId: prepared.candidate.interpretationId,
        interpretationRevisionId: prepared.candidate.interpretationRevisionId,
        payload: {
            groundingOutcome: prepared.groundingOutcome,
        },
    });
    events.push({
        eventId: createId('iglevent'),
        eventType: 'RISK_CLASSIFIED',
        occurredAt: timestamp,
        memoryScopeId: prepared.candidate.memoryScopeId,
        interpretationId: prepared.candidate.interpretationId,
        interpretationRevisionId: prepared.candidate.interpretationRevisionId,
        payload: cloneJson(prepared.risk),
    });
    events.push({
        eventId: createId('iglevent'),
        eventType: 'POLICY_RESOLVED',
        occurredAt: timestamp,
        memoryScopeId: prepared.candidate.memoryScopeId,
        interpretationId: prepared.candidate.interpretationId,
        interpretationRevisionId: prepared.candidate.interpretationRevisionId,
        payload: cloneJson(prepared.policy),
    });
    for (const obligation of prepared.obligations) {
        events.push({
            eventId: createId('iglevent'),
            eventType: 'REVIEW_OBLIGATION_CREATED',
            occurredAt: timestamp,
            memoryScopeId: prepared.candidate.memoryScopeId,
            interpretationId: prepared.candidate.interpretationId,
            interpretationRevisionId: prepared.candidate.interpretationRevisionId,
            payload: cloneJson(obligation),
        });
    }
    for (const request of prepared.reviewRequests) {
        events.push({
            eventId: createId('iglevent'),
            eventType: 'REVIEW_REQUESTED',
            occurredAt: timestamp,
            memoryScopeId: prepared.candidate.memoryScopeId,
            interpretationId: prepared.candidate.interpretationId,
            interpretationRevisionId: prepared.candidate.interpretationRevisionId,
            payload: cloneJson(request),
        });
    }
    return events;
}

function createReviewDispositionEvent(reviewDisposition, candidate) {
    return {
        eventId: createId('iglevent'),
        eventType: 'REVIEW_DISPOSITION_RECORDED',
        occurredAt: reviewDisposition.submittedAt,
        memoryScopeId: candidate.memoryScopeId,
        interpretationId: candidate.interpretationId,
        interpretationRevisionId: candidate.interpretationRevisionId,
        payload: cloneJson(reviewDisposition),
    };
}

function createSubjectDispositionEvent(subjectDisposition, candidate, reviewEnvelopeHash) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SUBJECT_DISPOSITION_RECORDED',
        occurredAt: subjectDisposition.updatedAt,
        memoryScopeId: candidate.memoryScopeId,
        interpretationId: candidate.interpretationId,
        interpretationRevisionId: candidate.interpretationRevisionId,
        payload: {
            subjectDispositionId: subjectDisposition.subjectDispositionId,
            memorySubjectId: subjectDisposition.memorySubjectId,
            state: subjectDisposition.state,
            finalDispositionAuthority: subjectDisposition.finalDispositionAuthority,
            reasonCodes: cloneJson(subjectDisposition.reasonCodes),
            commentary: subjectDisposition.commentary,
            reviewEnvelopeHash,
            createdAt: subjectDisposition.createdAt,
            updatedAt: subjectDisposition.updatedAt,
        },
    };
}

function createSynthesisPolicyEvent(policy) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_POLICY_REGISTERED',
        occurredAt: policy.createdAt,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: cloneJson(policy),
    };
}

function createSynthesisRunEvent(run) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_RUN_REGISTERED',
        occurredAt: run.createdAt,
        memoryScopeId: run.memoryScopeId,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: cloneJson(run),
    };
}

function createSynthesisProposalEvent(proposal) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_PROPOSAL_EMITTED',
        occurredAt: proposal.generatedAt,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: cloneJson(proposal),
    };
}

function createSynthesisProposalAdmissionEvent(proposal, interpretationRevisionId, timestamp) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_PROPOSAL_ADMITTED',
        occurredAt: timestamp,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId,
        payload: {
            synthesisProposalId: proposal.synthesisProposalId,
            synthesisRunId: proposal.synthesisRunId,
            interpretationRevisionId,
            admittedAt: timestamp,
        },
    };
}

function createSynthesisProposalQuarantineEvent(proposal, timestamp) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_PROPOSAL_QUARANTINED',
        occurredAt: timestamp,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: {
            synthesisProposalId: proposal.synthesisProposalId,
            synthesisRunId: proposal.synthesisRunId,
            quarantineCode: proposal.quarantineCode,
            quarantineDetails: cloneJson(proposal.quarantineDetails),
            updatedAt: timestamp,
        },
    };
}

function createSynthesisGroundingRecordedEvent(synthesisProposalId, synthesisRunId, groundingEvaluation) {
    return {
        eventId: createId('iglevent'),
        eventType: 'SYNTHESIS_GROUNDING_RECORDED',
        occurredAt: groundingEvaluation.evaluatedAt,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: {
            synthesisProposalId,
            synthesisRunId,
            groundingEvaluation: cloneJson(groundingEvaluation),
        },
    };
}

function appendLedgerEvents(ledgerPath, events) {
    const lines = events.map((entry) => JSON.stringify(entry)).join('\n');
    fs.appendFileSync(ledgerPath, `${lines}\n`, 'utf8');
}

const INTERPRETIVE_PROJECTION_TABLES = Object.freeze([
    'interpretation_review_dispositions',
    'interpretation_review_requests',
    'interpretation_review_obligations',
    'interpretation_policy_bindings',
    'interpretation_risk_classifications',
    'interpretation_grounding_aggregates',
    'interpretation_grounding_links',
    'interpretation_subject_dispositions',
    'interpretation_revisions',
    'interpretation_synthesis_runs',
    'interpretation_synthesis_policies',
    'interpretation_synthesis_proposals',
    'interpretation_synthesis_grounding_evaluations',
]);

function clearInterpretiveProjection(adapter) {
    adapter.transaction(() => {
        for (const tableName of INTERPRETIVE_PROJECTION_TABLES) {
            adapter.run(`DELETE FROM ${tableName}`);
        }
    });
}

function deriveRequestStatusFromDisposition(disposition) {
    if (disposition === 'DEFER') {
        return 'DEFERRED';
    }
    if (disposition === 'CONTEST') {
        return 'CONTESTED';
    }
    if (disposition === 'APPROVE') {
        return 'APPROVED';
    }
    if (disposition === 'APPROVE_WITH_EDIT') {
        return 'APPROVE_WITH_EDIT';
    }
    if (disposition === 'APPROVE_FOR_SCOPE_ONLY') {
        return 'APPROVE_FOR_SCOPE_ONLY';
    }
    if (disposition === 'REJECT') {
        return 'REJECTED';
    }
    return 'PENDING';
}

function deriveObligationStateFromRequestStatus(status) {
    if (status === 'PENDING') {
        return 'READY_TO_REQUEST';
    }
    if (status === 'DEFERRED') {
        return 'DEFERRED';
    }
    if (status === 'CONTESTED') {
        return 'CONTESTED';
    }
    return 'COMPLETED';
}

function computeReviewStateFromStatuses(obligations, requests) {
    if (obligations.some((entry) => entry.obligationState === 'BLOCKED')) {
        return 'BLOCKED';
    }
    const statuses = requests.map((entry) => entry.status);
    if (statuses.length === 0) {
        return 'NOT_ROUTED';
    }
    if (statuses.some((entry) => entry === 'PENDING')) {
        return 'PENDING';
    }
    if (statuses.some((entry) => entry === 'DEFERRED')) {
        return 'DEFERRED';
    }
    if (statuses.some((entry) => entry === 'CONTESTED')) {
        return 'CONTESTED';
    }
    return 'COMPLETE';
}

function loadCandidateRow(adapter, interpretationRevisionId) {
    return adapter.get(
        'SELECT * FROM interpretation_revisions WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
}

function loadReviewRequestRow(adapter, reviewRequestId) {
    return adapter.get(
        'SELECT * FROM interpretation_review_requests WHERE review_request_id = ?',
        [reviewRequestId],
    );
}

function loadReviewDispositionRows(adapter, interpretationRevisionId) {
    return adapter.all(
        'SELECT * FROM interpretation_review_dispositions WHERE interpretation_revision_id = ? ORDER BY submitted_at, review_disposition_id',
        [interpretationRevisionId],
    );
}

function recomputeCandidateReviewState(adapter, interpretationRevisionId, timestamp = Date.now()) {
    const obligations = adapter.all(
        'SELECT obligation_state AS obligationState FROM interpretation_review_obligations WHERE interpretation_revision_id = ? ORDER BY review_obligation_id',
        [interpretationRevisionId],
    );
    const requests = adapter.all(
        'SELECT status FROM interpretation_review_requests WHERE interpretation_revision_id = ? ORDER BY review_request_id',
        [interpretationRevisionId],
    );
    const reviewState = computeReviewStateFromStatuses(obligations, requests);
    adapter.run(
        'UPDATE interpretation_revisions SET review_state = ?, updated_at = ? WHERE interpretation_revision_id = ?',
        [reviewState, timestamp, interpretationRevisionId],
    );
    return reviewState;
}

function loadInterpretiveSynthesisPolicyProjection(adapter, synthesisPolicyId, policyVersion) {
    const row = adapter.get(
        'SELECT * FROM interpretation_synthesis_policies WHERE synthesis_policy_id = ? AND policy_version = ?',
        [synthesisPolicyId, policyVersion],
    );
    if (!row) {
        return null;
    }
    return {
        synthesisPolicyId: row.synthesis_policy_id,
        policyVersion: Number(row.policy_version),
        memorySubjectId: row.memory_subject_id,
        enabled: Number(row.enabled) === 1,
        allowedTypes: JSON.parse(row.allowed_types_json),
        allowedAssertionDomains: JSON.parse(row.allowed_assertion_domains_json),
        prohibitedDomains: JSON.parse(row.prohibited_domains_json),
        manualTriggerRequiredForHighRisk: Number(row.manual_trigger_required_for_high_risk) === 1,
        maxCandidatesPerRun: Number(row.max_candidates_per_run),
        policyHash: row.policy_hash,
        details: JSON.parse(row.details_json),
        createdAt: Number(row.created_at),
    };
}

function loadLatestInterpretiveSynthesisPolicy(adapter, synthesisPolicyId) {
    const row = adapter.get(
        `SELECT * FROM interpretation_synthesis_policies
         WHERE synthesis_policy_id = ?
         ORDER BY policy_version DESC
         LIMIT 1`,
        [synthesisPolicyId],
    );
    if (!row) {
        return null;
    }
    return loadInterpretiveSynthesisPolicyProjection(adapter, row.synthesis_policy_id, Number(row.policy_version));
}

function persistInterpretiveSynthesisPolicyRow(adapter, policy) {
    adapter.run(
        `INSERT INTO interpretation_synthesis_policies (
            synthesis_policy_id, policy_version, memory_subject_id, enabled,
            allowed_types_json, allowed_assertion_domains_json, prohibited_domains_json,
            manual_trigger_required_for_high_risk, max_candidates_per_run, policy_hash,
            details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            policy.synthesisPolicyId,
            policy.policyVersion,
            policy.memorySubjectId,
            policy.enabled ? 1 : 0,
            stableStringify(policy.allowedTypes),
            stableStringify(policy.allowedAssertionDomains),
            stableStringify(policy.prohibitedDomains),
            policy.manualTriggerRequiredForHighRisk ? 1 : 0,
            policy.maxCandidatesPerRun,
            policy.policyHash,
            stableStringify(policy.details),
            policy.createdAt,
        ],
    );
}

function loadInterpretiveSynthesisRunProjection(adapter, synthesisRunId) {
    const row = adapter.get(
        'SELECT * FROM interpretation_synthesis_runs WHERE synthesis_run_id = ?',
        [synthesisRunId],
    );
    if (!row) {
        return null;
    }
    return {
        synthesisRunId: row.synthesis_run_id,
        memoryScopeId: row.memory_scope_id,
        memorySubjectId: row.memory_subject_id,
        synthesisPolicyId: row.synthesis_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        sourceManifestId: row.source_manifest_id,
        sourceManifestHash: row.source_manifest_hash,
        sourceManifest: JSON.parse(row.source_manifest_json),
        modelProviderId: row.model_provider_id,
        promptVersion: row.prompt_version,
        promptHash: row.prompt_hash,
        generationConfigHash: row.generation_config_hash,
        requestedInterpretationTypes: JSON.parse(row.requested_interpretation_types_json),
        requestedAssertionDomains: JSON.parse(row.requested_assertion_domains_json),
        sharedRelationshipRequested: Number(row.shared_relationship_requested) === 1,
        personalMeaningRequested: Number(row.personal_meaning_requested) === 1,
        maxCandidatesRequested: Number(row.max_candidates_requested),
        generatedCandidateIds: JSON.parse(row.generated_candidate_ids_json),
        runStatus: row.run_status,
        failureCode: row.failure_code,
        failureDetails: row.failure_details_json ? JSON.parse(row.failure_details_json) : null,
        createdByEntityId: row.created_by_entity_id,
        manualTriggerAcknowledged: Number(row.manual_trigger_acknowledged) === 1,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        proposals: adapter.all(
            `SELECT * FROM interpretation_synthesis_proposals
             WHERE synthesis_run_id = ?
             ORDER BY generated_at, synthesis_proposal_id`,
            [synthesisRunId],
        ).map((proposal) => ({
            synthesisProposalId: proposal.synthesis_proposal_id,
            synthesisRunId: proposal.synthesis_run_id,
            interpretationRevisionId: proposal.interpretation_revision_id,
            proposalStatus: proposal.proposal_status,
            proposalContentHash: proposal.proposal_content_hash,
            proposalPayload: JSON.parse(proposal.proposal_payload_json),
            quarantineCode: proposal.quarantine_code,
            quarantineDetails: proposal.quarantine_details_json ? JSON.parse(proposal.quarantine_details_json) : null,
            groundingEvaluation: loadInterpretiveSynthesisGroundingEvaluation(adapter, proposal.synthesis_proposal_id),
            generatedAt: Number(proposal.generated_at),
            updatedAt: Number(proposal.updated_at),
        })),
    };
}

function persistInterpretiveSynthesisRunRow(adapter, run) {
    adapter.run(
        `INSERT INTO interpretation_synthesis_runs (
            synthesis_run_id, memory_scope_id, memory_subject_id, synthesis_policy_id,
            policy_version, policy_hash, source_manifest_id, source_manifest_hash,
            source_manifest_json, model_provider_id, prompt_version, prompt_hash,
            generation_config_hash, requested_interpretation_types_json,
            requested_assertion_domains_json, shared_relationship_requested,
            personal_meaning_requested, max_candidates_requested, generated_candidate_ids_json,
            run_status, failure_code, failure_details_json, created_by_entity_id,
            manual_trigger_acknowledged, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            run.synthesisRunId,
            run.memoryScopeId,
            run.memorySubjectId,
            run.synthesisPolicyId,
            run.policyVersion,
            run.policyHash,
            run.sourceManifestId,
            run.sourceManifestHash,
            stableStringify(run.sourceManifest),
            run.modelProviderId,
            run.promptVersion,
            run.promptHash,
            run.generationConfigHash,
            stableStringify(run.requestedInterpretationTypes),
            stableStringify(run.requestedAssertionDomains),
            run.sharedRelationshipRequested ? 1 : 0,
            run.personalMeaningRequested ? 1 : 0,
            run.maxCandidatesRequested,
            stableStringify(run.generatedCandidateIds),
            run.runStatus,
            run.failureCode,
            run.failureDetails ? stableStringify(run.failureDetails) : null,
            run.createdByEntityId,
            run.manualTriggerAcknowledged ? 1 : 0,
            run.createdAt,
            run.updatedAt,
        ],
    );
}

function persistInterpretiveSynthesisProposalRow(adapter, proposal) {
    adapter.run(
        `INSERT INTO interpretation_synthesis_proposals (
            synthesis_proposal_id, synthesis_run_id, interpretation_revision_id, proposal_status,
            proposal_content_hash, proposal_payload_json, quarantine_code, quarantine_details_json,
            generated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            proposal.synthesisProposalId,
            proposal.synthesisRunId,
            proposal.interpretationRevisionId,
            proposal.proposalStatus,
            proposal.proposalContentHash,
            stableStringify(proposal.proposalPayload),
            proposal.quarantineCode,
            proposal.quarantineDetails ? stableStringify(proposal.quarantineDetails) : null,
            proposal.generatedAt,
            proposal.updatedAt,
        ],
    );
}

function loadInterpretiveSynthesisGroundingEvaluation(adapter, synthesisProposalId) {
    const row = adapter.get(
        'SELECT * FROM interpretation_synthesis_grounding_evaluations WHERE synthesis_proposal_id = ?',
        [synthesisProposalId],
    );
    if (!row) {
        return null;
    }
    return {
        groundingEnvelopeHash: row.grounding_envelope_hash,
        sourceManifestHash: row.source_manifest_hash,
        referentialStatus: row.referential_status,
        aggregateOutcome: row.aggregate_outcome,
        scopeAssessment: row.scope_assessment,
        counterevidencePresent: Number(row.counterevidence_present) === 1,
        evaluationProtocolVersion: Number(row.evaluation_protocol_version),
        evaluatorConfigHash: row.evaluator_config_hash,
        linkAssessments: JSON.parse(row.link_assessments_json),
        reasonCodes: JSON.parse(row.reason_codes_json),
        evaluatedAt: Number(row.evaluated_at),
    };
}

function upsertInterpretiveSynthesisGroundingEvaluation(adapter, synthesisProposalId, groundingEvaluation) {
    adapter.run(
        `INSERT OR REPLACE INTO interpretation_synthesis_grounding_evaluations (
            synthesis_proposal_id, grounding_envelope_hash, source_manifest_hash, referential_status,
            aggregate_outcome, scope_assessment, counterevidence_present, evaluation_protocol_version,
            evaluator_config_hash, link_assessments_json, reason_codes_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            synthesisProposalId,
            groundingEvaluation.groundingEnvelopeHash,
            groundingEvaluation.sourceManifestHash,
            groundingEvaluation.referentialStatus,
            groundingEvaluation.aggregateOutcome,
            groundingEvaluation.scopeAssessment,
            groundingEvaluation.counterevidencePresent ? 1 : 0,
            groundingEvaluation.evaluationProtocolVersion,
            groundingEvaluation.evaluatorConfigHash,
            stableStringify(groundingEvaluation.linkAssessments),
            stableStringify(groundingEvaluation.reasonCodes),
            groundingEvaluation.evaluatedAt,
        ],
    );
}

function resolveSynthesisPolicyForRun(adapter, frozen) {
    const policy = frozen.policyVersion === null
        ? loadLatestInterpretiveSynthesisPolicy(adapter, frozen.synthesisPolicyId)
        : loadInterpretiveSynthesisPolicyProjection(adapter, frozen.synthesisPolicyId, frozen.policyVersion);
    if (!policy) {
        throw createError(404, `Synthesis policy ${frozen.synthesisPolicyId} was not found`, 'ARCH_SYNTHESIS_POLICY_NOT_FOUND');
    }
    if (policy.memorySubjectId !== frozen.memorySubjectId) {
        throw createError(409, 'Synthesis policy subject does not match the requested memory subject', 'ARCH_SYNTHESIS_SUBJECT_MISMATCH');
    }
    return policy;
}

function buildRefusedSynthesisRun(frozen, policy, failureCode, failureDetails) {
    return {
        synthesisRunId: frozen.synthesisRunId,
        memoryScopeId: frozen.memoryScopeId,
        memorySubjectId: frozen.memorySubjectId,
        synthesisPolicyId: policy.synthesisPolicyId,
        policyVersion: policy.policyVersion,
        policyHash: policy.policyHash,
        sourceManifestId: frozen.sourceManifestId,
        sourceManifestHash: frozen.sourceManifestHash,
        sourceManifest: frozen.sourceManifestCanonical,
        modelProviderId: frozen.modelProviderId,
        promptVersion: frozen.promptVersion,
        promptHash: frozen.promptHash,
        generationConfigHash: frozen.generationConfigHash,
        requestedInterpretationTypes: frozen.requestedInterpretationTypes,
        requestedAssertionDomains: frozen.requestedAssertionDomains,
        sharedRelationshipRequested: frozen.sharedRelationshipRequested,
        personalMeaningRequested: frozen.personalMeaningRequested,
        maxCandidatesRequested: frozen.maxCandidatesRequested,
        generatedCandidateIds: [],
        runStatus: 'REFUSED',
        failureCode,
        failureDetails,
        createdByEntityId: frozen.createdByEntityId,
        manualTriggerAcknowledged: frozen.manualTriggerAcknowledged,
        createdAt: frozen.createdAt,
        updatedAt: frozen.createdAt,
    };
}

function evaluateSynthesisRunAdmission(frozen, policy) {
    if (!policy.enabled) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_POLICY_DISABLED',
            failureDetails: { reason: 'policy-disabled' },
        };
    }
    const disallowedTypes = frozen.requestedInterpretationTypes.filter((entry) => !policy.allowedTypes.includes(entry));
    if (disallowedTypes.length > 0) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_TYPE_NOT_ALLOWED',
            failureDetails: { disallowedTypes },
        };
    }
    const disallowedDomains = frozen.requestedAssertionDomains.filter((entry) => !policy.allowedAssertionDomains.includes(entry));
    if (disallowedDomains.length > 0) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_ASSERTION_DOMAIN_NOT_ALLOWED',
            failureDetails: { disallowedDomains },
        };
    }
    const prohibitedDomains = frozen.requestedAssertionDomains.filter((entry) => policy.prohibitedDomains.includes(entry));
    if (prohibitedDomains.length > 0) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_PROHIBITED_DOMAIN',
            failureDetails: { prohibitedDomains },
        };
    }
    if (frozen.maxCandidatesRequested > policy.maxCandidatesPerRun) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_CANDIDATE_LIMIT_EXCEEDED',
            failureDetails: {
                maxCandidatesRequested: frozen.maxCandidatesRequested,
                maxCandidatesPerRun: policy.maxCandidatesPerRun,
            },
        };
    }
    if (policy.manualTriggerRequiredForHighRisk && frozen.risk.highRisk && !frozen.manualTriggerAcknowledged) {
        return {
            admitted: false,
            failureCode: 'SYNTHESIS_MANUAL_TRIGGER_REQUIRED',
            failureDetails: {
                riskReasons: frozen.risk.riskReasons,
            },
        };
    }
    return {
        admitted: true,
        failureCode: null,
        failureDetails: null,
    };
}

function executeDeterministicStubSynthesizer(run, options = {}) {
    if (options.stubProposalOverride) {
        return cloneJson(options.stubProposalOverride);
    }
    const type = run.requestedInterpretationTypes[0];
    const assertionDomains = run.requestedAssertionDomains.slice();
    const supportingOccurrence = run.sourceManifest.sourceManifestEntries.find((entry) => entry.sourceClass === 'SOURCE_OCCURRENCE');
    if (
        run.memorySubjectId === 'character:jeep.png'
        && type === 'ROLE_EVOLUTION'
        && assertionDomains.includes('AUTHORITY')
        && supportingOccurrence
    ) {
        return {
            type: 'ROLE_EVOLUTION',
            statement: "Jeep evolved from an analytical role into the primary architectural authority for the extension's design.",
            assertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
            sharedRelationshipAsserted: true,
            personalMeaningAsserted: true,
            materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
            proposedBasis: run.sourceManifest.sourceManifestEntries.map((entry) => (
                entry.sourceClass === 'STRUCTURAL_RECORD'
                    ? {
                        basisType: 'STRUCTURAL_RECORD',
                        basisRecordId: entry.basisRecordId,
                    }
                    : {
                        basisType: 'SOURCE_OCCURRENCE',
                        messageId: entry.messageId,
                    }
            )),
        };
    }
    return {
        type,
        statement: `Deterministic synthesis stub proposes ${type} for ${run.memorySubjectId}.`,
        assertionDomains,
        sharedRelationshipAsserted: run.sharedRelationshipRequested,
        personalMeaningAsserted: run.personalMeaningRequested,
        materialParticipantEntityIds: [run.memorySubjectId, run.createdByEntityId].sort(),
        proposedBasis: run.sourceManifest.sourceManifestEntries.map((entry) => (
            entry.sourceClass === 'STRUCTURAL_RECORD'
                ? {
                    basisType: 'STRUCTURAL_RECORD',
                    basisRecordId: entry.basisRecordId,
                }
                : {
                    basisType: 'SOURCE_OCCURRENCE',
                    messageId: entry.messageId,
                }
        )),
    };
}

function normalizeStubProposalOutput(rawProposal) {
    if (!rawProposal || typeof rawProposal !== 'object' || Array.isArray(rawProposal)) {
        throw createError(409, 'Stub synthesizer output must be an object', 'ARCH_SYNTHESIS_PROPOSAL_INVALID');
    }
    const allowedKeys = new Set([
        'type',
        'statement',
        'assertionDomains',
        'sharedRelationshipAsserted',
        'personalMeaningAsserted',
        'materialParticipantEntityIds',
        'proposedBasis',
    ]);
    const forbiddenKeys = Object.keys(rawProposal).filter((key) => !allowedKeys.has(key));
    if (forbiddenKeys.length > 0) {
        throw createError(
            409,
            `Stub synthesizer output attempted to set unsupported fields: ${forbiddenKeys.join(', ')}`,
            'ARCH_SYNTHESIS_FORBIDDEN_OUTPUT_FIELD',
            { fields: forbiddenKeys },
        );
    }
    const normalized = {
        type: String(rawProposal.type || '').trim(),
        statement: String(rawProposal.statement || '').trim(),
        assertionDomains: normalizeStringArray(rawProposal.assertionDomains, 'assertionDomains', ALLOWED_ASSERTION_DOMAINS),
        sharedRelationshipAsserted: rawProposal.sharedRelationshipAsserted === true,
        personalMeaningAsserted: rawProposal.personalMeaningAsserted === true,
        materialParticipantEntityIds: normalizeStringArray(
            rawProposal.materialParticipantEntityIds,
            'materialParticipantEntityIds',
            null,
        ).map((entry) => sanitizeIdentifier(entry, 'materialParticipantEntityId')),
        proposedBasis: Array.isArray(rawProposal.proposedBasis) ? cloneJson(rawProposal.proposedBasis) : [],
    };
    if (!ALLOWED_INTERPRETATION_TYPES.has(normalized.type)) {
        throw createError(409, 'Stub synthesizer emitted an unsupported interpretation type', 'ARCH_SYNTHESIS_TYPE_UNSUPPORTED');
    }
    if (!normalized.statement) {
        throw createError(409, 'Stub synthesizer emitted an empty statement', 'ARCH_SYNTHESIS_PROPOSAL_INVALID');
    }
    if (normalized.proposedBasis.length === 0) {
        throw createError(409, 'Stub synthesizer emitted no proposed basis', 'ARCH_SYNTHESIS_PROPOSAL_INVALID');
    }
    return normalized;
}

function resolveGroundingLinksFromFrozenManifest(run, normalizedProposal) {
    const basisSet = new Set(
        normalizedProposal.proposedBasis.map((entry) => {
            if (entry?.basisType === 'STRUCTURAL_RECORD') {
                return `STRUCTURAL_RECORD:${String(entry.basisRecordId || '').trim()}`;
            }
            if (entry?.basisType === 'SOURCE_OCCURRENCE') {
                return `SOURCE_OCCURRENCE:${String(entry.messageId || '').trim()}`;
            }
            return `UNKNOWN:${stableStringify(entry)}`;
        }),
    );
    const entries = run.sourceManifest.sourceManifestEntries.filter((entry) => (
        entry.sourceClass === 'STRUCTURAL_RECORD'
            ? basisSet.has(`STRUCTURAL_RECORD:${entry.basisRecordId}`)
            : basisSet.has(`SOURCE_OCCURRENCE:${entry.messageId}`)
    ));
    if (entries.length !== basisSet.size) {
        throw createError(409, 'Stub synthesizer cited basis outside the frozen source manifest', 'ARCH_SYNTHESIS_BASIS_NOT_FROZEN');
    }
    return entries.map((entry, index) => {
        if (entry.sourceClass === 'STRUCTURAL_RECORD') {
            return {
                basisType: 'STRUCTURAL_RECORD',
                basisRecordId: entry.basisRecordId,
                basisRecordVersion: entry.basisRecordVersion,
                basisRecordHash: entry.basisRecordHash,
                speakerEntityId: entry.speakerEntityId,
                groundingRole: index === 0 ? 'PRIMARY' : 'SUPPORTING',
                groundingAssessment: 'SUPPORTS',
            };
        }
        return {
            basisType: 'SOURCE_OCCURRENCE',
            chatInstanceId: entry.chatInstanceId,
            messageId: entry.messageId,
            messageRevisionHash: entry.messageRevisionHash,
            speakerEntityId: entry.speakerEntityId,
            groundingRole: index === 0 ? 'PRIMARY' : 'SUPPORTING',
            groundingAssessment: 'SUPPORTS',
        };
    });
}

function buildSynthesisGroundingEvaluation(run, proposalContentHash, normalizedProposal, groundingLinks, options = {}) {
    const evaluationProtocolVersion = 1;
    const evaluatorConfigHash = hashCanonical({
        evaluator: 'DETERMINISTIC_SUPPORT_EVALUATOR_V1',
        evaluationProtocolVersion,
    }).hash;
    const groundingEnvelopeHash = buildGroundingEnvelopeHash(
        proposalContentHash,
        run.sourceManifestHash,
        groundingLinks,
        evaluationProtocolVersion,
        evaluatorConfigHash,
    );
    let referentialStatus = 'VALID';
    const reasonCodes = [];
    if (options.expectedSourceManifestHash && options.expectedSourceManifestHash !== run.sourceManifestHash) {
        referentialStatus = 'SOURCE_MANIFEST_DRIFT';
        reasonCodes.push('SOURCE_MANIFEST_DRIFT');
    }
    const statement = normalizedProposal.statement;
    const linkAssessments = groundingLinks.map((link, index) => ({
        groundingLinkId: link.groundingLinkId || (
            link.basisType === 'STRUCTURAL_RECORD'
                ? `basis:${link.basisRecordId}:${link.basisRecordVersion}`
                : `basis:${link.chatInstanceId}:${link.messageId}:${link.messageRevisionHash}`
        ),
        assessment: link.groundingAssessment,
        reasonCodes: [
            index === 0 ? 'PRIMARY_FROZEN_BASIS' : 'SUPPORTING_FROZEN_BASIS',
        ],
    }));
    let aggregateOutcome = 'SUPPORTED';
    let scopeAssessment = 'SUPPORTED';
    let counterevidencePresent = false;
    if (!/evolved/i.test(statement) || !/(authority|role|architecture)/i.test(statement)) {
        aggregateOutcome = 'UNSUPPORTED';
        scopeAssessment = 'UNSUPPORTED';
        reasonCodes.push('SEMANTIC_SUPPORT_INSUFFICIENT');
    } else if (/extension'?s design/iu.test(statement)) {
        aggregateOutcome = 'CONTRARY_EVIDENCE_PRESENT';
        scopeAssessment = 'TOO_BROAD';
        counterevidencePresent = true;
        reasonCodes.push('SHARED_JURISDICTION_REQUIRES_QUALIFICATION');
    } else if (/shared architecture with Chris/iu.test(statement)) {
        aggregateOutcome = 'STRONGLY_SUPPORTED';
        scopeAssessment = 'SUPPORTED';
    } else if (normalizedProposal.sharedRelationshipAsserted || normalizedProposal.personalMeaningAsserted) {
        aggregateOutcome = 'PARTIALLY_SUPPORTED';
        scopeAssessment = 'QUALIFIED_SUPPORT';
        reasonCodes.push('SCOPE_REQUIRES_REVIEW');
    }
    return {
        groundingEnvelopeHash,
        sourceManifestHash: run.sourceManifestHash,
        referentialStatus,
        aggregateOutcome,
        scopeAssessment,
        counterevidencePresent,
        evaluationProtocolVersion,
        evaluatorConfigHash,
        linkAssessments,
        reasonCodes: Array.from(new Set(reasonCodes)).sort(),
        evaluatedAt: options.now ?? Date.now(),
    };
}

function isGroundingEvaluationAdmissible(evaluation) {
    if (evaluation.referentialStatus !== 'VALID') {
        return false;
    }
    return !['UNSUPPORTED', 'BASIS_INCOMPLETE', 'INVALIDATED_SOURCE_MUTATION'].includes(evaluation.aggregateOutcome);
}

function buildChildRevisionPayload(parentInterpretation, payload = {}, createdFromDispositionId, reviewerRole, timestamp) {
    const revised = payload?.revisedCandidate || {};
    const statement = String(revised.statement || '').trim();
    if (!statement) {
        throw createError(400, 'revisedCandidate.statement is required for APPROVE_WITH_EDIT', 'ARCH_INVALID_PAYLOAD');
    }
    return {
        interpretationId: parentInterpretation.interpretationId,
        interpretationRevisionId: revised.interpretationRevisionId || createId('interprev'),
        parentRevisionId: parentInterpretation.interpretationRevisionId,
        createdFromDispositionId,
        revisionReason: reviewerRole === 'MEMORY_SUBJECT' ? 'SUBJECT_EDIT' : 'REVIEW_REQUESTED_REVISION',
        memoryScopeId: parentInterpretation.memoryScopeId,
        memorySubjectId: parentInterpretation.memorySubjectId,
        type: revised.type || parentInterpretation.type,
        statement,
        assertionDomains: revised.assertionDomains || parentInterpretation.assertionDomains,
        sharedRelationshipAsserted: revised.sharedRelationshipAsserted ?? parentInterpretation.sharedRelationshipAsserted,
        personalMeaningAsserted: revised.personalMeaningAsserted ?? parentInterpretation.personalMeaningAsserted,
        materialParticipantEntityIds: revised.materialParticipantEntityIds || parentInterpretation.materialParticipantEntityIds,
        groundingLinks: revised.groundingLinks || parentInterpretation.groundingLinks,
        now: timestamp,
    };
}

export function readInterpretiveLedgerEvents(ledgerPath) {
    if (!fs.existsSync(ledgerPath)) {
        return [];
    }
    return fs.readFileSync(ledgerPath, 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function buildPreparedFromLedgerEvents(events) {
    const proposedEvent = events.find((entry) => entry.eventType === 'INTERPRETATION_PROPOSED');
    const groundingOutcomeEvent = events.find((entry) => entry.eventType === 'GROUNDING_EVALUATED');
    const riskEvent = events.find((entry) => entry.eventType === 'RISK_CLASSIFIED');
    const policyEvent = events.find((entry) => entry.eventType === 'POLICY_RESOLVED');
    if (!proposedEvent || !groundingOutcomeEvent || !riskEvent || !policyEvent) {
        throw createError(500, `Interpretive ledger replay is missing required events for ${events[0]?.interpretationRevisionId || 'unknown revision'}`, 'ARCH_INTERPRETIVE_LEDGER_INCOMPLETE');
    }
    const groundingLinks = events
        .filter((entry) => entry.eventType === 'GROUNDING_LINK_ATTACHED')
        .map((entry) => cloneJson(entry.payload))
        .sort((a, b) => String(a.groundingLinkId).localeCompare(String(b.groundingLinkId)));
    const obligations = events
        .filter((entry) => entry.eventType === 'REVIEW_OBLIGATION_CREATED')
        .map((entry) => cloneJson(entry.payload))
        .sort((a, b) => String(a.reviewObligationId).localeCompare(String(b.reviewObligationId)));
    const reviewRequests = events
        .filter((entry) => entry.eventType === 'REVIEW_REQUESTED')
        .map((entry) => cloneJson(entry.payload))
        .sort((a, b) => String(a.reviewRequestId).localeCompare(String(b.reviewRequestId)));
    const proposed = proposedEvent.payload;
    const lifecycle = deriveLifecycleStates(groundingOutcomeEvent.payload.groundingOutcome, obligations);
    const reviewEnvelopeHash = buildReviewEnvelopeHash(
        proposed.proposalContentHash,
        groundingLinks,
        groundingOutcomeEvent.payload.groundingOutcome,
        riskEvent.payload,
        policyEvent.payload,
        obligations,
    );
    return {
        candidate: {
            interpretationId: proposed.interpretationId,
            interpretationRevisionId: proposed.interpretationRevisionId,
            parentRevisionId: proposed.parentRevisionId || null,
            createdFromDispositionId: proposed.createdFromDispositionId || null,
            revisionReason: proposed.revisionReason,
            memoryScopeId: proposedEvent.memoryScopeId,
            memorySubjectId: proposed.memorySubjectId,
            type: proposed.type,
            statement: proposed.statement,
            assertionDomains: cloneJson(proposed.assertionDomains),
            sharedRelationshipAsserted: proposed.sharedRelationshipAsserted === true,
            personalMeaningAsserted: proposed.personalMeaningAsserted === true,
            materialParticipantEntityIds: cloneJson(proposed.materialParticipantEntityIds),
            groundingLinks,
            candidateState: lifecycle.candidateState,
            groundingState: lifecycle.groundingState,
            reviewState: lifecycle.reviewState,
            subjectDispositionState: lifecycle.subjectDispositionState,
            publicationState: lifecycle.publicationState,
            authorityEffect: lifecycle.authorityEffect,
            proposalContentHash: proposed.proposalContentHash,
            reviewEnvelopeHash,
            createdAt: Number(proposedEvent.occurredAt),
            updatedAt: Number(proposedEvent.occurredAt),
        },
        groundingOutcome: groundingOutcomeEvent.payload.groundingOutcome,
        risk: cloneJson(riskEvent.payload),
        policy: cloneJson(policyEvent.payload),
        obligations,
        reviewRequests,
    };
}

function applySynthesisLedgerEvent(adapter, event) {
    if (event.eventType === 'SYNTHESIS_POLICY_REGISTERED') {
        const policy = event.payload || {};
        persistInterpretiveSynthesisPolicyRow(adapter, {
            synthesisPolicyId: sanitizeIdentifier(policy.synthesisPolicyId, 'synthesisPolicyId'),
            policyVersion: normalizePositiveInteger(policy.policyVersion, 'policyVersion', 1, 1_000_000),
            memorySubjectId: sanitizeIdentifier(policy.memorySubjectId, 'memorySubjectId'),
            enabled: policy.enabled === true,
            allowedTypes: normalizeStringArray(policy.allowedTypes, 'allowedTypes', ALLOWED_INTERPRETATION_TYPES),
            allowedAssertionDomains: normalizeStringArray(
                policy.allowedAssertionDomains,
                'allowedAssertionDomains',
                ALLOWED_ASSERTION_DOMAINS,
            ),
            prohibitedDomains: Array.isArray(policy.prohibitedDomains)
                ? normalizeStringArrayAllowEmpty(policy.prohibitedDomains, 'prohibitedDomains', ALLOWED_ASSERTION_DOMAINS)
                : [],
            manualTriggerRequiredForHighRisk: policy.manualTriggerRequiredForHighRisk === true,
            maxCandidatesPerRun: normalizePositiveInteger(policy.maxCandidatesPerRun, 'maxCandidatesPerRun', 1, 100),
            policyHash: String(policy.policyHash || '').trim(),
            details: normalizeOptionalPlainObject(policy.details, 'details'),
            createdAt: Number(policy.createdAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'SYNTHESIS_RUN_REGISTERED') {
        const run = event.payload || {};
        const runStatus = String(run.runStatus || '').trim();
        if (!ALLOWED_SYNTHESIS_RUN_STATUSES.has(runStatus)) {
            throw createError(500, `Interpretive synthesis replay received invalid run status ${runStatus}`, 'ARCH_INTERPRETIVE_LEDGER_INVALID');
        }
        persistInterpretiveSynthesisRunRow(adapter, {
            synthesisRunId: sanitizeIdentifier(run.synthesisRunId, 'synthesisRunId'),
            memoryScopeId: sanitizeIdentifier(run.memoryScopeId, 'memoryScopeId'),
            memorySubjectId: sanitizeIdentifier(run.memorySubjectId, 'memorySubjectId'),
            synthesisPolicyId: sanitizeIdentifier(run.synthesisPolicyId, 'synthesisPolicyId'),
            policyVersion: normalizePositiveInteger(run.policyVersion, 'policyVersion', 1, 1_000_000),
            policyHash: String(run.policyHash || '').trim(),
            sourceManifestId: sanitizeIdentifier(run.sourceManifestId, 'sourceManifestId'),
            sourceManifestHash: String(run.sourceManifestHash || '').trim(),
            sourceManifest: cloneJson(run.sourceManifest || {}),
            modelProviderId: run.modelProviderId ? String(run.modelProviderId).trim() : null,
            promptVersion: run.promptVersion ? String(run.promptVersion).trim() : null,
            promptHash: run.promptHash ? String(run.promptHash).trim() : null,
            generationConfigHash: run.generationConfigHash ? String(run.generationConfigHash).trim() : null,
            requestedInterpretationTypes: normalizeStringArray(
                run.requestedInterpretationTypes,
                'requestedInterpretationTypes',
                ALLOWED_INTERPRETATION_TYPES,
            ),
            requestedAssertionDomains: normalizeStringArray(
                run.requestedAssertionDomains,
                'requestedAssertionDomains',
                ALLOWED_ASSERTION_DOMAINS,
            ),
            sharedRelationshipRequested: run.sharedRelationshipRequested === true,
            personalMeaningRequested: run.personalMeaningRequested === true,
            maxCandidatesRequested: normalizePositiveInteger(run.maxCandidatesRequested, 'maxCandidatesRequested', 1, 100),
            generatedCandidateIds: Array.isArray(run.generatedCandidateIds)
                ? run.generatedCandidateIds.map((entry) => sanitizeIdentifier(entry, 'generatedCandidateId')).sort()
                : [],
            runStatus,
            failureCode: run.failureCode ? String(run.failureCode).trim() : null,
            failureDetails: run.failureDetails ? cloneJson(run.failureDetails) : null,
            createdByEntityId: sanitizeIdentifier(run.createdByEntityId, 'createdByEntityId'),
            manualTriggerAcknowledged: run.manualTriggerAcknowledged === true,
            createdAt: Number(run.createdAt || event.occurredAt),
            updatedAt: Number(run.updatedAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'SYNTHESIS_PROPOSAL_EMITTED') {
        const proposal = event.payload || {};
        const proposalStatus = String(proposal.proposalStatus || '').trim();
        if (!ALLOWED_SYNTHESIS_PROPOSAL_STATUSES.has(proposalStatus)) {
            throw createError(500, `Interpretive synthesis replay received invalid proposal status ${proposalStatus}`, 'ARCH_INTERPRETIVE_LEDGER_INVALID');
        }
        persistInterpretiveSynthesisProposalRow(adapter, {
            synthesisProposalId: sanitizeIdentifier(proposal.synthesisProposalId, 'synthesisProposalId'),
            synthesisRunId: sanitizeIdentifier(proposal.synthesisRunId, 'synthesisRunId'),
            interpretationRevisionId: proposal.interpretationRevisionId
                ? sanitizeIdentifier(proposal.interpretationRevisionId, 'interpretationRevisionId')
                : null,
            proposalStatus,
            proposalContentHash: String(proposal.proposalContentHash || '').trim(),
            proposalPayload: cloneJson(proposal.proposalPayload || {}),
            quarantineCode: proposal.quarantineCode ? String(proposal.quarantineCode).trim() : null,
            quarantineDetails: proposal.quarantineDetails ? cloneJson(proposal.quarantineDetails) : null,
            generatedAt: Number(proposal.generatedAt || event.occurredAt),
            updatedAt: Number(proposal.updatedAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'SYNTHESIS_PROPOSAL_ADMITTED') {
        const payload = event.payload || {};
        const interpretationRevisionId = sanitizeIdentifier(payload.interpretationRevisionId, 'interpretationRevisionId');
        adapter.run(
            `UPDATE interpretation_synthesis_proposals
             SET interpretation_revision_id = ?, proposal_status = 'ADMITTED', updated_at = ?
             WHERE synthesis_proposal_id = ?`,
            [
                interpretationRevisionId,
                Number(payload.admittedAt || event.occurredAt),
                sanitizeIdentifier(payload.synthesisProposalId, 'synthesisProposalId'),
            ],
        );
        const run = loadInterpretiveSynthesisRunProjection(adapter, sanitizeIdentifier(payload.synthesisRunId, 'synthesisRunId'));
        if (run) {
            const generatedCandidateIds = Array.from(new Set([...run.generatedCandidateIds, interpretationRevisionId])).sort();
            adapter.run(
                `UPDATE interpretation_synthesis_runs
                 SET generated_candidate_ids_json = ?, run_status = 'COMPLETED_ADMITTED', updated_at = ?
                 WHERE synthesis_run_id = ?`,
                [
                    stableStringify(generatedCandidateIds),
                    Number(payload.admittedAt || event.occurredAt),
                    run.synthesisRunId,
                ],
            );
        }
        return;
    }
    if (event.eventType === 'SYNTHESIS_PROPOSAL_QUARANTINED') {
        const payload = event.payload || {};
        adapter.run(
            `UPDATE interpretation_synthesis_proposals
             SET proposal_status = 'QUARANTINED', quarantine_code = ?, quarantine_details_json = ?, updated_at = ?
             WHERE synthesis_proposal_id = ?`,
            [
                payload.quarantineCode ? String(payload.quarantineCode).trim() : null,
                payload.quarantineDetails ? stableStringify(payload.quarantineDetails) : null,
                Number(payload.updatedAt || event.occurredAt),
                sanitizeIdentifier(payload.synthesisProposalId, 'synthesisProposalId'),
            ],
        );
        adapter.run(
            `UPDATE interpretation_synthesis_runs
             SET run_status = 'COMPLETED_QUARANTINED', failure_code = ?, failure_details_json = ?, updated_at = ?
             WHERE synthesis_run_id = ?`,
            [
                payload.quarantineCode ? String(payload.quarantineCode).trim() : null,
                payload.quarantineDetails ? stableStringify(payload.quarantineDetails) : null,
                Number(payload.updatedAt || event.occurredAt),
                sanitizeIdentifier(payload.synthesisRunId, 'synthesisRunId'),
            ],
        );
        return;
    }
    if (event.eventType === 'SYNTHESIS_GROUNDING_RECORDED') {
        const payload = event.payload || {};
        const synthesisProposalId = sanitizeIdentifier(payload.synthesisProposalId, 'synthesisProposalId');
        const groundingEvaluation = cloneJson(payload.groundingEvaluation || {});
        if (!ALLOWED_REFERENTIAL_STATUSES.has(String(groundingEvaluation.referentialStatus || '').trim())) {
            throw createError(500, 'Interpretive synthesis replay received invalid referential status', 'ARCH_INTERPRETIVE_LEDGER_INVALID');
        }
        upsertInterpretiveSynthesisGroundingEvaluation(adapter, synthesisProposalId, {
            groundingEnvelopeHash: String(groundingEvaluation.groundingEnvelopeHash || '').trim(),
            sourceManifestHash: String(groundingEvaluation.sourceManifestHash || '').trim(),
            referentialStatus: String(groundingEvaluation.referentialStatus || '').trim(),
            aggregateOutcome: String(groundingEvaluation.aggregateOutcome || '').trim(),
            scopeAssessment: String(groundingEvaluation.scopeAssessment || '').trim(),
            counterevidencePresent: groundingEvaluation.counterevidencePresent === true,
            evaluationProtocolVersion: normalizePositiveInteger(
                groundingEvaluation.evaluationProtocolVersion,
                'evaluationProtocolVersion',
                1,
                1_000_000,
            ),
            evaluatorConfigHash: String(groundingEvaluation.evaluatorConfigHash || '').trim(),
            linkAssessments: Array.isArray(groundingEvaluation.linkAssessments) ? cloneJson(groundingEvaluation.linkAssessments) : [],
            reasonCodes: Array.isArray(groundingEvaluation.reasonCodes) ? cloneJson(groundingEvaluation.reasonCodes) : [],
            evaluatedAt: Number(groundingEvaluation.evaluatedAt || event.occurredAt),
        });
    }
}

function applyInterpretiveFollowOnEvent(adapter, event) {
    if (event.eventType === 'REVIEW_DISPOSITION_RECORDED') {
        const payload = event.payload || {};
        const request = loadReviewRequestRow(adapter, payload.reviewRequestId);
        if (!request) {
            throw createError(500, `Interpretive replay could not resolve review request ${payload.reviewRequestId}`, 'ARCH_INTERPRETIVE_LEDGER_INCOMPLETE');
        }
        const dispositionStatus = deriveRequestStatusFromDisposition(payload.disposition);
        adapter.run(
            `INSERT INTO interpretation_review_dispositions (
                review_disposition_id, review_request_id, interpretation_revision_id, reviewer_role,
                reviewer_entity_id, disposition, reason_codes_json, commentary, review_envelope_hash, submitted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.reviewDispositionId,
                payload.reviewRequestId,
                event.interpretationRevisionId,
                payload.reviewerRole,
                payload.reviewerEntityId,
                payload.disposition,
                stableStringify(payload.reasonCodes || []),
                payload.commentary || null,
                payload.reviewEnvelopeHash,
                Number(payload.submittedAt || event.occurredAt),
            ],
        );
        adapter.run(
            'UPDATE interpretation_review_requests SET status = ? WHERE review_request_id = ?',
            [dispositionStatus, payload.reviewRequestId],
        );
        adapter.run(
            'UPDATE interpretation_review_obligations SET obligation_state = ?, blocking_reason = ? WHERE review_obligation_id = ?',
            [deriveObligationStateFromRequestStatus(dispositionStatus), 'NONE', request.review_obligation_id],
        );
        recomputeCandidateReviewState(adapter, event.interpretationRevisionId, Number(payload.submittedAt || event.occurredAt));
        return;
    }
    if (event.eventType === 'SUBJECT_DISPOSITION_RECORDED') {
        const payload = event.payload || {};
        adapter.run(
            `UPDATE interpretation_subject_dispositions
             SET state = ?, reason_codes_json = ?, commentary = ?, updated_at = ?
             WHERE interpretation_revision_id = ?`,
            [
                payload.state,
                stableStringify(payload.reasonCodes || []),
                payload.commentary || null,
                Number(payload.updatedAt || event.occurredAt),
                event.interpretationRevisionId,
            ],
        );
        adapter.run(
            `UPDATE interpretation_revisions
             SET subject_disposition_state = ?, publication_state = 'NOT_PUBLISHED',
                 authority_effect = 'DESCRIPTIVE_ONLY', updated_at = ?
             WHERE interpretation_revision_id = ?`,
            [
                payload.state,
                Number(payload.updatedAt || event.occurredAt),
                event.interpretationRevisionId,
            ],
        );
    }
}

export function replayInterpretiveLedger(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const ledgerEvents = readInterpretiveLedgerEvents(options.ledgerPath || paths.interpretiveGovernanceLedgerPath);
    const grouped = new Map();
    const followOnEvents = [];
    const synthesisEvents = [];
    const synthesisEventTypes = new Set([
        'SYNTHESIS_POLICY_REGISTERED',
        'SYNTHESIS_RUN_REGISTERED',
        'SYNTHESIS_PROPOSAL_EMITTED',
        'SYNTHESIS_GROUNDING_RECORDED',
        'SYNTHESIS_PROPOSAL_ADMITTED',
        'SYNTHESIS_PROPOSAL_QUARANTINED',
    ]);
    for (const event of ledgerEvents) {
        if (synthesisEventTypes.has(event.eventType)) {
            synthesisEvents.push(event);
            continue;
        }
        const key = String(event.interpretationRevisionId || '');
        if (['REVIEW_DISPOSITION_RECORDED', 'SUBJECT_DISPOSITION_RECORDED'].includes(event.eventType)) {
            if (!key) {
                throw createError(500, 'Interpretive ledger follow-on event is missing interpretationRevisionId', 'ARCH_INTERPRETIVE_LEDGER_INVALID');
            }
            followOnEvents.push(event);
            continue;
        }
        if (!key) {
            throw createError(500, 'Interpretive ledger event is missing interpretationRevisionId', 'ARCH_INTERPRETIVE_LEDGER_INVALID');
        }
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(event);
    }

    const adapter = openOperationalDatabase(paths, { now: options.now });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        clearInterpretiveProjection(adapter);
        for (const event of synthesisEvents) {
            applySynthesisLedgerEvent(adapter, event);
        }
        const rehydrated = [];
        const replayedSynthesisPolicies = [];
        const replayedSynthesisRuns = [];
        const revisionIds = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
        for (const interpretationRevisionId of revisionIds) {
            const events = grouped.get(interpretationRevisionId)
                .slice()
                .sort((a, b) => Number(a.occurredAt) - Number(b.occurredAt) || String(a.eventId).localeCompare(String(b.eventId)));
            const prepared = buildPreparedFromLedgerEvents(events);
            persistPreparedCandidate(adapter, prepared, prepared.candidate.createdAt);
        }
        for (const event of followOnEvents.sort((a, b) => Number(a.occurredAt) - Number(b.occurredAt) || String(a.eventId).localeCompare(String(b.eventId)))) {
            applyInterpretiveFollowOnEvent(adapter, event);
        }
        for (const interpretationRevisionId of revisionIds) {
            rehydrated.push(loadInterpretiveCandidateProjection(adapter, interpretationRevisionId));
        }
        const policyRows = adapter.all(
            'SELECT synthesis_policy_id, policy_version FROM interpretation_synthesis_policies ORDER BY synthesis_policy_id, policy_version',
        );
        for (const row of policyRows) {
            replayedSynthesisPolicies.push(
                loadInterpretiveSynthesisPolicyProjection(adapter, row.synthesis_policy_id, Number(row.policy_version)),
            );
        }
        const runRows = adapter.all(
            'SELECT synthesis_run_id FROM interpretation_synthesis_runs ORDER BY created_at, synthesis_run_id',
        );
        for (const row of runRows) {
            replayedSynthesisRuns.push(loadInterpretiveSynthesisRunProjection(adapter, row.synthesis_run_id));
        }
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.3',
            replayedInterpretations: rehydrated,
            replayedSynthesisPolicies,
            replayedSynthesisRuns,
        };
    } finally {
        adapter.close();
    }
}

function persistPreparedCandidateRows(adapter, prepared, timestamp) {
    seedInterpretivePolicyDefinitions(adapter);
    const existing = adapter.get(
        'SELECT interpretation_revision_id FROM interpretation_revisions WHERE interpretation_revision_id = ?',
        [prepared.candidate.interpretationRevisionId],
    );
    if (existing) {
        throw createError(409, `Interpretation revision ${prepared.candidate.interpretationRevisionId} already exists`, 'ARCH_INTERPRETATION_REVISION_EXISTS');
    }
    adapter.run(
            `INSERT INTO interpretation_revisions (
                interpretation_revision_id, interpretation_id, parent_revision_id, created_from_disposition_id,
                revision_reason, memory_scope_id, memory_subject_id, interpretation_type, statement_text,
                assertion_domains_json, shared_relationship_asserted, personal_meaning_asserted,
                material_participant_entity_ids_json, candidate_state, grounding_state, review_state,
                subject_disposition_state, publication_state, authority_effect, proposal_content_hash,
                review_envelope_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                prepared.candidate.interpretationRevisionId,
                prepared.candidate.interpretationId,
                prepared.candidate.parentRevisionId,
                prepared.candidate.createdFromDispositionId,
                prepared.candidate.revisionReason,
                prepared.candidate.memoryScopeId,
                prepared.candidate.memorySubjectId,
                prepared.candidate.type,
                prepared.candidate.statement,
                stableStringify(prepared.candidate.assertionDomains),
                prepared.candidate.sharedRelationshipAsserted ? 1 : 0,
                prepared.candidate.personalMeaningAsserted ? 1 : 0,
                stableStringify(prepared.candidate.materialParticipantEntityIds),
                prepared.candidate.candidateState,
                prepared.candidate.groundingState,
                prepared.candidate.reviewState,
                prepared.candidate.subjectDispositionState,
                prepared.candidate.publicationState,
                prepared.candidate.authorityEffect,
                prepared.candidate.proposalContentHash,
                prepared.candidate.reviewEnvelopeHash,
                timestamp,
                timestamp,
            ],
    );
    for (const link of prepared.candidate.groundingLinks) {
        adapter.run(
                `INSERT INTO interpretation_grounding_links (
                    interpretation_revision_id, grounding_link_id, basis_type, basis_record_id,
                    basis_record_version, basis_record_hash, chat_instance_id, message_id,
                    message_revision_hash, speaker_entity_id, grounding_role, grounding_assessment, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    prepared.candidate.interpretationRevisionId,
                    link.groundingLinkId,
                    link.basisType,
                    link.basisRecordId,
                    link.basisRecordVersion,
                    link.basisRecordHash,
                    link.chatInstanceId,
                    link.messageId,
                    link.messageRevisionHash,
                    link.speakerEntityId,
                    link.groundingRole,
                    link.groundingAssessment,
                    stableStringify(link.details),
                ],
        );
    }
    adapter.run(
            `INSERT INTO interpretation_grounding_aggregates (
                interpretation_revision_id, grounding_outcome, evaluated_at
            ) VALUES (?, ?, ?)`,
            [
                prepared.candidate.interpretationRevisionId,
                prepared.groundingOutcome,
                timestamp,
            ],
    );
    adapter.run(
            `INSERT INTO interpretation_risk_classifications (
                interpretation_revision_id, risk_class, risk_reasons_json, resolution_input_hash
            ) VALUES (?, ?, ?, ?)`,
            [
                prepared.candidate.interpretationRevisionId,
                prepared.risk.riskClass,
                stableStringify(prepared.risk.riskReasons),
                prepared.risk.resolutionInputHash,
            ],
    );
    adapter.run(
            `INSERT INTO interpretation_policy_bindings (
                interpretation_revision_id, validation_policy_id, policy_version,
                policy_hash, matched_rule_ids_json, resolution_input_hash
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                prepared.candidate.interpretationRevisionId,
                prepared.policy.validationPolicyId,
                prepared.policy.policyVersion,
                prepared.policy.policyHash,
                stableStringify(prepared.policy.matchedRuleIds),
                prepared.policy.resolutionInputHash,
            ],
    );
    for (const obligation of prepared.obligations) {
        adapter.run(
                `INSERT INTO interpretation_review_obligations (
                    review_obligation_id, interpretation_revision_id, reviewer_role,
                    reviewer_entity_id, obligation_state, blocking_reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    obligation.reviewObligationId,
                    prepared.candidate.interpretationRevisionId,
                    obligation.reviewerRole,
                    obligation.reviewerEntityId,
                    obligation.obligationState,
                    obligation.blockingReason,
                    obligation.createdAt,
                ],
        );
    }
    for (const request of prepared.reviewRequests) {
        adapter.run(
                `INSERT INTO interpretation_review_requests (
                    review_request_id, review_obligation_id, interpretation_revision_id, reviewer_role,
                    reviewer_entity_id, status, review_envelope_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    request.reviewRequestId,
                    request.reviewObligationId,
                    request.interpretationRevisionId,
                    request.reviewerRole,
                    request.reviewerEntityId,
                    request.status,
                    request.reviewEnvelopeHash,
                    request.createdAt,
                ],
        );
    }
    adapter.run(
            `INSERT INTO interpretation_subject_dispositions (
                interpretation_revision_id, memory_subject_id, state, final_disposition_authority,
                reason_codes_json, commentary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                prepared.candidate.interpretationRevisionId,
                prepared.candidate.memorySubjectId,
                'PENDING',
                prepared.policy.finalDispositionAuthority,
                stableStringify([]),
                null,
                timestamp,
                timestamp,
            ],
    );
}

function persistPreparedCandidate(adapter, prepared, timestamp) {
    adapter.transaction(() => {
        persistPreparedCandidateRows(adapter, prepared, timestamp);
    });
}

export function loadInterpretiveCandidateProjection(adapter, interpretationRevisionId) {
    const candidate = adapter.get(
        'SELECT * FROM interpretation_revisions WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    if (!candidate) {
        return null;
    }
    const groundingLinks = adapter.all(
        'SELECT * FROM interpretation_grounding_links WHERE interpretation_revision_id = ? ORDER BY grounding_link_id',
        [interpretationRevisionId],
    );
    const groundingAggregate = adapter.get(
        'SELECT * FROM interpretation_grounding_aggregates WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    const risk = adapter.get(
        'SELECT * FROM interpretation_risk_classifications WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    const policyBinding = adapter.get(
        'SELECT * FROM interpretation_policy_bindings WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    const reviewObligations = adapter.all(
        'SELECT * FROM interpretation_review_obligations WHERE interpretation_revision_id = ? ORDER BY review_obligation_id',
        [interpretationRevisionId],
    );
    const reviewRequests = adapter.all(
        'SELECT * FROM interpretation_review_requests WHERE interpretation_revision_id = ? ORDER BY review_request_id',
        [interpretationRevisionId],
    );
    const reviewDispositions = loadReviewDispositionRows(adapter, interpretationRevisionId);
    const subjectDisposition = adapter.get(
        'SELECT * FROM interpretation_subject_dispositions WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    const childRevisions = adapter.all(
        'SELECT interpretation_revision_id FROM interpretation_revisions WHERE parent_revision_id = ? ORDER BY interpretation_revision_id',
        [interpretationRevisionId],
    );
    return {
        interpretationRevisionId: candidate.interpretation_revision_id,
        interpretationId: candidate.interpretation_id,
        parentRevisionId: candidate.parent_revision_id,
        createdFromDispositionId: candidate.created_from_disposition_id,
        revisionReason: candidate.revision_reason,
        memoryScopeId: candidate.memory_scope_id,
        memorySubjectId: candidate.memory_subject_id,
        type: candidate.interpretation_type,
        statement: candidate.statement_text,
        assertionDomains: JSON.parse(candidate.assertion_domains_json),
        sharedRelationshipAsserted: Number(candidate.shared_relationship_asserted) === 1,
        personalMeaningAsserted: Number(candidate.personal_meaning_asserted) === 1,
        materialParticipantEntityIds: JSON.parse(candidate.material_participant_entity_ids_json),
        candidateState: candidate.candidate_state,
        groundingState: candidate.grounding_state,
        reviewState: candidate.review_state,
        subjectDispositionState: candidate.subject_disposition_state,
        publicationState: candidate.publication_state,
        authorityEffect: candidate.authority_effect,
        proposalContentHash: candidate.proposal_content_hash,
        reviewEnvelopeHash: candidate.review_envelope_hash,
        createdAt: Number(candidate.created_at),
        updatedAt: Number(candidate.updated_at),
        groundingLinks: groundingLinks.map((entry) => ({
            groundingLinkId: entry.grounding_link_id,
            basisType: entry.basis_type,
            basisRecordId: entry.basis_record_id,
            basisRecordVersion: entry.basis_record_version === null ? null : Number(entry.basis_record_version),
            basisRecordHash: entry.basis_record_hash,
            chatInstanceId: entry.chat_instance_id,
            messageId: entry.message_id,
            messageRevisionHash: entry.message_revision_hash,
            speakerEntityId: entry.speaker_entity_id,
            groundingRole: entry.grounding_role,
            groundingAssessment: entry.grounding_assessment,
            details: JSON.parse(entry.details_json),
        })),
        groundingAggregate: groundingAggregate ? {
            groundingOutcome: groundingAggregate.grounding_outcome,
            evaluatedAt: Number(groundingAggregate.evaluated_at),
        } : null,
        risk: risk ? {
            riskClass: risk.risk_class,
            riskReasons: JSON.parse(risk.risk_reasons_json),
            resolutionInputHash: risk.resolution_input_hash,
        } : null,
        policyBinding: policyBinding ? {
            validationPolicyId: policyBinding.validation_policy_id,
            policyVersion: Number(policyBinding.policy_version),
            policyHash: policyBinding.policy_hash,
            matchedRuleIds: JSON.parse(policyBinding.matched_rule_ids_json),
            resolutionInputHash: policyBinding.resolution_input_hash,
        } : null,
        reviewObligations: reviewObligations.map((entry) => ({
            reviewObligationId: entry.review_obligation_id,
            reviewerRole: entry.reviewer_role,
            reviewerEntityId: entry.reviewer_entity_id,
            obligationState: entry.obligation_state,
            blockingReason: entry.blocking_reason,
            createdAt: Number(entry.created_at),
        })),
        reviewRequests: reviewRequests.map((entry) => ({
            reviewRequestId: entry.review_request_id,
            reviewObligationId: entry.review_obligation_id,
            interpretationRevisionId: entry.interpretation_revision_id,
            reviewerRole: entry.reviewer_role,
            reviewerEntityId: entry.reviewer_entity_id,
            status: entry.status,
            reviewEnvelopeHash: entry.review_envelope_hash,
            createdAt: Number(entry.created_at),
        })),
        reviewDispositions: reviewDispositions.map((entry) => ({
            reviewDispositionId: entry.review_disposition_id,
            reviewRequestId: entry.review_request_id,
            interpretationRevisionId: entry.interpretation_revision_id,
            reviewerRole: entry.reviewer_role,
            reviewerEntityId: entry.reviewer_entity_id,
            disposition: entry.disposition,
            reasonCodes: JSON.parse(entry.reason_codes_json),
            commentary: entry.commentary,
            reviewEnvelopeHash: entry.review_envelope_hash,
            submittedAt: Number(entry.submitted_at),
        })),
        subjectDisposition: subjectDisposition ? {
            memorySubjectId: subjectDisposition.memory_subject_id,
            state: subjectDisposition.state,
            finalDispositionAuthority: subjectDisposition.final_disposition_authority,
            reasonCodes: JSON.parse(subjectDisposition.reason_codes_json),
            commentary: subjectDisposition.commentary,
            createdAt: Number(subjectDisposition.created_at),
            updatedAt: Number(subjectDisposition.updated_at),
        } : null,
        childRevisionIds: childRevisions.map((entry) => entry.interpretation_revision_id),
    };
}

export function upsertInterpretiveSynthesisPolicy(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const policy = buildSynthesisPolicyRecord(payload, timestamp);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    fs.mkdirSync(paths.storageRoot, { recursive: true });

    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const existing = loadInterpretiveSynthesisPolicyProjection(adapter, policy.synthesisPolicyId, policy.policyVersion);
        if (existing) {
            if (existing.policyHash !== policy.policyHash) {
                throw createError(
                    409,
                    `Synthesis policy ${policy.synthesisPolicyId} version ${policy.policyVersion} already exists with different content`,
                    'ARCH_SYNTHESIS_POLICY_CONFLICT',
                );
            }
            return {
                ok: true,
                phase: 'c0.6.3',
                ledgerPath: paths.interpretiveGovernanceLedgerPath,
                synthesisPolicy: existing,
                created: false,
            };
        }
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [createSynthesisPolicyEvent(policy)]);
        adapter.transaction(() => {
            persistInterpretiveSynthesisPolicyRow(adapter, policy);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.3',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            synthesisPolicy: loadInterpretiveSynthesisPolicyProjection(adapter, policy.synthesisPolicyId, policy.policyVersion),
            created: true,
        };
    } finally {
        adapter.close();
    }
}

export function createInterpretiveSynthesisRun(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const frozen = buildFrozenSynthesisManifest(payload, timestamp);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    fs.mkdirSync(paths.storageRoot, { recursive: true });

    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const existing = loadInterpretiveSynthesisRunProjection(adapter, frozen.synthesisRunId);
        if (existing) {
            throw createError(409, `Synthesis run ${frozen.synthesisRunId} already exists`, 'ARCH_SYNTHESIS_RUN_EXISTS');
        }
        const policy = resolveSynthesisPolicyForRun(adapter, frozen);
        const admission = evaluateSynthesisRunAdmission(frozen, policy);
        const run = admission.admitted
            ? {
                synthesisRunId: frozen.synthesisRunId,
                memoryScopeId: frozen.memoryScopeId,
                memorySubjectId: frozen.memorySubjectId,
                synthesisPolicyId: policy.synthesisPolicyId,
                policyVersion: policy.policyVersion,
                policyHash: policy.policyHash,
                sourceManifestId: frozen.sourceManifestId,
                sourceManifestHash: frozen.sourceManifestHash,
                sourceManifest: frozen.sourceManifestCanonical,
                modelProviderId: frozen.modelProviderId,
                promptVersion: frozen.promptVersion,
                promptHash: frozen.promptHash,
                generationConfigHash: frozen.generationConfigHash,
                requestedInterpretationTypes: frozen.requestedInterpretationTypes,
                requestedAssertionDomains: frozen.requestedAssertionDomains,
                sharedRelationshipRequested: frozen.sharedRelationshipRequested,
                personalMeaningRequested: frozen.personalMeaningRequested,
                maxCandidatesRequested: frozen.maxCandidatesRequested,
                generatedCandidateIds: [],
                runStatus: 'READY_FOR_SYNTHESIS',
                failureCode: null,
                failureDetails: null,
                createdByEntityId: frozen.createdByEntityId,
                manualTriggerAcknowledged: frozen.manualTriggerAcknowledged,
                createdAt: timestamp,
                updatedAt: timestamp,
            }
            : buildRefusedSynthesisRun(frozen, policy, admission.failureCode, admission.failureDetails);
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [createSynthesisRunEvent(run)]);
        adapter.transaction(() => {
            persistInterpretiveSynthesisRunRow(adapter, run);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.3',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            admitted: admission.admitted,
            synthesisRun: loadInterpretiveSynthesisRunProjection(adapter, run.synthesisRunId),
        };
    } finally {
        adapter.close();
    }
}

export function executeInterpretiveSynthesisRun(request, synthesisRunId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const run = loadInterpretiveSynthesisRunProjection(
            adapter,
            sanitizeIdentifier(synthesisRunId, 'synthesisRunId'),
        );
        if (!run) {
            throw createError(404, `Synthesis run ${synthesisRunId} was not found`, 'ARCH_SYNTHESIS_RUN_NOT_FOUND');
        }
        if (run.runStatus !== 'READY_FOR_SYNTHESIS') {
            throw createError(409, `Synthesis run ${synthesisRunId} is not ready for synthesis`, 'ARCH_SYNTHESIS_RUN_NOT_READY');
        }
        const adapterId = String(payload?.adapterId || 'DETERMINISTIC_STUB_V1').trim();
        if (adapterId !== 'DETERMINISTIC_STUB_V1') {
            throw createError(400, `Unsupported synthesis adapter ${adapterId}`, 'ARCH_SYNTHESIS_ADAPTER_UNSUPPORTED');
        }

        const rawProposal = executeDeterministicStubSynthesizer(run, payload);
        let normalizedProposal;
        let proposal;
        try {
            normalizedProposal = normalizeStubProposalOutput(rawProposal);
            proposal = {
                synthesisProposalId: sanitizeIdentifier(payload?.synthesisProposalId || createId('synthproposal'), 'synthesisProposalId'),
                synthesisRunId: run.synthesisRunId,
                interpretationRevisionId: null,
                proposalStatus: 'EMITTED',
                proposalContentHash: hashCanonical(normalizedProposal).hash,
                proposalPayload: normalizedProposal,
                quarantineCode: null,
                quarantineDetails: null,
                generatedAt: timestamp,
                updatedAt: timestamp,
            };
        } catch (error) {
            const quarantinedProposal = {
                synthesisProposalId: sanitizeIdentifier(payload?.synthesisProposalId || createId('synthproposal'), 'synthesisProposalId'),
                synthesisRunId: run.synthesisRunId,
                interpretationRevisionId: null,
                proposalStatus: 'QUARANTINED',
                proposalContentHash: hashCanonical({ invalid: true, rawProposal }).hash,
                proposalPayload: cloneJson(rawProposal),
                quarantineCode: String(error?.code || 'ARCH_SYNTHESIS_PROPOSAL_INVALID'),
                quarantineDetails: {
                    message: String(error?.message || 'Invalid synthesis proposal'),
                },
                generatedAt: timestamp,
                updatedAt: timestamp,
            };
            appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [
                createSynthesisProposalEvent(quarantinedProposal),
                createSynthesisProposalQuarantineEvent(quarantinedProposal, timestamp),
            ]);
            adapter.transaction(() => {
                persistInterpretiveSynthesisProposalRow(adapter, quarantinedProposal);
                adapter.run(
                    `UPDATE interpretation_synthesis_runs
                     SET run_status = 'COMPLETED_QUARANTINED', failure_code = ?, failure_details_json = ?, updated_at = ?
                     WHERE synthesis_run_id = ?`,
                    [
                        quarantinedProposal.quarantineCode,
                        stableStringify(quarantinedProposal.quarantineDetails),
                        timestamp,
                        run.synthesisRunId,
                    ],
                );
            });
            snapshotOperationalDatabase(adapter, paths);
            return {
                ok: true,
                phase: 'c0.6.3',
                ledgerPath: paths.interpretiveGovernanceLedgerPath,
                admitted: false,
                quarantined: true,
                synthesisRun: loadInterpretiveSynthesisRunProjection(adapter, run.synthesisRunId),
            };
        }

        let groundingLinks;
        try {
            groundingLinks = resolveGroundingLinksFromFrozenManifest(run, normalizedProposal);
        } catch (error) {
            const quarantinedProposal = {
                synthesisProposalId: sanitizeIdentifier(payload?.synthesisProposalId || createId('synthproposal'), 'synthesisProposalId'),
                synthesisRunId: run.synthesisRunId,
                interpretationRevisionId: null,
                proposalStatus: 'QUARANTINED',
                proposalContentHash: proposal.proposalContentHash,
                proposalPayload: normalizedProposal,
                quarantineCode: String(error?.code || 'ARCH_SYNTHESIS_BASIS_NOT_FROZEN'),
                quarantineDetails: {
                    message: String(error?.message || 'Grounding basis could not be resolved from the frozen manifest'),
                },
                generatedAt: timestamp,
                updatedAt: timestamp,
            };
            appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [
                createSynthesisProposalEvent(quarantinedProposal),
                createSynthesisProposalQuarantineEvent(quarantinedProposal, timestamp),
            ]);
            adapter.transaction(() => {
                persistInterpretiveSynthesisProposalRow(adapter, quarantinedProposal);
                adapter.run(
                    `UPDATE interpretation_synthesis_runs
                     SET run_status = 'COMPLETED_QUARANTINED', failure_code = ?, failure_details_json = ?, updated_at = ?
                     WHERE synthesis_run_id = ?`,
                    [
                        quarantinedProposal.quarantineCode,
                        stableStringify(quarantinedProposal.quarantineDetails),
                        timestamp,
                        run.synthesisRunId,
                    ],
                );
            });
            snapshotOperationalDatabase(adapter, paths);
            return {
                ok: true,
                phase: 'c0.6.3',
                admitted: false,
                quarantined: true,
                synthesisRun: loadInterpretiveSynthesisRunProjection(adapter, run.synthesisRunId),
            };
        }
        const groundingEvaluation = buildSynthesisGroundingEvaluation(
            run,
            proposal.proposalContentHash,
            normalizedProposal,
            groundingLinks,
            {
                now: timestamp,
                expectedSourceManifestHash: payload?.expectedSourceManifestHash ? String(payload.expectedSourceManifestHash).trim() : null,
            },
        );
        if (!isGroundingEvaluationAdmissible(groundingEvaluation)) {
            proposal.proposalStatus = 'QUARANTINED';
            proposal.quarantineCode = groundingEvaluation.referentialStatus !== 'VALID'
                ? groundingEvaluation.referentialStatus
                : 'SEMANTIC_SUPPORT_INSUFFICIENT';
            proposal.quarantineDetails = {
                groundingEvaluation: cloneJson(groundingEvaluation),
            };
            appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [
                createSynthesisProposalEvent(proposal),
                createSynthesisGroundingRecordedEvent(proposal.synthesisProposalId, proposal.synthesisRunId, groundingEvaluation),
                createSynthesisProposalQuarantineEvent(proposal, timestamp),
            ]);
            adapter.transaction(() => {
                persistInterpretiveSynthesisProposalRow(adapter, proposal);
                upsertInterpretiveSynthesisGroundingEvaluation(adapter, proposal.synthesisProposalId, groundingEvaluation);
                adapter.run(
                    `UPDATE interpretation_synthesis_runs
                     SET run_status = 'COMPLETED_QUARANTINED', failure_code = ?, failure_details_json = ?, updated_at = ?
                     WHERE synthesis_run_id = ?`,
                    [
                        proposal.quarantineCode,
                        stableStringify(proposal.quarantineDetails),
                        timestamp,
                        run.synthesisRunId,
                    ],
                );
            });
            snapshotOperationalDatabase(adapter, paths);
            return {
                ok: true,
                phase: 'c0.6.3',
                admitted: false,
                quarantined: true,
                synthesisRun: loadInterpretiveSynthesisRunProjection(adapter, run.synthesisRunId),
            };
        }
        const candidatePayload = {
            interpretationId: sanitizeIdentifier(payload?.interpretationId || createId('interp'), 'interpretationId'),
            interpretationRevisionId: sanitizeIdentifier(payload?.interpretationRevisionId || createId('interprev'), 'interpretationRevisionId'),
            revisionReason: 'INITIAL_PROPOSAL',
            memoryScopeId: run.memoryScopeId,
            memorySubjectId: run.memorySubjectId,
            type: normalizedProposal.type,
            statement: normalizedProposal.statement,
            assertionDomains: normalizedProposal.assertionDomains,
            sharedRelationshipAsserted: normalizedProposal.sharedRelationshipAsserted,
            personalMeaningAsserted: normalizedProposal.personalMeaningAsserted,
            materialParticipantEntityIds: normalizedProposal.materialParticipantEntityIds,
            groundingLinks,
            groundingOutcomeOverride: groundingEvaluation.aggregateOutcome,
            now: timestamp,
        };
        const prepared = prepareInterpretiveCandidate(candidatePayload, timestamp);
        const admissionEvent = createSynthesisProposalAdmissionEvent(
            proposal,
            prepared.candidate.interpretationRevisionId,
            timestamp,
        );
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [
            createSynthesisProposalEvent(proposal),
            createSynthesisGroundingRecordedEvent(proposal.synthesisProposalId, proposal.synthesisRunId, groundingEvaluation),
            admissionEvent,
            ...createLedgerEvents(prepared, timestamp),
        ]);
        adapter.transaction(() => {
            persistInterpretiveSynthesisProposalRow(adapter, proposal);
            upsertInterpretiveSynthesisGroundingEvaluation(adapter, proposal.synthesisProposalId, groundingEvaluation);
            adapter.run(
                `UPDATE interpretation_synthesis_proposals
                 SET interpretation_revision_id = ?, proposal_status = 'ADMITTED', updated_at = ?
                 WHERE synthesis_proposal_id = ?`,
                [
                    prepared.candidate.interpretationRevisionId,
                    timestamp,
                    proposal.synthesisProposalId,
                ],
            );
            adapter.run(
                `UPDATE interpretation_synthesis_runs
                 SET generated_candidate_ids_json = ?, run_status = 'COMPLETED_ADMITTED', updated_at = ?
                 WHERE synthesis_run_id = ?`,
                [
                    stableStringify([prepared.candidate.interpretationRevisionId]),
                    timestamp,
                    run.synthesisRunId,
                ],
            );
            persistPreparedCandidateRows(adapter, prepared, timestamp);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.3',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            admitted: true,
            quarantined: false,
            synthesisRun: loadInterpretiveSynthesisRunProjection(adapter, run.synthesisRunId),
            interpretation: loadInterpretiveCandidateProjection(adapter, prepared.candidate.interpretationRevisionId),
        };
    } finally {
        adapter.close();
    }
}

export function createInterpretiveCandidate(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const prepared = prepareInterpretiveCandidate(payload, timestamp);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    fs.mkdirSync(paths.storageRoot, { recursive: true });
    const events = createLedgerEvents(prepared, timestamp);
    appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, events);

    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        persistPreparedCandidate(adapter, prepared, timestamp);
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.1',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            interpretation: loadInterpretiveCandidateProjection(adapter, prepared.candidate.interpretationRevisionId),
        };
    } finally {
        adapter.close();
    }
}

export function submitInterpretiveReviewDisposition(request, reviewRequestId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const actorEntityId = sanitizeIdentifier(payload?.actorEntityId, 'actorEntityId');
    const disposition = String(payload?.disposition || '').trim();
    if (!ALLOWED_REVIEW_DISPOSITIONS.has(disposition)) {
        throw createError(400, 'disposition is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const reviewEnvelopeHash = String(payload?.reviewEnvelopeHash || '').trim();
    if (!reviewEnvelopeHash.startsWith('sha256:')) {
        throw createError(400, 'reviewEnvelopeHash is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const reasonCodes = normalizeReasonCodes(payload?.reasonCodes, 'reasonCodes');
    const commentary = normalizeOptionalCommentary(payload?.commentary, 'commentary');

    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const requestRow = loadReviewRequestRow(adapter, sanitizeIdentifier(reviewRequestId, 'reviewRequestId'));
        if (!requestRow) {
            throw createError(404, `Review request ${reviewRequestId} was not found`, 'ARCH_REVIEW_REQUEST_NOT_FOUND');
        }
        if (requestRow.status !== 'PENDING') {
            throw createError(409, `Review request ${reviewRequestId} is not pending`, 'ARCH_REVIEW_REQUEST_NOT_PENDING');
        }
        if (requestRow.reviewer_entity_id !== actorEntityId) {
            throw createError(403, 'Only the exact bound reviewer may submit this disposition', 'ARCH_REVIEWER_IDENTITY_MISMATCH');
        }
        const interpretation = loadInterpretiveCandidateProjection(adapter, requestRow.interpretation_revision_id);
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${requestRow.interpretation_revision_id} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        if (interpretation.reviewEnvelopeHash !== requestRow.review_envelope_hash || interpretation.reviewEnvelopeHash !== reviewEnvelopeHash) {
            throw createError(409, 'Review envelope hash is stale for this request', 'ARCH_STALE_REVIEW_ENVELOPE');
        }

        const reviewDisposition = {
            reviewDispositionId: createId('reviewdisp'),
            reviewRequestId: requestRow.review_request_id,
            interpretationRevisionId: interpretation.interpretationRevisionId,
            reviewerRole: requestRow.reviewer_role,
            reviewerEntityId: requestRow.reviewer_entity_id,
            disposition,
            reasonCodes,
            commentary,
            reviewEnvelopeHash,
            submittedAt: timestamp,
        };

        let childInterpretation = null;
        let childPrepared = null;
        if (disposition === 'APPROVE_WITH_EDIT') {
            const childPayload = buildChildRevisionPayload(
                interpretation,
                payload,
                reviewDisposition.reviewDispositionId,
                requestRow.reviewer_role,
                timestamp,
            );
            childPrepared = prepareInterpretiveCandidate(childPayload, timestamp);
            childInterpretation = childPrepared.candidate.interpretationRevisionId;
            reviewDisposition.childInterpretationRevisionId = childInterpretation;
        }

        const events = [createReviewDispositionEvent(reviewDisposition, interpretation)];
        if (childPrepared) {
            events.push(...createLedgerEvents(childPrepared, timestamp));
        }
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, events);

        adapter.transaction(() => {
            adapter.run(
                `INSERT INTO interpretation_review_dispositions (
                    review_disposition_id, review_request_id, interpretation_revision_id, reviewer_role,
                    reviewer_entity_id, disposition, reason_codes_json, commentary, review_envelope_hash, submitted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    reviewDisposition.reviewDispositionId,
                    reviewDisposition.reviewRequestId,
                    reviewDisposition.interpretationRevisionId,
                    reviewDisposition.reviewerRole,
                    reviewDisposition.reviewerEntityId,
                    reviewDisposition.disposition,
                    stableStringify(reviewDisposition.reasonCodes),
                    reviewDisposition.commentary,
                    reviewDisposition.reviewEnvelopeHash,
                    reviewDisposition.submittedAt,
                ],
            );
            const requestStatus = deriveRequestStatusFromDisposition(disposition);
            adapter.run(
                'UPDATE interpretation_review_requests SET status = ? WHERE review_request_id = ?',
                [requestStatus, requestRow.review_request_id],
            );
            adapter.run(
                'UPDATE interpretation_review_obligations SET obligation_state = ?, blocking_reason = ? WHERE review_obligation_id = ?',
                [deriveObligationStateFromRequestStatus(requestStatus), 'NONE', requestRow.review_obligation_id],
            );
            recomputeCandidateReviewState(adapter, interpretation.interpretationRevisionId, timestamp);
            if (childPrepared) {
                persistPreparedCandidateRows(adapter, childPrepared, timestamp);
            }
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.2',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            disposition: reviewDisposition,
            interpretation: loadInterpretiveCandidateProjection(adapter, interpretation.interpretationRevisionId),
            childInterpretation: childPrepared
                ? loadInterpretiveCandidateProjection(adapter, childPrepared.candidate.interpretationRevisionId)
                : null,
        };
    } finally {
        adapter.close();
    }
}

export function recordInterpretiveSubjectDisposition(request, interpretationRevisionId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const actorEntityId = sanitizeIdentifier(payload?.actorEntityId, 'actorEntityId');
    const state = String(payload?.state || '').trim();
    if (!ALLOWED_SUBJECT_DISPOSITION_STATES.has(state)) {
        throw createError(400, 'state is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const reviewEnvelopeHash = String(payload?.reviewEnvelopeHash || '').trim();
    if (!reviewEnvelopeHash.startsWith('sha256:')) {
        throw createError(400, 'reviewEnvelopeHash is invalid', 'ARCH_INVALID_PAYLOAD');
    }
    const reasonCodes = normalizeReasonCodes(payload?.reasonCodes, 'reasonCodes');
    const commentary = normalizeOptionalCommentary(payload?.commentary, 'commentary');

    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const normalizedRevisionId = sanitizeIdentifier(interpretationRevisionId, 'interpretationRevisionId');
        const interpretation = loadInterpretiveCandidateProjection(adapter, normalizedRevisionId);
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        if (actorEntityId !== interpretation.memorySubjectId) {
            throw createError(403, 'Only the memory subject may record final continuity disposition', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        if (interpretation.reviewEnvelopeHash !== reviewEnvelopeHash) {
            throw createError(409, 'Subject disposition is stale for this review envelope', 'ARCH_STALE_REVIEW_ENVELOPE');
        }
        const pendingRequests = interpretation.reviewRequests.filter((entry) => entry.status === 'PENDING' || entry.status === 'DEFERRED');
        if (pendingRequests.length > 0 || interpretation.reviewState === 'BLOCKED' || interpretation.reviewState === 'PENDING' || interpretation.reviewState === 'DEFERRED') {
            throw createError(409, 'Required review is not complete for subject disposition', 'ARCH_REVIEW_INCOMPLETE');
        }

        const currentSubjectDisposition = interpretation.subjectDisposition || {
            memorySubjectId: interpretation.memorySubjectId,
            finalDispositionAuthority: 'MEMORY_SUBJECT',
            createdAt: timestamp,
        };
        const nextSubjectDisposition = {
            subjectDispositionId: createId('subjectdisp'),
            memorySubjectId: interpretation.memorySubjectId,
            state,
            finalDispositionAuthority: currentSubjectDisposition.finalDispositionAuthority,
            reasonCodes,
            commentary,
            createdAt: currentSubjectDisposition.createdAt,
            updatedAt: timestamp,
        };
        appendLedgerEvents(
            paths.interpretiveGovernanceLedgerPath,
            [createSubjectDispositionEvent(nextSubjectDisposition, interpretation, reviewEnvelopeHash)],
        );
        adapter.transaction(() => {
            adapter.run(
                `UPDATE interpretation_subject_dispositions
                 SET state = ?, reason_codes_json = ?, commentary = ?, updated_at = ?
                 WHERE interpretation_revision_id = ?`,
                [
                    nextSubjectDisposition.state,
                    stableStringify(nextSubjectDisposition.reasonCodes),
                    nextSubjectDisposition.commentary,
                    nextSubjectDisposition.updatedAt,
                    interpretation.interpretationRevisionId,
                ],
            );
            adapter.run(
                `UPDATE interpretation_revisions
                 SET subject_disposition_state = ?, publication_state = 'NOT_PUBLISHED',
                     authority_effect = 'DESCRIPTIVE_ONLY', updated_at = ?
                 WHERE interpretation_revision_id = ?`,
                [
                    nextSubjectDisposition.state,
                    nextSubjectDisposition.updatedAt,
                    interpretation.interpretationRevisionId,
                ],
            );
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.2',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            subjectDisposition: nextSubjectDisposition,
            interpretation: loadInterpretiveCandidateProjection(adapter, interpretation.interpretationRevisionId),
        };
    } finally {
        adapter.close();
    }
}

export function createInterpretiveRevision(request, interpretationRevisionId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const actorEntityId = sanitizeIdentifier(payload?.actorEntityId, 'actorEntityId');
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const interpretation = loadInterpretiveCandidateProjection(
            adapter,
            sanitizeIdentifier(interpretationRevisionId, 'interpretationRevisionId'),
        );
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        if (actorEntityId !== interpretation.memorySubjectId) {
            throw createError(403, 'Only the memory subject may create a direct child revision in C0.6.2', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const childPayload = buildChildRevisionPayload(
            interpretation,
            payload,
            payload?.createdFromDispositionId ? sanitizeIdentifier(payload.createdFromDispositionId, 'createdFromDispositionId') : null,
            'MEMORY_SUBJECT',
            timestamp,
        );
        const prepared = prepareInterpretiveCandidate(childPayload, timestamp);
        const events = createLedgerEvents(prepared, timestamp);
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, events);
        persistPreparedCandidate(adapter, prepared, timestamp);
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.2',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            interpretation: loadInterpretiveCandidateProjection(adapter, prepared.candidate.interpretationRevisionId),
        };
    } finally {
        adapter.close();
    }
}

export function listInterpretiveReviews(request, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const params = [];
        const where = [];
        if (filters.interpretationRevisionId) {
            where.push('r.interpretation_revision_id = ?');
            params.push(sanitizeIdentifier(filters.interpretationRevisionId, 'interpretationRevisionId'));
        }
        if (filters.reviewerEntityId) {
            where.push('r.reviewer_entity_id = ?');
            params.push(sanitizeIdentifier(filters.reviewerEntityId, 'reviewerEntityId'));
        }
        if (filters.status) {
            where.push('r.status = ?');
            params.push(String(filters.status).trim());
        }
        const sql = `SELECT
                r.review_request_id,
                r.review_obligation_id,
                r.interpretation_revision_id,
                r.reviewer_role,
                r.reviewer_entity_id,
                r.status,
                r.review_envelope_hash,
                r.created_at,
                o.obligation_state,
                o.blocking_reason,
                d.review_disposition_id,
                d.disposition,
                d.reason_codes_json,
                d.commentary,
                d.submitted_at
            FROM interpretation_review_requests r
            INNER JOIN interpretation_review_obligations o ON o.review_obligation_id = r.review_obligation_id
            LEFT JOIN interpretation_review_dispositions d ON d.review_request_id = r.review_request_id
            ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY r.created_at, r.review_request_id`;
        const rows = adapter.all(sql, params);
        return {
            ok: true,
            phase: 'c0.6.2',
            reviews: rows.map((row) => ({
                reviewRequestId: row.review_request_id,
                reviewObligationId: row.review_obligation_id,
                interpretationRevisionId: row.interpretation_revision_id,
                reviewerRole: row.reviewer_role,
                reviewerEntityId: row.reviewer_entity_id,
                status: row.status,
                reviewEnvelopeHash: row.review_envelope_hash,
                createdAt: Number(row.created_at),
                obligationState: row.obligation_state,
                blockingReason: row.blocking_reason,
                disposition: row.review_disposition_id ? {
                    reviewDispositionId: row.review_disposition_id,
                    disposition: row.disposition,
                    reasonCodes: JSON.parse(row.reason_codes_json),
                    commentary: row.commentary,
                    submittedAt: Number(row.submitted_at),
                } : null,
            })),
        };
    } finally {
        adapter.close();
    }
}

export function getInterpretiveCandidate(request, interpretationRevisionId) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const interpretation = loadInterpretiveCandidateProjection(
            adapter,
            sanitizeIdentifier(interpretationRevisionId, 'interpretationRevisionId'),
        );
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        return {
            ok: true,
            phase: 'c0.6.1',
            interpretation,
        };
    } finally {
        adapter.close();
    }
}

export function listInterpretivePolicyDefinitions(request) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const rows = adapter.all(
            'SELECT * FROM interpretation_policy_definitions ORDER BY validation_policy_id, policy_version',
        );
        return {
            ok: true,
            phase: 'c0.6.1',
            policies: rows.map((row) => ({
                validationPolicyId: row.validation_policy_id,
                policyVersion: Number(row.policy_version),
                policyHash: row.policy_hash,
                requiredGroundingOutcome: row.required_grounding_outcome,
                requiredReviewers: JSON.parse(row.required_reviewers_json),
                finalDispositionAuthority: row.final_disposition_authority,
                autoApprovalAllowed: Number(row.auto_approval_allowed) === 1,
                onDisagreement: row.on_disagreement,
                details: JSON.parse(row.details_json),
            })),
        };
    } finally {
        adapter.close();
    }
}

export function listInterpretiveSynthesisPolicies(request, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const params = [];
        const where = [];
        if (filters.memorySubjectId) {
            where.push('memory_subject_id = ?');
            params.push(sanitizeIdentifier(filters.memorySubjectId, 'memorySubjectId'));
        }
        if (filters.synthesisPolicyId) {
            where.push('synthesis_policy_id = ?');
            params.push(sanitizeIdentifier(filters.synthesisPolicyId, 'synthesisPolicyId'));
        }
        const rows = adapter.all(
            `SELECT synthesis_policy_id, policy_version
             FROM interpretation_synthesis_policies
             ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY synthesis_policy_id, policy_version`,
            params,
        );
        return {
            ok: true,
            phase: 'c0.6.3',
            policies: rows.map((row) => (
                loadInterpretiveSynthesisPolicyProjection(adapter, row.synthesis_policy_id, Number(row.policy_version))
            )),
        };
    } finally {
        adapter.close();
    }
}

export function getInterpretiveSynthesisRun(request, synthesisRunId) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const synthesisRun = loadInterpretiveSynthesisRunProjection(
            adapter,
            sanitizeIdentifier(synthesisRunId, 'synthesisRunId'),
        );
        if (!synthesisRun) {
            throw createError(404, `Synthesis run ${synthesisRunId} was not found`, 'ARCH_SYNTHESIS_RUN_NOT_FOUND');
        }
        return {
            ok: true,
            phase: 'c0.6.3',
            synthesisRun,
        };
    } finally {
        adapter.close();
    }
}
