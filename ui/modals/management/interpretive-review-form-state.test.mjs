import assert from 'node:assert/strict';
import test from 'node:test';

import {
    REVIEW_DISPOSITION_OPTIONS,
    SUBJECT_DISPOSITION_OPTIONS,
    filterDelegationPoliciesForAction,
    getInterpretiveSubmissionModeOptions,
    parseInterpretiveTokenList,
    resolveDefaultInterpretiveSubmissionMode,
} from './interpretive-review-form-state.js';

test('review disposition options exclude immutable edit flow in this slice', () => {
    assert.equal(REVIEW_DISPOSITION_OPTIONS.some((entry) => entry.value === 'APPROVE_WITH_EDIT'), false);
    assert.deepEqual(
        SUBJECT_DISPOSITION_OPTIONS.map((entry) => entry.value),
        ['GRANTED', 'REJECTED', 'CONTESTED', 'DEFERRED'],
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
        }).map((entry) => entry.value),
        ['DIRECT_SUBJECT_ACTION', 'SUBJECT_EXPRESSED_AND_RECORDED', 'TRUSTED_DELEGATE'],
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
