import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getInterpretiveCandidate,
    listInterpretiveDelegationPolicies,
    listInterpretiveReviews,
    resetArchitecturalAuthorityServerApiState,
} from './architectural-authority-server-api.js';

test.afterEach(() => {
    resetArchitecturalAuthorityServerApiState();
    delete global.fetch;
});

test('listInterpretiveReviews builds filtered query string', async () => {
    const calls = [];
    global.fetch = async (url) => {
        calls.push(url);
        return {
            ok: true,
            async json() {
                return { reviews: [] };
            },
        };
    };

    const response = await listInterpretiveReviews({ status: 'PENDING', reviewerEntityId: 'entity_reviewer_01' });

    assert.deepEqual(response, { reviews: [] });
    assert.equal(
        calls[0],
        '/api/plugins/summary-sharder-memory/interpretive/reviews?status=PENDING&reviewerEntityId=entity_reviewer_01',
    );
});

test('listInterpretiveDelegationPolicies omits blank filters', async () => {
    const calls = [];
    global.fetch = async (url) => {
        calls.push(url);
        return {
            ok: true,
            async json() {
                return { policies: [] };
            },
        };
    };

    await listInterpretiveDelegationPolicies({ memoryScopeId: 'scope_demo', delegateEntityId: '   ' });

    assert.equal(
        calls[0],
        '/api/plugins/summary-sharder-memory/interpretive/delegation-policies?memoryScopeId=scope_demo',
    );
});

test('getInterpretiveCandidate requires an interpretation revision id', async () => {
    await assert.rejects(
        () => getInterpretiveCandidate(''),
        /interpretationRevisionId is required/u,
    );
});

test('getInterpretiveCandidate fetches encoded revision path', async () => {
    const calls = [];
    global.fetch = async (url) => {
        calls.push(url);
        return {
            ok: true,
            async json() {
                return { interpretation: { interpretationRevisionId: 'interprev:test/value' } };
            },
        };
    };

    const response = await getInterpretiveCandidate('interprev:test/value');

    assert.equal(
        calls[0],
        '/api/plugins/summary-sharder-memory/interpretive/candidates/interprev%3Atest%2Fvalue',
    );
    assert.equal(response.interpretation.interpretationRevisionId, 'interprev:test/value');
});
