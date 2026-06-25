import test from 'node:test';
import assert from 'node:assert/strict';

import { applyManagedShardInsertion } from './insert-managed-shard-into-chat.mjs';

function makeMessage(index, name, text) {
    const suffix = String(index).padStart(2, '0');
    return {
        name,
        is_user: name === 'Chris',
        is_system: false,
        send_date: `2026-06-25T00:00:${suffix}.000Z`,
        mes: text,
        extra: {
            summary_sharder: {
                speakerIdentity: {
                    speakerEntityId: name === 'Chris' ? 'user:Chris' : 'character:jeep.png',
                    speakerPathAtInit: name === 'Chris' ? 'Chris' : 'jeep.png',
                    displayNameAtInit: name,
                    sourceType: name === 'Chris' ? 'user' : 'character',
                },
                evidencePolicy: 'include',
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: `msg_${`${index}`.padStart(32, 'a').slice(0, 32)}`,
                    initFingerprint: `sha256:init-${index}`,
                    revisionHash: `sha256:rev-${index}`,
                },
            },
        },
    };
}

function makeChatRecords() {
    return [
        {
            chat_metadata: {
                summary_sharder: {
                    chatId: 'Session A',
                    summarizedRanges: [
                        { start: 0, end: 0, hidden: true, ignoreCollapse: false, ignoreNames: '' },
                    ],
                    shardManifests: [],
                    messageIdentity: {
                        schemaVersion: 1,
                        status: 'IDENTITY_COMPLETE',
                        identifiedCount: 3,
                        unidentifiedCount: 0,
                        lastReconciledAt: 1782349664329,
                        corpusRevisionHash: 'sha256:before',
                    },
                },
            },
            user_name: 'Chris',
            character_name: 'Jeep',
        },
        makeMessage(0, 'Chris', 'Alpha'),
        makeMessage(1, 'Jeep', 'Beta'),
        makeMessage(2, 'Chris', 'Gamma'),
    ];
}

const SHARD_BODY = [
    '## DECISIONS',
    '',
    '[REF: S1:1] 🔴 ID:test-inserted-shard | TYPE:GOVERNANCE | DECISION:Test insertion preserves the managed shard contract. | WHY:explicit test fixture | SCOPE:test | STATUS:SEALED | EVIDENCE:[REF: S1:1]',
    '',
    '===END===',
].join('\n');

test('applyManagedShardInsertion inserts a wrapped shard, range, manifest, and refreshed identity status', async () => {
    const records = makeChatRecords();
    const result = await applyManagedShardInsertion(records, {
        startIndex: 1,
        endIndex: 2,
        expectedStartMessageId: records[2].extra.summary_sharder.messageIdentity.messageId,
        expectedEndMessageId: records[3].extra.summary_sharder.messageIdentity.messageId,
        shardBody: SHARD_BODY,
        outputUID: '2026-06-25T01:23:45.000Z',
        nowMs: Date.parse('2026-06-25T01:23:45.000Z'),
        messageName: 'SillyTavern System',
        promptPolicy: 'replace_source',
    });

    assert.equal(result.summary.messageCountBefore, 3);
    assert.equal(result.summary.messageCountAfter, 4);
    assert.equal(result.summary.insertionIndex, 3);
    assert.equal(result.insertedMessage.name, 'SillyTavern System');
    assert.match(result.insertedMessage.mes, /^\[MEMORY SHARD: Messages 1-2\]\n\n## DECISIONS/u);

    const nextHeader = result.nextRecords[0].chat_metadata.summary_sharder;
    assert.deepEqual(nextHeader.summarizedRanges, [
        { start: 0, end: 2, hidden: true, ignoreCollapse: false, ignoreNames: '' },
    ]);
    assert.equal(nextHeader.shardManifests.length, 1);
    assert.equal(nextHeader.messageIdentity.status, 'IDENTITY_COMPLETE');
    assert.equal(nextHeader.messageIdentity.identifiedCount, 4);
    assert.equal(nextHeader.messageIdentity.unidentifiedCount, 0);
    assert.match(nextHeader.messageIdentity.corpusRevisionHash, /^sha256:/u);

    assert.equal(result.hasValidationErrors, false);
    assert.equal(Array.isArray(result.validationReport.diagnostics), true);
    assert.equal(result.summary.validationErrorCount, 0);
    assert.equal(result.summary.validationDiagnosticCount >= result.summary.validationWarningCount, true);
});

test('applyManagedShardInsertion rejects a duplicate managed shard range', async () => {
    const first = await applyManagedShardInsertion(makeChatRecords(), {
        startIndex: 1,
        endIndex: 2,
        shardBody: SHARD_BODY,
        outputUID: '2026-06-25T01:23:45.000Z',
        nowMs: Date.parse('2026-06-25T01:23:45.000Z'),
    });

    await assert.rejects(
        applyManagedShardInsertion(first.nextRecords, {
            startIndex: 1,
            endIndex: 2,
            shardBody: SHARD_BODY,
            outputUID: '2026-06-25T01:23:46.000Z',
            nowMs: Date.parse('2026-06-25T01:23:46.000Z'),
        }),
        /already exists/u
    );
});

test('applyManagedShardInsertion rejects source-window identity drift', async () => {
    const records = makeChatRecords();
    await assert.rejects(
        applyManagedShardInsertion(records, {
            startIndex: 1,
            endIndex: 2,
            expectedStartMessageId: 'msg_deadbeefdeadbeefdeadbeefdeadbeef',
            shardBody: SHARD_BODY,
            outputUID: '2026-06-25T01:23:45.000Z',
            nowMs: Date.parse('2026-06-25T01:23:45.000Z'),
        }),
        /Start message ID mismatch/u
    );
});

test('applyManagedShardInsertion rejects duplicate output uid and duplicate body hash across managed shards', async () => {
    const first = await applyManagedShardInsertion(makeChatRecords(), {
        startIndex: 0,
        endIndex: 1,
        shardBody: SHARD_BODY,
        outputUID: '2026-06-25T01:23:45.000Z',
        nowMs: Date.parse('2026-06-25T01:23:45.000Z'),
    });

    await assert.rejects(
        applyManagedShardInsertion(first.nextRecords, {
            startIndex: 2,
            endIndex: 2,
            shardBody: [
                '## DECISIONS',
                '',
                '[REF: S2:1] 🔴 ID:test-other-shard | TYPE:GOVERNANCE | DECISION:Different body. | WHY:explicit test fixture | SCOPE:test | STATUS:SEALED | EVIDENCE:[REF: S2:1]',
                '',
                '===END===',
            ].join('\n'),
            outputUID: '2026-06-25T01:23:45.000Z',
            nowMs: Date.parse('2026-06-25T01:23:45.000Z'),
        }),
        /output UID/u
    );

    await assert.rejects(
        applyManagedShardInsertion(first.nextRecords, {
            startIndex: 2,
            endIndex: 2,
            shardBody: SHARD_BODY,
            outputUID: '2026-06-25T01:23:46.000Z',
            nowMs: Date.parse('2026-06-25T01:23:46.000Z'),
        }),
        /same body hash/u
    );
});
