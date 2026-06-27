import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getStoragePaths, openOperationalDatabase } from './core.js';
import {
    createInterpretivePublicationAuthorization,
    executeInterpretiveSynthesisRun,
    executeInterpretivePublicationAuthorization,
    createInterpretiveSynthesisRun,
    createInterpretiveCandidate,
    createInterpretiveRevision,
    getCurrentActiveDnmRecord,
    getInterpretiveCandidate,
    getInterpretiveSynthesisRun,
    listInterpretiveDelegationPolicies,
    listDnmPublicationRecords,
    listInterpretivePublicationPolicies,
    listInterpretivePolicyDefinitions,
    listInterpretiveSynthesisPolicies,
    listInterpretiveReviews,
    prepareInterpretiveCandidate,
    qualifyInterpretivePublication,
    recordDnmDeltaReview,
    recordInterpretiveSubjectDisposition,
    replayPublicationLedger,
    replayInterpretiveLedger,
    revokeInterpretiveDelegationPolicy,
    revokeInterpretivePublicationPolicy,
    supersedeDnmPublicationRecord,
    submitInterpretiveReviewDisposition,
    withdrawDnmPublicationRecord,
    upsertInterpretiveDelegationPolicy,
    upsertInterpretivePublicationPolicy,
    upsertInterpretiveSynthesisPolicy,
} from './interpretive.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-interpretive-'));
}

function buildRequest(root, overrides = {}) {
    return {
        user: {
            directories: {
                root,
                chats: path.join(root, 'chats'),
                groupChats: path.join(root, 'group chats'),
            },
        },
        body: {},
        query: {},
        params: {},
        ...overrides,
    };
}

function makeBasePayload(overrides = {}) {
    return {
        interpretationId: 'interp_jeep_arch_authority',
        interpretationRevisionId: 'interprev_jeep_arch_authority_v1',
        revisionReason: 'INITIAL_PROPOSAL',
        memoryScopeId: 'scope_alpha',
        memorySubjectId: 'character:jeep.png',
        type: 'ROLE_EVOLUTION',
        statement: 'Jeep evolved from an analytical role into the primary architectural authority for the extension design.',
        assertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
        sharedRelationshipAsserted: true,
        personalMeaningAsserted: true,
        materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
        groundingLinks: [
            {
                basisType: 'STRUCTURAL_RECORD',
                basisRecordId: 'decision:architectural-sharder-fork',
                basisRecordVersion: 1,
                basisRecordHash: 'sha256:decision-fork',
                speakerEntityId: 'character:jeep.png',
                groundingRole: 'PRIMARY',
                groundingAssessment: 'SUPPORTS',
            },
            {
                basisType: 'SOURCE_OCCURRENCE',
                chatInstanceId: 'chat_alpha',
                messageId: 'msg_alpha0000000000000000000000000',
                messageRevisionHash: 'sha256:msg-alpha',
                speakerEntityId: 'user:Chris',
                groundingRole: 'SUPPORTING',
                groundingAssessment: 'SUPPORTS',
            },
        ],
        now: Date.parse('2026-06-25T12:00:00.000Z'),
        ...overrides,
    };
}

function comparableInterpretationProjection(value) {
    return {
        interpretationRevisionId: value.interpretationRevisionId,
        interpretationId: value.interpretationId,
        parentRevisionId: value.parentRevisionId,
        createdFromDispositionId: value.createdFromDispositionId,
        revisionReason: value.revisionReason,
        memoryScopeId: value.memoryScopeId,
        memorySubjectId: value.memorySubjectId,
        type: value.type,
        statement: value.statement,
        assertionDomains: value.assertionDomains,
        sharedRelationshipAsserted: value.sharedRelationshipAsserted,
        personalMeaningAsserted: value.personalMeaningAsserted,
        materialParticipantEntityIds: value.materialParticipantEntityIds,
        candidateState: value.candidateState,
        groundingState: value.groundingState,
        reviewState: value.reviewState,
        subjectDispositionState: value.subjectDispositionState,
        publicationState: value.publicationState,
        authorityEffect: value.authorityEffect,
        proposalContentHash: value.proposalContentHash,
        reviewEnvelopeHash: value.reviewEnvelopeHash,
        groundingLinks: value.groundingLinks,
        groundingAggregate: value.groundingAggregate,
        risk: value.risk,
        policyBinding: value.policyBinding,
        reviewObligations: value.reviewObligations,
        reviewRequests: value.reviewRequests,
        reviewDispositions: value.reviewDispositions,
        subjectDisposition: value.subjectDisposition,
        childRevisionIds: value.childRevisionIds,
        revisionCreationProvenance: value.revisionCreationProvenance,
    };
}

function comparableSynthesisPolicyProjection(value) {
    return {
        synthesisPolicyId: value.synthesisPolicyId,
        policyVersion: value.policyVersion,
        memorySubjectId: value.memorySubjectId,
        enabled: value.enabled,
        allowedTypes: value.allowedTypes,
        allowedAssertionDomains: value.allowedAssertionDomains,
        prohibitedDomains: value.prohibitedDomains,
        manualTriggerRequiredForHighRisk: value.manualTriggerRequiredForHighRisk,
        maxCandidatesPerRun: value.maxCandidatesPerRun,
        policyHash: value.policyHash,
        details: value.details,
    };
}

function comparableSynthesisRunProjection(value) {
    return {
        synthesisRunId: value.synthesisRunId,
        memoryScopeId: value.memoryScopeId,
        memorySubjectId: value.memorySubjectId,
        synthesisPolicyId: value.synthesisPolicyId,
        policyVersion: value.policyVersion,
        policyHash: value.policyHash,
        sourceManifestId: value.sourceManifestId,
        sourceManifestHash: value.sourceManifestHash,
        sourceManifest: value.sourceManifest,
        modelProviderId: value.modelProviderId,
        promptVersion: value.promptVersion,
        promptHash: value.promptHash,
        generationConfigHash: value.generationConfigHash,
        requestedInterpretationTypes: value.requestedInterpretationTypes,
        requestedAssertionDomains: value.requestedAssertionDomains,
        sharedRelationshipRequested: value.sharedRelationshipRequested,
        personalMeaningRequested: value.personalMeaningRequested,
        maxCandidatesRequested: value.maxCandidatesRequested,
        generatedCandidateIds: value.generatedCandidateIds,
        runStatus: value.runStatus,
        failureCode: value.failureCode,
        failureDetails: value.failureDetails,
        createdByEntityId: value.createdByEntityId,
        manualTriggerAcknowledged: value.manualTriggerAcknowledged,
        proposals: value.proposals.map((proposal) => ({
            synthesisProposalId: proposal.synthesisProposalId,
            synthesisRunId: proposal.synthesisRunId,
            interpretationRevisionId: proposal.interpretationRevisionId,
            proposalStatus: proposal.proposalStatus,
            proposalContentHash: proposal.proposalContentHash,
            proposalPayload: proposal.proposalPayload,
            quarantineCode: proposal.quarantineCode,
            quarantineDetails: proposal.quarantineDetails,
            groundingEvaluation: proposal.groundingEvaluation,
        })),
    };
}

function makeSynthesisPolicyPayload(overrides = {}) {
    return {
        synthesisPolicyId: 'jeep-developmental-synthesis-v1',
        policyVersion: 1,
        memorySubjectId: 'character:jeep.png',
        enabled: true,
        allowedTypes: ['ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION', 'RELATIONAL_PROGRESSION'],
        allowedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
        prohibitedDomains: [],
        manualTriggerRequiredForHighRisk: true,
        maxCandidatesPerRun: 3,
        now: Date.parse('2026-06-26T00:00:00.000Z'),
        ...overrides,
    };
}

