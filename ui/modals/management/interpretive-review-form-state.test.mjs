import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildInterpretiveRevisedCandidatePayload,
    getGovernedFieldState,
    getInterpretiveDispositionFieldState,
    INTERPRETIVE_REASON_CODE_GROUPS,
    REVIEW_DISPOSITION_OPTIONS,
    SUBJECT_DISPOSITION_OPTIONS,
    filterDelegationPoliciesForAction,
    getInterpretiveSubmissionModeOptions,
    parseInterpretiveTokenList,
    resolveDefaultInterpretiveSubmissionMode,
    shouldShowInterpretiveRevisionEditor,
    validateInterpretiveActionPayload,
    validateGovernedSubmissionPayload,
} from './interpretive-review-form-state.js';

test('review disposition options include immutable edit flow for the governed editor slice', () => {
    assert.equal(REVIEW_DISPOSITION_OPTIONS.some((entry) => entry.value === 'APPROVE_WITH_EDIT'), true);
    assert.deepEqual(
        SUBJECT_DISPOSITION_OPTIONS.map((entry) => entry.value),
        ['GRANTED', 'REJECTED', 'CONTESTED', 'DEFERRED'],
    );
});

test('reason code groups preserve humanized attention and wording splits', () => {
    assert.deepEqual(
        INTERPRETIVE_REASON_CODE_GROUPS.map((group) => group.key),
        ['attention', 'why'],
    );
    assert.deepEqual(
        INTERPRETIVE_REASON_CODE_GROUPS[0].codes.map((entry) => entry.value),
        [
            'AUTHORITY',
            'ROLE',
            'RELATIONSHIP',
            'IDENTITY',
            'PERSONAL_HISTORY',
            'SENSITIVE_MEANING',
            'PROJECT_BEHAVIOR',
            'THEMATIC_MEANING',
        ],
    );
    assert.deepEqual(
        INTERPRETIVE_REASON_CODE_GROUPS[1].codes.map((entry) => entry.value),
        ['SCOPE_TOO_BROAD', 'CONTRARY_EVIDENCE_PRESENT'],
    );
});

test('parseInterpretiveTokenList trims, deduplicates, and accepts commas or newlines', () => {
    assert.deepEqual(
        parseInterpretiveTokenList(' AUTHORITY,\nROLE,\nAUTHORITY , RELATIONSHIP '),
        ['AUTHORITY', 'ROLE', 'RELATIONSHIP'],
    );
});

test('getInterpretiveSubmissionModeOptions distinguishes subject from reviewer ownership', () => {
    assert.deepEqual(
        getInterpretiveSubmissionModeOptions({
            ownerId: 'character:jeep.png',
            memorySubjectId: 'character:jeep.png',
            hasAutoSubjectEvidenceRefs: true,
        }).map((entry) => entry.value),
        ['DIRECT_SUBJECT_ACTION', 'SUBJECT_EXPRESSED_AND_RECORDED', 'TRUSTED_DELEGATE'],
    );

    assert.deepEqual(
        getInterpretiveSubmissionModeOptions({
            ownerId: 'character:jeep.png',
            memorySubjectId: 'character:jeep.png',
            hasAutoSubjectEvidenceRefs: false,
        }).map((entry) => entry.value),
        ['DIRECT_SUBJECT_ACTION', 'TRUSTED_DELEGATE'],
    );

    assert.deepEqual(
        getInterpretiveSubmissionModeOptions({
            ownerId: 'user:Chris',
            memorySubjectId: 'character:jeep.png',
        }).map((entry) => entry.value),
        ['DIRECT_REVIEWER_ACTION', 'TRUSTED_DELEGATE'],
    );
});

