import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARTIFACT_KIND,
    PROTOTYPE_VERSION,
    appendMetadataReceipt,
    buildAnchorArtifactHeader,
    buildAnchorEvent,
    buildReceipt,
    classifyReplay,
    computeCanonicalHash,
    detectDuplicateChatInstanceIds,
    ensureRuntimeMetadata,
    getAnchorArtifactFromHeader,
    getAnchorEvent,
    validateAnchorArtifact,
} from './core.js';

test('anchor header round-trips and validates', () => {
    const header = buildAnchorArtifactHeader('scope_test');
    const artifact = getAnchorArtifactFromHeader(header);

    assert.equal(artifact.kind, ARTIFACT_KIND);
    assert.equal(artifact.prototypeVersion, PROTOTYPE_VERSION);
    assert.deepEqual(validateAnchorArtifact(artifact, 'scope_test'), { valid: true, reason: null });
});

test('canonical hash ignores object key order', () => {
    const a = computeCanonicalHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = computeCanonicalHash({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
    assert.equal(a, b);
});

test('anchor event produces deterministic event payload and hash', () => {
    const eventRecord = buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-a',
        expectedHead: null,
        priorJournalHash: null,
        canonicalRecord: { decision: 'alpha' },
        originChatInstanceId: 'chat_a',
        sequence: 1,
        eventId: 'evt_fixed',
        createdAt: 123,
    });
    const event = getAnchorEvent(eventRecord);

    assert.equal(event.eventId, 'evt_fixed');
    assert.equal(event.sequence, 1);
    assert.equal(event.originChatInstanceId, 'chat_a');
    assert.match(event.eventHash, /^sha256:/);
});

test('metadata receipts deduplicate by event id', () => {
    const eventRecord = buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-a',
        expectedHead: null,
        priorJournalHash: null,
        canonicalRecord: { decision: 'alpha' },
        originChatInstanceId: 'chat_a',
        sequence: 1,
        eventId: 'evt_fixed',
    });
    const event = getAnchorEvent(eventRecord);
    const receipt = buildReceipt({ event, originChatInstanceId: 'chat_a' });

    const first = appendMetadataReceipt({}, receipt);
    const second = appendMetadataReceipt(first, receipt);

    assert.equal(first.summarySharderPrototypeReceipts.length, 1);
    assert.equal(second.summarySharderPrototypeReceipts.length, 1);
});

test('runtime metadata preserves existing ids', () => {
    const metadata = ensureRuntimeMetadata({
        summarySharderRuntime: {
            prototypeVersion: PROTOTYPE_VERSION,
            chatInstanceId: 'chat_existing',
        },
    }, {
        chatInstanceId: 'chat_new',
        memoryScopeId: 'scope_a',
    });

    assert.equal(metadata.summarySharderRuntime.chatInstanceId, 'chat_existing');
    assert.equal(metadata.summarySharderRuntime.memoryScopeId, 'scope_a');
});

test('duplicate chat instance detection reports collisions', () => {
    const duplicates = detectDuplicateChatInstanceIds([
        { filePath: 'a', chatInstanceId: 'chat_1' },
        { filePath: 'b', chatInstanceId: 'chat_2' },
        { filePath: 'c', chatInstanceId: 'chat_1' },
    ]);

    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].chatInstanceId, 'chat_1');
});

test('replay classification is exact when all anchor events are covered', () => {
    const first = getAnchorEvent(buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-a',
        expectedHead: null,
        priorJournalHash: null,
        canonicalRecord: { decision: 'alpha' },
        originChatInstanceId: 'chat_a',
        sequence: 1,
        eventId: 'evt_1',
    }));
    const second = getAnchorEvent(buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-b',
        expectedHead: first.eventHash,
        priorJournalHash: first.eventHash,
        canonicalRecord: { decision: 'beta' },
        originChatInstanceId: 'chat_a',
        sequence: 2,
        eventId: 'evt_2',
    }));

    const coverage = classifyReplay(
        [first, second],
        [
            buildReceipt({ event: first, originChatInstanceId: 'chat_a' }),
            buildReceipt({ event: second, originChatInstanceId: 'chat_a' }),
        ],
    );

    assert.equal(coverage.classification, 'exact');
    assert.equal(coverage.anchorEventCount, 2);
    assert.equal(coverage.uniqueReceiptEventCount, 2);
    assert.equal(coverage.finalReconstructedHead, second.eventHash);
});

test('replay classification is incomplete when receipts are missing', () => {
    const first = getAnchorEvent(buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-a',
        expectedHead: null,
        priorJournalHash: null,
        canonicalRecord: { decision: 'alpha' },
        originChatInstanceId: 'chat_a',
        sequence: 1,
        eventId: 'evt_1',
    }));
    const second = getAnchorEvent(buildAnchorEvent({
        memoryScopeId: 'scope_test',
        decisionId: 'decision-b',
        expectedHead: first.eventHash,
        priorJournalHash: first.eventHash,
        canonicalRecord: { decision: 'beta' },
        originChatInstanceId: 'chat_a',
        sequence: 2,
        eventId: 'evt_2',
    }));

    const coverage = classifyReplay(
        [first, second],
        [buildReceipt({ event: first, originChatInstanceId: 'chat_a' })],
    );

    assert.equal(coverage.classification, 'incomplete');
    assert.deepEqual(coverage.missingEventIds, ['evt_2']);
});