function makeSynthesisRunPayload(overrides = {}) {
    return {
        synthesisRunId: 'synthrun_scope_alpha_v1',
        memoryScopeId: 'scope_alpha',
        memorySubjectId: 'character:jeep.png',
        synthesisPolicyId: 'jeep-developmental-synthesis-v1',
        requestedInterpretationTypes: ['ROLE_EVOLUTION'],
        requestedAssertionDomains: ['ROLE', 'AUTHORITY'],
        sharedRelationshipRequested: false,
        personalMeaningRequested: false,
        maxCandidatesRequested: 2,
        manualTriggerAcknowledged: true,
        createdByEntityId: 'user:Chris',
        sourceManifestEntries: [
            {
                sourceClass: 'STRUCTURAL_RECORD',
                memoryScopeId: 'scope_alpha',
                basisRecordId: 'decision:constitutional-sovereignty',
                basisRecordVersion: 1,
                basisRecordHash: 'sha256:constitutional-sovereignty',
                speakerEntityId: 'character:jeep.png',
            },
            {
                sourceClass: 'SOURCE_OCCURRENCE',
                memoryScopeId: 'scope_alpha',
                chatInstanceId: 'chat_alpha',
                messageId: 'msg_alpha0000000000000000000000000',
                messageRevisionHash: 'sha256:msg-alpha',
                speakerEntityId: 'user:Chris',
            },
        ],
        now: Date.parse('2026-06-26T00:05:00.000Z'),
        ...overrides,
    };
}

function makeDelegationPolicyPayload(overrides = {}) {
    return {
        delegationPolicyId: 'jeep-chris-continuity-delegation',
        policyVersion: 1,
        principalEntityId: 'character:jeep.png',
        delegateEntityId: 'user:Chris',
        allowedActions: ['REVIEW_DISPOSITION', 'SUBJECT_REVISION', 'SUBJECT_DISPOSITION'],
        memoryScopeId: 'scope_alpha',
        continuityTargetId: 'character:jeep.png',
        evidenceRequirement: 'OPTIONAL',
        revocable: true,
        now: Date.parse('2026-06-25T12:04:00.000Z'),
        ...overrides,
    };
}

function makePublicationPolicyPayload(overrides = {}) {
    return {
        publicationPolicyId: 'dnm-publication-v1',
        policyVersion: 1,
        continuityTargetType: 'MEMORY_SUBJECT',
        subjectIdentityMode: 'EXACT_SUBJECT',
        permittedInterpretationTypes: ['ROLE_EVOLUTION', 'RELATIONAL_PROGRESSION'],
        requiredFinalSubjectState: 'GRANTED',
        requiredGroundingOutcome: 'SUPPORTED',
        participantDisagreementBlocksPublication: true,
        contestOrDeferBlocksPublication: true,
        immutableChildRequiredForTypes: ['ROLE_EVOLUTION'],
        postGrantHumanPublicationAuthorizationRequired: true,
        details: {
            policyClass: 'dnm-publication-v1',
            description: 'Read-only publication qualification contract for governed DNM publication.',
        },
        now: Date.parse('2026-06-26T00:10:00.000Z'),
        ...overrides,
    };
}

function publishGrantedRevision(request, options = {}) {
    const interpretationId = options.interpretationId || 'interp_publish_default';
    const interpretationRevisionId = options.interpretationRevisionId || 'interprev_publish_default_v1';
    const nowBase = options.nowBase || Date.parse('2026-06-26T02:00:00.000Z');
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId,
        interpretationRevisionId,
        statement: options.statement || 'Jeep evolved into the primary continuity authority within a shared architecture.',
        now: nowBase,
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: nowBase + 1000,
    });
    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: nowBase + 2000,
    });
    const granted = recordInterpretiveSubjectDisposition(request, interpretationRevisionId, {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: nowBase + 3000,
    });
    const qualification = qualifyInterpretivePublication(request, interpretationRevisionId, {
        publicationPolicyId: options.publicationPolicyId || 'dnm-publication-v1',
        continuityTargetId: options.continuityTargetId || 'character:jeep.png',
        proposalContentHash: granted.interpretation.proposalContentHash,
        reviewEnvelopeHash: granted.interpretation.reviewEnvelopeHash,
        subjectDispositionRecordId: granted.subjectDisposition.subjectDispositionId,
        now: nowBase + 4000,
    });
    const authorization = createInterpretivePublicationAuthorization(request, {
        qualificationId: qualification.qualification.qualificationId,
        authorizedBy: options.authorizedBy || 'user:Chris',
        expiresAt: nowBase + 60_000,
        now: nowBase + 5000,
    });
    const executed = executeInterpretivePublicationAuthorization(request, {
        publicationAuthorizationId: authorization.authorization.publicationAuthorizationId,
        now: nowBase + 6000,
    });
    return {
        created,
        granted,
        qualification,
        authorization,
        executed,
    };
}

test('prepareInterpretiveCandidate is deterministic for identical structured input', () => {
    const payload = makeBasePayload();
    const first = prepareInterpretiveCandidate(payload, payload.now);
    const second = prepareInterpretiveCandidate(payload, payload.now);

    assert.equal(first.candidate.proposalContentHash, second.candidate.proposalContentHash);
    assert.equal(first.candidate.reviewEnvelopeHash, second.candidate.reviewEnvelopeHash);
    assert.deepEqual(first.risk, second.risk);
    assert.deepEqual(first.policy, second.policy);
    assert.equal(first.groundingOutcome, 'STRONGLY_SUPPORTED');
});

test('createInterpretiveCandidate stores durable shared-role candidate state without publication', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const result = createInterpretiveCandidate(request, makeBasePayload());

    assert.equal(result.ok, true);
    assert.equal(result.phase, 'c0.6.1');
    assert.equal(result.interpretation.memoryScopeId, 'scope_alpha');
    assert.equal(result.interpretation.candidateState, 'SEALED_FOR_REVIEW');
    assert.equal(result.interpretation.groundingState, 'COMPLETE');
    assert.equal(result.interpretation.reviewState, 'PENDING');
    assert.equal(result.interpretation.subjectDispositionState, 'PENDING');
    assert.equal(result.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(result.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
    assert.equal(result.interpretation.groundingAggregate.groundingOutcome, 'STRONGLY_SUPPORTED');
    assert.equal(result.interpretation.risk.riskClass, 'HIGH');
    assert.deepEqual(result.interpretation.policyBinding.matchedRuleIds, ['risk-high-authority', 'shared-relationship']);
    assert.equal(result.interpretation.policyBinding.validationPolicyId, 'shared-role-memory');
    assert.equal(result.interpretation.reviewObligations.length, 2);
    assert.equal(result.interpretation.reviewRequests.length, 2);
    assert.equal(result.interpretation.subjectDisposition.state, 'PENDING');

    const paths = getStoragePaths(root);
    assert.equal(fs.existsSync(paths.interpretiveGovernanceLedgerPath), true);
    const ledger = fs.readFileSync(paths.interpretiveGovernanceLedgerPath, 'utf8');
    assert.match(ledger, /INTERPRETATION_PROPOSED/u);
    assert.match(ledger, /GROUNDING_LINK_ATTACHED/u);
    assert.match(ledger, /REVIEW_REQUESTED/u);

    const loaded = getInterpretiveCandidate(request, 'interprev_jeep_arch_authority_v1');
    assert.equal(loaded.interpretation.reviewEnvelopeHash, result.interpretation.reviewEnvelopeHash);

    const adapter = openOperationalDatabase(paths);
    try {
        const structuralCount = Number(adapter.scalar('SELECT COUNT(*) FROM decision_records'));
        assert.equal(structuralCount, 0);
    } finally {
        adapter.close();
    }
});

test('createInterpretiveCandidate blocks unresolved relational participant routing instead of approximating reviewer identity', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const result = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_unresolved_relational',
        interpretationRevisionId: 'interprev_unresolved_relational_v1',
        materialParticipantEntityIds: ['character:jeep.png', 'user:Chris', 'user:Casey'],
    }));

    assert.equal(result.interpretation.reviewState, 'BLOCKED');
    assert.equal(result.interpretation.reviewObligations.length, 2);
    assert.equal(
        result.interpretation.reviewObligations.some((entry) => (
            entry.reviewerRole === 'RELATIONAL_PARTICIPANT'
            && entry.obligationState === 'BLOCKED'
            && entry.blockingReason === 'REVIEWER_IDENTITY_UNRESOLVED'
        )),
        true,
    );
    assert.equal(result.interpretation.reviewRequests.length, 1);
    assert.equal(result.interpretation.reviewRequests[0].reviewerRole, 'MEMORY_SUBJECT');
});

