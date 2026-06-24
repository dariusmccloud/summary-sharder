import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    JOURNAL_MODE,
    MESSAGE_IDENTITY_SCAN_SCHEMA,
    SCHEMA_VERSION,
    SERVICE_VERSION,
    getStoragePaths,
    loadManifest,
    openOperationalDatabase,
    resolveChatJsonlPath,
    scanPersistedChatMetadata,
    snapshotOperationalDatabase,
    summarizePersistedChatMetadata,
} from './core.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-memory-'));
}

test('operational database initializes manifest and journal mode', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);
    const adapter = openOperationalDatabase(paths);

    try {
        const manifest = loadManifest(adapter);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        assert.equal(manifest.serviceVersion, SERVICE_VERSION);
        assert.equal(manifest.journalMode, JOURNAL_MODE);
        assert.equal(adapter.getJournalMode(), JOURNAL_MODE);
        assert.equal(fs.existsSync(paths.statePath), true);
    } finally {
        adapter.close();
    }
});

test('managed snapshot is created and verified', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);
    const adapter = openOperationalDatabase(paths);

    try {
        const manifest = snapshotOperationalDatabase(adapter, paths);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        assert.equal(fs.existsSync(paths.snapshotPath), true);
    } finally {
        adapter.close();
    }
});

test('corrupt operational database restores from verified snapshot', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.writeFileSync(paths.dbPath, Buffer.from('corrupt-db'));

    const restored = openOperationalDatabase(paths);
    try {
        const manifest = loadManifest(restored);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        const quarantineFiles = fs.readdirSync(paths.storageRoot).filter((name) => name.includes('.quarantine.'));
        assert.equal(quarantineFiles.length > 0, true);
    } finally {
        restored.close();
    }
});

test('missing valid snapshot after corruption reaches rebuild boundary', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.writeFileSync(paths.dbPath, Buffer.from('corrupt-db'));
    fs.writeFileSync(paths.snapshotPath, Buffer.from('corrupt-snapshot'));

    assert.throws(
        () => openOperationalDatabase(paths),
        /requires rebuild/i,
    );
});

test('missing operational database restores from verified snapshot', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.rmSync(paths.dbPath, { force: true });

    const restored = openOperationalDatabase(paths);
    try {
        const manifest = loadManifest(restored);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
    } finally {
        restored.close();
    }
});

test('missing operational database and snapshot fail closed after adoption', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.rmSync(paths.dbPath, { force: true });
    fs.rmSync(paths.snapshotPath, { force: true });

    assert.throws(
        () => openOperationalDatabase(paths),
        /requires rebuild/i,
    );
});

test('persisted chat metadata scan summarizes namespaced message state without mutation', () => {
    const root = makeTempRoot();
    const chatsRoot = path.join(root, 'chats');
    const charDir = path.join(chatsRoot, 'Jeep');
    fs.mkdirSync(charDir, { recursive: true });

    const chatFilePath = path.join(charDir, 'Session A.jsonl');
    const lines = [
        JSON.stringify({
            chat_metadata: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        status: 'IDENTITY_PARTIAL',
                    },
                },
            },
            user_name: 'unused',
            character_name: 'unused',
        }),
        JSON.stringify({
            is_user: true,
            is_system: false,
            mes: 'hello',
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
                        speakerEntityId: 'user',
                    },
                },
            },
        }),
        JSON.stringify({
            is_user: false,
            is_system: true,
            mes: 'hidden',
            swipes: ['a', 'b'],
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
        }),
    ];
    fs.writeFileSync(chatFilePath, `${lines.join('\n')}\n`, 'utf8');

    const request = {
        user: {
            directories: {
                chats: chatsRoot,
                groupChats: path.join(root, 'group chats'),
            },
        },
    };

    const result = scanPersistedChatMetadata(request, {
        avatarUrl: 'Jeep.png',
        chatLocator: 'Session A',
    });

    assert.equal(result.file.fileName, 'Session A.jsonl');
    assert.equal(result.summary.schema.messageIdentityPath, MESSAGE_IDENTITY_SCAN_SCHEMA.messageIdentityPath);
    assert.equal(result.summary.headerPresent, true);
    assert.equal(result.summary.messageCount, 2);
    assert.equal(result.summary.promptHiddenCount, 1);
    assert.equal(result.summary.identity.presentCount, 2);
    assert.equal(result.summary.archive.archivedCount, 1);
    assert.equal(result.summary.evidencePolicy.excludeCount, 1);
    assert.equal(result.summary.speakerIdentityCount, 1);
    assert.equal(result.summary.chatIdentityStatus.status, 'IDENTITY_PARTIAL');
});

test('chat path resolver supports group and character chats without arbitrary paths', () => {
    const request = {
        user: {
            directories: {
                chats: 'C:\\data\\chats',
                groupChats: 'C:\\data\\group chats',
            },
        },
    };

    const direct = resolveChatJsonlPath(request, {
        avatarUrl: 'Jeep.png',
        chatLocator: 'Session A',
    });
    const group = resolveChatJsonlPath(request, {
        isGroup: true,
        groupId: 'group-123',
        chatLocator: 'group-123',
    });

    assert.match(direct.chatFilePath, /Jeep[\\/]Session A\.jsonl$/);
    assert.match(group.chatFilePath, /group chats[\\/]group-123\.jsonl$/);
    assert.throws(
        () => resolveChatJsonlPath(request, { avatarUrl: '..\\bad.png', chatLocator: 'x' }),
        /(invalid|path separators)/i,
    );
});

test('persisted chat metadata summary tracks duplicate ids and unexpected evidence values', () => {
    const summary = summarizePersistedChatMetadata([
        { chat_metadata: {} },
        {
            is_system: false,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        messageId: 'msg_dup',
                        initFingerprint: 'sha256:a',
                        revisionHash: 'sha256:b',
                    },
                    evidencePolicy: 'surprising',
                },
            },
        },
        {
            is_system: false,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        messageId: 'msg_dup',
                        initFingerprint: 'sha256:c',
                        revisionHash: 'sha256:d',
                    },
                },
            },
        },
        {
            is_system: false,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        messageId: '',
                        initFingerprint: '',
                        revisionHash: '',
                    },
                },
            },
        },
    ], []);

    assert.deepEqual(summary.identity.duplicateIds, ['msg_dup']);
    assert.equal(summary.identity.malformedCount, 1);
    assert.deepEqual(summary.evidencePolicy.unexpectedValues, ['surprising']);
});