test('filterDelegationPoliciesForAction keeps only active matching policies', () => {
    const policies = [
        {
            delegationPolicyId: 'keep-me',
            policyState: 'ACTIVE',
            principalEntityId: 'character:jeep.png',
            delegateEntityId: 'user:Chris',
            allowedActions: ['SUBJECT_DISPOSITION', 'REVIEW_DISPOSITION'],
            memoryScopeId: 'scope_demo',
            continuityTargetId: 'character:jeep.png',
        },
        {
            delegationPolicyId: 'wrong-action',
            policyState: 'ACTIVE',
            principalEntityId: 'character:jeep.png',
            delegateEntityId: 'user:Chris',
            allowedActions: ['SUBJECT_REVISION'],
            memoryScopeId: 'scope_demo',
            continuityTargetId: 'character:jeep.png',
        },
        {
            delegationPolicyId: 'revoked',
            policyState: 'REVOKED',
            principalEntityId: 'character:jeep.png',
            delegateEntityId: 'user:Chris',
            allowedActions: ['SUBJECT_DISPOSITION'],
            memoryScopeId: 'scope_demo',
            continuityTargetId: 'character:jeep.png',
        },
    ];

    const filtered = filterDelegationPoliciesForAction(policies, {
        principalEntityId: 'character:jeep.png',
        delegateEntityId: 'user:Chris',
        actionKind: 'SUBJECT_DISPOSITION',
        memoryScopeId: 'scope_demo',
        continuityTargetId: 'character:jeep.png',
    });

    assert.deepEqual(filtered.map((entry) => entry.delegationPolicyId), ['keep-me']);
});

test('resolveDefaultInterpretiveSubmissionMode prefers active trusted delegation when owner and actor differ', () => {
    const mode = resolveDefaultInterpretiveSubmissionMode({
        ownerId: 'character:jeep.png',
        memorySubjectId: 'character:jeep.png',
        currentActorId: 'user:Chris',
        actionKind: 'SUBJECT_DISPOSITION',
        memoryScopeId: 'scope_demo',
        continuityTargetId: 'character:jeep.png',
        policies: [
            {
                delegationPolicyId: 'jeep-chris',
                policyState: 'ACTIVE',
                principalEntityId: 'character:jeep.png',
                delegateEntityId: 'user:Chris',
                allowedActions: ['SUBJECT_DISPOSITION'],
                memoryScopeId: 'scope_demo',
                continuityTargetId: 'character:jeep.png',
            },
        ],
    });

    assert.equal(mode, 'TRUSTED_DELEGATE');
});

test('resolveDefaultInterpretiveSubmissionMode falls back to direct subject action when no auto evidence refs exist', () => {
    const mode = resolveDefaultInterpretiveSubmissionMode({
        ownerId: 'character:jeep.png',
        memorySubjectId: 'character:jeep.png',
        currentActorId: '',
        actionKind: 'SUBJECT_DISPOSITION',
        memoryScopeId: 'scope_demo',
        continuityTargetId: 'character:jeep.png',
        policies: [],
        hasAutoSubjectEvidenceRefs: false,
    });

    assert.equal(mode, 'DIRECT_SUBJECT_ACTION');
});

test('shouldShowInterpretiveRevisionEditor only enables child revision editing for review approve-with-edit', () => {
    assert.equal(shouldShowInterpretiveRevisionEditor('review', 'APPROVE_WITH_EDIT'), true);
    assert.equal(shouldShowInterpretiveRevisionEditor('review', 'APPROVE'), false);
    assert.equal(shouldShowInterpretiveRevisionEditor('subject', 'APPROVE_WITH_EDIT'), false);
});

test('buildInterpretiveRevisedCandidatePayload requires a changed statement', () => {
    assert.deepEqual(
        buildInterpretiveRevisedCandidatePayload({
            parentStatement: 'Parent statement.',
            revisedStatement: '',
        }),
        { error: 'Revised statement is required for Approve With Edit.' },
    );

    assert.deepEqual(
        buildInterpretiveRevisedCandidatePayload({
            parentStatement: 'Parent statement.',
            revisedStatement: 'Parent statement.',
        }),
        { error: 'Revised statement must differ from the parent statement.' },
    );

    assert.deepEqual(
        buildInterpretiveRevisedCandidatePayload({
            parentStatement: 'Parent statement.',
            revisedStatement: 'Child statement.',
        }),
        { revisedCandidate: { statement: 'Child statement.' } },
    );
});