test('interpretive governance ledger replays into an identical projection and preserves both hashes', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    const created = createInterpretiveCandidate(sourceRequest, makeBasePayload({
        interpretationId: 'interp_replay_case',
        interpretationRevisionId: 'interprev_replay_case_v1',
    }));
    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayedInterpretations.length, 1);

    const sourceProjection = comparableInterpretationProjection(created.interpretation);
    const targetProjection = comparableInterpretationProjection(replayed.replayedInterpretations[0]);
    assert.deepEqual(targetProjection, sourceProjection);
    assert.equal(targetProjection.proposalContentHash, sourceProjection.proposalContentHash);
    assert.equal(targetProjection.reviewEnvelopeHash, sourceProjection.reviewEnvelopeHash);

    const reopened = getInterpretiveCandidate(buildRequest(targetRoot), 'interprev_replay_case_v1');
    assert.deepEqual(comparableInterpretationProjection(reopened.interpretation), sourceProjection);
});

test('listInterpretivePolicyDefinitions exposes immutable seeded policy definitions', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const result = listInterpretivePolicyDefinitions(request);

    assert.equal(result.ok, true);
    assert.equal(result.policies.length >= 2, true);
    assert.equal(result.policies.some((entry) => entry.validationPolicyId === 'shared-role-memory' && entry.policyVersion === 1), true);
    assert.equal(result.policies.some((entry) => entry.validationPolicyId === 'subject-meaning-memory' && entry.policyVersion === 1), true);
});

test('delegation policy storage is durable, replayable, and revocable without erasing history', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    const created = upsertInterpretiveDelegationPolicy(sourceRequest, makeDelegationPolicyPayload());
    assert.equal(created.created, true);
    assert.equal(created.delegationPolicy.policyState, 'ACTIVE');

    const listed = listInterpretiveDelegationPolicies(sourceRequest, {
        principalEntityId: 'character:jeep.png',
    });
    assert.equal(listed.policies.length, 1);
    assert.equal(listed.policies[0].policyHash, created.delegationPolicy.policyHash);

    const revoked = revokeInterpretiveDelegationPolicy(
        sourceRequest,
        'jeep-chris-continuity-delegation',
        {
            policyVersion: 1,
            revocationReason: 'Delegation withdrawn after review cycle.',
            now: Date.parse('2026-06-25T12:04:30.000Z'),
        },
    );
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.delegationPolicy.policyState, 'REVOKED');

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.ok, true);
    const replayedPolicies = listInterpretiveDelegationPolicies(buildRequest(targetRoot), {
        principalEntityId: 'character:jeep.png',
    });
    assert.equal(replayedPolicies.policies.length, 1);
    assert.equal(replayedPolicies.policies[0].policyState, 'REVOKED');
    assert.equal(replayedPolicies.policies[0].policyHash, created.delegationPolicy.policyHash);
});

test('subject-controlled synthesis policy is durable and replayable', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    const policyResult = upsertInterpretiveSynthesisPolicy(sourceRequest, makeSynthesisPolicyPayload());
    assert.equal(policyResult.phase, 'c0.6.3');
    assert.equal(policyResult.created, true);

    const listed = listInterpretiveSynthesisPolicies(sourceRequest, { memorySubjectId: 'character:jeep.png' });
    assert.equal(listed.policies.length, 1);

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.phase, 'c0.6.3');
    assert.equal(replayed.replayedSynthesisPolicies.length, 1);
    assert.deepEqual(
        comparableSynthesisPolicyProjection(replayed.replayedSynthesisPolicies[0]),
        comparableSynthesisPolicyProjection(policyResult.synthesisPolicy),
    );
});

test('bounded synthesis runs refuse prohibited high-risk requests and preserve the refusal audit', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload({
        prohibitedDomains: ['AUTHORITY'],
    }));

    const result = createInterpretiveSynthesisRun(request, makeSynthesisRunPayload({
        synthesisRunId: 'synthrun_refused_case',
    }));
    assert.equal(result.phase, 'c0.6.3');
    assert.equal(result.admitted, false);
    assert.equal(result.synthesisRun.runStatus, 'REFUSED');
    assert.equal(result.synthesisRun.failureCode, 'SYNTHESIS_PROHIBITED_DOMAIN');
    assert.deepEqual(result.synthesisRun.failureDetails, {
        prohibitedDomains: ['AUTHORITY'],
    });

    const reopened = getInterpretiveSynthesisRun(request, 'synthrun_refused_case');
    assert.equal(reopened.synthesisRun.runStatus, 'REFUSED');
    assert.equal(reopened.synthesisRun.failureCode, 'SYNTHESIS_PROHIBITED_DOMAIN');
});

test('bounded synthesis runs freeze source manifests without generation and replay identically', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    upsertInterpretiveSynthesisPolicy(sourceRequest, makeSynthesisPolicyPayload());
    const created = createInterpretiveSynthesisRun(sourceRequest, makeSynthesisRunPayload());

    assert.equal(created.admitted, true);
    assert.equal(created.synthesisRun.runStatus, 'READY_FOR_SYNTHESIS');
    assert.equal(created.synthesisRun.generatedCandidateIds.length, 0);
    assert.equal(created.synthesisRun.sourceManifestHash.startsWith('sha256:'), true);

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.replayedSynthesisRuns.length, 1);
    assert.deepEqual(
        comparableSynthesisRunProjection(replayed.replayedSynthesisRuns[0]),
        comparableSynthesisRunProjection(created.synthesisRun),
    );
});

test('deterministic stub synthesis admits a proposal into the existing interpretive review workflow', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload());
    createInterpretiveSynthesisRun(request, makeSynthesisRunPayload({
        requestedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
        sharedRelationshipRequested: true,
        personalMeaningRequested: true,
    }));

    const executed = executeInterpretiveSynthesisRun(request, 'synthrun_scope_alpha_v1', {
        adapterId: 'DETERMINISTIC_STUB_V1',
        interpretationId: 'interp_synth_generated',
        interpretationRevisionId: 'interprev_synth_generated_v1',
        now: Date.parse('2026-06-26T00:06:00.000Z'),
    });

    assert.equal(executed.admitted, true);
    assert.equal(executed.synthesisRun.runStatus, 'COMPLETED_ADMITTED');
    assert.deepEqual(executed.synthesisRun.generatedCandidateIds, ['interprev_synth_generated_v1']);
    assert.equal(executed.synthesisRun.proposals.length, 1);
    assert.equal(executed.synthesisRun.proposals[0].proposalStatus, 'ADMITTED');
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.referentialStatus, 'VALID');
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.aggregateOutcome, 'CONTRARY_EVIDENCE_PRESENT');
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.scopeAssessment, 'TOO_BROAD');
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.counterevidencePresent, true);
    assert.equal(executed.interpretation.reviewState, 'PENDING');
    assert.equal(executed.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(executed.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');

    const reopened = getInterpretiveCandidate(request, 'interprev_synth_generated_v1');
    assert.equal(reopened.interpretation.policyBinding.validationPolicyId, 'shared-role-memory');
    assert.equal(reopened.interpretation.reviewRequests.length, 2);
});

