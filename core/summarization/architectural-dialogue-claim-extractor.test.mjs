import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractArchitecturalDialogueClaims,
    TIER2_AUTHORITY_CLASS,
    TIER2_CLAIM_CLASS,
    TIER2_CLAIM_STATE,
    TIER2_REVIEW_KIND,
} from './architectural-dialogue-claim-extractor.js';

function makeContext(messageOverrides = {}) {
    return {
        memoryScopeId: 'scope_alpha',
        chatInstanceId: 'chat_alpha',
        sourceMessageId: 'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sourceRevisionHash: 'sha256:rev-a',
        initFingerprint: 'sha256:init-a',
        message: {
            name: 'Chris',
            is_user: true,
            is_system: false,
            send_date: '2026-06-24T10:00:00.000Z',
            mes: '',
            extra: {
                summary_sharder: {
                    speakerIdentity: {
                        speakerEntityId: 'user:Chris',
                        sourceType: 'user',
                    },
                },
            },
            ...messageOverrides,
        },
    };
}

test('assistant recommendation remains a proposed decision', () => {
    const claims = extractArchitecturalDialogueClaims(makeContext({
        name: 'Jeep',
        is_user: false,
        mes: 'We should keep browser-local state non-authoritative.',
        extra: {
            summary_sharder: {
                speakerIdentity: {
                    speakerEntityId: 'character:jeep.png',
                    sourceType: 'character',
                },
            },
        },
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimClass, TIER2_CLAIM_CLASS.DECISION);
    assert.equal(claims[0].claimState, TIER2_CLAIM_STATE.PROPOSED);
    assert.equal(claims[0].authorityClass, TIER2_AUTHORITY_CLASS.ASSISTANT_PROPOSAL);
});

test('user approval yields accepted decision classification', () => {
    const claims = extractArchitecturalDialogueClaims(makeContext({
        mes: 'Approved: Browser-local state remains non-authoritative.',
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimClass, TIER2_CLAIM_CLASS.DECISION);
    assert.equal(claims[0].claimState, TIER2_CLAIM_STATE.ACCEPTED);
    assert.equal(claims[0].authorityClass, TIER2_AUTHORITY_CLASS.USER_AUTHORITY);
});

test('character self-commitment is bounded to character self authority', () => {
    const claims = extractArchitecturalDialogueClaims(makeContext({
        name: 'Jeep',
        is_user: false,
        mes: 'I still need to validate my own archive settings.',
        extra: {
            summary_sharder: {
                speakerIdentity: {
                    speakerEntityId: 'character:jeep.png',
                    sourceType: 'character',
                },
            },
        },
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimClass, TIER2_CLAIM_CLASS.UNRESOLVED_COMMITMENT);
    assert.equal(claims[0].authorityClass, TIER2_AUTHORITY_CLASS.CHARACTER_SELF_AUTHORITY);
    assert.equal(claims[0].claimState, TIER2_CLAIM_STATE.UNRESOLVED);
});

test('claim-like text inside code fences is reported but not admitted', () => {
    const claims = extractArchitecturalDialogueClaims(makeContext({
        mes: '```text\nWe should keep browser-local state non-authoritative.\n```',
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].admissionStatus, 'review_only');
    assert.equal(claims[0].reviewKind, TIER2_REVIEW_KIND.NON_ADMITTED_MENTION);
});

test('context-only acceptance is reported but not admitted', () => {
    const claims = extractArchitecturalDialogueClaims(makeContext({
        mes: 'Agree.',
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].admissionStatus, 'review_only');
    assert.equal(claims[0].reviewKind, TIER2_REVIEW_KIND.CONTEXT_DEPENDENT_CANDIDATE);
});

test('claim ids stay stable across unchanged runs', () => {
    const first = extractArchitecturalDialogueClaims(makeContext({
        mes: 'Decision gain-modulation-boundary: Keep browser-local state non-authoritative.',
    }));
    const second = extractArchitecturalDialogueClaims(makeContext({
        mes: 'Decision gain-modulation-boundary: Keep browser-local state non-authoritative.',
    }));

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].claimId, second[0].claimId);
});
