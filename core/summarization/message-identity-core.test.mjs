import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMessageIdentitySnapshot,
    buildMessageInitFingerprint,
    buildMessageRevisionHash,
    reconcileMessageDeletionTombstones,
    reconcileMessageIdentityState,
    resolveMessageSpeakerIdentity,
} from './message-identity-core.js';
import {
    EVIDENCE_POLICY_INCLUDE,
    IDENTITY_STATUS_VALUES,
} from './message-identity-schema.js';

function makeCrypto() {
    return globalThis.crypto;
}

function makeDirectContext() {
    return {
        characterId: 0,
        characters: [{ avatar: 'Abigail.png', name: 'Abigail' }],
        name1: 'Chris',
    };
}

test('resolveMessageSpeakerIdentity binds group messages to original avatar', () => {
    const identity = resolveMessageSpeakerIdentity({
        name: 'Vera',
        is_user: false,
        original_avatar: 'Vera.png',
    }, { context: makeDirectContext() });

    assert.deepEqual(identity, {
        speakerEntityId: 'character:Vera.png',
        speakerPathAtInit: 'Vera.png',
        displayNameAtInit: 'Vera',
        sourceType: 'character',
    });
});

test('init fingerprint differs for duplicate text with distinct timestamps', async () => {
    const context = makeDirectContext();
    const messageA = {
        name: 'Abigail',
        is_user: false,
        send_date: '2026-04-15T06:53:36.798Z',
        mes: 'Hello there.',
    };
    const messageB = {
        ...messageA,
        send_date: '2026-04-15T06:53:37.798Z',
    };

    const a = await buildMessageInitFingerprint(messageA, { context, cryptoApi: makeCrypto() });
    const b = await buildMessageInitFingerprint(messageB, { context, cryptoApi: makeCrypto() });

    assert.notEqual(a, b);
});

test('revision hash changes when selected swipe changes', async () => {
    const context = makeDirectContext();
    const message = {
        name: 'Abigail',
        is_user: false,
        send_date: '2026-04-15T06:53:36.798Z',
        mes: 'Current text',
        swipes: ['First', 'Second'],
        swipe_info: [
            { send_date: '2026-04-15T06:53:36.798Z' },
            { send_date: '2026-04-15T06:53:40.000Z' },
        ],
        swipe_id: 0,
    };

    const a = await buildMessageRevisionHash(message, { context, cryptoApi: makeCrypto() });
    message.swipe_id = 1;
    message.mes = 'Second';
    const b = await buildMessageRevisionHash(message, { context, cryptoApi: makeCrypto() });

    assert.notEqual(a, b);
});

test('reconcileMessageIdentityState adopts missing ids and preserves existing anchors', async () => {
    const messages = [
        {
            name: 'Chris',
            is_user: true,
            is_system: false,
            send_date: '2026-04-15T06:51:57.721Z',
            mes: 'Hello?',
        },
        {
            name: 'Abigail',
            is_user: false,
            send_date: '2026-04-15T06:53:36.798Z',
            mes: 'Waiting.',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: 'msg_550e8400e29b41d4a716446655440000',
                    },
                },
            },
        },
    ];
    const chatMetadata = {};

    const result = await reconcileMessageIdentityState(messages, {
        chatMetadata,
        context: makeDirectContext(),
        now: 1782210204120,
        cryptoApi: makeCrypto(),
    });

    assert.equal(result.status, IDENTITY_STATUS_VALUES.COMPLETE);
    assert.equal(messages[0].extra.summary_sharder.evidencePolicy, EVIDENCE_POLICY_INCLUDE);
    assert.match(messages[0].extra.summary_sharder.messageIdentity.messageId, /^msg_[0-9a-f]{32}$/u);
    assert.equal(messages[1].extra.summary_sharder.messageIdentity.messageId, 'msg_550e8400e29b41d4a716446655440000');
    assert.ok(messages[0].extra.summary_sharder.messageIdentity.initFingerprint.startsWith('sha256:'));
    assert.ok(messages[0].extra.summary_sharder.messageIdentity.revisionHash.startsWith('sha256:'));
    assert.equal(chatMetadata.summary_sharder.messageIdentity.identifiedCount, 2);
    assert.equal(chatMetadata.summary_sharder.messageIdentity.unidentifiedCount, 0);
});

test('reconcileMessageIdentityState surfaces deterministic fingerprint collisions', async () => {
    const messages = [
        {
            name: 'Abigail',
            is_user: false,
            send_date: '2026-04-15T06:53:36.798Z',
            mes: 'Same text',
        },
        {
            name: 'Abigail',
            is_user: false,
            send_date: '2026-04-15T06:53:36.798Z',
            mes: 'Same text',
        },
    ];
    const chatMetadata = {};

    const result = await reconcileMessageIdentityState(messages, {
        chatMetadata,
        context: makeDirectContext(),
        cryptoApi: makeCrypto(),
    });

    assert.equal(result.status, IDENTITY_STATUS_VALUES.AMBIGUOUS);
    assert.ok(result.diagnostics.some((item) => item.code === 'MESSAGE_BOOTSTRAP_COLLISION'));
});

test('reconcileMessageDeletionTombstones records removed anchored ids without text retention', () => {
    const chatMetadata = {};
    const previous = buildMessageIdentitySnapshot([
        {
            name: 'Abigail',
            send_date: '2026-04-15T06:53:36.798Z',
            mes: 'Hello',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        messageId: 'msg_550e8400e29b41d4a716446655440000',
                        initFingerprint: 'sha256:init',
                        revisionHash: 'sha256:rev',
                    },
                },
            },
        },
    ], { chatId: 'chat-a' });

    const result = reconcileMessageDeletionTombstones(previous, [], chatMetadata, {
        now: Date.UTC(2026, 5, 23, 0, 0, 0),
    });

    assert.equal(result.added, 1);
    assert.equal(chatMetadata.summary_sharder.messageTombstones.length, 1);
    assert.deepEqual(chatMetadata.summary_sharder.messageTombstones[0], {
        schemaVersion: 1,
        messageId: 'msg_550e8400e29b41d4a716446655440000',
        deletedAt: '2026-06-23T00:00:00.000Z',
        lastRevisionHash: 'sha256:rev',
        deletionMode: 'source_content_deleted',
    });
});