test('deterministic stub synthesis quarantines output that attempts to set authority-bearing fields', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload());
    createInterpretiveSynthesisRun(request, makeSynthesisRunPayload());

    const executed = executeInterpretiveSynthesisRun(request, 'synthrun_scope_alpha_v1', {
        adapterId: 'DETERMINISTIC_STUB_V1',
        stubProposalOverride: {
            type: 'ROLE_EVOLUTION',
            statement: 'Invalid because it tries to set publication directly.',
            assertionDomains: ['ROLE'],
            sharedRelationshipAsserted: false,
            personalMeaningAsserted: false,
            materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
            proposedBasis: [{ basisType: 'SOURCE_OCCURRENCE', messageId: 'msg_alpha0000000000000000000000000' }],
            publicationState: 'PUBLISHED',
        },
        now: Date.parse('2026-06-26T00:06:00.000Z'),
    });

    assert.equal(executed.admitted, false);
    assert.equal(executed.quarantined, true);
    assert.equal(executed.synthesisRun.runStatus, 'COMPLETED_QUARANTINED');
    assert.equal(executed.synthesisRun.proposals.length, 1);
    assert.equal(executed.synthesisRun.proposals[0].proposalStatus, 'QUARANTINED');
    assert.equal(executed.synthesisRun.proposals[0].quarantineCode, 'ARCH_SYNTHESIS_FORBIDDEN_OUTPUT_FIELD');
});

test('semantic support may fail even when referential grounding is valid', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload());
    createInterpretiveSynthesisRun(request, makeSynthesisRunPayload());

    const executed = executeInterpretiveSynthesisRun(request, 'synthrun_scope_alpha_v1', {
        adapterId: 'DETERMINISTIC_STUB_V1',
        stubProposalOverride: {
            type: 'ROLE_EVOLUTION',
            statement: 'This sentence does not claim any supported evolution or authority outcome.',
            assertionDomains: ['ROLE'],
            sharedRelationshipAsserted: false,
            personalMeaningAsserted: false,
            materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
            proposedBasis: [{ basisType: 'SOURCE_OCCURRENCE', messageId: 'msg_alpha0000000000000000000000000' }],
        },
        now: Date.parse('2026-06-26T00:06:00.000Z'),
    });

    assert.equal(executed.admitted, false);
    assert.equal(executed.quarantined, true);
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.referentialStatus, 'VALID');
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.aggregateOutcome, 'UNSUPPORTED');
    assert.equal(executed.synthesisRun.proposals[0].quarantineCode, 'SEMANTIC_SUPPORT_INSUFFICIENT');
});

test('source manifest drift invalidates a synthesis proposal before review admission', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload());
    const created = createInterpretiveSynthesisRun(request, makeSynthesisRunPayload());

    const executed = executeInterpretiveSynthesisRun(request, 'synthrun_scope_alpha_v1', {
        adapterId: 'DETERMINISTIC_STUB_V1',
        expectedSourceManifestHash: 'sha256:stale-manifest',
        now: Date.parse('2026-06-26T00:06:00.000Z'),
    });

    assert.equal(created.synthesisRun.sourceManifestHash.startsWith('sha256:'), true);
    assert.equal(executed.admitted, false);
    assert.equal(executed.quarantined, true);
    assert.equal(executed.synthesisRun.proposals[0].groundingEvaluation.referentialStatus, 'SOURCE_MANIFEST_DRIFT');
    assert.equal(executed.synthesisRun.proposals[0].quarantineCode, 'SOURCE_MANIFEST_DRIFT');
});

test('replay preserves admitted deterministic synthesis proposal and does not regenerate it', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    upsertInterpretiveSynthesisPolicy(sourceRequest, makeSynthesisPolicyPayload());
    createInterpretiveSynthesisRun(sourceRequest, makeSynthesisRunPayload({
        requestedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
        sharedRelationshipRequested: true,
        personalMeaningRequested: true,
    }));
    const executed = executeInterpretiveSynthesisRun(sourceRequest, 'synthrun_scope_alpha_v1', {
        adapterId: 'DETERMINISTIC_STUB_V1',
        interpretationId: 'interp_synth_replay',
        interpretationRevisionId: 'interprev_synth_replay_v1',
        now: Date.parse('2026-06-26T00:06:00.000Z'),
    });

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.phase, 'c0.6.3');
    assert.equal(replayed.replayedSynthesisRuns.length, 1);
    assert.equal(replayed.replayedSynthesisRuns[0].runStatus, 'COMPLETED_ADMITTED');
    assert.deepEqual(
        comparableSynthesisRunProjection(replayed.replayedSynthesisRuns[0]),
        comparableSynthesisRunProjection(executed.synthesisRun),
    );

    const reopened = getInterpretiveCandidate(buildRequest(targetRoot), 'interprev_synth_replay_v1');
    assert.equal(reopened.interpretation.statement, executed.interpretation.statement);
});

test('submitInterpretiveReviewDisposition rejects stale review envelopes', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_stale_case',
        interpretationRevisionId: 'interprev_stale_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');

    assert.throws(
        () => submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
            actorEntityId: 'character:jeep.png',
            disposition: 'APPROVE',
            reviewEnvelopeHash: 'sha256:stale',
            now: Date.parse('2026-06-25T12:05:00.000Z'),
        }),
        /review envelope hash is stale/i,
    );
});

