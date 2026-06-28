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

const ALLOWED_SUBMISSION_MODES = new Set([
    'DIRECT_REVIEWER_ACTION',
    'DIRECT_SUBJECT_ACTION',
    'SUBJECT_EXPRESSED_AND_RECORDED',
    'TRUSTED_DELEGATE',
    'SYSTEM_GROUNDING_ACTION',
]);

const ALLOWED_DELEGATION_ACTIONS = new Set([
    'REVIEW_DISPOSITION',
    'SUBJECT_REVISION',
    'SUBJECT_DISPOSITION',
    'DNM_SUPERSESSION',
    'DNM_WITHDRAWAL',
    'DNM_DELTA_REVIEW',
]);

const ALLOWED_DELEGATION_EVIDENCE_REQUIREMENTS = new Set([
    'OPTIONAL',
    'REQUIRED',
]);

const ALLOWED_DELEGATION_POLICY_STATES = new Set([
    'ACTIVE',
    'REVOKED',
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

const ALLOWED_PUBLICATION_POLICY_STATES = new Set([
    'ACTIVE',
    'REVOKED',
]);

const ALLOWED_CONTINUITY_TARGET_TYPES = new Set([
    'MEMORY_SUBJECT',
]);

const ALLOWED_SUBJECT_IDENTITY_MODES = new Set([
    'EXACT_SUBJECT',
]);

const ALLOWED_PUBLICATION_ELIGIBILITY_VERDICTS = new Set([
    'ELIGIBLE',
    'INELIGIBLE',
]);

const ALLOWED_PUBLICATION_AUTHORIZATION_STATUSES = new Set([
    'AUTHORIZED',
    'CONSUMED',
    'EXPIRED',
]);

const ALLOWED_DNM_PUBLICATION_STATES = new Set([
    'PUBLISHED',
]);

const ALLOWED_DNM_LIFECYCLE_STATES = new Set([
    'ACTIVE',
    'SUPERSEDED',
    'WITHDRAWN',
    'CONTEST_REOPENED',
    'DELTA_PENDING',
]);

const ALLOWED_DNM_DELTA_REVIEW_STATES = new Set([
    'NONE',
    'PENDING',
    'CLOSED',
]);

const GROUNDING_OUTCOME_ORDER = Object.freeze({
    UNSUPPORTED: 0,
    BASIS_INCOMPLETE: 1,
    PARTIALLY_SUPPORTED: 2,
    SUPPORTED: 3,
    STRONGLY_SUPPORTED: 4,
    CONTRARY_EVIDENCE_PRESENT: 0,
    INVALIDATED_SOURCE_MUTATION: 0,
});

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

function computeDelegationPolicyHash(policy) {
    return hashCanonical({
        delegationPolicyId: policy.delegationPolicyId,
        policyVersion: policy.policyVersion,
        principalEntityId: policy.principalEntityId,
        delegateEntityId: policy.delegateEntityId,
        allowedActions: policy.allowedActions,
        memoryScopeId: policy.memoryScopeId,
        continuityTargetId: policy.continuityTargetId,
        evidenceRequirement: policy.evidenceRequirement,
        revocable: policy.revocable,
    }).hash;
}

function computePublicationPolicyHash(policy) {
    return hashCanonical({
        publicationPolicyId: policy.publicationPolicyId,
        policyVersion: policy.policyVersion,
        continuityTargetType: policy.continuityTargetType,
        subjectIdentityMode: policy.subjectIdentityMode,
        permittedInterpretationTypes: policy.permittedInterpretationTypes,
        requiredFinalSubjectState: policy.requiredFinalSubjectState,
        requiredGroundingOutcome: policy.requiredGroundingOutcome,
        participantDisagreementBlocksPublication: policy.participantDisagreementBlocksPublication,
        contestOrDeferBlocksPublication: policy.contestOrDeferBlocksPublication,
        immutableChildRequiredForTypes: policy.immutableChildRequiredForTypes,
        postGrantHumanPublicationAuthorizationRequired: policy.postGrantHumanPublicationAuthorizationRequired,
        details: policy.details,
    }).hash;
}

function computePublicationQualificationBindingHash(binding) {
    return hashCanonical({
        bindingVersion: 1,
        ...binding,
    }).hash;
}

function getPolicyDefinition(validationPolicyId, policyVersion) {
    return POLICY_DEFINITIONS.find((entry) => (
        entry.validationPolicyId === validationPolicyId
        && Number(entry.policyVersion) === Number(policyVersion)
    )) || null;
}

function createDelegationPolicyEvent(policy) {
    return {
        eventId: createId('iglevent'),
        eventType: 'DELEGATION_POLICY_REGISTERED',
        occurredAt: policy.createdAt,
        memoryScopeId: policy.memoryScopeId,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: cloneJson(policy),
    };
}

function createDelegationPolicyRevocationEvent(policy, timestamp) {
    return {
        eventId: createId('iglevent'),
        eventType: 'DELEGATION_POLICY_REVOKED',
        occurredAt: timestamp,
        memoryScopeId: policy.memoryScopeId,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: {
            delegationPolicyId: policy.delegationPolicyId,
            policyVersion: policy.policyVersion,
            policyHash: policy.policyHash,
            revokedAt: timestamp,
            revocationReason: policy.revocationReason,
        },
    };
}

function createPublicationPolicyEvent(policy) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_PUBLICATION_POLICY_REGISTERED',
        occurredAt: policy.createdAt,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: cloneJson(policy),
    };
}

function createPublicationPolicyRevocationEvent(policy, timestamp) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_PUBLICATION_POLICY_REVOKED',
        occurredAt: timestamp,
        memoryScopeId: null,
        interpretationId: null,
        interpretationRevisionId: null,
        payload: {
            publicationPolicyId: policy.publicationPolicyId,
            policyVersion: policy.policyVersion,
            policyHash: policy.policyHash,
            revokedAt: timestamp,
            revocationReason: policy.revocationReason,
        },
    };
}

function createPublicationAuthorizationEvent(authorization) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_PUBLICATION_AUTHORIZED',
        occurredAt: authorization.authorizedAt,
        memoryScopeId: authorization.memoryScopeId,
        interpretationId: null,
        interpretationRevisionId: authorization.interpretationRevisionId,
        payload: cloneJson(authorization),
    };
}

function createPublicationAuthorizationRefusedEvent(authorization, refusalCodes, timestamp) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_PUBLICATION_REFUSED',
        occurredAt: timestamp,
        memoryScopeId: authorization.memoryScopeId,
        interpretationId: null,
        interpretationRevisionId: authorization.interpretationRevisionId,
        payload: {
            publicationAuthorizationId: authorization.publicationAuthorizationId,
            refusalCodes: Array.from(new Set(refusalCodes)).sort(),
            status: 'EXPIRED',
            refusedAt: timestamp,
        },
    };
}

function createDnmPublishedEvent(record) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_PUBLISHED',
        occurredAt: record.publishedAt,
        memoryScopeId: record.memoryScopeId,
        interpretationId: record.sourceInterpretationId,
        interpretationRevisionId: record.sourceInterpretationRevisionId,
        payload: cloneJson(record),
    };
}

function createDnmSupersededEvent(payload) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_SUPERSEDED',
        occurredAt: payload.supersededAt,
        memoryScopeId: payload.memoryScopeId,
        interpretationId: payload.replacementInterpretationId,
        interpretationRevisionId: payload.replacementInterpretationRevisionId,
        payload: cloneJson(payload),
    };
}

function createDnmWithdrawnEvent(payload) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_WITHDRAWN',
        occurredAt: payload.withdrawnAt,
        memoryScopeId: payload.memoryScopeId,
        interpretationId: payload.sourceInterpretationId,
        interpretationRevisionId: payload.sourceInterpretationRevisionId,
        payload: cloneJson(payload),
    };
}

function createDnmDeltaReviewRecordedEvent(payload) {
    return {
        eventId: createId('dnmlevent'),
        eventType: 'DNM_DELTA_REVIEW_RECORDED',
        occurredAt: payload.createdAt,
        memoryScopeId: payload.memoryScopeId,
        interpretationId: payload.sourceInterpretationId,
        interpretationRevisionId: payload.sourceInterpretationRevisionId,
        payload: cloneJson(payload),
    };
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

function normalizeEnumValue(value, fieldName, allowedValues, fallback = null) {
    const normalized = String(value ?? fallback ?? '').trim();
    if (!allowedValues.has(normalized)) {
        throw createError(400, `${fieldName} is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    return normalized;
}

function compareGroundingOutcomeLevel(left, right) {
    return (GROUNDING_OUTCOME_ORDER[left] ?? -1) - (GROUNDING_OUTCOME_ORDER[right] ?? -1);
}

function normalizeActorEntityId(payload = {}) {
    return sanitizeIdentifier(
        payload?.submittedByActorId || payload?.actorEntityId,
        payload?.submittedByActorId ? 'submittedByActorId' : 'actorEntityId',
    );
}

function normalizeSubmissionMode(value, fieldName = 'submissionMode') {
    const normalized = String(value || '').trim();
    if (!ALLOWED_SUBMISSION_MODES.has(normalized)) {
        throw createError(400, `${fieldName} is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    return normalized;
}

function normalizeSubjectEvidenceRefs(value, fieldName = 'subjectEvidenceRefs') {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw createError(400, `${fieldName} must be an array`, 'ARCH_INVALID_PAYLOAD');
    }
    return value.map((entry, index) => {
        if (typeof entry === 'string') {
            const normalized = entry.trim();
            if (!normalized) {
                throw createError(400, `${fieldName}[${index}] must not be empty`, 'ARCH_INVALID_PAYLOAD');
            }
            return normalized;
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw createError(400, `${fieldName}[${index}] must be a string or object`, 'ARCH_INVALID_PAYLOAD');
        }
        return cloneJson(entry);
    });
}

function normalizeDelegationActionList(value, fieldName = 'allowedActions') {
    return normalizeStringArray(value, fieldName, ALLOWED_DELEGATION_ACTIONS);
}

function normalizeDelegationEvidenceRequirement(value, fieldName = 'evidenceRequirement') {
    const normalized = String(value || '').trim();
    if (!ALLOWED_DELEGATION_EVIDENCE_REQUIREMENTS.has(normalized)) {
        throw createError(400, `${fieldName} is invalid`, 'ARCH_INVALID_PAYLOAD');
    }
    return normalized;
}

function buildInterpretiveDelegationPolicyRecord(payload, timestamp) {
    const delegationPolicyId = sanitizeIdentifier(payload?.delegationPolicyId, 'delegationPolicyId');
    const policyVersion = normalizePositiveInteger(payload?.policyVersion, 'policyVersion', 1, 1_000_000);
    const principalEntityId = sanitizeIdentifier(payload?.principalEntityId, 'principalEntityId');
    const delegateEntityId = sanitizeIdentifier(payload?.delegateEntityId, 'delegateEntityId');
    const allowedActions = normalizeDelegationActionList(payload?.allowedActions, 'allowedActions');
    const memoryScopeId = sanitizeIdentifier(payload?.memoryScopeId, 'memoryScopeId');
    const continuityTargetId = payload?.continuityTargetId == null
        ? null
        : sanitizeIdentifier(payload?.continuityTargetId, 'continuityTargetId');
    const evidenceRequirement = normalizeDelegationEvidenceRequirement(payload?.evidenceRequirement, 'evidenceRequirement');
    const revocable = normalizeBoolean(payload?.revocable, 'revocable');
    const policy = {
        delegationPolicyId,
        policyVersion,
        principalEntityId,
        delegateEntityId,
        allowedActions,
        memoryScopeId,
        continuityTargetId,
        evidenceRequirement,
        revocable,
        policyState: 'ACTIVE',
        revocationReason: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        revokedAt: null,
    };
    return {
        ...policy,
        policyHash: computeDelegationPolicyHash(policy),
    };
}

function buildInterpretivePublicationPolicyRecord(payload, timestamp) {
    const publicationPolicyId = sanitizeIdentifier(payload?.publicationPolicyId, 'publicationPolicyId');
    const policyVersion = normalizePositiveInteger(payload?.policyVersion, 'policyVersion', 1, 1_000_000);
    const continuityTargetType = normalizeEnumValue(
        payload?.continuityTargetType,
        'continuityTargetType',
        ALLOWED_CONTINUITY_TARGET_TYPES,
        'MEMORY_SUBJECT',
    );
    const subjectIdentityMode = normalizeEnumValue(
        payload?.subjectIdentityMode,
        'subjectIdentityMode',
        ALLOWED_SUBJECT_IDENTITY_MODES,
        'EXACT_SUBJECT',
    );
    const permittedInterpretationTypes = normalizeStringArray(
        payload?.permittedInterpretationTypes || ['ROLE_EVOLUTION'],
        'permittedInterpretationTypes',
        ALLOWED_INTERPRETATION_TYPES,
    );
    const requiredFinalSubjectState = normalizeEnumValue(
        payload?.requiredFinalSubjectState,
        'requiredFinalSubjectState',
        ALLOWED_SUBJECT_DISPOSITION_STATES,
        'GRANTED',
    );
    const requiredGroundingOutcome = normalizeEnumValue(
        payload?.requiredGroundingOutcome,
        'requiredGroundingOutcome',
        new Set(Object.keys(GROUNDING_OUTCOME_ORDER)),
        'SUPPORTED',
    );
    const participantDisagreementBlocksPublication = normalizeBoolean(
        payload?.participantDisagreementBlocksPublication,
        'participantDisagreementBlocksPublication',
    );
    const contestOrDeferBlocksPublication = normalizeBoolean(
        payload?.contestOrDeferBlocksPublication,
        'contestOrDeferBlocksPublication',
    );
    const immutableChildRequiredForTypes = normalizeStringArrayAllowEmpty(
        payload?.immutableChildRequiredForTypes || [],
        'immutableChildRequiredForTypes',
        ALLOWED_INTERPRETATION_TYPES,
    );
    const postGrantHumanPublicationAuthorizationRequired = normalizeBoolean(
        payload?.postGrantHumanPublicationAuthorizationRequired,
        'postGrantHumanPublicationAuthorizationRequired',
    );
    const details = normalizeOptionalPlainObject(payload?.details, 'details');
    const policy = {
        publicationPolicyId,
        policyVersion,
        continuityTargetType,
        subjectIdentityMode,
        permittedInterpretationTypes,
        requiredFinalSubjectState,
        requiredGroundingOutcome,
        participantDisagreementBlocksPublication,
        contestOrDeferBlocksPublication,
        immutableChildRequiredForTypes,
        postGrantHumanPublicationAuthorizationRequired,
        policyState: 'ACTIVE',
        revocationReason: null,
        details,
        createdAt: timestamp,
        updatedAt: timestamp,
        revokedAt: null,
    };
    return {
        ...policy,
        policyHash: computePublicationPolicyHash(policy),
    };
}

function defaultReviewSubmissionMode(requestRow, submittedByActorId) {
    if (requestRow.reviewer_entity_id === submittedByActorId) {
        return requestRow.reviewer_role === 'MEMORY_SUBJECT'
            ? 'DIRECT_SUBJECT_ACTION'
            : 'DIRECT_REVIEWER_ACTION';
    }
    return 'TRUSTED_DELEGATE';
}

function defaultSubjectSubmissionMode(memorySubjectId, submittedByActorId) {
    return memorySubjectId === submittedByActorId ? 'DIRECT_SUBJECT_ACTION' : 'TRUSTED_DELEGATE';
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
        revisionCreationProvenance: payload?.revisionCreationProvenance
            ? cloneJson(payload.revisionCreationProvenance)
            : null,
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
            revisionCreationProvenance: cloneJson(prepared.candidate.revisionCreationProvenance),
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
            provenance: cloneJson(subjectDisposition.provenance || null),
            reviewEnvelopeHash,
            createdAt: subjectDisposition.createdAt,
            updatedAt: subjectDisposition.updatedAt,
        },
    };
}

