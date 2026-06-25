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
    cleanupCandidateRebuildArtifacts as cleanupCandidateArtifacts,
    computePersistedCanonicalCandidateState,
    initCandidateRebuildRun,
    listCandidateRebuildRuns as listCandidateRuns,
    loadCandidateRebuildReport,
    normalizeComparableDumpForHash,
    runCandidateRebuild,
    setCandidateRebuildPinned,
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

async function appendConflictingArchitecturalShard(root, chatFilePath) {
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
}

async function writeArchitecturalChatWithShardMessages(root, shardMessages, options = {}) {
    const memoryScopeId = options.memoryScopeId || 'scope_alpha';
    const chatInstanceId = options.chatInstanceId || 'chat_alpha';
    const chatsRoot = path.join(root, 'chats');
    const charDir = path.join(chatsRoot, 'Jeep');
    fs.mkdirSync(charDir, { recursive: true });
    const chatFilePath = path.join(charDir, `${options.chatFileName || 'Session B'}.jsonl`);

    const sourceMessage = {
        name: 'Chris',
        is_user: true,
        is_system: false,
        send_date: '2026-06-24T10:00:00.000Z',
        mes: options.sourceMes || 'Source discussion.',
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('aa1'),
                    initFingerprint: 'sha256:init-aa1',
                    revisionHash: 'sha256:rev-aa1',
                },
                speakerIdentity: {
                    speakerEntityId: 'user:Chris',
                    sourceType: 'user',
                },
            },
        },
    };

    const messages = [sourceMessage];
    const shardManifests = [];
    for (const shardMessage of shardMessages) {
        messages.push(shardMessage);
        const manifest = await buildManagedShardManifest(messages, {
            startIndex: 0,
            endIndex: 0,
            artifactKind: 'system-shard',
            outputUID: shardMessage.send_date,
            promptPolicy: 'replace_source',
            now: Date.now(),
            cryptoApi: globalThis.crypto,
        });
        shardManifests.push(manifest);
    }

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
                    chatId: options.chatFileName || 'Session B',
                    scopeAlias: '',
                    boundAt: Date.now(),
                    updatedAt: Date.now(),
                    branchedFromChatInstanceId: options.branchedFromChatInstanceId || null,
                    importedFromChatInstanceId: options.importedFromChatInstanceId || null,
                },
                shardManifests,
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