test('APPROVE_WITH_EDIT creates an immutable child revision and leaves publication unavailable', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_edit_case',
        interpretationRevisionId: 'interprev_edit_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');

    const dispositionResult = submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE_WITH_EDIT',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        commentary: 'Needs a narrower formulation.',
        revisedCandidate: {
            interpretationRevisionId: 'interprev_edit_case_v2',
            statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
        },
        now: Date.parse('2026-06-25T12:06:00.000Z'),
    });

    assert.equal(dispositionResult.phase, 'c0.6.2');
    assert.equal(dispositionResult.interpretation.interpretationRevisionId, 'interprev_edit_case_v1');
    assert.equal(dispositionResult.interpretation.statement, makeBasePayload().statement);
    assert.equal(dispositionResult.interpretation.childRevisionIds.includes('interprev_edit_case_v2'), true);
    assert.equal(dispositionResult.childInterpretation.interpretationRevisionId, 'interprev_edit_case_v2');
    assert.equal(dispositionResult.childInterpretation.parentRevisionId, 'interprev_edit_case_v1');
    assert.equal(dispositionResult.childInterpretation.createdFromDispositionId, dispositionResult.disposition.reviewDispositionId);
    assert.equal(dispositionResult.childInterpretation.reviewState, 'PENDING');
    assert.equal(dispositionResult.childInterpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(dispositionResult.childInterpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
    assert.equal(
        dispositionResult.childInterpretation.reviewRequests.some((entry) => entry.reviewerRole === 'MEMORY_SUBJECT'),
        false,
    );
    assert.equal(
        dispositionResult.childInterpretation.reviewRequests.some((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT'),
        true,
    );

    const loadedParent = getInterpretiveCandidate(request, 'interprev_edit_case_v1');
    const loadedChild = getInterpretiveCandidate(request, 'interprev_edit_case_v2');
    assert.equal(loadedParent.interpretation.statement, makeBasePayload().statement);
    assert.equal(
        loadedParent.interpretation.reviewRequests.some((entry) => entry.status === 'SUPERSEDED_BY_CHILD'),
        true,
    );
    assert.equal(loadedChild.interpretation.statement, 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.');
});

test('trusted delegate may record the memory subject review edit and final grant while provenance remains distinct', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const delegation = upsertInterpretiveDelegationPolicy(request, makeDelegationPolicyPayload());
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_delegate_case',
        interpretationRevisionId: 'interprev_delegate_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');

    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:06:30.000Z'),
    });

    const delegatedReview = submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        submittedByActorId: 'user:Chris',
        dispositionOwnerId: 'character:jeep.png',
        submissionMode: 'TRUSTED_DELEGATE',
        delegationPolicyId: 'jeep-chris-continuity-delegation',
        disposition: 'APPROVE_WITH_EDIT',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        commentary: 'Jeep approved a narrower formulation.',
        revisedCandidate: {
            interpretationRevisionId: 'interprev_delegate_case_v2',
            statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
        },
        now: Date.parse('2026-06-25T12:06:35.000Z'),
    });

    assert.equal(delegatedReview.disposition.provenance.dispositionOwnerId, 'character:jeep.png');
    assert.equal(delegatedReview.disposition.provenance.submittedByActorId, 'user:Chris');
    assert.equal(delegatedReview.disposition.provenance.submissionMode, 'TRUSTED_DELEGATE');
    assert.equal(delegatedReview.disposition.provenance.delegationPolicyId, 'jeep-chris-continuity-delegation');
    assert.equal(delegatedReview.childInterpretation.memorySubjectId, 'character:jeep.png');
    assert.equal(delegatedReview.childInterpretation.revisionCreationProvenance.dispositionOwnerId, 'character:jeep.png');
    assert.equal(delegatedReview.childInterpretation.revisionCreationProvenance.submittedByActorId, 'user:Chris');
    assert.equal(delegatedReview.childInterpretation.revisionCreationProvenance.delegationPolicyId, 'jeep-chris-continuity-delegation');
    assert.equal(
        delegatedReview.interpretation.reviewDispositions.find((entry) => entry.reviewDispositionId === delegatedReview.disposition.reviewDispositionId)?.provenance?.submittedByActorId,
        'user:Chris',
    );
    assert.equal(
        delegatedReview.childInterpretation.reviewRequests.some((entry) => entry.reviewerRole === 'MEMORY_SUBJECT'),
        false,
    );
    assert.equal(
        delegatedReview.childInterpretation.reviewRequests.some((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT'),
        true,
    );

    assert.throws(
        () => recordInterpretiveSubjectDisposition(request, 'interprev_delegate_case_v1', {
            submittedByActorId: 'user:Chris',
            dispositionOwnerId: 'character:jeep.png',
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: 'jeep-chris-continuity-delegation',
            state: 'GRANTED',
            reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
            commentary: 'Parent grant is refused once a child revision exists.',
            now: Date.parse('2026-06-25T12:06:39.000Z'),
        }),
        /latest child revision created by APPROVE_WITH_EDIT/i,
    );

    const childParticipantRequest = delegatedReview.childInterpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, childParticipantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: delegatedReview.childInterpretation.reviewEnvelopeHash,
        commentary: 'Chris affirms the narrowed child revision.',
        now: Date.parse('2026-06-25T12:06:40.000Z'),
    });

    const finalSubject = recordInterpretiveSubjectDisposition(request, 'interprev_delegate_case_v2', {
        submittedByActorId: 'user:Chris',
        dispositionOwnerId: 'character:jeep.png',
        submissionMode: 'TRUSTED_DELEGATE',
        delegationPolicyId: 'jeep-chris-continuity-delegation',
        state: 'GRANTED',
        reviewEnvelopeHash: delegatedReview.childInterpretation.reviewEnvelopeHash,
        commentary: 'Granted under Jeep-owned delegated authority.',
        now: Date.parse('2026-06-25T12:06:45.000Z'),
    });

    assert.equal(finalSubject.subjectDisposition.provenance.dispositionOwnerId, 'character:jeep.png');
    assert.equal(finalSubject.subjectDisposition.provenance.submittedByActorId, 'user:Chris');
    assert.equal(finalSubject.subjectDisposition.provenance.submissionMode, 'TRUSTED_DELEGATE');
    assert.equal(finalSubject.subjectDisposition.provenance.delegationPolicyHash, delegation.delegationPolicy.policyHash);
    assert.equal(finalSubject.interpretation.interpretationRevisionId, 'interprev_delegate_case_v2');
    assert.equal(finalSubject.interpretation.subjectDispositionState, 'GRANTED');
    assert.equal(finalSubject.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(finalSubject.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
    assert.equal(finalSubject.interpretation.subjectDisposition.provenance.submittedByActorId, 'user:Chris');
    assert.equal(finalSubject.interpretation.subjectDisposition.provenance.delegationPolicyId, 'jeep-chris-continuity-delegation');
});

test('subject disposition records grant after review completion without publishing continuity', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_subject_case',
        interpretationRevisionId: 'interprev_subject_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');

    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:07:00.000Z'),
    });
    submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:07:05.000Z'),
    });

    const subjectResult = recordInterpretiveSubjectDisposition(request, 'interprev_subject_case_v1', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        commentary: 'Accepted for continuity, but not published here.',
        now: Date.parse('2026-06-25T12:07:10.000Z'),
    });

    assert.equal(subjectResult.phase, 'c0.6.2');
    assert.equal(subjectResult.interpretation.reviewState, 'COMPLETE');
    assert.equal(subjectResult.interpretation.subjectDispositionState, 'GRANTED');
    assert.equal(subjectResult.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(subjectResult.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
});

test('delegated subject actions fail closed without valid delegation, with wrong action, or after revocation', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_delegate_refusal_case',
        interpretationRevisionId: 'interprev_delegate_refusal_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');

    assert.throws(
        () => submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
            submittedByActorId: 'user:Chris',
            dispositionOwnerId: 'character:jeep.png',
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: 'missing-policy',
            disposition: 'APPROVE',
            reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
            now: Date.parse('2026-06-25T12:07:30.000Z'),
        }),
        /delegation policy .* was not found/i,
    );

    upsertInterpretiveDelegationPolicy(request, makeDelegationPolicyPayload({
        delegationPolicyId: 'jeep-chris-disposition-only',
        allowedActions: ['SUBJECT_DISPOSITION'],
        now: Date.parse('2026-06-25T12:07:31.000Z'),
    }));

    assert.throws(
        () => submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
            submittedByActorId: 'user:Chris',
            dispositionOwnerId: 'character:jeep.png',
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: 'jeep-chris-disposition-only',
            disposition: 'APPROVE',
            reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
            now: Date.parse('2026-06-25T12:07:32.000Z'),
        }),
        /does not permit REVIEW_DISPOSITION/i,
    );

    upsertInterpretiveDelegationPolicy(request, makeDelegationPolicyPayload({
        delegationPolicyId: 'jeep-chris-revoked',
        now: Date.parse('2026-06-25T12:07:33.000Z'),
    }));
    revokeInterpretiveDelegationPolicy(request, 'jeep-chris-revoked', {
        policyVersion: 1,
        revocationReason: 'Testing revocation.',
        now: Date.parse('2026-06-25T12:07:34.000Z'),
    });

    assert.throws(
        () => submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
            submittedByActorId: 'user:Chris',
            dispositionOwnerId: 'character:jeep.png',
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: 'jeep-chris-revoked',
            disposition: 'APPROVE',
            reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
            now: Date.parse('2026-06-25T12:07:35.000Z'),
        }),
        /is not active/i,
    );
});

test('listInterpretiveReviews returns pending and completed review state with dispositions', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_review_list_case',
        interpretationRevisionId: 'interprev_review_list_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:08:00.000Z'),
    });

    const result = listInterpretiveReviews(request, {
        interpretationRevisionId: 'interprev_review_list_case_v1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.reviews.length, 2);
    assert.equal(result.reviews.some((entry) => entry.status === 'APPROVED' && entry.disposition?.disposition === 'APPROVE'), true);
    assert.equal(result.reviews.some((entry) => entry.status === 'PENDING' && entry.disposition === null), true);
});