test('getGovernedFieldState hides or requires fields by submission mode', () => {
    assert.deepEqual(
        getGovernedFieldState({
            submissionMode: 'DIRECT_SUBJECT_ACTION',
            hasApplicablePolicies: true,
        }),
        {
            showDelegationPolicyField: false,
            showDelegationPolicyUnavailable: false,
            delegationPolicyRequired: false,
            showEvidenceField: false,
            evidenceRequired: false,
            evidenceHint: 'Optional for trusted delegation.',
        },
    );

    assert.deepEqual(
        getGovernedFieldState({
            submissionMode: 'TRUSTED_DELEGATE',
            hasApplicablePolicies: false,
        }),
        {
            showDelegationPolicyField: false,
            showDelegationPolicyUnavailable: true,
            delegationPolicyRequired: false,
            showEvidenceField: true,
            evidenceRequired: false,
            evidenceHint: 'Optional for trusted delegation.',
        },
    );

    assert.deepEqual(
        getGovernedFieldState({
            submissionMode: 'SUBJECT_EXPRESSED_AND_RECORDED',
            hasApplicablePolicies: true,
        }),
        {
            showDelegationPolicyField: false,
            showDelegationPolicyUnavailable: false,
            delegationPolicyRequired: false,
            showEvidenceField: true,
            evidenceRequired: true,
            evidenceHint: 'Required for recorded subject expression.',
        },
    );

    assert.deepEqual(
        getGovernedFieldState({
            submissionMode: 'SUBJECT_EXPRESSED_AND_RECORDED',
            hasApplicablePolicies: true,
            hasAutoSubjectEvidenceRefs: false,
        }),
        {
            showDelegationPolicyField: false,
            showDelegationPolicyUnavailable: false,
            delegationPolicyRequired: false,
            showEvidenceField: false,
            evidenceRequired: false,
            evidenceHint: '',
        },
    );
});

test('validateGovernedSubmissionPayload blocks missing evidence and missing required delegation policy', () => {
    assert.equal(
        validateGovernedSubmissionPayload({
            submissionMode: 'SUBJECT_EXPRESSED_AND_RECORDED',
            subjectEvidenceRefs: [],
            hasApplicablePolicies: false,
            hasAutoSubjectEvidenceRefs: false,
        }),
        'Recorded subject expression is unavailable until inspectable subject evidence references are bound to this candidate.',
    );

    assert.equal(
        validateGovernedSubmissionPayload({
            submissionMode: 'SUBJECT_EXPRESSED_AND_RECORDED',
            subjectEvidenceRefs: [],
            hasApplicablePolicies: false,
        }),
        'Recorded subject expression requires at least one subject evidence reference.',
    );

    assert.equal(
        validateGovernedSubmissionPayload({
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: null,
            subjectEvidenceRefs: [],
            hasApplicablePolicies: true,
        }),
        'Trusted delegation requires a matching active delegation policy.',
    );

    assert.equal(
        validateGovernedSubmissionPayload({
            submissionMode: 'TRUSTED_DELEGATE',
            delegationPolicyId: null,
            subjectEvidenceRefs: [],
            hasApplicablePolicies: false,
        }),
        null,
    );
});

test('getInterpretiveDispositionFieldState collapses or requires concern fields by disposition', () => {
    assert.deepEqual(
        getInterpretiveDispositionFieldState({
            formKind: 'review',
            disposition: 'APPROVE',
        }),
        {
            showReasonSelectors: false,
            requireReasonCodes: false,
            requireCommentary: false,
            commentaryPlaceholder: 'Optional explanation.',
            commentaryHint: '',
        },
    );

    assert.deepEqual(
        getInterpretiveDispositionFieldState({
            formKind: 'review',
            disposition: 'APPROVE_WITH_EDIT',
        }),
        {
            showReasonSelectors: true,
            requireReasonCodes: true,
            requireCommentary: false,
            commentaryPlaceholder: 'Explain what needs to change.',
            commentaryHint: 'Select what needs attention and why the current wording should change.',
        },
    );

    assert.deepEqual(
        getInterpretiveDispositionFieldState({
            formKind: 'subject',
            disposition: 'REJECTED',
        }),
        {
            showReasonSelectors: true,
            requireReasonCodes: true,
            requireCommentary: true,
            commentaryPlaceholder: 'Explain why you are rejecting or contesting this memory.',
            commentaryHint: 'Select the concern and explain the decision.',
        },
    );
});

test('validateInterpretiveActionPayload enforces reasons and commentary only when required', () => {
    assert.equal(
        validateInterpretiveActionPayload({
            formKind: 'review',
            disposition: 'APPROVE',
            reasonCodes: [],
            commentary: '',
        }),
        null,
    );

    assert.equal(
        validateInterpretiveActionPayload({
            formKind: 'review',
            disposition: 'APPROVE_WITH_EDIT',
            reasonCodes: [],
            commentary: '',
        }),
        'Select at least one concern before submitting this decision.',
    );

    assert.equal(
        validateInterpretiveActionPayload({
            formKind: 'subject',
            disposition: 'REJECTED',
            reasonCodes: ['AUTHORITY'],
            commentary: '',
        }),
        'Add an explanation before submitting this decision.',
    );
});
