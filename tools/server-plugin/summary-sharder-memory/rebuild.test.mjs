import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildManagedShardManifest } from '../../../core/summarization/shard-integrity-core.js';
import {
    getStoragePaths,
    openOperationalDatabase,
} from './core.js';
import {
    initCandidateRebuildRun,
    loadCandidateRebuildReport,
    runCandidateRebuild,
} from './rebuild.js';
import { createNodeSqliteAdapter } from './sqlite-node.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-rebuild-'));
}

function makeMessageId(suffix) {
    return `msg_${suffix.padEnd(32, '0').slice(0, 32)}`;
}

async function writeArchitecturalChat(root, options = {}) {
    const memoryScopeId = options.memoryScopeId || 'scope_alpha';
    const chatInstanceId = options.chatInstanceId || 'chat_alpha';
    const chatsRoot = path.join(root, 'chats');
    const charDir = path.join(chatsRoot, 'Jeep');
    fs.mkdirSync(charDir, { recursive: true });
    const chatFilePath = path.join(charDir, 'Session A.jsonl');

    const messages = [
        {
            name: 'Chris',
            is_user: true,
            is_system: false,
            send_date: '2026-06-24T10:00:00.000Z',
            mes: 'We should keep browser-local state non-authoritative.',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('a1'),
                        initFingerprint: 'sha256:init-a1',
                        revisionHash: 'sha256:rev-a1',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'user:Chris',
                        sourceType: 'user',
                    },
                },
            },
        },
        {
            name: 'Jeep',
            is_user: false,
            is_system: false,
            send_date: '2026-06-24T10:00:05.000Z',
            mes: 'Agreed. The authority should live outside browser-local projection state.',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('b2'),
                        initFingerprint: 'sha256:init-b2',
                        revisionHash: 'sha256:rev-b2',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'character:jeep.png',
                        sourceType: 'character',
                    },
                },
            },
        },
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:00:10.000Z',
            mes: `[MEMORY SHARD: Messages 0-1]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: gain-modulation-boundary | DECISION: Keep browser-local state non-authoritative.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('c3'),
                        initFingerprint: 'sha256:init-c3',
                        revisionHash: 'sha256:rev-c3',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
    ];

    const manifest = await buildManagedShardManifest(messages, {
        startIndex: 0,
        endIndex: 1,
        artifactKind: 'system-shard',
        outputUID: messages[2].send_date,
        promptPolicy: 'replace_source',
        now: Date.now(),
        cryptoApi: globalThis.crypto,
    });

    const header = {
        chat_metadata: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    status: 'IDENTITY_COMPLETE',
                },
                architecturalMemoryBinding: {
                    memoryScopeId,
                    chatInstanceId,
                    chatId: 'Session A',
                    scopeAlias: '',
                    boundAt: Date.now(),
                    updatedAt: Date.now(),
                },
                shardManifests: [manifest],
            },
        },
        user_name: 'Chris',
        character_name: 'Jeep',
    };

    const lines = [JSON.stringify(header), ...messages.map((message) => JSON.stringify(message))];
    fs.writeFileSync(chatFilePath, `${lines.join('\n')}\n`, 'utf8');

    return { chatFilePath, memoryScopeId };
}

function buildRequest(root) {
    return {
        user: {
            directories: {
                root,
                chats: path.join(root, 'chats'),
                groupChats: path.join(root, 'group chats'),
            },
        },
    };
}

function fingerprintFiles(paths) {
    const result = {};
    for (const [key, filePath] of Object.entries({
        db: paths.dbPath,
        snapshot: paths.snapshotPath,
        state: paths.statePath,
        wal: `${paths.dbPath}-wal`,
        shm: `${paths.dbPath}-shm`,
    })) {
        result[key] = fs.existsSync(filePath)
            ? {
                bytes: fs.statSync(filePath).size,
                content: fs.readFileSync(filePath).toString('base64'),
            }
            : null;
    }
    return result;
}

function readTableNames(dbPath) {
    const adapter = createNodeSqliteAdapter(dbPath);
    try {
        return adapter.all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`).map((row) => row.name);
    } finally {
        adapter.close();
    }
}