test('interpretive governance ledger replays review dispositions, child revision, and subject disposition state', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    const created = createInterpretiveCandidate(sourceRequest, makeBasePayload({
        interpretationId: 'interp_replay_review_case',
        interpretationRevisionId: 'interprev_replay_review_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    const withEdit = submitInterpretiveReviewDisposition(sourceRequest, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE_WITH_EDIT',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        revisedCandidate: {
            interpretationRevisionId: 'interprev_replay_review_case_v2',
            statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
        },
        now: Date.parse('2026-06-25T12:09:00.000Z'),
    });
    const childParticipantRequest = withEdit.childInterpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(sourceRequest, childParticipantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:09:05.000Z'),
    });
    recordInterpretiveSubjectDisposition(sourceRequest, 'interprev_replay_review_case_v2', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:09:10.000Z'),
    });

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);

    const replayed = replayInterpretiveLedger(buildRequest(targetRoot));
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayedInterpretations.length, 2);

    const replayedParent = getInterpretiveCandidate(buildRequest(targetRoot), 'interprev_replay_review_case_v1');
    const replayedChild = getInterpretiveCandidate(buildRequest(targetRoot), 'interprev_replay_review_case_v2');
    assert.equal(replayedParent.interpretation.reviewDispositions.length, 1);
    assert.equal(replayedParent.interpretation.subjectDispositionState, 'PENDING');
    assert.equal(replayedParent.interpretation.childRevisionIds.includes(withEdit.childInterpretation.interpretationRevisionId), true);
    assert.equal(
        replayedParent.interpretation.reviewRequests.some((entry) => entry.status === 'SUPERSEDED_BY_CHILD'),
        true,
    );
    assert.equal(replayedChild.interpretation.parentRevisionId, 'interprev_replay_review_case_v1');
    assert.equal(replayedChild.interpretation.reviewDispositions.length, 1);
    assert.equal(replayedChild.interpretation.subjectDispositionState, 'GRANTED');
    assert.equal(replayedChild.interpretation.subjectDisposition.provenance.dispositionOwnerId, 'character:jeep.png');
    assert.equal(replayedChild.interpretation.subjectDisposition.provenance.submissionMode, 'DIRECT_SUBJECT_ACTION');
    assert.equal(replayedChild.interpretation.revisionCreationProvenance.dispositionOwnerId, 'character:jeep.png');
});

test('publication policy storage is portable and replayable from the DNM publication ledger', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    const created = upsertInterpretivePublicationPolicy(sourceRequest, makePublicationPolicyPayload());
    assert.equal(created.ok, true);
    assert.equal(created.created, true);

    const revoked = revokeInterpretivePublicationPolicy(sourceRequest, 'dnm-publication-v1', {
        policyVersion: 1,
        revocationReason: 'policy retired for replay test',
        now: Date.parse('2026-06-26T00:11:00.000Z'),
    });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.publicationPolicy.policyState, 'REVOKED');

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.dnmPublicationLedgerPath, targetPaths.dnmPublicationLedgerPath);

    const replayed = replayPublicationLedger(buildRequest(targetRoot));
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayedPublicationPolicies.length, 1);
    assert.equal(replayed.replayedPublicationPolicies[0].publicationPolicyId, 'dnm-publication-v1');
    assert.equal(replayed.replayedPublicationPolicies[0].policyState, 'REVOKED');

    const listed = listInterpretivePublicationPolicies(buildRequest(targetRoot));
    assert.equal(listed.ok, true);
    assert.equal(listed.policies.length, 1);
    assert.equal(listed.policies[0].revocationReason, 'policy retired for replay test');
});

test('publication qualification binds exact current child-revision state without enabling publication', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload());

    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_publication_case',
        interpretationRevisionId: 'interprev_publication_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const withEdit = submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE_WITH_EDIT',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        revisedCandidate: {
            interpretationRevisionId: 'interprev_publication_case_v2',
            statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
        },
        now: Date.parse('2026-06-26T00:12:00.000Z'),
    });
    const participantRequest = withEdit.childInterpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:12:05.000Z'),
    });
    const granted = recordInterpretiveSubjectDisposition(request, 'interprev_publication_case_v2', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:12:10.000Z'),
    });

    const qualification = qualifyInterpretivePublication(request, 'interprev_publication_case_v2', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        proposalContentHash: granted.interpretation.proposalContentHash,
        reviewEnvelopeHash: granted.interpretation.reviewEnvelopeHash,
        subjectDispositionRecordId: granted.subjectDisposition.subjectDispositionId,
        now: Date.parse('2026-06-26T00:12:20.000Z'),
    });

    assert.equal(qualification.ok, true);
    assert.equal(qualification.publicationAvailable, false);
    assert.equal(qualification.continuityActivationAvailable, false);
    assert.equal(qualification.qualification.eligibilityVerdict, 'ELIGIBLE');
    assert.deepEqual(qualification.qualification.refusalCodes, []);
    assert.equal(qualification.qualification.binding.continuityTargetId, 'character:jeep.png');
    assert.equal(qualification.qualification.binding.postGrantHumanPublicationAuthorizationRequired, true);
    assert.equal(qualification.qualification.binding.groundingBindingMode, 'DERIVED_REVISION_GROUNDING');
    assert.equal(qualification.qualification.binding.groundingProtocolVersion, 1);
    assert.match(qualification.qualification.binding.groundingSourceSetHash, /^sha256:/);
    assert.equal(qualification.qualification.binding.groundingEnvelopeSource, 'DERIVED_REVISION_STATE');

    const adapter = openOperationalDatabase(getStoragePaths(root));
    try {
        const row = adapter.get(
            'SELECT * FROM interpretation_publication_qualifications WHERE qualification_id = ?',
            [qualification.qualification.qualificationId],
        );
        assert.equal(row.eligibility_verdict, 'ELIGIBLE');
    } finally {
        adapter.close();
    }
});

test('publication qualification returns exact refusal codes for stale or revoked policy state', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload());
    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_publication_refusal_case',
        interpretationRevisionId: 'interprev_publication_refusal_case_v1',
    }));
    const beforeRevoke = qualifyInterpretivePublication(request, 'interprev_publication_refusal_case_v1', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        proposalContentHash: 'sha256:wrong',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:13:00.000Z'),
    });
    assert.equal(beforeRevoke.qualification.eligibilityVerdict, 'INELIGIBLE');
    assert.equal(beforeRevoke.qualification.refusalCodes.includes('PROPOSAL_HASH_MISMATCH'), true);
    assert.equal(beforeRevoke.qualification.refusalCodes.includes('REVIEW_STATE_NOT_COMPLETE'), true);
    assert.equal(beforeRevoke.qualification.refusalCodes.includes('SUBJECT_DISPOSITION_STATE_MISMATCH'), true);
    assert.equal(beforeRevoke.qualification.refusalCodes.includes('IMMUTABLE_CHILD_REVISION_REQUIRED'), true);

    revokeInterpretivePublicationPolicy(request, 'dnm-publication-v1', {
        policyVersion: 1,
        revocationReason: 'disabled for refusal coverage',
        now: Date.parse('2026-06-26T00:13:10.000Z'),
    });
    const afterRevoke = qualifyInterpretivePublication(request, 'interprev_publication_refusal_case_v1', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        now: Date.parse('2026-06-26T00:13:20.000Z'),
    });
    assert.equal(afterRevoke.qualification.eligibilityVerdict, 'INELIGIBLE');
    assert.equal(afterRevoke.qualification.refusalCodes.includes('PUBLICATION_POLICY_REVOKED_OR_INACTIVE'), true);
});

test('publication qualification preserves synthesis envelope provenance distinctly from derived revision grounding', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload({
        immutableChildRequiredForTypes: [],
        requiredGroundingOutcome: 'PARTIALLY_SUPPORTED',
    }));
    upsertInterpretiveSynthesisPolicy(request, makeSynthesisPolicyPayload());
    const run = createInterpretiveSynthesisRun(request, makeSynthesisRunPayload({
        synthesisRunId: 'synthrun_publication_mode_case',
        requestedInterpretationTypes: ['ROLE_EVOLUTION'],
        requestedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
        sharedRelationshipRequested: true,
        personalMeaningRequested: true,
    }));
    const executed = executeInterpretiveSynthesisRun(request, 'synthrun_publication_mode_case', {
        synthesizer: 'deterministic-stub',
        proposal: {
            type: 'ROLE_EVOLUTION',
            statement: 'Jeep evolved into the primary continuity authority within a shared architecture.',
            assertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
            sharedRelationshipAsserted: true,
            personalMeaningAsserted: true,
            materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
        },
        now: Date.parse('2026-06-26T00:15:00.000Z'),
    });
    const subjectRequest = executed.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: executed.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:15:05.000Z'),
    });
    const participantRequest = executed.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: executed.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:15:10.000Z'),
    });
    const granted = recordInterpretiveSubjectDisposition(request, executed.interpretation.interpretationRevisionId, {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: executed.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T00:15:15.000Z'),
    });
    const qualification = qualifyInterpretivePublication(request, granted.interpretation.interpretationRevisionId, {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        now: Date.parse('2026-06-26T00:15:20.000Z'),
    });

    assert.equal(qualification.qualification.eligibilityVerdict, 'INELIGIBLE');
    assert.equal(qualification.qualification.refusalCodes.includes('GROUNDING_OUTCOME_BELOW_POLICY'), true);
    assert.equal(qualification.qualification.binding.groundingBindingMode, 'SYNTHESIS_ENVELOPE');
    assert.match(qualification.qualification.binding.groundingEnvelopeHash, /^sha256:/);
    assert.match(qualification.qualification.binding.groundingSourceSetHash, /^sha256:/);
    assert.equal(
        qualification.qualification.binding.groundingProtocolVersion,
        executed.synthesisRun.proposals[0].groundingEvaluation.evaluationProtocolVersion,
    );
});