function createActionProvenanceRecord({
    interpretationRevisionId,
    actionKind,
    actionTargetId,
    dispositionOwnerId,
    submittedByActorId,
    submissionMode,
    delegationPolicy = null,
    subjectEvidenceRefs = [],
    createdAt,
}) {
    return {
        actionProvenanceId: createId('actionprov'),
        interpretationRevisionId,
        actionKind,
        actionTargetId,
        dispositionOwnerId,
        submittedByActorId,
        submissionMode,
        delegationPolicyId: delegationPolicy?.delegationPolicyId || null,
        delegationPolicyVersion: delegationPolicy?.policyVersion ?? null,
        delegationPolicyHash: delegationPolicy?.policyHash || null,
        subjectEvidenceRefs: cloneJson(subjectEvidenceRefs),
        createdAt,
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
    'interpretation_action_provenance',
    'interpretation_delegation_policies',
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

function loadInterpretiveDelegationPolicyProjection(adapter, delegationPolicyId, policyVersion) {
    const row = adapter.get(
        `SELECT * FROM interpretation_delegation_policies
         WHERE delegation_policy_id = ? AND policy_version = ?`,
        [delegationPolicyId, policyVersion],
    );
    if (!row) {
        return null;
    }
    return {
        delegationPolicyId: row.delegation_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        principalEntityId: row.principal_entity_id,
        delegateEntityId: row.delegate_entity_id,
        allowedActions: JSON.parse(row.allowed_actions_json),
        memoryScopeId: row.memory_scope_id,
        continuityTargetId: row.continuity_target_id,
        evidenceRequirement: row.evidence_requirement,
        revocable: Number(row.revocable) === 1,
        policyState: row.policy_state,
        revocationReason: row.revocation_reason,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    };
}

function loadInterpretivePublicationPolicyProjection(adapter, publicationPolicyId, policyVersion) {
    const row = adapter.get(
        `SELECT * FROM interpretation_publication_policies
         WHERE publication_policy_id = ? AND policy_version = ?`,
        [publicationPolicyId, policyVersion],
    );
    if (!row) {
        return null;
    }
    return {
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        continuityTargetType: row.continuity_target_type,
        subjectIdentityMode: row.subject_identity_mode,
        permittedInterpretationTypes: JSON.parse(row.permitted_interpretation_types_json),
        requiredFinalSubjectState: row.required_final_subject_state,
        requiredGroundingOutcome: row.required_grounding_outcome,
        participantDisagreementBlocksPublication: Number(row.participant_disagreement_blocks_publication) === 1,
        contestOrDeferBlocksPublication: Number(row.contest_or_defer_blocks_publication) === 1,
        immutableChildRequiredForTypes: JSON.parse(row.immutable_child_required_for_types_json),
        postGrantHumanPublicationAuthorizationRequired: Number(row.post_grant_human_publication_authorization_required) === 1,
        policyState: row.policy_state,
        revocationReason: row.revocation_reason,
        details: JSON.parse(row.details_json),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    };
}

function loadLatestInterpretivePublicationPolicy(adapter, publicationPolicyId) {
    const row = adapter.get(
        `SELECT publication_policy_id, policy_version
         FROM interpretation_publication_policies
         WHERE publication_policy_id = ?
         ORDER BY policy_version DESC
         LIMIT 1`,
        [publicationPolicyId],
    );
    if (!row) {
        return null;
    }
    return loadInterpretivePublicationPolicyProjection(adapter, row.publication_policy_id, Number(row.policy_version));
}

function loadInterpretivePublicationQualificationRow(adapter, qualificationId) {
    const row = adapter.get(
        `SELECT * FROM interpretation_publication_qualifications
         WHERE qualification_id = ?`,
        [qualificationId],
    );
    if (!row) {
        return null;
    }
    return {
        qualificationId: row.qualification_id,
        interpretationRevisionId: row.interpretation_revision_id,
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        continuityTargetId: row.continuity_target_id,
        continuityTargetType: row.continuity_target_type,
        memoryScopeId: row.memory_scope_id,
        memorySubjectId: row.memory_subject_id,
        eligibilityVerdict: row.eligibility_verdict,
        refusalCodes: JSON.parse(row.refusal_codes_json),
        binding: JSON.parse(row.binding_json),
        evaluatedAt: Number(row.evaluated_at),
    };
}

function loadInterpretivePublicationAuthorizationProjection(adapter, publicationAuthorizationId) {
    const row = adapter.get(
        `SELECT * FROM interpretation_publication_authorizations
         WHERE publication_authorization_id = ?`,
        [publicationAuthorizationId],
    );
    if (!row) {
        return null;
    }
    return {
        publicationAuthorizationId: row.publication_authorization_id,
        qualificationId: row.qualification_id,
        interpretationRevisionId: row.interpretation_revision_id,
        publicationPolicyId: row.publication_policy_id,
        policyVersion: Number(row.policy_version),
        policyHash: row.policy_hash,
        continuityTargetId: row.continuity_target_id,
        continuityTargetType: row.continuity_target_type,
        memoryScopeId: row.memory_scope_id,
        memorySubjectId: row.memory_subject_id,
        authorizationNonce: row.authorization_nonce,
        qualificationBindingHash: row.qualification_binding_hash,
        authorizedBy: row.authorized_by,
        authorizedAt: Number(row.authorized_at),
        expiresAt: Number(row.expires_at),
        status: row.status,
        binding: JSON.parse(row.binding_json),
        consumedAt: row.consumed_at === null ? null : Number(row.consumed_at),
        dnmRecordId: row.dnm_record_id,
    };
}

function loadInterpretivePublicationQualificationsForRevision(adapter, interpretationRevisionId, continuityTargetId = null) {
    const params = [interpretationRevisionId];
    let where = 'interpretation_revision_id = ?';
    if (continuityTargetId) {
        where += ' AND continuity_target_id = ?';
        params.push(continuityTargetId);
    }
    const rows = adapter.all(
        `SELECT qualification_id
         FROM interpretation_publication_qualifications
         WHERE ${where}
         ORDER BY evaluated_at DESC, qualification_id DESC`,
        params,
    );
    return rows.map((row) => loadInterpretivePublicationQualificationRow(adapter, row.qualification_id));
}

function loadInterpretivePublicationAuthorizationsForRevision(adapter, interpretationRevisionId, continuityTargetId = null) {
    const params = [interpretationRevisionId];
    let where = 'interpretation_revision_id = ?';
    if (continuityTargetId) {
        where += ' AND continuity_target_id = ?';
        params.push(continuityTargetId);
    }
    const rows = adapter.all(
        `SELECT publication_authorization_id
         FROM interpretation_publication_authorizations
         WHERE ${where}
         ORDER BY authorized_at DESC, publication_authorization_id DESC`,
        params,
    );
    return rows.map((row) => loadInterpretivePublicationAuthorizationProjection(adapter, row.publication_authorization_id));
}

function loadInterpretivePublicationPoliciesForType(adapter, interpretationType) {
    const rows = adapter.all(
        `SELECT publication_policy_id, policy_version
         FROM interpretation_publication_policies
         WHERE policy_state = 'ACTIVE'
         ORDER BY publication_policy_id, policy_version DESC`,
    );
    return rows
        .map((row) => loadInterpretivePublicationPolicyProjection(adapter, row.publication_policy_id, Number(row.policy_version)))
        .filter((policy) => policy && Array.isArray(policy.permittedInterpretationTypes) && policy.permittedInterpretationTypes.includes(interpretationType));
}

function loadDnmPublicationRecordProjection(adapter, dnmRecordId) {
    const row = adapter.get(
        `SELECT * FROM dnm_publication_records
         WHERE dnm_record_id = ?`,
        [dnmRecordId],
    );
    if (!row) {
        return null;
    }
    const metadata = loadDnmPublicationLifecycleMetadata(adapter, dnmRecordId);
    const deltaReviews = loadDnmDeltaReviewRows(adapter, dnmRecordId);
    return {
        dnmRecordId: row.dnm_record_id,
        continuityTargetId: row.continuity_target_id,
        memorySubjectId: row.memory_subject_id,
        memoryScopeId: row.memory_scope_id,
        sourceInterpretationRevisionId: row.source_interpretation_revision_id,
        sourceInterpretationId: row.source_interpretation_id,
        publishedStatement: row.published_statement,
        proposalContentHash: row.proposal_content_hash,
        groundingBindingMode: row.grounding_binding_mode,
        groundingEnvelopeHash: row.grounding_envelope_hash,
        groundingProtocolVersion: Number(row.grounding_protocol_version),
        groundingSourceSetHash: row.grounding_source_set_hash,
        reviewEnvelopeHash: row.review_envelope_hash,
        publicationPolicyId: row.publication_policy_id,
        publicationPolicyVersion: Number(row.publication_policy_version),
        publicationPolicyHash: row.publication_policy_hash,
        publicationState: row.publication_state,
        lifecycleState: row.lifecycle_state,
        publishedAt: Number(row.published_at),
        publicationAuthorizationId: row.publication_authorization_id,
        supersededByDnmRecordId: metadata?.supersededByDnmRecordId || null,
        supersedesDnmRecordId: metadata?.supersedesDnmRecordId || null,
        supersededAt: metadata?.supersededAt ?? null,
        withdrawnAt: metadata?.withdrawnAt ?? null,
        deltaReviewState: metadata?.deltaReviewState || 'NONE',
        latestDeltaReviewId: metadata?.latestDeltaReviewId || null,
        lifecycleMetadata: metadata,
        deltaReviews,
    };
}

function buildCandidatePublicationOperatorState(adapter, interpretation, continuityTargetId) {
    const matchingPolicies = loadInterpretivePublicationPoliciesForType(adapter, interpretation.type)
        .filter((policy) => policy.continuityTargetType === 'MEMORY_SUBJECT');
    const qualifications = loadInterpretivePublicationQualificationsForRevision(
        adapter,
        interpretation.interpretationRevisionId,
        continuityTargetId,
    );
    const authorizations = loadInterpretivePublicationAuthorizationsForRevision(
        adapter,
        interpretation.interpretationRevisionId,
        continuityTargetId,
    );
    const latestQualification = qualifications[0] || null;
    const latestAuthorization = authorizations[0] || null;
    const publishedRecordsForRevision = listPublishedRecordsForInterpretationRevision(adapter, interpretation.interpretationRevisionId);

    const availableActions = [];
    const blockedActions = [];
    const blockingReasons = [];
    const addBlockedAction = (action, reasons) => {
        const normalizedReasons = Array.from(new Set((Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean)));
        if (normalizedReasons.length === 0) {
            return;
        }
        blockedActions.push({ action, blockingReasons: normalizedReasons });
        blockingReasons.push(...normalizedReasons);
    };

    const qualificationReasons = [];
    if (interpretation.publicationState === 'PUBLISHED') {
        qualificationReasons.push('INTERPRETATION_ALREADY_PUBLISHED');
    }
    if (matchingPolicies.length === 0) {
        qualificationReasons.push('NO_ACTIVE_PUBLICATION_POLICY');
    }
    if (interpretation.reviewState !== 'COMPLETE') {
        qualificationReasons.push('REVIEW_NOT_COMPLETE');
    }
    if (interpretation.subjectDispositionState !== 'GRANTED') {
        qualificationReasons.push('SUBJECT_DISPOSITION_NOT_GRANTED');
    }
    if (qualificationReasons.length === 0) {
        availableActions.push('QUALIFY_PUBLICATION');
    } else {
        addBlockedAction('QUALIFY_PUBLICATION', qualificationReasons);
    }

    const authorizationReasons = [];
    if (interpretation.publicationState === 'PUBLISHED') {
        authorizationReasons.push('INTERPRETATION_ALREADY_PUBLISHED');
    }
    if (!latestQualification) {
        authorizationReasons.push('PUBLICATION_QUALIFICATION_REQUIRED');
    } else if (latestQualification.eligibilityVerdict !== 'ELIGIBLE') {
        authorizationReasons.push(...latestQualification.refusalCodes);
    }
    if (authorizationReasons.length === 0) {
        availableActions.push('AUTHORIZE_PUBLICATION');
    } else {
        addBlockedAction('AUTHORIZE_PUBLICATION', authorizationReasons);
    }

    const executeReasons = [];
    if (interpretation.publicationState === 'PUBLISHED') {
        executeReasons.push('INTERPRETATION_ALREADY_PUBLISHED');
    }
    if (!latestAuthorization) {
        executeReasons.push('PUBLICATION_AUTHORIZATION_REQUIRED');
    } else if (latestAuthorization.status === 'EXPIRED') {
        executeReasons.push('PUBLICATION_AUTHORIZATION_EXPIRED');
    } else if (latestAuthorization.status === 'CONSUMED') {
        executeReasons.push('PUBLICATION_AUTHORIZATION_CONSUMED');
    } else if (latestAuthorization.status !== 'AUTHORIZED') {
        executeReasons.push('PUBLICATION_AUTHORIZATION_REQUIRED');
    }
    if (executeReasons.length === 0) {
        availableActions.push('EXECUTE_PUBLICATION');
    } else {
        addBlockedAction('EXECUTE_PUBLICATION', executeReasons);
    }

    return {
        continuityTargetId,
        matchingPolicies,
        qualifications,
        latestQualification,
        authorizations,
        latestAuthorization,
        publishedRecordsForRevision,
        availableActions: Array.from(new Set(availableActions)),
        blockedActions,
        blockingReasons: Array.from(new Set(blockingReasons)),
    };
}

function buildDnmRecordOperatorState(record, currentActiveRecord) {
    const availableActions = ['RECORD_DELTA_REVIEW'];
    const blockedActions = [];
    const blockingReasons = [];
    const addBlockedAction = (action, reasons) => {
        const normalizedReasons = Array.from(new Set((Array.isArray(reasons) ? reasons : [reasons]).filter(Boolean)));
        if (normalizedReasons.length === 0) {
            return;
        }
        blockedActions.push({ action, blockingReasons: normalizedReasons });
        blockingReasons.push(...normalizedReasons);
    };

    if (record.lifecycleState === 'ACTIVE') {
        availableActions.push('WITHDRAW_DNM');
    } else {
        addBlockedAction('WITHDRAW_DNM', ['RECORD_NOT_ACTIVE_FOR_WITHDRAWAL']);
    }

    if (
        record.lifecycleState === 'DELTA_PENDING'
        && currentActiveRecord
        && currentActiveRecord.dnmRecordId !== record.dnmRecordId
    ) {
        availableActions.push('SUPERSEDE_ACTIVE_WITH_RECORD');
    } else if (record.lifecycleState !== 'DELTA_PENDING') {
        addBlockedAction('SUPERSEDE_ACTIVE_WITH_RECORD', ['RECORD_NOT_DELTA_PENDING_FOR_SUPERSESSION']);
    } else if (!currentActiveRecord) {
        addBlockedAction('SUPERSEDE_ACTIVE_WITH_RECORD', ['NO_CURRENT_ACTIVE_RECORD_TO_SUPERSEDE']);
    } else if (currentActiveRecord.dnmRecordId === record.dnmRecordId) {
        addBlockedAction('SUPERSEDE_ACTIVE_WITH_RECORD', ['RECORD_ALREADY_ACTIVE']);
    }

    return {
        availableActions: Array.from(new Set(availableActions)),
        blockedActions,
        blockingReasons: Array.from(new Set(blockingReasons)),
    };
}

function buildInterpretivePublicationOperatorState(adapter, interpretationRevisionId, continuityTargetIdOverride = null) {
    const interpretation = loadInterpretiveCandidateProjection(adapter, interpretationRevisionId);
    if (!interpretation) {
        return null;
    }
    const continuityTargetId = continuityTargetIdOverride || interpretation.memorySubjectId;
    const currentActiveRecord = loadCurrentActiveDnmRecordForTarget(adapter, continuityTargetId);
    const recordsForTarget = listPublishedRecordsForContinuityTarget(adapter, continuityTargetId)
        .map((record) => ({
            ...record,
            operatorState: buildDnmRecordOperatorState(record, currentActiveRecord),
        }));
    return {
        interpretationRevisionId: interpretation.interpretationRevisionId,
        continuityTargetId,
        currentActiveRecord,
        recordsForTarget,
        ...buildCandidatePublicationOperatorState(adapter, interpretation, continuityTargetId),
    };
}

function loadDnmPublicationLifecycleMetadata(adapter, dnmRecordId) {
    const row = adapter.get(
        `SELECT * FROM dnm_publication_lifecycle_metadata
         WHERE dnm_record_id = ?`,
        [dnmRecordId],
    );
    if (!row) {
        return null;
    }
    return {
        dnmRecordId: row.dnm_record_id,
        continuityTargetId: row.continuity_target_id,
        supersededByDnmRecordId: row.superseded_by_dnm_record_id,
        supersedesDnmRecordId: row.supersedes_dnm_record_id,
        supersededAt: row.superseded_at == null ? null : Number(row.superseded_at),
        supersessionReasonCodes: JSON.parse(row.supersession_reason_codes_json),
        supersessionCommentary: row.supersession_commentary,
        supersessionProvenance: row.supersession_provenance_json ? JSON.parse(row.supersession_provenance_json) : null,
        withdrawnAt: row.withdrawn_at == null ? null : Number(row.withdrawn_at),
        withdrawalReasonCodes: JSON.parse(row.withdrawal_reason_codes_json),
        withdrawalCommentary: row.withdrawal_commentary,
        withdrawalProvenance: row.withdrawal_provenance_json ? JSON.parse(row.withdrawal_provenance_json) : null,
        deltaReviewState: row.delta_review_state,
        latestDeltaReviewId: row.latest_delta_review_id,
        updatedAt: Number(row.updated_at),
    };
}

function loadDnmDeltaReviewRows(adapter, dnmRecordId) {
    return adapter.all(
        `SELECT * FROM dnm_delta_reviews
         WHERE dnm_record_id = ?
         ORDER BY created_at, delta_review_id`,
        [dnmRecordId],
    ).map((row) => ({
        deltaReviewId: row.delta_review_id,
        dnmRecordId: row.dnm_record_id,
        continuityTargetId: row.continuity_target_id,
        sourceInterpretationRevisionId: row.source_interpretation_revision_id,
        deltaState: row.delta_state,
        reasonCodes: JSON.parse(row.reason_codes_json),
        commentary: row.commentary,
        provenance: JSON.parse(row.provenance_json),
        createdAt: Number(row.created_at),
    }));
}

function loadCurrentActiveDnmRecordForTarget(adapter, continuityTargetId) {
    const rows = adapter.all(
        `SELECT dnm_record_id
         FROM dnm_publication_records
         WHERE continuity_target_id = ? AND lifecycle_state = 'ACTIVE'
         ORDER BY published_at DESC, dnm_record_id DESC`,
        [continuityTargetId],
    );
    if (rows.length === 0) {
        return null;
    }
    if (rows.length > 1) {
        throw createError(500, `Multiple active DNM records exist for ${continuityTargetId}`, 'ARCH_DNM_ACTIVE_STATE_CONFLICT');
    }
    return loadDnmPublicationRecordProjection(adapter, rows[0].dnm_record_id);
}

function listPublishedRecordsForContinuityTarget(adapter, continuityTargetId) {
    return adapter.all(
        `SELECT dnm_record_id
         FROM dnm_publication_records
         WHERE continuity_target_id = ?
         ORDER BY published_at DESC, dnm_record_id DESC`,
        [continuityTargetId],
    ).map((row) => loadDnmPublicationRecordProjection(adapter, row.dnm_record_id));
}

function listPublishedRecordsForInterpretationRevision(adapter, interpretationRevisionId) {
    return adapter.all(
        `SELECT dnm_record_id
         FROM dnm_publication_records
         WHERE source_interpretation_revision_id = ?
         ORDER BY published_at DESC, dnm_record_id DESC`,
        [interpretationRevisionId],
    ).map((row) => loadDnmPublicationRecordProjection(adapter, row.dnm_record_id));
}

function loadActionProvenanceRows(adapter, interpretationRevisionId) {
    return adapter.all(
        `SELECT * FROM interpretation_action_provenance
         WHERE interpretation_revision_id = ?
         ORDER BY created_at, action_provenance_id`,
        [interpretationRevisionId],
    );
}

function loadReviewDispositionRows(adapter, interpretationRevisionId) {
    return adapter.all(
        'SELECT * FROM interpretation_review_dispositions WHERE interpretation_revision_id = ? ORDER BY submitted_at, review_disposition_id',
        [interpretationRevisionId],
    );
}

function persistInterpretiveDelegationPolicyRow(adapter, policy) {
    adapter.run(
        `INSERT OR REPLACE INTO interpretation_delegation_policies (
            delegation_policy_id, policy_version, policy_hash, principal_entity_id, delegate_entity_id,
            allowed_actions_json, memory_scope_id, continuity_target_id, evidence_requirement,
            revocable, policy_state, revocation_reason, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            policy.delegationPolicyId,
            Number(policy.policyVersion),
            policy.policyHash,
            policy.principalEntityId,
            policy.delegateEntityId,
            stableStringify(policy.allowedActions),
            policy.memoryScopeId,
            policy.continuityTargetId,
            policy.evidenceRequirement,
            policy.revocable ? 1 : 0,
            policy.policyState,
            policy.revocationReason,
            Number(policy.createdAt),
            Number(policy.updatedAt),
            policy.revokedAt == null ? null : Number(policy.revokedAt),
        ],
    );
}

function persistInterpretivePublicationPolicyRow(adapter, policy) {
    adapter.run(
        `INSERT OR REPLACE INTO interpretation_publication_policies (
            publication_policy_id, policy_version, policy_hash, continuity_target_type,
            subject_identity_mode, permitted_interpretation_types_json, required_final_subject_state,
            required_grounding_outcome, participant_disagreement_blocks_publication,
            contest_or_defer_blocks_publication, immutable_child_required_for_types_json,
            post_grant_human_publication_authorization_required, policy_state, revocation_reason,
            details_json, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            policy.publicationPolicyId,
            Number(policy.policyVersion),
            policy.policyHash,
            policy.continuityTargetType,
            policy.subjectIdentityMode,
            stableStringify(policy.permittedInterpretationTypes),
            policy.requiredFinalSubjectState,
            policy.requiredGroundingOutcome,
            policy.participantDisagreementBlocksPublication ? 1 : 0,
            policy.contestOrDeferBlocksPublication ? 1 : 0,
            stableStringify(policy.immutableChildRequiredForTypes),
            policy.postGrantHumanPublicationAuthorizationRequired ? 1 : 0,
            policy.policyState,
            policy.revocationReason,
            stableStringify(policy.details || {}),
            Number(policy.createdAt),
            Number(policy.updatedAt),
            policy.revokedAt == null ? null : Number(policy.revokedAt),
        ],
    );
}

function persistInterpretivePublicationAuthorizationRow(adapter, authorization) {
    adapter.run(
        `INSERT OR REPLACE INTO interpretation_publication_authorizations (
            publication_authorization_id, qualification_id, interpretation_revision_id,
            publication_policy_id, policy_version, policy_hash, continuity_target_id,
            continuity_target_type, memory_scope_id, memory_subject_id, authorization_nonce,
            qualification_binding_hash, authorized_by, authorized_at, expires_at, status,
            binding_json, consumed_at, dnm_record_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            authorization.publicationAuthorizationId,
            authorization.qualificationId,
            authorization.interpretationRevisionId,
            authorization.publicationPolicyId,
            Number(authorization.policyVersion),
            authorization.policyHash,
            authorization.continuityTargetId,
            authorization.continuityTargetType,
            authorization.memoryScopeId,
            authorization.memorySubjectId,
            authorization.authorizationNonce,
            authorization.qualificationBindingHash,
            authorization.authorizedBy,
            Number(authorization.authorizedAt),
            Number(authorization.expiresAt),
            authorization.status,
            stableStringify(authorization.binding),
            authorization.consumedAt == null ? null : Number(authorization.consumedAt),
            authorization.dnmRecordId,
        ],
    );
}

function persistDnmPublicationRecordRow(adapter, record) {
    adapter.run(
        `INSERT OR REPLACE INTO dnm_publication_records (
            dnm_record_id, continuity_target_id, memory_subject_id, memory_scope_id,
            source_interpretation_revision_id, source_interpretation_id, published_statement,
            proposal_content_hash, grounding_binding_mode, grounding_envelope_hash,
            grounding_protocol_version, grounding_source_set_hash, review_envelope_hash,
            publication_policy_id, publication_policy_version, publication_policy_hash,
            publication_state, lifecycle_state, published_at, publication_authorization_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            record.dnmRecordId,
            record.continuityTargetId,
            record.memorySubjectId,
            record.memoryScopeId,
            record.sourceInterpretationRevisionId,
            record.sourceInterpretationId,
            record.publishedStatement,
            record.proposalContentHash,
            record.groundingBindingMode,
            record.groundingEnvelopeHash,
            Number(record.groundingProtocolVersion),
            record.groundingSourceSetHash,
            record.reviewEnvelopeHash,
            record.publicationPolicyId,
            Number(record.publicationPolicyVersion),
            record.publicationPolicyHash,
            record.publicationState,
            record.lifecycleState,
            Number(record.publishedAt),
            record.publicationAuthorizationId,
        ],
    );
}

function persistDnmPublicationLifecycleMetadataRow(adapter, metadata) {
    adapter.run(
        `INSERT OR REPLACE INTO dnm_publication_lifecycle_metadata (
            dnm_record_id, continuity_target_id, superseded_by_dnm_record_id, supersedes_dnm_record_id,
            superseded_at, supersession_reason_codes_json, supersession_commentary, supersession_provenance_json,
            withdrawn_at, withdrawal_reason_codes_json, withdrawal_commentary, withdrawal_provenance_json,
            delta_review_state, latest_delta_review_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            metadata.dnmRecordId,
            metadata.continuityTargetId,
            metadata.supersededByDnmRecordId,
            metadata.supersedesDnmRecordId,
            metadata.supersededAt == null ? null : Number(metadata.supersededAt),
            stableStringify(metadata.supersessionReasonCodes || []),
            metadata.supersessionCommentary || null,
            metadata.supersessionProvenance ? stableStringify(metadata.supersessionProvenance) : null,
            metadata.withdrawnAt == null ? null : Number(metadata.withdrawnAt),
            stableStringify(metadata.withdrawalReasonCodes || []),
            metadata.withdrawalCommentary || null,
            metadata.withdrawalProvenance ? stableStringify(metadata.withdrawalProvenance) : null,
            metadata.deltaReviewState || 'NONE',
            metadata.latestDeltaReviewId || null,
            Number(metadata.updatedAt),
        ],
    );
}

function persistDnmDeltaReviewRow(adapter, review) {
    adapter.run(
        `INSERT OR REPLACE INTO dnm_delta_reviews (
            delta_review_id, dnm_record_id, continuity_target_id, source_interpretation_revision_id,
            delta_state, reason_codes_json, commentary, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            review.deltaReviewId,
            review.dnmRecordId,
            review.continuityTargetId,
            review.sourceInterpretationRevisionId,
            review.deltaState,
            stableStringify(review.reasonCodes || []),
            review.commentary || null,
            stableStringify(review.provenance || {}),
            Number(review.createdAt),
        ],
    );
}

function persistActionProvenanceRow(adapter, provenance) {
    adapter.run(
        `INSERT INTO interpretation_action_provenance (
            action_provenance_id, interpretation_revision_id, action_kind, action_target_id,
            disposition_owner_id, submitted_by_actor_id, submission_mode, delegation_policy_id,
            delegation_policy_version, delegation_policy_hash, subject_evidence_refs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            provenance.actionProvenanceId,
            provenance.interpretationRevisionId,
            provenance.actionKind,
            provenance.actionTargetId,
            provenance.dispositionOwnerId,
            provenance.submittedByActorId,
            provenance.submissionMode,
            provenance.delegationPolicyId,
            provenance.delegationPolicyVersion == null ? null : Number(provenance.delegationPolicyVersion),
            provenance.delegationPolicyHash,
            stableStringify(provenance.subjectEvidenceRefs || []),
            Number(provenance.createdAt),
        ],
    );
}

function normalizeActionProvenanceRow(row) {
    if (!row) {
        return null;
    }
    return {
        actionProvenanceId: row.action_provenance_id,
        interpretationRevisionId: row.interpretation_revision_id,
        actionKind: row.action_kind,
        actionTargetId: row.action_target_id,
        dispositionOwnerId: row.disposition_owner_id,
        submittedByActorId: row.submitted_by_actor_id,
        submissionMode: row.submission_mode,
        delegationPolicyId: row.delegation_policy_id,
        delegationPolicyVersion: row.delegation_policy_version === null ? null : Number(row.delegation_policy_version),
        delegationPolicyHash: row.delegation_policy_hash,
        subjectEvidenceRefs: JSON.parse(row.subject_evidence_refs_json),
        createdAt: Number(row.created_at),
    };
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

function resolveDelegationPolicyForAction(adapter, {
    delegationPolicyId,
    principalEntityId,
    delegateEntityId,
    actionKind,
    memoryScopeId,
    continuityTargetId,
    subjectEvidenceRefs,
}) {
    const normalizedPolicyId = sanitizeIdentifier(delegationPolicyId, 'delegationPolicyId');
    const rows = adapter.all(
        `SELECT * FROM interpretation_delegation_policies
         WHERE delegation_policy_id = ?
         ORDER BY policy_version DESC`,
        [normalizedPolicyId],
    );
    if (rows.length === 0) {
        throw createError(403, `Delegation policy ${normalizedPolicyId} was not found`, 'ARCH_DELEGATION_POLICY_NOT_FOUND');
    }
    const policy = loadInterpretiveDelegationPolicyProjection(adapter, rows[0].delegation_policy_id, Number(rows[0].policy_version));
    if (policy.policyState !== 'ACTIVE') {
        throw createError(403, `Delegation policy ${normalizedPolicyId} is not active`, 'ARCH_DELEGATION_POLICY_REVOKED');
    }
    if (policy.principalEntityId !== principalEntityId) {
        throw createError(403, 'Delegation principal does not match the required disposition owner', 'ARCH_DELEGATION_PRINCIPAL_MISMATCH');
    }
    if (policy.delegateEntityId !== delegateEntityId) {
        throw createError(403, 'Delegation delegate does not match the submitting actor', 'ARCH_DELEGATION_DELEGATE_MISMATCH');
    }
    if (!policy.allowedActions.includes(actionKind)) {
        throw createError(403, `Delegation policy does not permit ${actionKind}`, 'ARCH_DELEGATION_ACTION_FORBIDDEN');
    }
    if (policy.memoryScopeId !== memoryScopeId) {
        throw createError(403, 'Delegation policy is not valid for this memory scope', 'ARCH_DELEGATION_SCOPE_MISMATCH');
    }
    if (policy.continuityTargetId && policy.continuityTargetId !== continuityTargetId) {
        throw createError(403, 'Delegation policy is not valid for this continuity target', 'ARCH_DELEGATION_TARGET_MISMATCH');
    }
    if (policy.evidenceRequirement === 'REQUIRED' && subjectEvidenceRefs.length === 0) {
        throw createError(403, 'Delegation policy requires subject evidence references', 'ARCH_DELEGATION_EVIDENCE_REQUIRED');
    }
    return policy;
}

function authorizeInterpretiveAction(adapter, {
    interpretation,
    actionKind,
    dispositionOwnerId,
    submittedByActorId,
    submissionMode,
    delegationPolicyId = null,
    subjectEvidenceRefs = [],
}) {
    const evidenceRefs = normalizeSubjectEvidenceRefs(subjectEvidenceRefs, 'subjectEvidenceRefs');
    switch (submissionMode) {
    case 'DIRECT_REVIEWER_ACTION':
        if (dispositionOwnerId === interpretation.memorySubjectId) {
            throw createError(403, 'Direct memory-subject actions must use DIRECT_SUBJECT_ACTION', 'ARCH_SUBMISSION_MODE_FORBIDDEN');
        }
        if (submittedByActorId !== dispositionOwnerId) {
            throw createError(403, 'Direct reviewer actions require the owner and actor to match', 'ARCH_ACTION_OWNER_MISMATCH');
        }
        return { delegationPolicy: null, subjectEvidenceRefs: evidenceRefs };
    case 'DIRECT_SUBJECT_ACTION':
        if (dispositionOwnerId !== interpretation.memorySubjectId) {
            throw createError(403, 'Direct subject action is only valid for the memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        if (submittedByActorId !== dispositionOwnerId) {
            throw createError(403, 'Direct subject action requires the subject to submit directly', 'ARCH_ACTION_OWNER_MISMATCH');
        }
        return { delegationPolicy: null, subjectEvidenceRefs: evidenceRefs };
    case 'SUBJECT_EXPRESSED_AND_RECORDED':
        if (dispositionOwnerId !== interpretation.memorySubjectId) {
            throw createError(403, 'Recorded subject expression is only valid for the memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        if (evidenceRefs.length === 0) {
            throw createError(403, 'Recorded subject expression requires subject evidence references', 'ARCH_SUBJECT_EVIDENCE_REQUIRED');
        }
        return { delegationPolicy: null, subjectEvidenceRefs: evidenceRefs };
    case 'TRUSTED_DELEGATE':
        if (submittedByActorId === dispositionOwnerId) {
            throw createError(403, 'Trusted delegate mode requires a distinct submitting actor', 'ARCH_ACTION_OWNER_MISMATCH');
        }
        return {
            delegationPolicy: resolveDelegationPolicyForAction(adapter, {
                delegationPolicyId,
                principalEntityId: dispositionOwnerId,
                delegateEntityId: submittedByActorId,
                actionKind,
                memoryScopeId: interpretation.memoryScopeId,
                continuityTargetId: interpretation.memorySubjectId,
                subjectEvidenceRefs: evidenceRefs,
            }),
            subjectEvidenceRefs: evidenceRefs,
        };
    case 'SYSTEM_GROUNDING_ACTION':
        throw createError(403, 'System grounding action may not record interpretive review or subject consent', 'ARCH_SUBMISSION_MODE_FORBIDDEN');
    default:
        throw createError(400, 'submissionMode is invalid', 'ARCH_INVALID_PAYLOAD');
    }
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
    if (statement === String(parentInterpretation.statement || '').trim()) {
        throw createError(400, 'revisedCandidate.statement must differ from the parent statement', 'ARCH_INVALID_PAYLOAD');
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

function carryForwardPreparedReviewerApproval(prepared, reviewerRole, reviewerEntityId, timestamp) {
    const obligations = prepared.obligations.filter((entry) => !(
        entry.reviewerRole === reviewerRole
        && entry.reviewerEntityId === reviewerEntityId
    ));
    const lifecycle = deriveLifecycleStates(prepared.groundingOutcome, obligations);
    const reviewEnvelopeHash = buildReviewEnvelopeHash(
        prepared.candidate.proposalContentHash,
        prepared.candidate.groundingLinks,
        prepared.groundingOutcome,
        prepared.risk,
        prepared.policy,
        obligations,
    );
    const reviewRequests = buildReviewRequests(
        obligations,
        prepared.candidate.interpretationRevisionId,
        reviewEnvelopeHash,
        timestamp,
    );
    prepared.obligations = obligations;
    prepared.reviewRequests = reviewRequests;
    Object.assign(prepared.candidate, lifecycle, {
        reviewEnvelopeHash,
    });
    return prepared;
}

function supersedeSiblingReviewRequestsAfterChild(adapter, interpretationRevisionId, retainedReviewRequestId) {
    const siblingRequests = adapter.all(
        `SELECT review_request_id, review_obligation_id
         FROM interpretation_review_requests
         WHERE interpretation_revision_id = ?
           AND review_request_id <> ?
           AND status IN ('PENDING', 'DEFERRED')`,
        [interpretationRevisionId, retainedReviewRequestId],
    );
    for (const row of siblingRequests) {
        adapter.run(
            'UPDATE interpretation_review_requests SET status = ? WHERE review_request_id = ?',
            ['SUPERSEDED_BY_CHILD', row.review_request_id],
        );
        adapter.run(
            'UPDATE interpretation_review_obligations SET obligation_state = ?, blocking_reason = ? WHERE review_obligation_id = ?',
            ['COMPLETED', 'SUPERSEDED_BY_CHILD', row.review_obligation_id],
        );
    }
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

export function readPublicationLedgerEvents(ledgerPath) {
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
            revisionCreationProvenance: proposed.revisionCreationProvenance
                ? cloneJson(proposed.revisionCreationProvenance)
                : null,
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
        if (payload.provenance) {
            persistActionProvenanceRow(adapter, {
                ...cloneJson(payload.provenance),
                interpretationRevisionId: event.interpretationRevisionId,
                actionKind: 'REVIEW_DISPOSITION',
                actionTargetId: payload.reviewDispositionId,
                createdAt: Number(payload.provenance.createdAt || payload.submittedAt || event.occurredAt),
            });
        }
        adapter.run(
            'UPDATE interpretation_review_requests SET status = ? WHERE review_request_id = ?',
            [dispositionStatus, payload.reviewRequestId],
        );
        adapter.run(
            'UPDATE interpretation_review_obligations SET obligation_state = ?, blocking_reason = ? WHERE review_obligation_id = ?',
            [deriveObligationStateFromRequestStatus(dispositionStatus), 'NONE', request.review_obligation_id],
        );
        if (payload.childInterpretationRevisionId) {
            supersedeSiblingReviewRequestsAfterChild(
                adapter,
                event.interpretationRevisionId,
                payload.reviewRequestId,
            );
        }
        recomputeCandidateReviewState(adapter, event.interpretationRevisionId, Number(payload.submittedAt || event.occurredAt));
        return;
    }
    if (event.eventType === 'SUBJECT_DISPOSITION_RECORDED') {
        const payload = event.payload || {};
        if (payload.provenance) {
            persistActionProvenanceRow(adapter, {
                ...cloneJson(payload.provenance),
                interpretationRevisionId: event.interpretationRevisionId,
                actionKind: 'SUBJECT_DISPOSITION',
                actionTargetId: payload.subjectDispositionId,
                createdAt: Number(payload.provenance.createdAt || payload.updatedAt || event.occurredAt),
            });
        }
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

function applyDelegationPolicyLedgerEvent(adapter, event) {
    const payload = event.payload || {};
    if (event.eventType === 'DELEGATION_POLICY_REGISTERED') {
        persistInterpretiveDelegationPolicyRow(adapter, {
            delegationPolicyId: sanitizeIdentifier(payload.delegationPolicyId, 'delegationPolicyId'),
            policyVersion: normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000),
            policyHash: String(payload.policyHash || '').trim(),
            principalEntityId: sanitizeIdentifier(payload.principalEntityId, 'principalEntityId'),
            delegateEntityId: sanitizeIdentifier(payload.delegateEntityId, 'delegateEntityId'),
            allowedActions: normalizeDelegationActionList(payload.allowedActions, 'allowedActions'),
            memoryScopeId: sanitizeIdentifier(payload.memoryScopeId, 'memoryScopeId'),
            continuityTargetId: payload.continuityTargetId == null ? null : sanitizeIdentifier(payload.continuityTargetId, 'continuityTargetId'),
            evidenceRequirement: normalizeDelegationEvidenceRequirement(payload.evidenceRequirement, 'evidenceRequirement'),
            revocable: payload.revocable === true,
            policyState: 'ACTIVE',
            revocationReason: null,
            createdAt: Number(payload.createdAt || event.occurredAt),
            updatedAt: Number(payload.updatedAt || payload.createdAt || event.occurredAt),
            revokedAt: null,
        });
        return;
    }
    if (event.eventType === 'DELEGATION_POLICY_REVOKED') {
        const delegationPolicyId = sanitizeIdentifier(payload.delegationPolicyId, 'delegationPolicyId');
        const policyVersion = normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000);
        const existing = loadInterpretiveDelegationPolicyProjection(adapter, delegationPolicyId, policyVersion);
        if (!existing) {
            throw createError(500, `Interpretive replay could not resolve delegation policy ${delegationPolicyId} v${policyVersion}`, 'ARCH_INTERPRETIVE_LEDGER_INCOMPLETE');
        }
        persistInterpretiveDelegationPolicyRow(adapter, {
            ...existing,
            policyState: 'REVOKED',
            revocationReason: payload.revocationReason ? String(payload.revocationReason).trim() : null,
            updatedAt: Number(payload.revokedAt || event.occurredAt),
            revokedAt: Number(payload.revokedAt || event.occurredAt),
        });
    }
}

function applyPublicationLedgerEvent(adapter, event) {
    const payload = event.payload || {};
    if (event.eventType === 'DNM_PUBLICATION_POLICY_REGISTERED') {
        persistInterpretivePublicationPolicyRow(adapter, {
            publicationPolicyId: sanitizeIdentifier(payload.publicationPolicyId, 'publicationPolicyId'),
            policyVersion: normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000),
            policyHash: String(payload.policyHash || '').trim(),
            continuityTargetType: normalizeEnumValue(payload.continuityTargetType, 'continuityTargetType', ALLOWED_CONTINUITY_TARGET_TYPES),
            subjectIdentityMode: normalizeEnumValue(payload.subjectIdentityMode, 'subjectIdentityMode', ALLOWED_SUBJECT_IDENTITY_MODES),
            permittedInterpretationTypes: normalizeStringArray(payload.permittedInterpretationTypes, 'permittedInterpretationTypes', ALLOWED_INTERPRETATION_TYPES),
            requiredFinalSubjectState: normalizeEnumValue(payload.requiredFinalSubjectState, 'requiredFinalSubjectState', ALLOWED_SUBJECT_DISPOSITION_STATES),
            requiredGroundingOutcome: normalizeEnumValue(payload.requiredGroundingOutcome, 'requiredGroundingOutcome', new Set(Object.keys(GROUNDING_OUTCOME_ORDER))),
            participantDisagreementBlocksPublication: payload.participantDisagreementBlocksPublication === true,
            contestOrDeferBlocksPublication: payload.contestOrDeferBlocksPublication === true,
            immutableChildRequiredForTypes: normalizeStringArrayAllowEmpty(
                payload.immutableChildRequiredForTypes || [],
                'immutableChildRequiredForTypes',
                ALLOWED_INTERPRETATION_TYPES,
            ),
            postGrantHumanPublicationAuthorizationRequired: payload.postGrantHumanPublicationAuthorizationRequired === true,
            policyState: 'ACTIVE',
            revocationReason: null,
            details: normalizeOptionalPlainObject(payload.details, 'details'),
            createdAt: Number(payload.createdAt || event.occurredAt),
            updatedAt: Number(payload.updatedAt || payload.createdAt || event.occurredAt),
            revokedAt: null,
        });
        return;
    }
    if (event.eventType === 'DNM_PUBLICATION_POLICY_REVOKED') {
        const publicationPolicyId = sanitizeIdentifier(payload.publicationPolicyId, 'publicationPolicyId');
        const policyVersion = normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000);
        const existing = loadInterpretivePublicationPolicyProjection(adapter, publicationPolicyId, policyVersion);
        if (!existing) {
            throw createError(500, `Publication policy ${publicationPolicyId} v${policyVersion} is missing during replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        persistInterpretivePublicationPolicyRow(adapter, {
            ...existing,
            policyState: 'REVOKED',
            revocationReason: payload.revocationReason ? String(payload.revocationReason).trim() : null,
            updatedAt: Number(payload.revokedAt || event.occurredAt),
            revokedAt: Number(payload.revokedAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'DNM_PUBLICATION_AUTHORIZED') {
        const status = normalizeEnumValue(payload.status, 'status', ALLOWED_PUBLICATION_AUTHORIZATION_STATUSES);
        persistInterpretivePublicationAuthorizationRow(adapter, {
            publicationAuthorizationId: sanitizeIdentifier(payload.publicationAuthorizationId, 'publicationAuthorizationId'),
            qualificationId: sanitizeIdentifier(payload.qualificationId, 'qualificationId'),
            interpretationRevisionId: sanitizeIdentifier(payload.interpretationRevisionId, 'interpretationRevisionId'),
            publicationPolicyId: sanitizeIdentifier(payload.publicationPolicyId, 'publicationPolicyId'),
            policyVersion: normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000),
            policyHash: String(payload.policyHash || '').trim(),
            continuityTargetId: sanitizeIdentifier(payload.continuityTargetId, 'continuityTargetId'),
            continuityTargetType: normalizeEnumValue(payload.continuityTargetType, 'continuityTargetType', ALLOWED_CONTINUITY_TARGET_TYPES),
            memoryScopeId: sanitizeIdentifier(payload.memoryScopeId, 'memoryScopeId'),
            memorySubjectId: sanitizeIdentifier(payload.memorySubjectId, 'memorySubjectId'),
            authorizationNonce: sanitizeIdentifier(payload.authorizationNonce, 'authorizationNonce'),
            qualificationBindingHash: String(payload.qualificationBindingHash || '').trim(),
            authorizedBy: sanitizeIdentifier(payload.authorizedBy, 'authorizedBy'),
            authorizedAt: Number(payload.authorizedAt || event.occurredAt),
            expiresAt: Number(payload.expiresAt),
            status,
            binding: cloneJson(payload.binding || {}),
            consumedAt: payload.consumedAt == null ? null : Number(payload.consumedAt),
            dnmRecordId: payload.dnmRecordId == null ? null : sanitizeIdentifier(payload.dnmRecordId, 'dnmRecordId'),
        });
        return;
    }
    if (event.eventType === 'DNM_PUBLICATION_REFUSED') {
        const authorization = loadInterpretivePublicationAuthorizationProjection(
            adapter,
            sanitizeIdentifier(payload.publicationAuthorizationId, 'publicationAuthorizationId'),
        );
        if (!authorization) {
            throw createError(500, `Publication authorization ${payload.publicationAuthorizationId} is missing during replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        persistInterpretivePublicationAuthorizationRow(adapter, {
            ...authorization,
            status: normalizeEnumValue(payload.status || 'EXPIRED', 'status', ALLOWED_PUBLICATION_AUTHORIZATION_STATUSES),
            consumedAt: null,
        });
        return;
    }
    if (event.eventType === 'DNM_PUBLISHED') {
        const interpretationRevisionId = sanitizeIdentifier(payload.sourceInterpretationRevisionId, 'sourceInterpretationRevisionId');
        const interpretation = loadInterpretiveCandidateProjection(adapter, interpretationRevisionId);
        if (!interpretation) {
            throw createError(500, `Interpretation revision ${interpretationRevisionId} is missing during DNM publication replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        const publicationState = normalizeEnumValue(payload.publicationState, 'publicationState', ALLOWED_DNM_PUBLICATION_STATES);
        const lifecycleState = normalizeEnumValue(payload.lifecycleState, 'lifecycleState', ALLOWED_DNM_LIFECYCLE_STATES);
        const record = {
            dnmRecordId: sanitizeIdentifier(payload.dnmRecordId, 'dnmRecordId'),
            continuityTargetId: sanitizeIdentifier(payload.continuityTargetId, 'continuityTargetId'),
            memorySubjectId: sanitizeIdentifier(payload.memorySubjectId, 'memorySubjectId'),
            memoryScopeId: sanitizeIdentifier(payload.memoryScopeId, 'memoryScopeId'),
            sourceInterpretationRevisionId: interpretationRevisionId,
            sourceInterpretationId: sanitizeIdentifier(payload.sourceInterpretationId, 'sourceInterpretationId'),
            publishedStatement: String(payload.publishedStatement || '').trim(),
            proposalContentHash: String(payload.proposalContentHash || '').trim(),
            groundingBindingMode: String(payload.groundingBindingMode || '').trim(),
            groundingEnvelopeHash: String(payload.groundingEnvelopeHash || '').trim(),
            groundingProtocolVersion: normalizePositiveInteger(payload.groundingProtocolVersion, 'groundingProtocolVersion', 1, 1_000_000),
            groundingSourceSetHash: String(payload.groundingSourceSetHash || '').trim(),
            reviewEnvelopeHash: String(payload.reviewEnvelopeHash || '').trim(),
            publicationPolicyId: sanitizeIdentifier(payload.publicationPolicyId, 'publicationPolicyId'),
            publicationPolicyVersion: normalizePositiveInteger(payload.publicationPolicyVersion, 'publicationPolicyVersion', 1, 1_000_000),
            publicationPolicyHash: String(payload.publicationPolicyHash || '').trim(),
            publicationState,
            lifecycleState,
            publishedAt: Number(payload.publishedAt || event.occurredAt),
            publicationAuthorizationId: sanitizeIdentifier(payload.publicationAuthorizationId, 'publicationAuthorizationId'),
        };
        persistDnmPublicationRecordRow(adapter, record);
        persistDnmPublicationLifecycleMetadataRow(adapter, buildDefaultDnmLifecycleMetadata(record));
        const authorization = loadInterpretivePublicationAuthorizationProjection(adapter, record.publicationAuthorizationId);
        if (!authorization) {
            throw createError(500, `Publication authorization ${record.publicationAuthorizationId} is missing during replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        persistInterpretivePublicationAuthorizationRow(adapter, {
            ...authorization,
            status: 'CONSUMED',
            consumedAt: record.publishedAt,
            dnmRecordId: record.dnmRecordId,
        });
        adapter.run(
            `UPDATE interpretation_revisions
             SET publication_state = 'PUBLISHED', authority_effect = 'DEVELOPMENTAL_MEMORY', updated_at = ?
                WHERE interpretation_revision_id = ?`,
            [record.publishedAt, interpretationRevisionId],
        );
        return;
    }
    if (event.eventType === 'DNM_SUPERSEDED') {
        const previousRecord = loadDnmPublicationRecordProjection(adapter, sanitizeIdentifier(payload.supersededDnmRecordId, 'supersededDnmRecordId'));
        const replacementRecord = loadDnmPublicationRecordProjection(adapter, sanitizeIdentifier(payload.replacementDnmRecordId, 'replacementDnmRecordId'));
        if (!previousRecord || !replacementRecord) {
            throw createError(500, 'DNM supersession replay is missing required records', 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        persistDnmPublicationRecordRow(adapter, {
            ...previousRecord,
            lifecycleState: 'SUPERSEDED',
        });
        persistDnmPublicationRecordRow(adapter, {
            ...replacementRecord,
            lifecycleState: 'ACTIVE',
        });
        persistDnmPublicationLifecycleMetadataRow(adapter, {
            ...(loadDnmPublicationLifecycleMetadata(adapter, previousRecord.dnmRecordId) || buildDefaultDnmLifecycleMetadata(previousRecord)),
            supersededByDnmRecordId: replacementRecord.dnmRecordId,
            supersededAt: Number(payload.supersededAt || event.occurredAt),
            supersessionReasonCodes: normalizeReasonCodes(payload.reasonCodes, 'reasonCodes'),
            supersessionCommentary: normalizeOptionalCommentary(payload.commentary, 'commentary'),
            supersessionProvenance: cloneJson(payload.provenance || null),
            updatedAt: Number(payload.supersededAt || event.occurredAt),
        });
        persistDnmPublicationLifecycleMetadataRow(adapter, {
            ...(loadDnmPublicationLifecycleMetadata(adapter, replacementRecord.dnmRecordId) || buildDefaultDnmLifecycleMetadata(replacementRecord)),
            supersedesDnmRecordId: previousRecord.dnmRecordId,
            deltaReviewState: 'NONE',
            updatedAt: Number(payload.supersededAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'DNM_WITHDRAWN') {
        const record = loadDnmPublicationRecordProjection(adapter, sanitizeIdentifier(payload.dnmRecordId, 'dnmRecordId'));
        if (!record) {
            throw createError(500, `DNM record ${payload.dnmRecordId} is missing during withdrawal replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        persistDnmPublicationRecordRow(adapter, {
            ...record,
            lifecycleState: 'WITHDRAWN',
        });
        persistDnmPublicationLifecycleMetadataRow(adapter, {
            ...(loadDnmPublicationLifecycleMetadata(adapter, record.dnmRecordId) || buildDefaultDnmLifecycleMetadata(record)),
            withdrawnAt: Number(payload.withdrawnAt || event.occurredAt),
            withdrawalReasonCodes: normalizeReasonCodes(payload.reasonCodes, 'reasonCodes'),
            withdrawalCommentary: normalizeOptionalCommentary(payload.commentary, 'commentary'),
            withdrawalProvenance: cloneJson(payload.provenance || null),
            updatedAt: Number(payload.withdrawnAt || event.occurredAt),
        });
        return;
    }
    if (event.eventType === 'DNM_DELTA_REVIEW_RECORDED') {
        const record = loadDnmPublicationRecordProjection(adapter, sanitizeIdentifier(payload.dnmRecordId, 'dnmRecordId'));
        if (!record) {
            throw createError(500, `DNM record ${payload.dnmRecordId} is missing during delta review replay`, 'ARCH_PUBLICATION_LEDGER_INCOMPLETE');
        }
        const review = {
            deltaReviewId: sanitizeIdentifier(payload.deltaReviewId, 'deltaReviewId'),
            dnmRecordId: record.dnmRecordId,
            continuityTargetId: sanitizeIdentifier(payload.continuityTargetId, 'continuityTargetId'),
            sourceInterpretationRevisionId: payload.sourceInterpretationRevisionId
                ? sanitizeIdentifier(payload.sourceInterpretationRevisionId, 'sourceInterpretationRevisionId')
                : null,
            deltaState: normalizeEnumValue(payload.deltaState, 'deltaState', ALLOWED_DNM_DELTA_REVIEW_STATES),
            reasonCodes: normalizeReasonCodes(payload.reasonCodes, 'reasonCodes'),
            commentary: normalizeOptionalCommentary(payload.commentary, 'commentary'),
            provenance: cloneJson(payload.provenance || {}),
            createdAt: Number(payload.createdAt || event.occurredAt),
        };
        persistDnmDeltaReviewRow(adapter, review);
        persistDnmPublicationLifecycleMetadataRow(adapter, {
            ...(loadDnmPublicationLifecycleMetadata(adapter, record.dnmRecordId) || buildDefaultDnmLifecycleMetadata(record)),
            deltaReviewState: review.deltaState,
            latestDeltaReviewId: review.deltaReviewId,
            updatedAt: review.createdAt,
        });
    }
}

export function replayInterpretiveLedger(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const ledgerEvents = readInterpretiveLedgerEvents(options.ledgerPath || paths.interpretiveGovernanceLedgerPath);
    const grouped = new Map();
    const followOnEvents = [];
    const synthesisEvents = [];
    const delegationPolicyEvents = [];
    const synthesisEventTypes = new Set([
        'SYNTHESIS_POLICY_REGISTERED',
        'SYNTHESIS_RUN_REGISTERED',
        'SYNTHESIS_PROPOSAL_EMITTED',
        'SYNTHESIS_GROUNDING_RECORDED',
        'SYNTHESIS_PROPOSAL_ADMITTED',
        'SYNTHESIS_PROPOSAL_QUARANTINED',
    ]);
    for (const event of ledgerEvents) {
        if (['DELEGATION_POLICY_REGISTERED', 'DELEGATION_POLICY_REVOKED'].includes(event.eventType)) {
            delegationPolicyEvents.push(event);
            continue;
        }
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
        for (const event of delegationPolicyEvents.sort((a, b) => Number(a.occurredAt) - Number(b.occurredAt) || String(a.eventId).localeCompare(String(b.eventId)))) {
            applyDelegationPolicyLedgerEvent(adapter, event);
        }
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

export function replayPublicationLedger(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const ledgerEvents = readPublicationLedgerEvents(options.ledgerPath || paths.dnmPublicationLedgerPath);
    const adapter = openOperationalDatabase(paths, { now: options.now });
    try {
        adapter.transaction(() => {
            adapter.run('DELETE FROM dnm_delta_reviews');
            adapter.run('DELETE FROM dnm_publication_lifecycle_metadata');
            adapter.run('DELETE FROM dnm_publication_records');
            adapter.run('DELETE FROM interpretation_publication_authorizations');
            adapter.run('DELETE FROM interpretation_publication_policies');
            adapter.run(
                `UPDATE interpretation_revisions
                 SET publication_state = 'NOT_PUBLISHED',
                     authority_effect = CASE
                        WHEN authority_effect = 'DEVELOPMENTAL_MEMORY' THEN 'DESCRIPTIVE_ONLY'
                        ELSE authority_effect
                     END`,
            );
            for (const event of ledgerEvents) {
                applyPublicationLedgerEvent(adapter, event);
            }
        });
        snapshotOperationalDatabase(adapter, paths);
        const policyRows = adapter.all(
            `SELECT publication_policy_id, policy_version
             FROM interpretation_publication_policies
             ORDER BY publication_policy_id, policy_version`,
        );
        const authorizationRows = adapter.all(
            `SELECT publication_authorization_id
             FROM interpretation_publication_authorizations
             ORDER BY authorized_at, publication_authorization_id`,
        );
        const recordRows = adapter.all(
            `SELECT dnm_record_id
             FROM dnm_publication_records
             ORDER BY published_at, dnm_record_id`,
        );
        return {
            ok: true,
            phase: 'c0.6.4',
            replayedPublicationPolicies: policyRows.map((row) => (
                loadInterpretivePublicationPolicyProjection(adapter, row.publication_policy_id, Number(row.policy_version))
            )),
            replayedPublicationAuthorizations: authorizationRows.map((row) => (
                loadInterpretivePublicationAuthorizationProjection(adapter, row.publication_authorization_id)
            )),
            replayedPublishedRecords: recordRows.map((row) => (
                loadDnmPublicationRecordProjection(adapter, row.dnm_record_id)
            )),
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
    if (prepared.candidate.revisionCreationProvenance) {
        persistActionProvenanceRow(adapter, prepared.candidate.revisionCreationProvenance);
    }
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
    const actionProvenanceRows = loadActionProvenanceRows(adapter, interpretationRevisionId);
    const subjectDisposition = adapter.get(
        'SELECT * FROM interpretation_subject_dispositions WHERE interpretation_revision_id = ?',
        [interpretationRevisionId],
    );
    const childRevisions = adapter.all(
        'SELECT interpretation_revision_id FROM interpretation_revisions WHERE parent_revision_id = ? ORDER BY interpretation_revision_id',
        [interpretationRevisionId],
    );
    const actionProvenanceByTarget = new Map(
        actionProvenanceRows.map((row) => [`${row.action_kind}:${row.action_target_id}`, normalizeActionProvenanceRow(row)]),
    );
    const latestSubjectDispositionProvenanceRow = actionProvenanceRows
        .filter((row) => row.action_kind === 'SUBJECT_DISPOSITION')
        .sort((left, right) => Number(right.created_at) - Number(left.created_at) || String(right.action_provenance_id).localeCompare(String(left.action_provenance_id)))[0] || null;
    const latestSubjectDispositionProvenance = latestSubjectDispositionProvenanceRow
        ? normalizeActionProvenanceRow(latestSubjectDispositionProvenanceRow)
        : null;
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
            provenance: actionProvenanceByTarget.get(`REVIEW_DISPOSITION:${entry.review_disposition_id}`) || null,
        })),
        subjectDisposition: subjectDisposition ? {
            subjectDispositionId: latestSubjectDispositionProvenance?.actionTargetId || null,
            memorySubjectId: subjectDisposition.memory_subject_id,
            state: subjectDisposition.state,
            finalDispositionAuthority: subjectDisposition.final_disposition_authority,
            reasonCodes: JSON.parse(subjectDisposition.reason_codes_json),
            commentary: subjectDisposition.commentary,
            createdAt: Number(subjectDisposition.created_at),
            updatedAt: Number(subjectDisposition.updated_at),
            provenance: latestSubjectDispositionProvenance,
        } : null,
        revisionCreationProvenance: actionProvenanceByTarget.get(`SUBJECT_REVISION:${candidate.interpretation_revision_id}`) || null,
        childRevisionIds: childRevisions.map((entry) => entry.interpretation_revision_id),
    };
}

function resolveInterpretationGroundingEnvelope(adapter, interpretation) {
    const synthesisProposalRows = adapter.all(
        `SELECT synthesis_proposal_id
         FROM interpretation_synthesis_proposals
         WHERE interpretation_revision_id = ?
         ORDER BY updated_at DESC, synthesis_proposal_id DESC`,
        [interpretation.interpretationRevisionId],
    );
    for (const row of synthesisProposalRows) {
        const groundingEvaluation = loadInterpretiveSynthesisGroundingEvaluation(adapter, row.synthesis_proposal_id);
        if (groundingEvaluation?.groundingEnvelopeHash) {
            return {
                groundingBindingMode: 'SYNTHESIS_ENVELOPE',
                groundingEnvelopeHash: groundingEvaluation.groundingEnvelopeHash,
                groundingProtocolVersion: groundingEvaluation.evaluationProtocolVersion,
                groundingSourceSetHash: groundingEvaluation.sourceManifestHash,
                sourceKind: 'SYNTHESIS_GROUNDING_EVALUATION',
                sourceManifestHash: groundingEvaluation.sourceManifestHash,
                aggregateOutcome: groundingEvaluation.aggregateOutcome,
                evaluationProtocolVersion: groundingEvaluation.evaluationProtocolVersion,
                evaluatorConfigHash: groundingEvaluation.evaluatorConfigHash,
            };
        }
    }
    const groundingSourceSetHash = hashCanonical({
        derivation: 'interpretive-publication-grounding-source-set-v1',
        interpretationRevisionId: interpretation.interpretationRevisionId,
        groundingLinks: interpretation.groundingLinks.map((entry) => ({
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
        })),
    }).hash;
    return {
        groundingBindingMode: 'DERIVED_REVISION_GROUNDING',
        groundingEnvelopeHash: hashCanonical({
            derivation: 'interpretive-publication-grounding-envelope-v1',
            interpretationRevisionId: interpretation.interpretationRevisionId,
            proposalContentHash: interpretation.proposalContentHash,
            groundingOutcome: interpretation.groundingAggregate?.groundingOutcome || null,
            groundingLinks: interpretation.groundingLinks.map((entry) => ({
                groundingLinkId: entry.groundingLinkId,
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
                details: entry.details,
            })),
        }).hash,
        groundingProtocolVersion: 1,
        groundingSourceSetHash,
        sourceKind: 'DERIVED_REVISION_STATE',
        sourceManifestHash: null,
        aggregateOutcome: interpretation.groundingAggregate?.groundingOutcome || null,
        evaluationProtocolVersion: 1,
        evaluatorConfigHash: null,
    };
}

function persistInterpretivePublicationQualificationRow(adapter, qualification) {
    adapter.run(
        `INSERT INTO interpretation_publication_qualifications (
            qualification_id, interpretation_revision_id, publication_policy_id, policy_version,
            policy_hash, continuity_target_id, continuity_target_type, memory_scope_id,
            memory_subject_id, eligibility_verdict, refusal_codes_json, binding_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
            qualification.qualificationId,
            qualification.interpretationRevisionId,
            qualification.publicationPolicyId,
            Number(qualification.policyVersion),
            qualification.policyHash,
            qualification.continuityTargetId,
            qualification.continuityTargetType,
            qualification.memoryScopeId,
            qualification.memorySubjectId,
            qualification.eligibilityVerdict,
            stableStringify(qualification.refusalCodes),
            stableStringify(qualification.binding),
            Number(qualification.evaluatedAt),
        ],
    );
}

function evaluateInterpretivePublicationQualification(adapter, interpretation, policy, payload = {}, timestamp = Date.now()) {
    const continuityTargetId = sanitizeIdentifier(payload?.continuityTargetId, 'continuityTargetId');
    const refusalCodes = [];
    const groundingEnvelope = resolveInterpretationGroundingEnvelope(adapter, interpretation);
    const expectedProposalContentHash = payload?.proposalContentHash ? String(payload.proposalContentHash).trim() : null;
    const expectedGroundingEnvelopeHash = payload?.groundingEnvelopeHash ? String(payload.groundingEnvelopeHash).trim() : null;
    const expectedReviewEnvelopeHash = payload?.reviewEnvelopeHash ? String(payload.reviewEnvelopeHash).trim() : null;
    const expectedSubjectDispositionRecordId = payload?.subjectDispositionRecordId ? sanitizeIdentifier(payload.subjectDispositionRecordId, 'subjectDispositionRecordId') : null;

    if (Array.isArray(interpretation.childRevisionIds) && interpretation.childRevisionIds.length > 0) {
        refusalCodes.push('INTERPRETATION_REVISION_NOT_LATEST_ELIGIBLE_CHILD');
    }
    if (interpretation.reviewState !== 'COMPLETE') {
        refusalCodes.push('REVIEW_STATE_NOT_COMPLETE');
    }
    if (interpretation.subjectDispositionState !== policy.requiredFinalSubjectState) {
        refusalCodes.push('SUBJECT_DISPOSITION_STATE_MISMATCH');
    }
    if (interpretation.publicationState !== 'NOT_PUBLISHED') {
        refusalCodes.push('PUBLICATION_STATE_NOT_NOT_PUBLISHED');
    }
    if (!policy.permittedInterpretationTypes.includes(interpretation.type)) {
        refusalCodes.push('UNSUPPORTED_INTERPRETATION_TYPE_FOR_TARGET');
    }
    if (policy.policyState !== 'ACTIVE') {
        refusalCodes.push('PUBLICATION_POLICY_REVOKED_OR_INACTIVE');
    }
    if (policy.continuityTargetType === 'MEMORY_SUBJECT' && continuityTargetId !== interpretation.memorySubjectId) {
        refusalCodes.push('CONTINUITY_TARGET_MISMATCH');
    }
    if (policy.subjectIdentityMode === 'EXACT_SUBJECT' && continuityTargetId !== interpretation.memorySubjectId) {
        refusalCodes.push('SUBJECT_IDENTITY_MISMATCH');
    }
    if (compareGroundingOutcomeLevel(
        groundingEnvelope.aggregateOutcome || 'UNSUPPORTED',
        policy.requiredGroundingOutcome,
    ) < 0) {
        refusalCodes.push('GROUNDING_OUTCOME_BELOW_POLICY');
    }
    if (policy.contestOrDeferBlocksPublication) {
        const hasContestOrDefer = interpretation.reviewDispositions.some((entry) => ['CONTEST', 'DEFER'].includes(entry.disposition))
            || ['CONTESTED', 'DEFERRED'].includes(interpretation.subjectDispositionState)
            || interpretation.reviewRequests.some((entry) => ['CONTESTED', 'DEFERRED'].includes(entry.status));
        if (hasContestOrDefer) {
            refusalCodes.push('CONTEST_OR_DEFER_BLOCKS_PUBLICATION');
        }
    }
    if (policy.participantDisagreementBlocksPublication) {
        const hasParticipantDisagreement = interpretation.reviewDispositions.some((entry) => ['REJECT', 'CONTEST', 'DEFER'].includes(entry.disposition));
        if (hasParticipantDisagreement) {
            refusalCodes.push('PARTICIPANT_DISAGREEMENT_BLOCKS_PUBLICATION');
        }
    }
    if (policy.immutableChildRequiredForTypes.includes(interpretation.type) && !interpretation.parentRevisionId) {
        refusalCodes.push('IMMUTABLE_CHILD_REVISION_REQUIRED');
    }
    if (expectedProposalContentHash && expectedProposalContentHash !== interpretation.proposalContentHash) {
        refusalCodes.push('PROPOSAL_HASH_MISMATCH');
    }
    if (expectedGroundingEnvelopeHash && expectedGroundingEnvelopeHash !== groundingEnvelope.groundingEnvelopeHash) {
        refusalCodes.push('GROUNDING_ENVELOPE_HASH_MISMATCH');
    }
    if (expectedReviewEnvelopeHash && expectedReviewEnvelopeHash !== interpretation.reviewEnvelopeHash) {
        refusalCodes.push('REVIEW_ENVELOPE_HASH_MISMATCH');
    }
    if (expectedSubjectDispositionRecordId && expectedSubjectDispositionRecordId !== interpretation.subjectDisposition?.subjectDispositionId) {
        refusalCodes.push('SUBJECT_DISPOSITION_RECORD_MISMATCH');
    }

    const binding = {
        interpretationRevisionId: interpretation.interpretationRevisionId,
        interpretationId: interpretation.interpretationId,
        proposalContentHash: interpretation.proposalContentHash,
        groundingBindingMode: groundingEnvelope.groundingBindingMode,
        groundingEnvelopeHash: groundingEnvelope.groundingEnvelopeHash,
        groundingProtocolVersion: groundingEnvelope.groundingProtocolVersion,
        groundingSourceSetHash: groundingEnvelope.groundingSourceSetHash,
        groundingEnvelopeSource: groundingEnvelope.sourceKind,
        reviewEnvelopeHash: interpretation.reviewEnvelopeHash,
        reviewState: interpretation.reviewState,
        subjectDispositionState: interpretation.subjectDispositionState,
        subjectDispositionRecordId: interpretation.subjectDisposition?.subjectDispositionId || null,
        memoryScopeId: interpretation.memoryScopeId,
        memorySubjectId: interpretation.memorySubjectId,
        continuityTargetId,
        publicationPolicyId: policy.publicationPolicyId,
        publicationPolicyVersion: policy.policyVersion,
        publicationPolicyHash: policy.policyHash,
        postGrantHumanPublicationAuthorizationRequired: policy.postGrantHumanPublicationAuthorizationRequired,
    };
    const eligibilityVerdict = refusalCodes.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE';
    if (!ALLOWED_PUBLICATION_ELIGIBILITY_VERDICTS.has(eligibilityVerdict)) {
        throw createError(500, 'Publication eligibility verdict is invalid', 'ARCH_PUBLICATION_QUALIFICATION_INVALID');
    }
    return {
        qualificationId: createId('dnmqual'),
        interpretationRevisionId: interpretation.interpretationRevisionId,
        publicationPolicyId: policy.publicationPolicyId,
        policyVersion: policy.policyVersion,
        policyHash: policy.policyHash,
        continuityTargetId,
        continuityTargetType: policy.continuityTargetType,
        memoryScopeId: interpretation.memoryScopeId,
        memorySubjectId: interpretation.memorySubjectId,
        eligibilityVerdict,
        refusalCodes: Array.from(new Set(refusalCodes)).sort(),
        binding,
        evaluatedAt: timestamp,
    };
}

function buildPublicationAuthorizationRecord(qualification, authorizedBy, expiresAt, timestamp) {
    const qualificationBindingHash = computePublicationQualificationBindingHash(qualification.binding);
    return {
        publicationAuthorizationId: createId('dnmauth'),
        qualificationId: qualification.qualificationId,
        interpretationRevisionId: qualification.interpretationRevisionId,
        publicationPolicyId: qualification.publicationPolicyId,
        policyVersion: qualification.policyVersion,
        policyHash: qualification.policyHash,
        continuityTargetId: qualification.continuityTargetId,
        continuityTargetType: qualification.continuityTargetType,
        memoryScopeId: qualification.memoryScopeId,
        memorySubjectId: qualification.memorySubjectId,
        authorizationNonce: createId('dnmnonce'),
        qualificationBindingHash,
        authorizedBy,
        authorizedAt: timestamp,
        expiresAt,
        status: 'AUTHORIZED',
        binding: {
            ...cloneJson(qualification.binding),
            qualificationId: qualification.qualificationId,
            qualificationEvaluatedAt: qualification.evaluatedAt,
            qualificationBindingHash,
        },
        consumedAt: null,
        dnmRecordId: null,
    };
}

function expirePublicationAuthorization(adapter, authorization, refusalCodes, timestamp) {
    const nextAuthorization = {
        ...authorization,
        status: 'EXPIRED',
        consumedAt: null,
    };
    persistInterpretivePublicationAuthorizationRow(adapter, nextAuthorization);
    return createPublicationAuthorizationRefusedEvent(nextAuthorization, refusalCodes, timestamp);
}

function buildPublicationExecutionRecord(
    authorization,
    interpretation,
    timestamp,
    dnmRecordId = createId('dnmrec'),
    lifecycleState = 'ACTIVE',
) {
    return {
        dnmRecordId,
        continuityTargetId: authorization.continuityTargetId,
        memorySubjectId: authorization.memorySubjectId,
        memoryScopeId: authorization.memoryScopeId,
        sourceInterpretationRevisionId: interpretation.interpretationRevisionId,
        sourceInterpretationId: interpretation.interpretationId,
        publishedStatement: interpretation.statement,
        proposalContentHash: interpretation.proposalContentHash,
        groundingBindingMode: authorization.binding.groundingBindingMode,
        groundingEnvelopeHash: authorization.binding.groundingEnvelopeHash,
        groundingProtocolVersion: Number(authorization.binding.groundingProtocolVersion),
        groundingSourceSetHash: authorization.binding.groundingSourceSetHash,
        reviewEnvelopeHash: interpretation.reviewEnvelopeHash,
        publicationPolicyId: authorization.publicationPolicyId,
        publicationPolicyVersion: authorization.policyVersion,
        publicationPolicyHash: authorization.policyHash,
        publicationState: 'PUBLISHED',
        lifecycleState,
        publishedAt: timestamp,
        publicationAuthorizationId: authorization.publicationAuthorizationId,
    };
}

function buildDefaultDnmLifecycleMetadata(record) {
    return {
        dnmRecordId: record.dnmRecordId,
        continuityTargetId: record.continuityTargetId,
        supersededByDnmRecordId: null,
        supersedesDnmRecordId: null,
        supersededAt: null,
        supersessionReasonCodes: [],
        supersessionCommentary: null,
        supersessionProvenance: null,
        withdrawnAt: null,
        withdrawalReasonCodes: [],
        withdrawalCommentary: null,
        withdrawalProvenance: null,
        deltaReviewState: 'NONE',
        latestDeltaReviewId: null,
        updatedAt: record.publishedAt,
    };
}

function buildDnmLifecycleInterpretation(record) {
    return {
        memoryScopeId: record.memoryScopeId,
        memorySubjectId: record.memorySubjectId,
    };
}

function authorizeDnmLifecycleAction(adapter, record, {
    actionKind,
    dispositionOwnerId,
    submittedByActorId,
    submissionMode,
    delegationPolicyId = null,
    subjectEvidenceRefs = [],
}) {
    return authorizeInterpretiveAction(adapter, {
        interpretation: buildDnmLifecycleInterpretation(record),
        actionKind,
        dispositionOwnerId,
        submittedByActorId,
        submissionMode,
        delegationPolicyId,
        subjectEvidenceRefs,
    });
}

function buildDnmSupersessionAction(previousRecord, replacementRecord, provenance, reasonCodes, commentary, timestamp) {
    return {
        dnmSupersessionId: createId('dnmsup'),
        supersededDnmRecordId: previousRecord.dnmRecordId,
        replacementDnmRecordId: replacementRecord.dnmRecordId,
        continuityTargetId: previousRecord.continuityTargetId,
        memoryScopeId: previousRecord.memoryScopeId,
        memorySubjectId: previousRecord.memorySubjectId,
        supersededInterpretationRevisionId: previousRecord.sourceInterpretationRevisionId,
        replacementInterpretationRevisionId: replacementRecord.sourceInterpretationRevisionId,
        replacementInterpretationId: replacementRecord.sourceInterpretationId,
        reasonCodes,
        commentary,
        provenance,
        supersededAt: timestamp,
    };
}

function buildDnmWithdrawalAction(record, provenance, reasonCodes, commentary, timestamp) {
    return {
        dnmWithdrawalId: createId('dnmwith'),
        dnmRecordId: record.dnmRecordId,
        continuityTargetId: record.continuityTargetId,
        memoryScopeId: record.memoryScopeId,
        memorySubjectId: record.memorySubjectId,
        sourceInterpretationRevisionId: record.sourceInterpretationRevisionId,
        sourceInterpretationId: record.sourceInterpretationId,
        reasonCodes,
        commentary,
        provenance,
        withdrawnAt: timestamp,
    };
}

function buildDnmDeltaReviewRecord(record, sourceInterpretationRevisionId, deltaState, reasonCodes, commentary, provenance, timestamp) {
    return {
        deltaReviewId: createId('dnmdelta'),
        dnmRecordId: record.dnmRecordId,
        continuityTargetId: record.continuityTargetId,
        memoryScopeId: record.memoryScopeId,
        memorySubjectId: record.memorySubjectId,
        sourceInterpretationRevisionId,
        sourceInterpretationId: record.sourceInterpretationId,
        deltaState,
        reasonCodes,
        commentary,
        provenance,
        createdAt: timestamp,
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
    const submittedByActorId = normalizeActorEntityId(payload);
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
        const interpretation = loadInterpretiveCandidateProjection(adapter, requestRow.interpretation_revision_id);
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${requestRow.interpretation_revision_id} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        if (interpretation.reviewEnvelopeHash !== requestRow.review_envelope_hash || interpretation.reviewEnvelopeHash !== reviewEnvelopeHash) {
            throw createError(409, 'Review envelope hash is stale for this request', 'ARCH_STALE_REVIEW_ENVELOPE');
        }
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : requestRow.reviewer_entity_id;
        if (dispositionOwnerId !== requestRow.reviewer_entity_id) {
            throw createError(403, 'Review disposition owner must match the bound review request owner', 'ARCH_REVIEWER_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultReviewSubmissionMode(requestRow, submittedByActorId);
        const authorization = authorizeInterpretiveAction(adapter, {
            interpretation,
            actionKind: 'REVIEW_DISPOSITION',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });
        let childRevisionProvenance = null;
        if (disposition === 'APPROVE_WITH_EDIT') {
            const revisionAuthorization = authorizeInterpretiveAction(adapter, {
                interpretation,
                actionKind: 'SUBJECT_REVISION',
                dispositionOwnerId,
                submittedByActorId,
                submissionMode,
                delegationPolicyId: payload?.delegationPolicyId || null,
                subjectEvidenceRefs: payload?.subjectEvidenceRefs,
            });
            childRevisionProvenance = revisionAuthorization;
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
            provenance: createActionProvenanceRecord({
                interpretationRevisionId: interpretation.interpretationRevisionId,
                actionKind: 'REVIEW_DISPOSITION',
                actionTargetId: null,
                dispositionOwnerId,
                submittedByActorId,
                submissionMode,
                delegationPolicy: authorization.delegationPolicy,
                subjectEvidenceRefs: authorization.subjectEvidenceRefs,
                createdAt: timestamp,
            }),
        };
        reviewDisposition.provenance.actionTargetId = reviewDisposition.reviewDispositionId;

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
            childPayload.revisionCreationProvenance = createActionProvenanceRecord({
                interpretationRevisionId: childPayload.interpretationRevisionId,
                actionKind: 'SUBJECT_REVISION',
                actionTargetId: childPayload.interpretationRevisionId,
                dispositionOwnerId,
                submittedByActorId,
                submissionMode,
                delegationPolicy: childRevisionProvenance?.delegationPolicy || null,
                subjectEvidenceRefs: childRevisionProvenance?.subjectEvidenceRefs || [],
                createdAt: timestamp,
            });
            childPrepared = carryForwardPreparedReviewerApproval(
                prepareInterpretiveCandidate(childPayload, timestamp),
                requestRow.reviewer_role,
                requestRow.reviewer_entity_id,
                timestamp,
            );
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
            persistActionProvenanceRow(adapter, reviewDisposition.provenance);
            const requestStatus = deriveRequestStatusFromDisposition(disposition);
            adapter.run(
                'UPDATE interpretation_review_requests SET status = ? WHERE review_request_id = ?',
                [requestStatus, requestRow.review_request_id],
            );
            adapter.run(
                'UPDATE interpretation_review_obligations SET obligation_state = ?, blocking_reason = ? WHERE review_obligation_id = ?',
                [deriveObligationStateFromRequestStatus(requestStatus), 'NONE', requestRow.review_obligation_id],
            );
            if (childPrepared) {
                supersedeSiblingReviewRequestsAfterChild(
                    adapter,
                    interpretation.interpretationRevisionId,
                    requestRow.review_request_id,
                );
                persistPreparedCandidateRows(adapter, childPrepared, timestamp);
            }
            recomputeCandidateReviewState(adapter, interpretation.interpretationRevisionId, timestamp);
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
    const submittedByActorId = normalizeActorEntityId(payload);
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
        if (interpretation.reviewEnvelopeHash !== reviewEnvelopeHash) {
            throw createError(409, 'Subject disposition is stale for this review envelope', 'ARCH_STALE_REVIEW_ENVELOPE');
        }
        if (Array.isArray(interpretation.childRevisionIds) && interpretation.childRevisionIds.length > 0) {
            throw createError(
                409,
                'Subject disposition must be recorded against the latest child revision created by APPROVE_WITH_EDIT',
                'ARCH_SUBJECT_DISPOSITION_SUPERSEDED',
            );
        }
        const pendingRequests = interpretation.reviewRequests.filter((entry) => entry.status === 'PENDING' || entry.status === 'DEFERRED');
        if (pendingRequests.length > 0 || interpretation.reviewState === 'BLOCKED' || interpretation.reviewState === 'PENDING' || interpretation.reviewState === 'DEFERRED') {
            throw createError(409, 'Required review is not complete for subject disposition', 'ARCH_REVIEW_INCOMPLETE');
        }
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : interpretation.memorySubjectId;
        if (dispositionOwnerId !== interpretation.memorySubjectId) {
            throw createError(403, 'Subject disposition owner must match the interpretation memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultSubjectSubmissionMode(interpretation.memorySubjectId, submittedByActorId);
        const authorization = authorizeInterpretiveAction(adapter, {
            interpretation,
            actionKind: 'SUBJECT_DISPOSITION',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });

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
            provenance: createActionProvenanceRecord({
                interpretationRevisionId: interpretation.interpretationRevisionId,
                actionKind: 'SUBJECT_DISPOSITION',
                actionTargetId: null,
                dispositionOwnerId,
                submittedByActorId,
                submissionMode,
                delegationPolicy: authorization.delegationPolicy,
                subjectEvidenceRefs: authorization.subjectEvidenceRefs,
                createdAt: timestamp,
            }),
        };
        nextSubjectDisposition.provenance.actionTargetId = nextSubjectDisposition.subjectDispositionId;
        appendLedgerEvents(
            paths.interpretiveGovernanceLedgerPath,
            [createSubjectDispositionEvent(nextSubjectDisposition, interpretation, reviewEnvelopeHash)],
        );
        adapter.transaction(() => {
            persistActionProvenanceRow(adapter, nextSubjectDisposition.provenance);
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
    const submittedByActorId = normalizeActorEntityId(payload);
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
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : interpretation.memorySubjectId;
        if (dispositionOwnerId !== interpretation.memorySubjectId) {
            throw createError(403, 'Revision owner must match the interpretation memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultSubjectSubmissionMode(interpretation.memorySubjectId, submittedByActorId);
        const authorization = authorizeInterpretiveAction(adapter, {
            interpretation,
            actionKind: 'SUBJECT_REVISION',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });
        const childPayload = buildChildRevisionPayload(
            interpretation,
            payload,
            payload?.createdFromDispositionId ? sanitizeIdentifier(payload.createdFromDispositionId, 'createdFromDispositionId') : null,
            'MEMORY_SUBJECT',
            timestamp,
        );
        childPayload.revisionCreationProvenance = createActionProvenanceRecord({
            interpretationRevisionId: childPayload.interpretationRevisionId,
            actionKind: 'SUBJECT_REVISION',
            actionTargetId: childPayload.interpretationRevisionId,
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicy: authorization.delegationPolicy,
            subjectEvidenceRefs: authorization.subjectEvidenceRefs,
            createdAt: timestamp,
        });
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
        const provenanceRows = adapter.all(
            `SELECT * FROM interpretation_action_provenance
             WHERE interpretation_revision_id ${filters.interpretationRevisionId ? '= ?' : 'IN (SELECT interpretation_revision_id FROM interpretation_review_requests)'}
             ORDER BY created_at, action_provenance_id`,
            filters.interpretationRevisionId
                ? [sanitizeIdentifier(filters.interpretationRevisionId, 'interpretationRevisionId')]
                : [],
        );
        const provenanceByTarget = new Map(
            provenanceRows
                .filter((row) => row.action_kind === 'REVIEW_DISPOSITION')
                .map((row) => [`REVIEW_DISPOSITION:${row.action_target_id}`, normalizeActionProvenanceRow(row)]),
        );
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
                    provenance: provenanceByTarget.get(`REVIEW_DISPOSITION:${row.review_disposition_id}`) || null,
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

export function listInterpretiveDelegationPolicies(request, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const params = [];
        const where = [];
        if (filters.memoryScopeId) {
            where.push('memory_scope_id = ?');
            params.push(sanitizeIdentifier(filters.memoryScopeId, 'memoryScopeId'));
        }
        if (filters.principalEntityId) {
            where.push('principal_entity_id = ?');
            params.push(sanitizeIdentifier(filters.principalEntityId, 'principalEntityId'));
        }
        if (filters.delegateEntityId) {
            where.push('delegate_entity_id = ?');
            params.push(sanitizeIdentifier(filters.delegateEntityId, 'delegateEntityId'));
        }
        if (filters.policyState) {
            const policyState = String(filters.policyState).trim();
            if (!ALLOWED_DELEGATION_POLICY_STATES.has(policyState)) {
                throw createError(400, 'policyState is invalid', 'ARCH_INVALID_PAYLOAD');
            }
            where.push('policy_state = ?');
            params.push(policyState);
        }
        const rows = adapter.all(
            `SELECT delegation_policy_id, policy_version
             FROM interpretation_delegation_policies
             ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY created_at, delegation_policy_id, policy_version`,
            params,
        );
        return {
            ok: true,
            phase: 'c0.6.2',
            policies: rows.map((row) => (
                loadInterpretiveDelegationPolicyProjection(adapter, row.delegation_policy_id, Number(row.policy_version))
            )),
        };
    } finally {
        adapter.close();
    }
}

export function upsertInterpretiveDelegationPolicy(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const policy = buildInterpretiveDelegationPolicyRecord(payload, timestamp);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    fs.mkdirSync(paths.storageRoot, { recursive: true });

    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const existing = loadInterpretiveDelegationPolicyProjection(adapter, policy.delegationPolicyId, policy.policyVersion);
        if (existing) {
            if (existing.policyHash !== policy.policyHash) {
                throw createError(
                    409,
                    `Delegation policy ${policy.delegationPolicyId} version ${policy.policyVersion} already exists with different content`,
                    'ARCH_DELEGATION_POLICY_CONFLICT',
                );
            }
            return {
                ok: true,
                phase: 'c0.6.2',
                ledgerPath: paths.interpretiveGovernanceLedgerPath,
                delegationPolicy: existing,
                created: false,
            };
        }
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [createDelegationPolicyEvent(policy)]);
        adapter.transaction(() => {
            persistInterpretiveDelegationPolicyRow(adapter, policy);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.2',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            delegationPolicy: loadInterpretiveDelegationPolicyProjection(adapter, policy.delegationPolicyId, policy.policyVersion),
            created: true,
        };
    } finally {
        adapter.close();
    }
}

export function revokeInterpretiveDelegationPolicy(request, delegationPolicyId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const policyVersion = normalizePositiveInteger(payload?.policyVersion, 'policyVersion', 1, 1_000_000);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        seedInterpretivePolicyDefinitions(adapter);
        const policy = loadInterpretiveDelegationPolicyProjection(
            adapter,
            sanitizeIdentifier(delegationPolicyId, 'delegationPolicyId'),
            policyVersion,
        );
        if (!policy) {
            throw createError(404, `Delegation policy ${delegationPolicyId} version ${policyVersion} was not found`, 'ARCH_DELEGATION_POLICY_NOT_FOUND');
        }
        if (!policy.revocable) {
            throw createError(409, `Delegation policy ${delegationPolicyId} version ${policyVersion} is not revocable`, 'ARCH_DELEGATION_POLICY_NOT_REVOCABLE');
        }
        if (policy.policyState === 'REVOKED') {
            return {
                ok: true,
                phase: 'c0.6.2',
                ledgerPath: paths.interpretiveGovernanceLedgerPath,
                delegationPolicy: policy,
                revoked: false,
            };
        }
        const revocationReason = normalizeOptionalCommentary(payload?.revocationReason, 'revocationReason');
        const nextPolicy = {
            ...policy,
            policyState: 'REVOKED',
            revocationReason,
            updatedAt: timestamp,
            revokedAt: timestamp,
        };
        appendLedgerEvents(paths.interpretiveGovernanceLedgerPath, [createDelegationPolicyRevocationEvent(nextPolicy, timestamp)]);
        adapter.transaction(() => {
            persistInterpretiveDelegationPolicyRow(adapter, nextPolicy);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.2',
            ledgerPath: paths.interpretiveGovernanceLedgerPath,
            delegationPolicy: loadInterpretiveDelegationPolicyProjection(adapter, nextPolicy.delegationPolicyId, nextPolicy.policyVersion),
            revoked: true,
        };
    } finally {
        adapter.close();
    }
}

export function listDnmPublicationRecords(request, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        const params = [];
        const where = [];
        if (filters.continuityTargetId) {
            where.push('continuity_target_id = ?');
            params.push(sanitizeIdentifier(filters.continuityTargetId, 'continuityTargetId'));
        }
        if (filters.memorySubjectId) {
            where.push('memory_subject_id = ?');
            params.push(sanitizeIdentifier(filters.memorySubjectId, 'memorySubjectId'));
        }
        if (filters.lifecycleState) {
            where.push('lifecycle_state = ?');
            params.push(normalizeEnumValue(filters.lifecycleState, 'lifecycleState', ALLOWED_DNM_LIFECYCLE_STATES));
        }
        const rows = adapter.all(
            `SELECT dnm_record_id
             FROM dnm_publication_records
             ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY published_at, dnm_record_id`,
            params,
        );
        return {
            ok: true,
            phase: 'c0.6.4',
            records: rows.map((row) => loadDnmPublicationRecordProjection(adapter, row.dnm_record_id)),
        };
    } finally {
        adapter.close();
    }
}

export function getCurrentActiveDnmRecord(request, continuityTargetId) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        const normalizedTargetId = sanitizeIdentifier(continuityTargetId, 'continuityTargetId');
        return {
            ok: true,
            phase: 'c0.6.4',
            continuityTargetId: normalizedTargetId,
            currentActiveRecord: loadCurrentActiveDnmRecordForTarget(adapter, normalizedTargetId),
        };
    } finally {
        adapter.close();
    }
}

export function getInterpretivePublicationOperatorState(request, interpretationRevisionId, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        const normalizedRevisionId = sanitizeIdentifier(interpretationRevisionId, 'interpretationRevisionId');
        const continuityTargetId = filters?.continuityTargetId
            ? sanitizeIdentifier(filters.continuityTargetId, 'continuityTargetId')
            : null;
        const operatorState = buildInterpretivePublicationOperatorState(adapter, normalizedRevisionId, continuityTargetId);
        if (!operatorState) {
            throw createError(404, `Interpretation revision ${interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        return {
            ok: true,
            phase: 'c0.6.4',
            operatorState,
        };
    } finally {
        adapter.close();
    }
}

export function listInterpretivePublicationPolicies(request, filters = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths);
    try {
        const params = [];
        const where = [];
        if (filters.publicationPolicyId) {
            where.push('publication_policy_id = ?');
            params.push(sanitizeIdentifier(filters.publicationPolicyId, 'publicationPolicyId'));
        }
        if (filters.policyState) {
            where.push('policy_state = ?');
            params.push(normalizeEnumValue(filters.policyState, 'policyState', ALLOWED_PUBLICATION_POLICY_STATES));
        }
        const rows = adapter.all(
            `SELECT publication_policy_id, policy_version
             FROM interpretation_publication_policies
             ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
             ORDER BY publication_policy_id, policy_version`,
            params,
        );
        return {
            ok: true,
            phase: 'c0.6.4',
            policies: rows.map((row) => (
                loadInterpretivePublicationPolicyProjection(adapter, row.publication_policy_id, Number(row.policy_version))
            )),
        };
    } finally {
        adapter.close();
    }
}

export function supersedeDnmPublicationRecord(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const submittedByActorId = normalizeActorEntityId(payload);
    const priorDnmRecordId = sanitizeIdentifier(payload?.priorDnmRecordId, 'priorDnmRecordId');
    const replacementDnmRecordId = sanitizeIdentifier(payload?.replacementDnmRecordId, 'replacementDnmRecordId');
    const reasonCodes = normalizeReasonCodes(payload?.reasonCodes, 'reasonCodes');
    const commentary = normalizeOptionalCommentary(payload?.commentary, 'commentary');
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const priorRecord = loadDnmPublicationRecordProjection(adapter, priorDnmRecordId);
        if (!priorRecord) {
            throw createError(404, `DNM record ${priorDnmRecordId} was not found`, 'ARCH_DNM_RECORD_NOT_FOUND');
        }
        const replacementRecord = loadDnmPublicationRecordProjection(adapter, replacementDnmRecordId);
        if (!replacementRecord) {
            throw createError(404, `DNM record ${replacementDnmRecordId} was not found`, 'ARCH_DNM_RECORD_NOT_FOUND');
        }
        if (priorRecord.dnmRecordId === replacementRecord.dnmRecordId) {
            throw createError(409, 'Replacement DNM record must differ from the prior active record', 'ARCH_DNM_SUPERSESSION_INVALID');
        }
        if (priorRecord.continuityTargetId !== replacementRecord.continuityTargetId) {
            throw createError(409, 'Replacement DNM record targets a different continuity subject', 'ARCH_DNM_SUPERSESSION_TARGET_MISMATCH');
        }
        if (priorRecord.lifecycleState !== 'ACTIVE') {
            throw createError(409, 'Prior DNM record is not currently active', 'ARCH_DNM_SUPERSESSION_STALE');
        }
        if (replacementRecord.publicationState !== 'PUBLISHED') {
            throw createError(409, 'Replacement DNM record is not published', 'ARCH_DNM_SUPERSESSION_INVALID');
        }
        if (!['DELTA_PENDING', 'ACTIVE'].includes(replacementRecord.lifecycleState)) {
            throw createError(409, 'Replacement DNM record is not in a supersedable lifecycle state', 'ARCH_DNM_SUPERSESSION_INVALID');
        }
        const currentActive = loadCurrentActiveDnmRecordForTarget(adapter, priorRecord.continuityTargetId);
        if (!currentActive || currentActive.dnmRecordId !== priorRecord.dnmRecordId) {
            throw createError(409, 'Current active DNM record drifted before supersession', 'ARCH_DNM_SUPERSESSION_STALE');
        }
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : priorRecord.memorySubjectId;
        if (dispositionOwnerId !== priorRecord.memorySubjectId) {
            throw createError(403, 'DNM supersession owner must match the memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultSubjectSubmissionMode(priorRecord.memorySubjectId, submittedByActorId);
        const authorization = authorizeDnmLifecycleAction(adapter, priorRecord, {
            actionKind: 'DNM_SUPERSESSION',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });
        const provenance = createActionProvenanceRecord({
            interpretationRevisionId: replacementRecord.sourceInterpretationRevisionId,
            actionKind: 'DNM_SUPERSESSION',
            actionTargetId: replacementRecord.dnmRecordId,
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicy: authorization.delegationPolicy,
            subjectEvidenceRefs: authorization.subjectEvidenceRefs,
            createdAt: timestamp,
        });
        const supersession = buildDnmSupersessionAction(
            priorRecord,
            replacementRecord,
            provenance,
            reasonCodes,
            commentary,
            timestamp,
        );
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createDnmSupersededEvent(supersession)]);
        adapter.transaction(() => {
            persistDnmPublicationRecordRow(adapter, {
                ...priorRecord,
                lifecycleState: 'SUPERSEDED',
            });
            persistDnmPublicationRecordRow(adapter, {
                ...replacementRecord,
                lifecycleState: 'ACTIVE',
            });
            persistDnmPublicationLifecycleMetadataRow(adapter, {
                ...(loadDnmPublicationLifecycleMetadata(adapter, priorRecord.dnmRecordId) || buildDefaultDnmLifecycleMetadata(priorRecord)),
                supersededByDnmRecordId: replacementRecord.dnmRecordId,
                supersededAt: timestamp,
                supersessionReasonCodes: reasonCodes,
                supersessionCommentary: commentary,
                supersessionProvenance: provenance,
                updatedAt: timestamp,
            });
            persistDnmPublicationLifecycleMetadataRow(adapter, {
                ...(loadDnmPublicationLifecycleMetadata(adapter, replacementRecord.dnmRecordId) || buildDefaultDnmLifecycleMetadata(replacementRecord)),
                supersedesDnmRecordId: priorRecord.dnmRecordId,
                deltaReviewState: 'NONE',
                updatedAt: timestamp,
            });
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            supersession,
            priorRecord: loadDnmPublicationRecordProjection(adapter, priorRecord.dnmRecordId),
            replacementRecord: loadDnmPublicationRecordProjection(adapter, replacementRecord.dnmRecordId),
            currentActiveRecord: loadCurrentActiveDnmRecordForTarget(adapter, priorRecord.continuityTargetId),
        };
    } finally {
        adapter.close();
    }
}

export function withdrawDnmPublicationRecord(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const submittedByActorId = normalizeActorEntityId(payload);
    const dnmRecordId = sanitizeIdentifier(payload?.dnmRecordId, 'dnmRecordId');
    const reasonCodes = normalizeReasonCodes(payload?.reasonCodes, 'reasonCodes');
    const commentary = normalizeOptionalCommentary(payload?.commentary, 'commentary');
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const record = loadDnmPublicationRecordProjection(adapter, dnmRecordId);
        if (!record) {
            throw createError(404, `DNM record ${dnmRecordId} was not found`, 'ARCH_DNM_RECORD_NOT_FOUND');
        }
        if (record.lifecycleState !== 'ACTIVE') {
            throw createError(409, 'DNM record is not currently active', 'ARCH_DNM_WITHDRAWAL_STALE');
        }
        const currentActive = loadCurrentActiveDnmRecordForTarget(adapter, record.continuityTargetId);
        if (!currentActive || currentActive.dnmRecordId !== record.dnmRecordId) {
            throw createError(409, 'Current active DNM record drifted before withdrawal', 'ARCH_DNM_WITHDRAWAL_STALE');
        }
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : record.memorySubjectId;
        if (dispositionOwnerId !== record.memorySubjectId) {
            throw createError(403, 'DNM withdrawal owner must match the memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultSubjectSubmissionMode(record.memorySubjectId, submittedByActorId);
        const authorization = authorizeDnmLifecycleAction(adapter, record, {
            actionKind: 'DNM_WITHDRAWAL',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });
        const provenance = createActionProvenanceRecord({
            interpretationRevisionId: record.sourceInterpretationRevisionId,
            actionKind: 'DNM_WITHDRAWAL',
            actionTargetId: record.dnmRecordId,
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicy: authorization.delegationPolicy,
            subjectEvidenceRefs: authorization.subjectEvidenceRefs,
            createdAt: timestamp,
        });
        const withdrawal = buildDnmWithdrawalAction(record, provenance, reasonCodes, commentary, timestamp);
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createDnmWithdrawnEvent(withdrawal)]);
        adapter.transaction(() => {
            persistDnmPublicationRecordRow(adapter, {
                ...record,
                lifecycleState: 'WITHDRAWN',
            });
            persistDnmPublicationLifecycleMetadataRow(adapter, {
                ...(loadDnmPublicationLifecycleMetadata(adapter, record.dnmRecordId) || buildDefaultDnmLifecycleMetadata(record)),
                withdrawnAt: timestamp,
                withdrawalReasonCodes: reasonCodes,
                withdrawalCommentary: commentary,
                withdrawalProvenance: provenance,
                updatedAt: timestamp,
            });
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            withdrawal,
            record: loadDnmPublicationRecordProjection(adapter, record.dnmRecordId),
            currentActiveRecord: loadCurrentActiveDnmRecordForTarget(adapter, record.continuityTargetId),
        };
    } finally {
        adapter.close();
    }
}

export function recordDnmDeltaReview(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const submittedByActorId = normalizeActorEntityId(payload);
    const reasonCodes = normalizeReasonCodes(payload?.reasonCodes, 'reasonCodes');
    const commentary = normalizeOptionalCommentary(payload?.commentary, 'commentary');
    const deltaState = normalizeEnumValue(payload?.deltaState, 'deltaState', ALLOWED_DNM_DELTA_REVIEW_STATES, 'PENDING');
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const explicitRecordId = payload?.dnmRecordId ? sanitizeIdentifier(payload.dnmRecordId, 'dnmRecordId') : null;
        const explicitTargetId = payload?.continuityTargetId ? sanitizeIdentifier(payload.continuityTargetId, 'continuityTargetId') : null;
        let record = explicitRecordId ? loadDnmPublicationRecordProjection(adapter, explicitRecordId) : null;
        if (!record && explicitTargetId) {
            record = loadCurrentActiveDnmRecordForTarget(adapter, explicitTargetId);
        }
        if (!record) {
            throw createError(404, 'A target DNM record could not be resolved for delta review', 'ARCH_DNM_RECORD_NOT_FOUND');
        }
        if (explicitTargetId && record.continuityTargetId !== explicitTargetId) {
            throw createError(409, 'Delta review continuity target does not match the resolved DNM record', 'ARCH_DNM_DELTA_TARGET_MISMATCH');
        }
        const dispositionOwnerId = payload?.dispositionOwnerId
            ? sanitizeIdentifier(payload.dispositionOwnerId, 'dispositionOwnerId')
            : record.memorySubjectId;
        if (dispositionOwnerId !== record.memorySubjectId) {
            throw createError(403, 'DNM delta review owner must match the memory subject', 'ARCH_SUBJECT_IDENTITY_MISMATCH');
        }
        const submissionMode = payload?.submissionMode
            ? normalizeSubmissionMode(payload.submissionMode, 'submissionMode')
            : defaultSubjectSubmissionMode(record.memorySubjectId, submittedByActorId);
        const authorization = authorizeDnmLifecycleAction(adapter, record, {
            actionKind: 'DNM_DELTA_REVIEW',
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicyId: payload?.delegationPolicyId || null,
            subjectEvidenceRefs: payload?.subjectEvidenceRefs,
        });
        const provenance = createActionProvenanceRecord({
            interpretationRevisionId: payload?.sourceInterpretationRevisionId
                ? sanitizeIdentifier(payload.sourceInterpretationRevisionId, 'sourceInterpretationRevisionId')
                : record.sourceInterpretationRevisionId,
            actionKind: 'DNM_DELTA_REVIEW',
            actionTargetId: record.dnmRecordId,
            dispositionOwnerId,
            submittedByActorId,
            submissionMode,
            delegationPolicy: authorization.delegationPolicy,
            subjectEvidenceRefs: authorization.subjectEvidenceRefs,
            createdAt: timestamp,
        });
        const review = buildDnmDeltaReviewRecord(
            record,
            provenance.interpretationRevisionId,
            deltaState,
            reasonCodes,
            commentary,
            provenance,
            timestamp,
        );
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createDnmDeltaReviewRecordedEvent(review)]);
        adapter.transaction(() => {
            persistDnmDeltaReviewRow(adapter, review);
            persistDnmPublicationLifecycleMetadataRow(adapter, {
                ...(loadDnmPublicationLifecycleMetadata(adapter, record.dnmRecordId) || buildDefaultDnmLifecycleMetadata(record)),
                deltaReviewState: deltaState,
                latestDeltaReviewId: review.deltaReviewId,
                updatedAt: timestamp,
            });
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            deltaReview: review,
            record: loadDnmPublicationRecordProjection(adapter, record.dnmRecordId),
            currentActiveRecord: loadCurrentActiveDnmRecordForTarget(adapter, record.continuityTargetId),
        };
    } finally {
        adapter.close();
    }
}

export function upsertInterpretivePublicationPolicy(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const policy = buildInterpretivePublicationPolicyRecord(payload, timestamp);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    fs.mkdirSync(paths.storageRoot, { recursive: true });
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const existing = loadInterpretivePublicationPolicyProjection(adapter, policy.publicationPolicyId, policy.policyVersion);
        if (existing) {
            if (existing.policyHash !== policy.policyHash) {
                throw createError(
                    409,
                    `Publication policy ${policy.publicationPolicyId} version ${policy.policyVersion} already exists with different content`,
                    'ARCH_PUBLICATION_POLICY_CONFLICT',
                );
            }
            return {
                ok: true,
                phase: 'c0.6.4',
                ledgerPath: paths.dnmPublicationLedgerPath,
                publicationPolicy: existing,
                created: false,
            };
        }
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createPublicationPolicyEvent(policy)]);
        adapter.transaction(() => {
            persistInterpretivePublicationPolicyRow(adapter, policy);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            ledgerPath: paths.dnmPublicationLedgerPath,
            publicationPolicy: loadInterpretivePublicationPolicyProjection(adapter, policy.publicationPolicyId, policy.policyVersion),
            created: true,
        };
    } finally {
        adapter.close();
    }
}

export function revokeInterpretivePublicationPolicy(request, publicationPolicyId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const policyVersion = payload?.policyVersion == null
        ? null
        : normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const policy = policyVersion === null
            ? loadLatestInterpretivePublicationPolicy(adapter, sanitizeIdentifier(publicationPolicyId, 'publicationPolicyId'))
            : loadInterpretivePublicationPolicyProjection(
                adapter,
                sanitizeIdentifier(publicationPolicyId, 'publicationPolicyId'),
                policyVersion,
            );
        if (!policy) {
            throw createError(404, `Publication policy ${publicationPolicyId}${policyVersion === null ? '' : ` version ${policyVersion}`} was not found`, 'ARCH_PUBLICATION_POLICY_NOT_FOUND');
        }
        if (policy.policyState === 'REVOKED') {
            return {
                ok: true,
                phase: 'c0.6.4',
                ledgerPath: paths.dnmPublicationLedgerPath,
                publicationPolicy: policy,
                revoked: false,
            };
        }
        const revocationReason = normalizeOptionalCommentary(payload?.revocationReason, 'revocationReason');
        const nextPolicy = {
            ...policy,
            policyState: 'REVOKED',
            revocationReason,
            updatedAt: timestamp,
            revokedAt: timestamp,
        };
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createPublicationPolicyRevocationEvent(nextPolicy, timestamp)]);
        adapter.transaction(() => {
            persistInterpretivePublicationPolicyRow(adapter, nextPolicy);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            ledgerPath: paths.dnmPublicationLedgerPath,
            publicationPolicy: loadInterpretivePublicationPolicyProjection(adapter, nextPolicy.publicationPolicyId, nextPolicy.policyVersion),
            revoked: true,
        };
    } finally {
        adapter.close();
    }
}

export function qualifyInterpretivePublication(request, interpretationRevisionId, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const interpretation = loadInterpretiveCandidateProjection(
            adapter,
            sanitizeIdentifier(interpretationRevisionId, 'interpretationRevisionId'),
        );
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        const publicationPolicyId = sanitizeIdentifier(payload?.publicationPolicyId, 'publicationPolicyId');
        const policyVersion = payload?.policyVersion == null
            ? null
            : normalizePositiveInteger(payload.policyVersion, 'policyVersion', 1, 1_000_000);
        const policy = policyVersion === null
            ? loadLatestInterpretivePublicationPolicy(adapter, publicationPolicyId)
            : loadInterpretivePublicationPolicyProjection(adapter, publicationPolicyId, policyVersion);
        if (!policy) {
            throw createError(404, `Publication policy ${publicationPolicyId}${policyVersion == null ? '' : ` version ${policyVersion}`} was not found`, 'ARCH_PUBLICATION_POLICY_NOT_FOUND');
        }
        const qualification = evaluateInterpretivePublicationQualification(adapter, interpretation, policy, payload, timestamp);
        adapter.transaction(() => {
            persistInterpretivePublicationQualificationRow(adapter, qualification);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            publicationAvailable: false,
            continuityActivationAvailable: false,
            qualification,
        };
    } finally {
        adapter.close();
    }
}

export function createInterpretivePublicationAuthorization(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const qualificationId = sanitizeIdentifier(payload?.qualificationId, 'qualificationId');
    const authorizedBy = sanitizeIdentifier(payload?.authorizedBy, 'authorizedBy');
    const expiresAt = Number(payload?.expiresAt);
    if (!Number.isFinite(expiresAt)) {
        throw createError(400, 'expiresAt is required', 'ARCH_INVALID_PAYLOAD');
    }
    if (expiresAt <= timestamp) {
        throw createError(400, 'expiresAt must be in the future', 'ARCH_INVALID_PAYLOAD');
    }

    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const qualification = loadInterpretivePublicationQualificationRow(adapter, qualificationId);
        if (!qualification) {
            throw createError(404, `Publication qualification ${qualificationId} was not found`, 'ARCH_PUBLICATION_QUALIFICATION_NOT_FOUND');
        }
        if (qualification.eligibilityVerdict !== 'ELIGIBLE') {
            throw createError(
                409,
                `Publication qualification ${qualificationId} is not eligible for authorization`,
                'ARCH_PUBLICATION_QUALIFICATION_INELIGIBLE',
                { refusalCodes: qualification.refusalCodes },
            );
        }
        const interpretation = loadInterpretiveCandidateProjection(adapter, qualification.interpretationRevisionId);
        if (!interpretation) {
            throw createError(404, `Interpretation revision ${qualification.interpretationRevisionId} was not found`, 'ARCH_INTERPRETATION_NOT_FOUND');
        }
        const policy = loadInterpretivePublicationPolicyProjection(
            adapter,
            qualification.publicationPolicyId,
            qualification.policyVersion,
        );
        if (!policy) {
            throw createError(
                409,
                `Publication policy ${qualification.publicationPolicyId} v${qualification.policyVersion} is missing`,
                'ARCH_PUBLICATION_POLICY_NOT_FOUND',
            );
        }
        const requalification = evaluateInterpretivePublicationQualification(adapter, interpretation, policy, {
            continuityTargetId: qualification.binding.continuityTargetId,
            proposalContentHash: qualification.binding.proposalContentHash,
            groundingEnvelopeHash: qualification.binding.groundingEnvelopeHash,
            reviewEnvelopeHash: qualification.binding.reviewEnvelopeHash,
            subjectDispositionRecordId: qualification.binding.subjectDispositionRecordId,
        }, timestamp);
        if (requalification.eligibilityVerdict !== 'ELIGIBLE') {
            throw createError(
                409,
                'Publication qualification drifted before authorization',
                'ARCH_PUBLICATION_QUALIFICATION_DRIFT',
                { refusalCodes: requalification.refusalCodes },
            );
        }

        const authorization = buildPublicationAuthorizationRecord(qualification, authorizedBy, expiresAt, timestamp);
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [createPublicationAuthorizationEvent(authorization)]);
        adapter.transaction(() => {
            persistInterpretivePublicationAuthorizationRow(adapter, authorization);
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            publicationAuthorizationAvailable: true,
            continuityPublicationAvailable: false,
            authorization,
        };
    } finally {
        adapter.close();
    }
}

export function executeInterpretivePublicationAuthorization(request, payload = {}) {
    const timestamp = nowTimestamp(payload?.now);
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const publicationAuthorizationId = sanitizeIdentifier(payload?.publicationAuthorizationId, 'publicationAuthorizationId');
    const adapter = openOperationalDatabase(paths, { now: timestamp });
    try {
        const authorization = loadInterpretivePublicationAuthorizationProjection(adapter, publicationAuthorizationId);
        if (!authorization) {
            throw createError(404, `Publication authorization ${publicationAuthorizationId} was not found`, 'ARCH_PUBLICATION_AUTHORIZATION_NOT_FOUND');
        }
        if (authorization.status === 'CONSUMED') {
            throw createError(409, `Publication authorization ${publicationAuthorizationId} was already used`, 'ARCH_PUBLICATION_AUTHORIZATION_CONSUMED');
        }
        if (authorization.status === 'EXPIRED' || authorization.expiresAt <= timestamp) {
            if (authorization.status !== 'EXPIRED') {
                const refusalCodes = ['PUBLICATION_AUTHORIZATION_EXPIRED'];
                const refusalEvent = expirePublicationAuthorization(adapter, authorization, refusalCodes, timestamp);
                appendLedgerEvents(paths.dnmPublicationLedgerPath, [refusalEvent]);
                snapshotOperationalDatabase(adapter, paths);
            }
            throw createError(409, `Publication authorization ${publicationAuthorizationId} has expired`, 'ARCH_PUBLICATION_AUTHORIZATION_EXPIRED');
        }

        const interpretation = loadInterpretiveCandidateProjection(adapter, authorization.interpretationRevisionId);
        if (!interpretation) {
            const refusalCodes = ['INTERPRETATION_REVISION_NOT_FOUND'];
            const refusalEvent = expirePublicationAuthorization(adapter, authorization, refusalCodes, timestamp);
            appendLedgerEvents(paths.dnmPublicationLedgerPath, [refusalEvent]);
            snapshotOperationalDatabase(adapter, paths);
            throw createError(409, 'Publication authorization target interpretation is missing', 'ARCH_PUBLICATION_AUTHORIZATION_STALE', { refusalCodes });
        }
        const policy = loadInterpretivePublicationPolicyProjection(
            adapter,
            authorization.publicationPolicyId,
            authorization.policyVersion,
        );
        if (!policy) {
            const refusalCodes = ['PUBLICATION_POLICY_MISMATCH'];
            const refusalEvent = expirePublicationAuthorization(adapter, authorization, refusalCodes, timestamp);
            appendLedgerEvents(paths.dnmPublicationLedgerPath, [refusalEvent]);
            snapshotOperationalDatabase(adapter, paths);
            throw createError(409, 'Publication authorization policy binding is stale', 'ARCH_PUBLICATION_AUTHORIZATION_STALE', { refusalCodes });
        }

        const requalification = evaluateInterpretivePublicationQualification(adapter, interpretation, policy, {
            continuityTargetId: authorization.binding.continuityTargetId,
            proposalContentHash: authorization.binding.proposalContentHash,
            groundingEnvelopeHash: authorization.binding.groundingEnvelopeHash,
            reviewEnvelopeHash: authorization.binding.reviewEnvelopeHash,
            subjectDispositionRecordId: authorization.binding.subjectDispositionRecordId,
        }, timestamp);
        const currentBindingHash = computePublicationQualificationBindingHash(requalification.binding);
        const refusalCodes = [];
        if (requalification.eligibilityVerdict !== 'ELIGIBLE') {
            refusalCodes.push(...requalification.refusalCodes);
        }
        if (authorization.qualificationBindingHash !== currentBindingHash) {
            refusalCodes.push('STALE_AUTHORIZATION_AGAINST_CHANGED_PUBLICATION_STATE');
        }
        if (authorization.binding.publicationPolicyHash !== policy.policyHash) {
            refusalCodes.push('PUBLICATION_POLICY_MISMATCH');
        }
        if (authorization.binding.continuityTargetId !== interpretation.memorySubjectId) {
            refusalCodes.push('CONTINUITY_TARGET_MISMATCH');
        }

        if (refusalCodes.length > 0) {
            const uniqueRefusals = Array.from(new Set(refusalCodes)).sort();
            const refusalEvent = expirePublicationAuthorization(adapter, authorization, uniqueRefusals, timestamp);
            appendLedgerEvents(paths.dnmPublicationLedgerPath, [refusalEvent]);
            snapshotOperationalDatabase(adapter, paths);
            throw createError(
                409,
                'Publication authorization failed revalidation',
                'ARCH_PUBLICATION_AUTHORIZATION_STALE',
                { refusalCodes: uniqueRefusals },
            );
        }

        const existingActiveRecord = loadCurrentActiveDnmRecordForTarget(adapter, authorization.continuityTargetId);
        const initialLifecycleState = existingActiveRecord ? 'DELTA_PENDING' : 'ACTIVE';
        const record = buildPublicationExecutionRecord(
            authorization,
            interpretation,
            timestamp,
            createId('dnmrec'),
            initialLifecycleState,
        );
        const consumedAuthorization = {
            ...authorization,
            status: 'CONSUMED',
            consumedAt: timestamp,
            dnmRecordId: record.dnmRecordId,
        };
        appendLedgerEvents(paths.dnmPublicationLedgerPath, [
            createDnmPublishedEvent(record),
        ]);
        adapter.transaction(() => {
            persistDnmPublicationRecordRow(adapter, record);
            persistDnmPublicationLifecycleMetadataRow(adapter, buildDefaultDnmLifecycleMetadata(record));
            persistInterpretivePublicationAuthorizationRow(adapter, consumedAuthorization);
            adapter.run(
                `UPDATE interpretation_revisions
                 SET publication_state = 'PUBLISHED', authority_effect = 'DEVELOPMENTAL_MEMORY', updated_at = ?
                 WHERE interpretation_revision_id = ?`,
                [timestamp, interpretation.interpretationRevisionId],
            );
        });
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.4',
            publicationAuthorizationAvailable: true,
            continuityPublicationAvailable: true,
            liveContinuityMutation: true,
            authorization: loadInterpretivePublicationAuthorizationProjection(adapter, consumedAuthorization.publicationAuthorizationId),
            publishedRecord: loadDnmPublicationRecordProjection(adapter, record.dnmRecordId),
            currentActiveRecord: loadCurrentActiveDnmRecordForTarget(adapter, authorization.continuityTargetId),
            interpretation: loadInterpretiveCandidateProjection(adapter, interpretation.interpretationRevisionId),
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
