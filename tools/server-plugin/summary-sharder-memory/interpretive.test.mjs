import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getStoragePaths, openOperationalDatabase } from './core.js';
import {
    createInterpretiveCandidate,
    getInterpretiveCandidate,
    listInterpretivePolicyDefinitions,
    prepareInterpretiveCandidate,
    replayInterpretiveLedger,
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
        subjectDisposition: value.subjectDisposition,
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