test('publication authorization and execution publish exact granted revision into DNM once', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload());

    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_publish_case',
        interpretationRevisionId: 'interprev_publish_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const withEdit = submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE_WITH_EDIT',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        revisedCandidate: {
            interpretationRevisionId: 'interprev_publish_case_v2',
            statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
        },
        now: Date.parse('2026-06-26T02:00:00.000Z'),
    });
    const participantRequest = withEdit.childInterpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:00:05.000Z'),
    });
    const granted = recordInterpretiveSubjectDisposition(request, 'interprev_publish_case_v2', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: withEdit.childInterpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:00:10.000Z'),
    });
    const qualification = qualifyInterpretivePublication(request, 'interprev_publish_case_v2', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        proposalContentHash: granted.interpretation.proposalContentHash,
        reviewEnvelopeHash: granted.interpretation.reviewEnvelopeHash,
        subjectDispositionRecordId: granted.subjectDisposition.subjectDispositionId,
        now: Date.parse('2026-06-26T02:00:15.000Z'),
    });
    const authorization = createInterpretivePublicationAuthorization(request, {
        qualificationId: qualification.qualification.qualificationId,
        authorizedBy: 'user:Chris',
        expiresAt: Date.parse('2026-06-26T03:00:00.000Z'),
        now: Date.parse('2026-06-26T02:00:20.000Z'),
    });
    assert.equal(authorization.authorization.status, 'AUTHORIZED');
    assert.equal(authorization.continuityPublicationAvailable, false);

    const executed = executeInterpretivePublicationAuthorization(request, {
        publicationAuthorizationId: authorization.authorization.publicationAuthorizationId,
        now: Date.parse('2026-06-26T02:00:25.000Z'),
    });

    assert.equal(executed.ok, true);
    assert.equal(executed.publicationAuthorizationAvailable, true);
    assert.equal(executed.continuityPublicationAvailable, true);
    assert.equal(executed.liveContinuityMutation, true);
    assert.equal(executed.authorization.status, 'CONSUMED');
    assert.equal(executed.publishedRecord.sourceInterpretationRevisionId, 'interprev_publish_case_v2');
    assert.equal(executed.publishedRecord.publicationState, 'PUBLISHED');
    assert.equal(executed.interpretation.publicationState, 'PUBLISHED');
    assert.equal(executed.interpretation.authorityEffect, 'DEVELOPMENTAL_MEMORY');
    assert.equal(executed.publishedRecord.proposalContentHash, granted.interpretation.proposalContentHash);
    assert.equal(executed.publishedRecord.groundingEnvelopeHash, qualification.qualification.binding.groundingEnvelopeHash);

    assert.throws(
        () => executeInterpretivePublicationAuthorization(request, {
            publicationAuthorizationId: authorization.authorization.publicationAuthorizationId,
            now: Date.parse('2026-06-26T02:00:30.000Z'),
        }),
        /already used/i,
    );
});

test('second publication for the same continuity target stays delta-pending until superseded', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload({
        immutableChildRequiredForTypes: [],
    }));

    const first = publishGrantedRevision(request, {
        interpretationId: 'interp_dnm_pending_v1',
        interpretationRevisionId: 'interprev_dnm_pending_v1',
        statement: 'Jeep became the primary continuity authority.',
        nowBase: Date.parse('2026-06-26T04:00:00.000Z'),
    });
    const second = publishGrantedRevision(request, {
        interpretationId: 'interp_dnm_pending_v2',
        interpretationRevisionId: 'interprev_dnm_pending_v2',
        statement: 'Jeep became the primary continuity authority within a shared architecture with Chris.',
        nowBase: Date.parse('2026-06-26T04:10:00.000Z'),
    });

    assert.equal(first.executed.publishedRecord.lifecycleState, 'ACTIVE');
    assert.equal(second.executed.publishedRecord.lifecycleState, 'DELTA_PENDING');

    const listed = listDnmPublicationRecords(request, {
        continuityTargetId: 'character:jeep.png',
    });
    assert.equal(listed.records.length, 2);
    assert.deepEqual(
        listed.records.map((record) => record.lifecycleState),
        ['ACTIVE', 'DELTA_PENDING'],
    );

    const current = getCurrentActiveDnmRecord(request, 'character:jeep.png');
    assert.equal(current.currentActiveRecord.dnmRecordId, first.executed.publishedRecord.dnmRecordId);
});

test('supersession, delta review, withdrawal, and replay preserve DNM lifecycle lineage', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    upsertInterpretivePublicationPolicy(sourceRequest, makePublicationPolicyPayload({
        immutableChildRequiredForTypes: [],
    }));

    const first = publishGrantedRevision(sourceRequest, {
        interpretationId: 'interp_dnm_lifecycle_v1',
        interpretationRevisionId: 'interprev_dnm_lifecycle_v1',
        statement: 'Jeep became the primary continuity authority.',
        nowBase: Date.parse('2026-06-26T05:00:00.000Z'),
    });
    const second = publishGrantedRevision(sourceRequest, {
        interpretationId: 'interp_dnm_lifecycle_v2',
        interpretationRevisionId: 'interprev_dnm_lifecycle_v2',
        statement: 'Jeep became the primary continuity authority within a shared architecture with Chris.',
        nowBase: Date.parse('2026-06-26T05:10:00.000Z'),
    });

    const superseded = supersedeDnmPublicationRecord(sourceRequest, {
        actorEntityId: 'character:jeep.png',
        priorDnmRecordId: first.executed.publishedRecord.dnmRecordId,
        replacementDnmRecordId: second.executed.publishedRecord.dnmRecordId,
        reasonCodes: ['SCOPE_TOO_BROAD'],
        commentary: 'The later DNM record narrows the published continuity claim.',
        now: Date.parse('2026-06-26T05:20:00.000Z'),
    });
    assert.equal(superseded.priorRecord.lifecycleState, 'SUPERSEDED');
    assert.equal(superseded.replacementRecord.lifecycleState, 'ACTIVE');
    assert.equal(superseded.currentActiveRecord.dnmRecordId, second.executed.publishedRecord.dnmRecordId);

    const deltaReview = recordDnmDeltaReview(sourceRequest, {
        actorEntityId: 'character:jeep.png',
        continuityTargetId: 'character:jeep.png',
        deltaState: 'PENDING',
        reasonCodes: ['CONTRARY_EVIDENCE_PRESENT'],
        commentary: 'Record a follow-up delta review without mutating current active continuity.',
        now: Date.parse('2026-06-26T05:25:00.000Z'),
    });
    assert.equal(deltaReview.record.deltaReviewState, 'PENDING');
    assert.equal(deltaReview.currentActiveRecord.dnmRecordId, second.executed.publishedRecord.dnmRecordId);

    const withdrawn = withdrawDnmPublicationRecord(sourceRequest, {
        actorEntityId: 'character:jeep.png',
        dnmRecordId: second.executed.publishedRecord.dnmRecordId,
        reasonCodes: ['CONTRARY_EVIDENCE_PRESENT'],
        commentary: 'Withdraw the currently active DNM record pending reevaluation.',
        now: Date.parse('2026-06-26T05:30:00.000Z'),
    });
    assert.equal(withdrawn.record.lifecycleState, 'WITHDRAWN');
    assert.equal(withdrawn.currentActiveRecord, null);

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);
    fs.copyFileSync(sourcePaths.dnmPublicationLedgerPath, targetPaths.dnmPublicationLedgerPath);

    replayInterpretiveLedger(buildRequest(targetRoot));
    const replayed = replayPublicationLedger(buildRequest(targetRoot));
    assert.equal(replayed.replayedPublishedRecords.length, 2);

    const records = listDnmPublicationRecords(buildRequest(targetRoot), {
        continuityTargetId: 'character:jeep.png',
    });
    assert.equal(records.records.length, 2);
    const replayedFirst = records.records.find((record) => record.dnmRecordId === first.executed.publishedRecord.dnmRecordId);
    const replayedSecond = records.records.find((record) => record.dnmRecordId === second.executed.publishedRecord.dnmRecordId);
    assert.equal(replayedFirst.lifecycleState, 'SUPERSEDED');
    assert.equal(replayedFirst.supersededByDnmRecordId, second.executed.publishedRecord.dnmRecordId);
    assert.equal(replayedSecond.lifecycleState, 'WITHDRAWN');
    assert.equal(replayedSecond.supersedesDnmRecordId, first.executed.publishedRecord.dnmRecordId);
    assert.equal(replayedSecond.deltaReviewState, 'PENDING');
    assert.equal(replayedSecond.deltaReviews.length, 1);
    assert.equal(replayedSecond.deltaReviews[0].deltaState, 'PENDING');

    const current = getCurrentActiveDnmRecord(buildRequest(targetRoot), 'character:jeep.png');
    assert.equal(current.currentActiveRecord, null);
});