function seedLiveAuthorityFromCandidate(root, candidateDbPath, memoryScopeId) {
    const candidateAdapter = createNodeSqliteAdapter(candidateDbPath);
    const livePaths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(livePaths);
    try {
        liveAdapter.run('DELETE FROM current_decisions WHERE memory_scope_id = ?', [memoryScopeId]);
        liveAdapter.run('DELETE FROM decision_records WHERE memory_scope_id = ?', [memoryScopeId]);
        liveAdapter.run('DELETE FROM chat_bindings WHERE memory_scope_id = ?', [memoryScopeId]);
        liveAdapter.run('DELETE FROM memory_scopes WHERE memory_scope_id = ?', [memoryScopeId]);

        for (const row of candidateAdapter.all('SELECT * FROM memory_scopes WHERE memory_scope_id = ?', [memoryScopeId])) {
            liveAdapter.run(
                'INSERT INTO memory_scopes (memory_scope_id, scope_alias, scope_version, current_scope_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                [row.memory_scope_id, row.scope_alias, row.scope_version, row.current_scope_run, row.created_at, row.updated_at],
            );
        }
        for (const row of candidateAdapter.all('SELECT * FROM chat_bindings WHERE memory_scope_id = ?', [memoryScopeId])) {
            liveAdapter.run(
                `INSERT INTO chat_bindings (
                    chat_instance_id, memory_scope_id, chat_locator, scope_alias,
                    branched_from_chat_instance_id, imported_from_chat_instance_id, bound_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.chat_instance_id,
                    row.memory_scope_id,
                    row.chat_locator,
                    row.scope_alias,
                    row.branched_from_chat_instance_id,
                    row.imported_from_chat_instance_id,
                    row.bound_at,
                    row.updated_at,
                ],
            );
        }
        for (const row of candidateAdapter.all('SELECT * FROM decision_records WHERE memory_scope_id = ?', [memoryScopeId])) {
            liveAdapter.run(
                `INSERT INTO decision_records (
                    memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
                    hash_algorithm, semantic_payload, fields_json, status, prior_version,
                    source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.memory_scope_id,
                    row.decision_id,
                    row.record_version,
                    row.canonical_hash,
                    row.canonical_hash_version,
                    row.hash_algorithm,
                    row.semantic_payload,
                    row.fields_json,
                    row.status,
                    row.prior_version,
                    row.source_chat_instance_id,
                    row.last_updating_chat_instance_id,
                    row.provenance_json,
                    row.created_at,
                    row.updated_at,
                ],
            );
        }
        for (const row of candidateAdapter.all('SELECT * FROM current_decisions WHERE memory_scope_id = ?', [memoryScopeId])) {
            liveAdapter.run(
                `INSERT INTO current_decisions (
                    memory_scope_id, decision_id, current_record_version, canonical_hash, canonical_hash_version,
                    hash_algorithm, authority_location, archive_pointer_json, stub_pointer_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.memory_scope_id,
                    row.decision_id,
                    row.current_record_version,
                    row.canonical_hash,
                    row.canonical_hash_version,
                    row.hash_algorithm,
                    row.authority_location,
                    row.archive_pointer_json,
                    row.stub_pointer_json,
                    row.updated_at,
                ],
            );
        }
    } finally {
        liveAdapter.close();
        candidateAdapter.close();
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
    assert.equal(result.report.determinism.canonicalHashFinal, true);
    assert.equal(loaded.report.reconstructionRunId, init.manifest.reconstructionRunId);
    assert.match(result.report.candidateRelativePath, /^summary-sharder\/candidates\//);
    const candidateDbPath = path.join(root, result.report.candidateRelativePath);
    const persistedHash = computePersistedCanonicalCandidateState(candidateDbPath);
    const persistedHashSecondRead = computePersistedCanonicalCandidateState(candidateDbPath);
    assert.equal(result.report.determinism.canonicalCandidateHash, persistedHash.canonicalCandidateHash);
    assert.equal(persistedHashSecondRead.canonicalCandidateHash, persistedHash.canonicalCandidateHash);
    assert.equal(result.report.determinism.canonicalByteLength, persistedHash.canonicalByteLength);
    assert.equal(result.report.promotionQualification.completed, true);
    assert.equal(result.report.promotionQualification.authorization.promotionAvailable, false);
    assert.equal(result.report.promotionQualification.live.dbPresent, false);
    assert.equal(result.report.promotionQualification.live.generationIdentity, `live:${memoryScopeId}:run:0`);
    assert.equal(result.report.promotionQualification.structuralDiff.addedRecordCount > 0, true);
    assert.equal(result.report.promotionQualification.eligibility.eligible, true);
    assert.equal(typeof result.report.promotionQualification.boundEvidenceDigest, 'string');
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
    assert.equal(result.report.determinism.canonicalCandidateHash, null);
    assert.equal(result.report.determinism.canonicalHashFinal, false);
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
    assert.equal(result.report.promotionQualification.live.dbPresent, true);
});

test('candidate qualification compares against matching live authority without mutating it', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);

    const first = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-fq1',
        now: Date.now(),
    });
    const firstResult = await runCandidateRebuild(request, {
        reconstructionRunId: first.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const firstCandidateDbPath = path.join(root, firstResult.report.candidateRelativePath);
    seedLiveAuthorityFromCandidate(root, firstCandidateDbPath, memoryScopeId);

    const paths = getStoragePaths(root);
    const before = fingerprintFiles(paths);

    const second = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-fq2',
        now: Date.now(),
    });
    const secondResult = await runCandidateRebuild(request, {
        reconstructionRunId: second.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const after = fingerprintFiles(paths);

    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.report.promotionQualification.live.dbPresent, true);
    assert.equal(secondResult.report.promotionQualification.structuralDiff.equal, true);
    assert.equal(secondResult.report.promotionQualification.structuralDiff.addedRecordCount, 0);
    assert.equal(secondResult.report.promotionQualification.structuralDiff.removedRecordCount, 0);
    assert.equal(secondResult.report.promotionQualification.structuralDiff.changedRecordCount, 0);
    assert.equal(secondResult.report.promotionQualification.eligibility.eligible, true);
    assert.equal(
        secondResult.report.promotionQualification.candidate.authoritySurfaceHash,
        secondResult.report.promotionQualification.live.canonicalAuthorityHash,
    );
    assert.deepEqual(after, before);
});

test('invalid candidate build leaves live DB artifacts unchanged and rejects rerun', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const chatFilePath = path.join(root, 'chats', 'Jeep', 'Session A.jsonl');
    await appendConflictingArchitecturalShard(root, chatFilePath);

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
    assert.equal(result.report.executionSummary.compileCompleted, true);
    assert.equal(result.report.executionSummary.tier2ExtractionCompleted, true);
    assert.equal(result.report.candidateValidity.valid, false);
    assert.equal(result.report.candidateValidity.structuralBlockers.some((entry) => entry.code === 'REBUILD_UNRESOLVED_SEMANTIC_CONFLICT'), true);
    assert.equal(result.report.occurrenceGroups.some((entry) => entry.occurrenceClassification === 'UNRESOLVED_SEMANTIC_CONFLICT'), true);
    assert.equal(result.report.promotionQualification.completed, true);
    assert.equal(result.report.promotionQualification.eligibility.eligible, false);
    assert.equal(result.report.promotionQualification.eligibility.reasons.some((entry) => entry.code === 'CANDIDATE_RUN_NOT_SUCCESSFUL'), true);
    assert.equal(result.report.promotionQualification.eligibility.reasons.some((entry) => entry.code === 'CANDIDATE_INVALID'), true);
    const candidateDbPath = path.join(root, result.report.candidateRelativePath);
    const persistedHash = computePersistedCanonicalCandidateState(candidateDbPath);
    assert.equal(result.report.determinism.canonicalHashFinal, true);
    assert.equal(result.report.determinism.canonicalCandidateHash, persistedHash.canonicalCandidateHash);
    assert.deepEqual(after, before);
    await assert.rejects(
        runCandidateRebuild(request, {
            reconstructionRunId: init.manifest.reconstructionRunId,
            now: Date.now(),
        }),
        /not ready to compile/i,
    );
});

test('occurrence group ids remain stable across repeated runs on the same frozen corpus', async () => {
    const root = makeTempRoot();
    const duplicateShard = {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: '2026-06-24T10:12:00.000Z',
        mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: stable-group-decision | DECISION: Preserve the same semantic occurrence across runs.

===END===`,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('e55'),
                    initFingerprint: 'sha256:init-e55',
                    revisionHash: 'sha256:rev-e55',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    };
    await writeArchitecturalChatWithShardMessages(root, [duplicateShard], {
        memoryScopeId: 'scope_stable',
        chatInstanceId: 'chat_parent',
        chatFileName: 'Stable Parent',
        sourceMes: 'Parent source.',
    });
    await writeArchitecturalChatWithShardMessages(root, [{
        ...duplicateShard,
        send_date: '2026-06-24T10:12:10.000Z',
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('f66'),
                    initFingerprint: 'sha256:init-f66',
                    revisionHash: 'sha256:rev-f66',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    }], {
        memoryScopeId: 'scope_stable',
        chatInstanceId: 'chat_branch',
        branchedFromChatInstanceId: 'chat_parent',
        chatFileName: 'Stable Branch',
        sourceMes: 'Branch source.',
    });

    const request = buildRequest(root);
    const firstInit = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_stable', requestKey: 'stable-run-1', now: Date.now() });
    const firstRun = await runCandidateRebuild(request, { reconstructionRunId: firstInit.manifest.reconstructionRunId, now: Date.now() });
    const secondInit = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_stable', requestKey: 'stable-run-2', now: Date.now() });
    const secondRun = await runCandidateRebuild(request, { reconstructionRunId: secondInit.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(firstRun.ok, true);
    assert.equal(secondRun.ok, true);
    assert.equal(firstRun.report.occurrenceGroups.length, 1);
    assert.equal(secondRun.report.occurrenceGroups.length, 1);
    assert.equal(firstRun.report.occurrenceGroups[0].collisionEvidenceGroupId, secondRun.report.occurrenceGroups[0].collisionEvidenceGroupId);
    assert.equal(firstRun.report.occurrenceGroups[0].canonicalRecordId, secondRun.report.occurrenceGroups[0].canonicalRecordId);
});

test('duplicate copied evidence collapses into one member row without changing candidate validity', async () => {
    const root = makeTempRoot();
    const duplicateShard = {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: '2026-06-24T10:12:00.000Z',
        mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: duplicate-copied-evidence | DECISION: Collapse copied stable evidence without duplicating authority.

===END===`,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('dup1'),
                    initFingerprint: 'sha256:init-dup1',
                    revisionHash: 'sha256:rev-dup1',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    };

    await writeArchitecturalChatWithShardMessages(root, [duplicateShard], {
        memoryScopeId: 'scope_duplicate_copy',
        chatInstanceId: 'chat_duplicate_copy',
        chatFileName: 'Duplicate Copy A',
        sourceMes: 'Duplicate copy source.',
    });
    await writeArchitecturalChatWithShardMessages(root, [duplicateShard], {
        memoryScopeId: 'scope_duplicate_copy',
        chatInstanceId: 'chat_duplicate_copy',
        chatFileName: 'Duplicate Copy B',
        sourceMes: 'Duplicate copy source.',
    });

    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_duplicate_copy', requestKey: 'duplicate-copy', now: Date.now() });
    const result = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(result.ok, true);
    assert.equal(result.report.occurrenceGroups.length, 1);
    assert.equal(result.report.occurrenceGroups[0].occurrenceClassification, 'DUPLICATE_OCCURRENCE');
    assert.equal(result.report.occurrenceGroups[0].members.length, 1);
    assert.equal(result.report.occurrenceGroups[0].details.rawMemberCount, 2);
    assert.equal(result.report.occurrenceGroups[0].details.uniqueMemberCount, 1);
    assert.equal(result.report.occurrenceGroups[0].members[0].details.duplicateSourceCount, 2);
    assert.equal('sourceId' in result.report.occurrenceGroups[0].members[0].details.duplicateCopies[0], false);
    assert.equal(result.report.outputSummary.candidateAuthorityRecordCount, 1);
});

test('comparable dump normalization ignores runtime-only duplicate copy source ids', () => {
    const left = normalizeComparableDumpForHash({
        reconstruction_occurrence_group_members: [{
            member_evidence_id: 'evidencev1:sha256:left',
            details_json: JSON.stringify({
                duplicateSourceCount: 1,
                duplicateCopies: [{
                    sourceId: 'src_left',
                    sourceManifestId: 'manifest:system-shard:a',
                    artifactMessageId: 'msg_a',
                    chatInstanceId: 'chat_a',
                }],
            }),
        }],
    });
    const right = normalizeComparableDumpForHash({
        reconstruction_occurrence_group_members: [{
            member_evidence_id: 'evidencev1:sha256:left',
            details_json: JSON.stringify({
                duplicateSourceCount: 1,
                duplicateCopies: [{
                    sourceId: 'src_right',
                    sourceManifestId: 'manifest:system-shard:a',
                    artifactMessageId: 'msg_a',
                    chatInstanceId: 'chat_a',
                }],
            }),
        }],
    });

    assert.deepEqual(left, right);
});

test('malformed same-version member blocks canonicalization while preserving occurrence evidence', async () => {
    const root = makeTempRoot();
    const shardMessages = [
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:13:00.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: malformed-version-decision | RECORD-VERSION: 1 | DECISION: Keep the candidate deterministic.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('g77'),
                        initFingerprint: 'sha256:init-g77',
                        revisionHash: 'sha256:rev-g77',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:13:10.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: malformed-version-decision | RECORD-VERSION: not-a-number | DECISION: Keep the candidate deterministic.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('h88'),
                        initFingerprint: 'sha256:init-h88',
                        revisionHash: 'sha256:rev-h88',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
    ];
    const { memoryScopeId } = await writeArchitecturalChatWithShardMessages(root, shardMessages, {
        chatFileName: 'Malformed Member',
        sourceMes: 'Malformed metadata should block the group.',
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId, requestKey: 'req-malformed', now: Date.now() });
    const result = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(result.ok, false);
    assert.equal(result.report.occurrenceGroups.some((entry) => entry.occurrenceClassification === 'MALFORMED_STRUCTURED_RECORD'), true);
    assert.equal(result.report.occurrenceGroups.some((entry) => entry.canonicalRecordId === null), true);
    assert.equal(result.report.candidateValidity.structuralBlockers.some((entry) => entry.code === 'REBUILD_MALFORMED_STRUCTURED_RECORD'), true);
});

test('duplicate occurrence may coexist with a valid version chain', async () => {
    const root = makeTempRoot();
    const versionOneShard = {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: '2026-06-24T10:14:00.000Z',
        mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: chained-duplicate-decision | RECORD-VERSION: 1 | DECISION: Preserve duplicate provenance inside a versioned chain.

===END===`,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('i99'),
                    initFingerprint: 'sha256:init-i99',
                    revisionHash: 'sha256:rev-i99',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    };
    await writeArchitecturalChatWithShardMessages(root, [versionOneShard], {
        memoryScopeId: 'scope_chain_duplicate',
        chatInstanceId: 'chat_chain_parent',
        chatFileName: 'Chain Parent',
        sourceMes: 'Parent version one.',
    });
    await writeArchitecturalChatWithShardMessages(root, [{
        ...versionOneShard,
        send_date: '2026-06-24T10:14:05.000Z',
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('j0a'),
                    initFingerprint: 'sha256:init-j0a',
                    revisionHash: 'sha256:rev-j0a',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    }], {
        memoryScopeId: 'scope_chain_duplicate',
        chatInstanceId: 'chat_chain_branch',
        branchedFromChatInstanceId: 'chat_chain_parent',
        chatFileName: 'Chain Branch',
        sourceMes: 'Branch duplicate version one.',
    });
    await writeArchitecturalChatWithShardMessages(root, [{
        ...versionOneShard,
        send_date: '2026-06-24T10:14:10.000Z',
        mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: chained-duplicate-decision | RECORD-VERSION: 2 | PRIOR-VERSION: 1 | DECISION: Preserve duplicate provenance inside a versioned chain.

===END===`,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId('k1b'),
                    initFingerprint: 'sha256:init-k1b',
                    revisionHash: 'sha256:rev-k1b',
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
    }], {
        memoryScopeId: 'scope_chain_duplicate',
        chatInstanceId: 'chat_chain_update',
        chatFileName: 'Chain Update',
        sourceMes: 'Version two.',
    });

    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_chain_duplicate', requestKey: 'req-chain-duplicate', now: Date.now() });
    const result = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(result.ok, true);
    assert.equal(result.report.occurrenceGroups.some((entry) => entry.occurrenceClassification === 'BRANCH_LINEAGE_DUPLICATE'), true);
    assert.equal(result.report.versionLifecycleGroups.some((entry) => entry.versionLifecycleClassification === 'VALID_VERSION_CHAIN'), true);
});

test('version-hinted structured records classify as a valid version lifecycle chain', async () => {
    const root = makeTempRoot();
    const shardMessages = [
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:10:00.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: gain-modulation-boundary | RECORD-VERSION: 1 | DECISION: Keep browser-local state non-authoritative.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('a11'),
                        initFingerprint: 'sha256:init-a11',
                        revisionHash: 'sha256:rev-a11',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:10:10.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: gain-modulation-boundary | RECORD-VERSION: 2 | PRIOR-VERSION: 1 | DECISION: Keep browser-local state non-authoritative.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('b22'),
                        initFingerprint: 'sha256:init-b22',
                        revisionHash: 'sha256:rev-b22',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
    ];
    const { memoryScopeId } = await writeArchitecturalChatWithShardMessages(root, shardMessages, {
        chatFileName: 'Version Chain',
        sourceMes: 'We refined the same decision.',
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId, requestKey: 'req-version-chain', now: Date.now() });
    const result = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(result.ok, true);
    assert.equal(result.report.versionLifecycleGroups.length, 1);
    assert.equal(result.report.versionLifecycleGroups[0].versionLifecycleClassification, 'VALID_VERSION_CHAIN');
    assert.equal(result.report.occurrenceGroups.every((entry) => entry.blocking === false), true);
    assert.equal(result.report.outputSummary.candidateAuthorityRecordCount, 2);
});

test('explicit structured supersession links classify as a valid supersession chain', async () => {
    const root = makeTempRoot();
    const shardMessages = [
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:11:00.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: SUPERSEDED | ID: browser-local-authority | SUPERSEDED-BY: db-authority | DECISION: Keep browser-local state authoritative.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('c33'),
                        initFingerprint: 'sha256:init-c33',
                        revisionHash: 'sha256:rev-c33',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: '2026-06-24T10:11:10.000Z',
            mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: db-authority | SUPERSEDES: browser-local-authority | DECISION: Move authority into the operational database.

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId('d44'),
                        initFingerprint: 'sha256:init-d44',
                        revisionHash: 'sha256:rev-d44',
                    },
                    speakerIdentity: {
                        speakerEntityId: 'system:system',
                        sourceType: 'system',
                    },
                },
            },
        },
    ];
    const { memoryScopeId } = await writeArchitecturalChatWithShardMessages(root, shardMessages, {
        chatFileName: 'Supersession Chain',
        sourceMes: 'We replaced one decision with another.',
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId, requestKey: 'req-supersession-chain', now: Date.now() });
    const result = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(result.ok, true);
    assert.equal(result.report.supersessionComponents.length, 1);
    assert.equal(result.report.supersessionComponents[0].supersessionLifecycleClassification, 'VALID_SUPERSESSION_CHAIN');
    assert.equal(result.report.candidateValidity.valid, true);
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

test('successful candidate report includes artifact admissions, candidate records, provenance, and retention state', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-j',
        now: Date.now(),
    });

    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.report.artifactAdmissions.length, 1);
    assert.equal(result.report.artifactAdmissions[0].admissionStatus, 'admitted');
    assert.equal(result.report.candidateRecords.length, 1);
    assert.equal(result.report.candidateRecords[0].decisionId, 'gain-modulation-boundary');
    assert.equal(result.report.candidateRecords[0].provenance.length, 1);
    assert.equal(result.report.candidateRecords[0].provenance[0].coveredSourceMessageIds.length > 0, true);
    assert.deepEqual(result.report.issues, []);
    assert.equal(result.report.retention.cleanupEligible, false);
    assert.deepEqual(result.report.retention.retainedBecause, ['latest_success']);
});

test('meaningful persisted candidate mutation changes the canonical hash', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-j-hash-mutation',
        now: Date.now(),
    });

    const result = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const candidateDbPath = path.join(root, result.report.candidateRelativePath);
    const before = computePersistedCanonicalCandidateState(candidateDbPath);
    const adapter = createNodeSqliteAdapter(candidateDbPath);
    try {
        adapter.run(
            'UPDATE decision_records SET status = ? WHERE memory_scope_id = ? AND decision_id = ?',
            ['ACCEPTED', memoryScopeId, 'gain-modulation-boundary'],
        );
    } finally {
        adapter.close();
    }
    const after = computePersistedCanonicalCandidateState(candidateDbPath);
    assert.notEqual(before.canonicalCandidateHash, after.canonicalCandidateHash);
});

test('failed candidate run emits a retrievable failed report', async () => {
    const root = makeTempRoot();
    const { memoryScopeId, chatFilePath } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-k',
        now: Date.now(),
    });

    fs.rmSync(chatFilePath, { force: true });

    await assert.rejects(
        runCandidateRebuild(request, {
            reconstructionRunId: init.manifest.reconstructionRunId,
            now: Date.now(),
        }),
        /ENOENT|no such file/i,
    );

    const loaded = loadCandidateRebuildReport(request, init.manifest.reconstructionRunId);
    assert.equal(loaded.report.status, 'failed');
    assert.equal(loaded.report.promotionAvailable, false);
    assert.equal(loaded.report.failure.code.length > 0, true);
    assert.equal(loaded.report.retention.cleanupEligible, false);
    assert.deepEqual(loaded.report.retention.retainedBecause, ['latest_non_success']);
    assert.equal(loaded.report.determinism.canonicalCandidateHash, null);
    assert.equal(loaded.report.determinism.canonicalHashFinal, false);
});

test('older candidate reports load without C0.5C arrays and preserve historical blockers verbatim', () => {
    const root = makeTempRoot();
    const request = buildRequest(root);
    const reconstructionRunId = 'rebuild_legacy000000000000000000000000';
    const storageRoot = getStoragePaths(root).storageRoot;
    const candidatesRoot = path.join(storageRoot, 'candidates');
    fs.mkdirSync(candidatesRoot, { recursive: true });
    const baseName = `architectural-memory.candidate.${reconstructionRunId}`;
    const reportPath = path.join(candidatesRoot, `${baseName}.report.json`);

    fs.writeFileSync(reportPath, JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        reconstructionRunId,
        memoryScopeId: 'scope_legacy',
        status: 'invalid',
        candidateArtifactId: `candidate_${reconstructionRunId}`,
        candidateRelativePath: `summary-sharder/candidates/${baseName}.db`,
        manifestRelativePath: `summary-sharder/candidates/${baseName}.manifest.json`,
        reportRelativePath: `summary-sharder/candidates/${baseName}.report.json`,
        liveAuthorityChanged: false,
        promotionAvailable: false,
        tier2Claims: [],
        conflicts: [],
        issues: [{
            issueId: 'issue_legacy',
            severity: 'error',
            code: 'REBUILD_DECISION_COLLISION',
            message: 'legacy generic blocker',
            sourceId: 'src_legacy',
            details: {},
        }],
    }, null, 2));

    const loaded = loadCandidateRebuildReport(request, reconstructionRunId);
    assert.equal(loaded.report.issues[0].code, 'REBUILD_DECISION_COLLISION');
    assert.equal(Object.prototype.hasOwnProperty.call(loaded.report, 'occurrenceGroups'), false);
    assert.equal(loaded.report.candidateValidity.structuralBlockers.some((entry) => entry.code === 'REBUILD_DECISION_COLLISION'), true);
});

test('candidate retention cleanup keeps latest success, latest non-success, and pinned candidates only', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const chatFilePath = path.join(root, 'chats', 'Jeep', 'Session A.jsonl');

    const successA = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-l1',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: successA.manifest.reconstructionRunId,
        now: Date.now(),
    });
    await setCandidateRebuildPinned(request, {
        reconstructionRunId: successA.manifest.reconstructionRunId,
        pinReason: 'keep-for-comparison',
        now: Date.now(),
    });

    await appendConflictingArchitecturalShard(root, chatFilePath);
    const invalidRun = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-l2',
        now: Date.now(),
    });
    const invalidResult = await runCandidateRebuild(request, {
        reconstructionRunId: invalidRun.manifest.reconstructionRunId,
        now: Date.now(),
    });
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.report.status, 'invalid');

    await writeArchitecturalChat(root, { memoryScopeId, chatInstanceId: 'chat_beta' });
    const successB = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-l3',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: successB.manifest.reconstructionRunId,
        now: Date.now(),
    });

    const cleanup = cleanupCandidateArtifacts(request, { memoryScopeId });
    const runs = listCandidateRuns(request, { memoryScopeId }).runs;

    assert.deepEqual(cleanup.removedRunIds, []);
    assert.equal(runs.length, 3);
    assert.deepEqual(
        runs.find((entry) => entry.reconstructionRunId === successA.manifest.reconstructionRunId)?.retention.retainedBecause,
        ['pinned'],
    );
    assert.deepEqual(
        runs.find((entry) => entry.reconstructionRunId === invalidRun.manifest.reconstructionRunId)?.retention.retainedBecause,
        ['latest_non_success'],
    );
    assert.deepEqual(
        runs.find((entry) => entry.reconstructionRunId === successB.manifest.reconstructionRunId)?.retention.retainedBecause,
        ['latest_success'],
    );
});

test('automatic retention removes superseded unpinned candidates and explicit cleanup is a safe no-op', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);
    const paths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(paths);
    liveAdapter.close();
    const beforeLive = fingerprintFiles(paths);

    const first = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-m1',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: first.manifest.reconstructionRunId,
        now: Date.now(),
    });

    await writeArchitecturalChat(root, { memoryScopeId, chatInstanceId: 'chat_gamma' });
    const second = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'req-m2',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: second.manifest.reconstructionRunId,
        now: Date.now(),
    });

    const listedBefore = listCandidateRuns(request, { memoryScopeId }).runs;
    const cleanup = cleanupCandidateArtifacts(request, { memoryScopeId });
    const listedAfter = listCandidateRuns(request, { memoryScopeId }).runs;
    const afterLive = fingerprintFiles(paths);

    assert.equal(listedBefore.some((entry) => entry.reconstructionRunId === first.manifest.reconstructionRunId), false);
    assert.equal(listedBefore.some((entry) => entry.reconstructionRunId === second.manifest.reconstructionRunId), true);
    assert.deepEqual(cleanup.removedRunIds, []);
    assert.equal(listedAfter.some((entry) => entry.reconstructionRunId === first.manifest.reconstructionRunId), false);
    assert.equal(listedAfter.some((entry) => entry.reconstructionRunId === second.manifest.reconstructionRunId), true);
    assert.deepEqual(afterLive, beforeLive);
});
