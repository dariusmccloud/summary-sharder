import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getStoragePaths, openOperationalDatabase } from './core.js';
import {
    executeInterpretiveSynthesisRun,
    createInterpretiveSynthesisRun,
    createInterpretiveCandidate,
    createInterpretiveRevision,
    getInterpretiveCandidate,
    getInterpretiveSynthesisRun,
    listInterpretivePolicyDefinitions,
    listInterpretiveSynthesisPolicies,
    listInterpretiveReviews,
    prepareInterpretiveCandidate,
    recordInterpretiveSubjectDisposition,
    replayInterpretiveLedger,
    submitInterpretiveReviewDisposition,
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

    const loadedParent = getInterpretiveCandidate(request, 'interprev_edit_case_v1');
    const loadedChild = getInterpretiveCandidate(request, 'interprev_edit_case_v2');
    assert.equal(loadedParent.interpretation.statement, makeBasePayload().statement);
    assert.equal(loadedChild.interpretation.statement, 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.');
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
    submitInterpretiveReviewDisposition(sourceRequest, participantRequest.reviewRequestId, {
        actorEntityId: 'user:Chris',
        disposition: 'APPROVE',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
        now: Date.parse('2026-06-25T12:09:05.000Z'),
    });
    recordInterpretiveSubjectDisposition(sourceRequest, 'interprev_replay_review_case_v1', {
        actorEntityId: 'character:jeep.png',
        state: 'GRANTED',
        reviewEnvelopeHash: created.interpretation.reviewEnvelopeHash,
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
    assert.equal(replayedParent.interpretation.reviewDispositions.length, 2);
    assert.equal(replayedParent.interpretation.subjectDispositionState, 'GRANTED');
    assert.equal(replayedParent.interpretation.childRevisionIds.includes(withEdit.childInterpretation.interpretationRevisionId), true);
    assert.equal(replayedChild.interpretation.parentRevisionId, 'interprev_replay_review_case_v1');
});
