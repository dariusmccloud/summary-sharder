import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
    EVIDENCE_POLICY_EXCLUDE,
    EVIDENCE_POLICY_INCLUDE,
    MESSAGE_IDENTITY_SCHEMA_VERSION,
    getMessageIdentitySchemaDescriptor,
    summarizeMessageIdentitySurface,
} from './message-identity-schema.js';

test('message identity schema descriptor exposes namespaced paths and defaults', () => {
    const descriptor = getMessageIdentitySchemaDescriptor();

    assert.equal(descriptor.namespace, 'summary_sharder');
    assert.equal(descriptor.messageIdentity.schemaVersion, MESSAGE_IDENTITY_SCHEMA_VERSION);
    assert.equal(descriptor.chatIdentityStatus.schemaVersion, CHAT_IDENTITY_STATUS_SCHEMA_VERSION);
    assert.equal(descriptor.messageIdentity.path, 'extra.summary_sharder.messageIdentity');
    assert.equal(descriptor.archive.path, 'extra.summary_sharder.archive');
    assert.equal(descriptor.evidencePolicy.defaultValue, EVIDENCE_POLICY_INCLUDE);
    assert.deepEqual(descriptor.evidencePolicy.allowedValues, [EVIDENCE_POLICY_INCLUDE, EVIDENCE_POLICY_EXCLUDE]);
    assert.equal(descriptor.promptVisibility.hostField, 'is_system');
});

test('message identity surface summary preserves independent hidden archive and evidence-policy counts', () => {
    const messages = [
        {
            is_system: false,
            mes: 'A',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: 'msg_alpha',
                        initFingerprint: 'sha256:init-a',
                        revisionHash: 'sha256:rev-a',
                    },
                    evidencePolicy: 'include',
                    speakerIdentity: {
                        speakerEntityId: 'char_jeep',
                    },
                },
            },
        },
        {
            is_system: true,
            mes: 'B',
            swipes: ['b1', 'b2'],
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: 'msg_beta',
                        initFingerprint: 'sha256:init-b',
                        revisionHash: 'sha256:rev-b',
                    },
                    archive: {
                        isArchived: true,
                        archivedAt: '2026-06-23T00:00:00.000Z',
                        promptVisibilityBeforeArchive: 'hidden',
                    },
                    evidencePolicy: 'exclude',
                },
            },
        },
        {
            is_system: false,
            mes: 'C',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: 'msg_alpha',
                        initFingerprint: 'sha256:init-c',
                        revisionHash: 'sha256:rev-c',
                    },
                },
            },
        },
        {
            is_system: false,
            mes: 'D',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: '',
                        initFingerprint: 'sha256:init-d',
                        revisionHash: '',
                    },
                },
            },
        },
        {
            is_system: false,
            mes: 'E',
        },
    ];

    const chatMetadata = {
        summary_sharder: {
            messageIdentity: {
                schemaVersion: 1,
                status: 'IDENTITY_PARTIAL',
                identifiedCount: 3,
                unidentifiedCount: 2,
            },
        },
    };

    const summary = summarizeMessageIdentitySurface(messages, chatMetadata);

    assert.equal(summary.messageCount, 5);
    assert.equal(summary.promptHiddenCount, 1);
    assert.equal(summary.swipeCarrierCount, 1);
    assert.equal(summary.identity.presentCount, 3);
    assert.equal(summary.identity.missingCount, 1);
    assert.equal(summary.identity.malformedCount, 1);
    assert.deepEqual(summary.identity.duplicateIds, ['msg_alpha']);
    assert.equal(summary.archive.archivedCount, 1);
    assert.equal(summary.archive.promptVisibilityBeforeArchiveCount, 1);
    assert.equal(summary.evidencePolicy.includeCount, 4);
    assert.equal(summary.evidencePolicy.excludeCount, 1);
    assert.equal(summary.speakerIdentityCount, 1);
    assert.equal(summary.chatIdentityStatus.status, 'IDENTITY_PARTIAL');
});
