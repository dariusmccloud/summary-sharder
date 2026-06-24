import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SHARD_ARTIFACT_KINDS,
    SHARD_CONTENT_HEALTH_VALUES,
    SHARD_EXPOSURE_HEALTH_VALUES,
    SHARD_PROMPT_POLICY_VALUES,
    buildBackfilledManifestFromOutputMessage,
    buildManagedShardManifest,
    parseManagedOutputWrapper,
    validateShardManifest,
} from './shard-integrity-core.js';

function makeMessage(index, overrides = {}) {
    const messageId = overrides.messageId || `msg_${String(index + 1).padStart(32, '0')}`;
    const revisionHash = overrides.revisionHash || `sha256:rev-${index + 1}`;
    return {
        name: overrides.name || 'Speaker',
        mes: overrides.mes || `Message ${index + 1}`,
        send_date: overrides.send_date || `2026-06-24T00:00:0${index}.000Z`,
        is_system: overrides.is_system ?? false,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId,
                    initFingerprint: overrides.initFingerprint || `sha256:init-${index + 1}`,
                    revisionHash,
                },
            },
        },
    };
}

test('parseManagedOutputWrapper recognizes system shard wrappers', () => {
    assert.deepEqual(
        parseManagedOutputWrapper('[MEMORY SHARD: Messages 10-20]\n\nBody'),
        {
            tag: 'MEMORY SHARD',
            artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SHARD,
            startIndex: 10,
            endIndex: 20,
        }
    );
});

test('buildManagedShardManifest records identity-backed source coverage', async () => {
    const messages = [
        makeMessage(0),
        makeMessage(1),
        makeMessage(2, { mes: '[SUMMARY: Messages 0-1]\n\nSummary body', send_date: '2026-06-24T00:00:09.000Z' }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    assert.equal(manifest.artifactKind, SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY);
    assert.equal(manifest.outputUID, '2026-06-24T00:00:09.000Z');
    assert.deepEqual(manifest.sourceSelector, {
        mode: 'contiguous_interval',
        startMessageId: 'msg_00000000000000000000000000000001',
        endMessageId: 'msg_00000000000000000000000000000002',
        sourceCount: 2,
    });
    assert.equal(manifest.promptPolicy, SHARD_PROMPT_POLICY_VALUES.REPLACE_SOURCE);
    assert.match(manifest.sourceIdentityHash, /^sha256:/u);
    assert.match(manifest.sourceRevisionHash, /^sha256:/u);
});

test('validateShardManifest reports INTACT when source ids and hash still match', async () => {
    const messages = [
        makeMessage(0, { is_system: true }),
        makeMessage(1, { is_system: true }),
        makeMessage(2, { mes: '[SUMMARY: Messages 0-1]\n\nSummary body', send_date: '2026-06-24T00:00:09.000Z' }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    const result = await validateShardManifest(manifest, messages);
    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.INTACT);
    assert.equal(result.exposureHealth, SHARD_EXPOSURE_HEALTH_VALUES.EXPOSURE_OK);
    assert.equal(result.diagnostics.length, 0);
});

test('validateShardManifest reports STALE when source revision hash changes', async () => {
    const messages = [
        makeMessage(0, { is_system: true }),
        makeMessage(1, { is_system: true }),
        makeMessage(2, { mes: '[SUMMARY: Messages 0-1]\n\nSummary body', send_date: '2026-06-24T00:00:09.000Z' }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    messages[1].extra.summary_sharder.messageIdentity.revisionHash = 'sha256:changed';

    const result = await validateShardManifest(manifest, messages);
    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.STALE);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'SHARD_SOURCE_HASH_MISMATCH'));
});

test('validateShardManifest reports DEGRADED when one covered source message is missing', async () => {
    const messages = [
        makeMessage(0, { is_system: true }),
        makeMessage(1, { is_system: true }),
        makeMessage(2, { mes: '[SUMMARY: Messages 0-1]\n\nSummary body', send_date: '2026-06-24T00:00:09.000Z' }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    const result = await validateShardManifest(manifest, [messages[0], messages[2]]);
    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.DEGRADED);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'MESSAGE_SOURCE_MISSING'));
});

test('validateShardManifest reports ORPHANED when the saved shard output is gone', async () => {
    const messages = [
        makeMessage(0, { is_system: true }),
        makeMessage(1, { is_system: true }),
        makeMessage(2, { mes: '[SUMMARY: Messages 0-1]\n\nSummary body', send_date: '2026-06-24T00:00:09.000Z' }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    const result = await validateShardManifest(manifest, messages.slice(0, 2));
    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.ORPHANED);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'SHARD_ORPHANED'));
});