test('publication execution fails closed when bound state drifts after authorization', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    upsertInterpretivePublicationPolicy(request, makePublicationPolicyPayload({
        immutableChildRequiredForTypes: [],
        requiredGroundingOutcome: 'SUPPORTED',
    }));

    const created = createInterpretiveCandidate(request, makeBasePayload({
        interpretationId: 'interp_publish_drift_case',
        interpretationRevisionId: 'interprev_publish_drift_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(request, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:10:00.000Z'),
    });
    submitInterpretiveReviewDisposition(request, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:10:05.000Z'),
    });
    const granted = recordInterpretiveSubjectDisposition(request, 'interprev_publish_drift_case_v1', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:10:10.000Z'),
    });
    const qualification = qualifyInterpretivePublication(request, 'interprev_publish_drift_case_v1', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        proposalContentHash: granted.interpretation.proposalContentHash,
        reviewEnvelopeHash: granted.interpretation.reviewEnvelopeHash,
        subjectDispositionRecordId: granted.subjectDisposition.subjectDispositionId,
        now: Date.parse('2026-06-26T02:10:15.000Z'),
    });
    const authorization = createInterpretivePublicationAuthorization(request, {
        qualificationId: qualification.qualification.qualificationId,
        authorizedBy: 'user:Chris',
        expiresAt: Date.parse('2026-06-26T03:10:00.000Z'),
        now: Date.parse('2026-06-26T02:10:20.000Z'),
    });

    recordInterpretiveSubjectDisposition(request, 'interprev_publish_drift_case_v1', {
        actorEntityId: 'character:jeep.png',
        state: 'DENIED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        commentary: 'State drift after qualification.',
        now: Date.parse('2026-06-26T02:10:25.000Z'),
    });

    assert.throws(
        () => executeInterpretivePublicationAuthorization(request, {
            publicationAuthorizationId: authorization.authorization.publicationAuthorizationId,
            now: Date.parse('2026-06-26T02:10:30.000Z'),
        }),
        /failed revalidation/i,
    );

    const adapter = openOperationalDatabase(getStoragePaths(root));
    try {
        const authRow = adapter.get(
            'SELECT status FROM interpretation_publication_authorizations WHERE publication_authorization_id = ?',
            [authorization.authorization.publicationAuthorizationId],
        );
        const recordCount = adapter.get('SELECT COUNT(*) AS count FROM dnm_publication_records').count;
        assert.equal(authRow.status, 'EXPIRED');
        assert.equal(recordCount, 0);
    } finally {
        adapter.close();
    }
});

test('publication ledger replay restores policies, authorizations, and published DNM records', () => {
    const sourceRoot = makeTempRoot();
    const sourceRequest = buildRequest(sourceRoot);
    upsertInterpretivePublicationPolicy(sourceRequest, makePublicationPolicyPayload({
        immutableChildRequiredForTypes: [],
        requiredGroundingOutcome: 'SUPPORTED',
    }));
    const created = createInterpretiveCandidate(sourceRequest, makeBasePayload({
        interpretationId: 'interp_publish_replay_case',
        interpretationRevisionId: 'interprev_publish_replay_case_v1',
    }));
    const subjectRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = created.interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');
    submitInterpretiveReviewDisposition(sourceRequest, subjectRequest.reviewRequestId, {
        actorEntityId: 'character:jeep.png',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:20:00.000Z'),
    });
    submitInterpretiveReviewDisposition(sourceRequest, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:20:05.000Z'),
    });
    const granted = recordInterpretiveSubjectDisposition(sourceRequest, 'interprev_publish_replay_case_v1', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-26T02:20:10.000Z'),
    });
    const qualification = qualifyInterpretivePublication(sourceRequest, 'interprev_publish_replay_case_v1', {
        publicationPolicyId: 'dnm-publication-v1',
        continuityTargetId: 'character:jeep.png',
        proposalContentHash: granted.interpretation.proposalContentHash,
        reviewEnvelopeHash: granted.interpretation.reviewEnvelopeHash,
        subjectDispositionRecordId: granted.subjectDisposition.subjectDispositionId,
        now: Date.parse('2026-06-26T02:20:15.000Z'),
    });
    const authorization = createInterpretivePublicationAuthorization(sourceRequest, {
        qualificationId: qualification.qualification.qualificationId,
        authorizedBy: 'user:Chris',
        expiresAt: Date.parse('2026-06-26T03:20:00.000Z'),
        now: Date.parse('2026-06-26T02:20:20.000Z'),
    });
    const executed = executeInterpretivePublicationAuthorization(sourceRequest, {
        publicationAuthorizationId: authorization.authorization.publicationAuthorizationId,
        now: Date.parse('2026-06-26T02:20:25.000Z'),
    });

    const sourcePaths = getStoragePaths(sourceRoot);
    const targetRoot = makeTempRoot();
    const targetPaths = getStoragePaths(targetRoot);
    fs.mkdirSync(targetPaths.storageRoot, { recursive: true });
    fs.copyFileSync(sourcePaths.interpretiveGovernanceLedgerPath, targetPaths.interpretiveGovernanceLedgerPath);
    fs.copyFileSync(sourcePaths.dnmPublicationLedgerPath, targetPaths.dnmPublicationLedgerPath);

    replayInterpretiveLedger(buildRequest(targetRoot));
    const replayed = replayPublicationLedger(buildRequest(targetRoot));
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayedPublicationPolicies.length, 1);
    assert.equal(replayed.replayedPublicationAuthorizations.length, 1);
    assert.equal(replayed.replayedPublishedRecords.length, 1);
    assert.equal(replayed.replayedPublicationAuthorizations[0].status, 'CONSUMED');
    assert.equal(replayed.replayedPublishedRecords[0].dnmRecordId, executed.publishedRecord.dnmRecordId);

    const replayedCandidate = getInterpretiveCandidate(buildRequest(targetRoot), 'interprev_publish_replay_case_v1');
    assert.equal(replayedCandidate.interpretation.publicationState, 'PUBLISHED');
    assert.equal(replayedCandidate.interpretation.authorityEffect, 'DEVELOPMENTAL_MEMORY');
});