function readScalar(dbPath, sql, params = []) {
    const adapter = createNodeSqliteAdapter(dbPath);
    try {
        return adapter.scalar(sql, params);
    } finally {
        adapter.close();
    }
}

test('candidate init freezes a manifest without creating live authority files', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);

    const first = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-a',
        now: Date.now(),
    });

    const second = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-a',
        now: Date.now(),
    });

    const livePaths = getStoragePaths(root);
    assert.equal(first.ok, true);
    assert.equal(first.manifest.memoryScopeId, memoryScopeId);
    assert.equal(first.manifest.corpusFiles.length, 1);
    assert.equal(first.manifest.artifacts.length, 1);
    assert.equal(first.manifest.artifacts[0].admissionStatus, 'admitted');
    assert.equal(second.idempotent, true);
    assert.equal(fs.existsSync(livePaths.dbPath), false);
    assert.equal(fs.existsSync(livePaths.snapshotPath), false);
    assert.equal(fs.existsSync(livePaths.statePath), false);
});

test('candidate run compiles admitted artifacts into isolated candidate state and emits a no-promotion report', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-b',
        now: Date.now(),
    });

    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const loaded = loadCandidateRebuildReport(request, init.manifest.reconstructionRunId);
    const livePaths = getStoragePaths(root);

    assert.equal(result.ok, true);
    assert.equal(result.report.status, 'success');
    assert.equal(result.report.promotionAvailable, false);
    assert.equal(result.report.liveAuthorityChanged, false);
    assert.equal(result.report.outputSummary.candidateAuthorityRecordCount, 1);
    assert.equal(result.report.determinism.attempted, true);
    assert.equal(result.report.determinism.equivalent, true);
    assert.equal(loaded.report.reconstructionRunId, init.manifest.reconstructionRunId);
    assert.match(result.report.candidateRelativePath, /^summary-sharder\/candidates\//);
    assert.equal(fs.existsSync(livePaths.dbPath), false);
    assert.equal(fs.existsSync(livePaths.snapshotPath), false);
    assert.equal(fs.existsSync(livePaths.statePath), false);
});

test('candidate run invalidates when the frozen corpus file changes before compile', async () => {
    const root = makeTempRoot();
    const { memoryScopeId, chatFilePath } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-c',
        now: Date.now(),
    });

    fs.appendFileSync(chatFilePath, '\n', 'utf8');

    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.report.status, 'invalidated_source_mutation');
    assert.equal(result.report.promotionAvailable, false);
});

