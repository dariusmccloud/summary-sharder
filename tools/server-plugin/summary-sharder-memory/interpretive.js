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
    const groundingOutcome = deriveGroundingOutcome(groundingLinks);
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
]);

function clearInterpretiveProjection(adapter) {
    adapter.transaction(() => {
        for (const tableName of INTERPRETIVE_PROJECTION_TABLES) {
            adapter.run(`DELETE FROM ${tableName}`);
        }
    });
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

export function replayInterpretiveLedger(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    const ledgerEvents = readInterpretiveLedgerEvents(options.ledgerPath || paths.interpretiveGovernanceLedgerPath);
    const grouped = new Map();
    for (const event of ledgerEvents) {
        const key = String(event.interpretationRevisionId || '');
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
        const rehydrated = [];
        const revisionIds = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
        for (const interpretationRevisionId of revisionIds) {
            const events = grouped.get(interpretationRevisionId)
                .slice()
                .sort((a, b) => Number(a.occurredAt) - Number(b.occurredAt) || String(a.eventId).localeCompare(String(b.eventId)));
            const prepared = buildPreparedFromLedgerEvents(events);
            persistPreparedCandidate(adapter, prepared, prepared.candidate.createdAt);
            rehydrated.push(loadInterpretiveCandidateProjection(adapter, interpretationRevisionId));
        }
        snapshotOperationalDatabase(adapter, paths);
        return {
            ok: true,
            phase: 'c0.6.1',
            replayedInterpretations: rehydrated,
        };
    } finally {
        adapter.close();
    }
}

function persistPreparedCandidate(adapter, prepared, timestamp) {
    seedInterpretivePolicyDefinitions(adapter);
    const existing = adapter.get(
        'SELECT interpretation_revision_id FROM interpretation_revisions WHERE interpretation_revision_id = ?',
        [prepared.candidate.interpretationRevisionId],
    );
    if (existing) {
        throw createError(409, `Interpretation revision ${prepared.candidate.interpretationRevisionId} already exists`, 'ARCH_INTERPRETATION_REVISION_EXISTS');
    }
    adapter.transaction(() => {
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
    const subjectDisposition = adapter.get(
        'SELECT * FROM interpretation_subject_dispositions WHERE interpretation_revision_id = ?',
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
            reviewerRole: entry.reviewer_role,
            reviewerEntityId: entry.reviewer_entity_id,
            status: entry.status,
            reviewEnvelopeHash: entry.review_envelope_hash,
            createdAt: Number(entry.created_at),
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
    };
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