test('validateShardManifest splits intact content from replace-source exposure conflict', async () => {
    const longText = 'word '.repeat(800).trim();
    const messages = [
        makeMessage(0, { mes: longText }),
        makeMessage(1, { mes: longText }),
        makeMessage(2, {
            mes: `[SUMMARY: Messages 0-1]\n\n${longText}`,
            send_date: '2026-06-24T00:00:09.000Z',
            is_system: false,
        }),
    ];

    const manifest = await buildManagedShardManifest(messages, {
        artifactKind: SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY,
        outputUID: '2026-06-24T00:00:09.000Z',
        startIndex: 0,
        endIndex: 1,
    });

    const result = await validateShardManifest(manifest, messages);
    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.INTACT);
    assert.equal(result.exposureHealth, SHARD_EXPOSURE_HEALTH_VALUES.SOURCE_AND_ARTIFACT_VISIBLE);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'DOUBLE_CONTEXT_INCLUSION'));
    assert.ok(result.diagnostics.some((entry) => entry.code === 'PROMPT_SIZE_ESTIMATED_WARNING'));
});

test('validateShardManifest does not infer double inclusion for unknown legacy policy', async () => {
    const longText = 'word '.repeat(200).trim();
    const messages = [
        makeMessage(0, { mes: longText }),
        makeMessage(1, { mes: longText }),
        makeMessage(2, {
            mes: `[SUMMARY: Messages 0-1]\n\n${longText}`,
            send_date: '2026-06-24T00:00:09.000Z',
            is_system: false,
        }),
    ];

    const manifest = await buildBackfilledManifestFromOutputMessage(messages, messages[2]);
    const result = await validateShardManifest(manifest, messages);

    assert.equal(result.contentHealth, SHARD_CONTENT_HEALTH_VALUES.INTACT);
    assert.equal(result.exposureHealth, SHARD_EXPOSURE_HEALTH_VALUES.VISIBILITY_POLICY_UNKNOWN);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'VISIBILITY_POLICY_UNKNOWN'));
    assert.equal(result.diagnostics.some((entry) => entry.code === 'DOUBLE_CONTEXT_INCLUSION'), false);
});

test('buildBackfilledManifestFromOutputMessage reconstructs legacy wrapper coverage from the saved output row', async () => {
    const messages = [
        makeMessage(0),
        makeMessage(1),
        makeMessage(2, {
            mes: '[MEMORY SHARD: Messages 0-1]\n\nRecovered shard body',
            send_date: '2026-06-24T00:00:09.000Z',
        }),
    ];

    const manifest = await buildBackfilledManifestFromOutputMessage(messages, messages[2]);
    assert.equal(manifest.artifactKind, SHARD_ARTIFACT_KINDS.SYSTEM_SHARD);
    assert.equal(manifest.outputUID, '2026-06-24T00:00:09.000Z');
    assert.equal(manifest.promptPolicy, SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY);
    assert.deepEqual(manifest.sourceSelector, {
        mode: 'contiguous_interval',
        startMessageId: 'msg_00000000000000000000000000000001',
        endMessageId: 'msg_00000000000000000000000000000002',
        sourceCount: 2,
    });
});