test('live schema bootstrap does not create candidate-only reconstruction tables', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);
    const adapter = openOperationalDatabase(paths);
    try {
        const tables = adapter.all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`).map((row) => row.name);
        assert.equal(tables.includes('reconstruction_runs'), false);
        assert.equal(tables.includes('reconstruction_manifest_files'), false);
        assert.equal(tables.includes('reconstruction_candidate_provenance'), false);
    } finally {
        adapter.close();
    }
});

test('candidate bootstrap creates operational schema tables and candidate-only audit tables', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-d',
        now: Date.now(),
    });

    const candidateDbPath = path.join(root, init.manifest.candidateRelativePath);
    const tables = readTableNames(candidateDbPath);
    assert.equal(tables.includes('decision_records'), true);
    assert.equal(tables.includes('current_decisions'), true);
    assert.equal(tables.includes('chat_bindings'), true);
    assert.equal(tables.includes('reconstruction_runs'), true);
    assert.equal(tables.includes('reconstruction_manifest_files'), true);
    assert.equal(tables.includes('reconstruction_manifest_artifacts'), true);
});

test('candidate compilation writes authority into operational-shaped candidate tables', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-e',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });

    const candidateDbPath = path.join(root, init.manifest.candidateRelativePath);
    assert.equal(Number(readScalar(candidateDbPath, 'SELECT COUNT(*) FROM decision_records')), 1);
    assert.equal(Number(readScalar(candidateDbPath, 'SELECT COUNT(*) FROM current_decisions')), 1);
    assert.equal(Number(readScalar(candidateDbPath, 'SELECT COUNT(*) FROM reconstruction_candidate_provenance')), 1);
});

test('candidate build leaves live DB, snapshot, state marker, WAL, and SHM unchanged on success', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const paths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(paths);
    try {
        // create live files
    } finally {
        liveAdapter.close();
    }
    const before = fingerprintFiles(paths);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-f',
        now: Date.now(),
    });
    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const after = fingerprintFiles(paths);

    assert.equal(result.ok, true);
    assert.deepEqual(after, before);
    assert.equal(result.report.liveAuthorityChanged, false);
});

test('invalid candidate build leaves live DB artifacts unchanged and rejects rerun', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const chatFilePath = path.join(root, 'chats', 'Jeep', 'Session A.jsonl');
    const lines = fs.readFileSync(chatFilePath, 'utf8').trimEnd().split('\n');
    const secondShard = JSON.parse(lines[lines.length - 1]);
    secondShard.send_date = '2026-06-24T10:00:11.000Z';
    secondShard.extra.summary_sharder.messageIdentity.messageId = makeMessageId('d4');
    secondShard.extra.summary_sharder.messageIdentity.revisionHash = 'sha256:rev-d4';
    secondShard.mes = `[MEMORY SHARD: Messages 0-1]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: gain-modulation-boundary | DECISION: Make browser-local state authoritative.

===END===`;
    const header = JSON.parse(lines[0]);
    const messages = lines.slice(1).map((line) => JSON.parse(line));
    messages.push(secondShard);
    const secondManifest = await buildManagedShardManifest(messages, {
        startIndex: 0,
        endIndex: 1,
        artifactKind: 'system-shard',
        outputUID: secondShard.send_date,
        promptPolicy: 'replace_source',
        now: Date.now(),
        cryptoApi: globalThis.crypto,
    });
    header.chat_metadata.summary_sharder.shardManifests.push(secondManifest);
    fs.writeFileSync(chatFilePath, `${[JSON.stringify(header), ...messages.map((message) => JSON.stringify(message))].join('\n')}\n`, 'utf8');

    const paths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(paths);
    liveAdapter.close();
    const before = fingerprintFiles(paths);

    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-g',
        now: Date.now(),
    });
    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const after = fingerprintFiles(paths);

    assert.equal(result.ok, false);
    assert.equal(result.report.status, 'invalid');
    assert.equal(result.report.liveAuthorityChanged, false);
    assert.deepEqual(after, before);
    await assert.rejects(
        runCandidateRebuild(request, {
            reconstructionRunId: init.manifest.reconstructionRunId,
            now: Date.now(),
        }),
        /not ready to compile/i,
    );
});

test('one active candidate run per scope is enforced', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-h1',
        now: Date.now(),
    });

    await assert.rejects(
        initCandidateRebuildRun(request, {
            memoryScopeId,
            requestKey: 'req-h2',
            now: Date.now(),
        }),
        /already active/i,
    );
});

test('source mutation invalidation leaves live DB artifacts unchanged', async () => {
    const root = makeTempRoot();
    const { memoryScopeId, chatFilePath } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const paths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(paths);
    liveAdapter.close();
    const before = fingerprintFiles(paths);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-i',
        now: Date.now(),
    });
    fs.appendFileSync(chatFilePath, '\n', 'utf8');
    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const after = fingerprintFiles(paths);

    assert.equal(result.report.status, 'invalidated_source_mutation');
    assert.equal(result.report.liveAuthorityChanged, false);
    assert.deepEqual(after, before);
});
