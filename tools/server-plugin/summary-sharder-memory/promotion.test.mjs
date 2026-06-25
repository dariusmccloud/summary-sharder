import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildManagedShardManifest } from '../../../core/summarization/shard-integrity-core.js';
import {
    getStoragePaths,
    openOperationalDatabase,
    readOperationalStateMarker,
    resolveOperationalDbPath,
    writeOperationalStateMarkerDescriptor,
} from './core.js';
import {
    initCandidateRebuildRun,
    runCandidateRebuild,
    computeScopedAuthorityState,
    readLiveAuthorityStateReadOnly,
} from './rebuild.js';
import {
    createPromotionAuthorization,
    executePromotionAuthorization,
    recoverPromotionState,
} from './promotion.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-promotion-'));
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
    const chatFilePath = path.join(charDir, `${options.chatFileName || 'Session A'}.jsonl`);

    const messages = [
        {
            name: 'Chris',
            is_user: true,
            is_system: false,
            send_date: '2026-06-24T10:00:00.000Z',
            mes: options.sourceMes || 'We should keep browser-local state non-authoritative.',
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId(`${memoryScopeId}a1`),
                        initFingerprint: `sha256:init-${memoryScopeId}-a1`,
                        revisionHash: `sha256:rev-${memoryScopeId}-a1`,
                    },
                    speakerIdentity: {
                        speakerEntityId: 'user:Chris',
                        sourceType: 'user',
                    },
                },
            },
        },
        {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: options.outputUid || '2026-06-24T10:00:10.000Z',
            mes: options.shardMes || `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID:${options.decisionId || 'gain-modulation-boundary'} | DECISION:${options.decisionText || 'Keep browser-local state non-authoritative.'}

===END===`,
            extra: {
                summary_sharder: {
                    messageIdentity: {
                        schemaVersion: 1,
                        messageId: makeMessageId(`${memoryScopeId}c3`),
                        initFingerprint: `sha256:init-${memoryScopeId}-c3`,
                        revisionHash: `sha256:rev-${memoryScopeId}-c3`,
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
        endIndex: 0,
        artifactKind: 'system-shard',
        outputUID: messages[1].send_date,
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
                    chatId: options.chatFileName || 'Session A',
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
    return { memoryScopeId, chatFilePath };
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

test('promotion can authorize and publish the first live generation from an absent live state', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);

    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'promo-first',
        now: Date.now(),
    });
    const run = await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    assert.equal(run.report.promotionQualification.eligibility.eligible, true);

    const auth = createPromotionAuthorization(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    const execute = executePromotionAuthorization(request, {
        authorizationId: auth.authorization.authorizationId,
        now: Date.now(),
    });

    assert.equal(execute.ok, true);
    const paths = getStoragePaths(root);
    const marker = readOperationalStateMarker(paths);
    assert.equal(typeof marker.liveAuthority.generationId, 'string');
    assert.equal(fs.existsSync(resolveOperationalDbPath(paths, marker)), true);
    assert.equal(fs.existsSync(paths.snapshotPath), true);
    assert.equal(fs.existsSync(paths.promotionJournalPath), true);

    const journal = fs.readFileSync(paths.promotionJournalPath, 'utf8');
    assert.match(journal, /PROMOTION_PREPARED/u);
    assert.match(journal, /PROMOTION_COMMITTED/u);

    const liveState = readLiveAuthorityStateReadOnly(root, memoryScopeId);
    assert.equal(liveState.ok, true);
    assert.equal(liveState.dbPresent, true);
    assert.equal(liveState.generationIdentity, marker.liveAuthority.generationId);
});

test('promotion preserves unrelated scopes while replacing the authorized target scope', async () => {
    const root = makeTempRoot();
    const request = buildRequest(root);

    const seed = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_beta',
        chatInstanceId: 'chat_beta',
        chatFileName: 'Beta Session',
        decisionId: 'beta-decision',
        decisionText: 'Preserve unrelated scope state.',
    });
    const seedInit = await initCandidateRebuildRun(request, {
        memoryScopeId: seed.memoryScopeId,
        requestKey: 'seed-beta',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const seedAuth = createPromotionAuthorization(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    executePromotionAuthorization(request, {
        authorizationId: seedAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const target = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_alpha',
        chatInstanceId: 'chat_alpha',
        chatFileName: 'Alpha Session',
        decisionId: 'alpha-decision',
        decisionText: 'Replace only the target scope.',
    });
    const targetInit = await initCandidateRebuildRun(request, {
        memoryScopeId: target.memoryScopeId,
        requestKey: 'promo-alpha',
        now: Date.now(),
    });
    const targetRun = await runCandidateRebuild(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const targetAuth = createPromotionAuthorization(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    const execute = executePromotionAuthorization(request, {
        authorizationId: targetAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const livePaths = getStoragePaths(root);
    const activeDbPath = resolveOperationalDbPath(livePaths, readOperationalStateMarker(livePaths));
    const alphaState = computeScopedAuthorityState(activeDbPath, 'scope_alpha');
    const betaState = computeScopedAuthorityState(activeDbPath, 'scope_beta');
    const candidateAlphaState = computeScopedAuthorityState(path.join(root, targetRun.report.candidateRelativePath), 'scope_alpha');

    assert.equal(alphaState.canonicalAuthorityHash, candidateAlphaState.canonicalAuthorityHash);
    assert.equal(betaState.scopePresent, true);
    assert.equal(execute.generation.stagedNonTargetAggregateHash, execute.generation.parentNonTargetAggregateHash);
});

test('promotion refuses execution if live state drifts after authorization', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);

    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'promo-drift',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const auth = createPromotionAuthorization(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });

    const livePaths = getStoragePaths(root);
    const liveAdapter = openOperationalDatabase(livePaths);
    try {
        liveAdapter.run(
            'INSERT INTO memory_scopes (memory_scope_id, scope_alias, scope_version, current_scope_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ['scope_drift', '', 1, 0, Date.now(), Date.now()],
        );
    } finally {
        liveAdapter.close();
    }

    assert.throws(
        () => executePromotionAuthorization(request, {
            authorizationId: auth.authorization.authorizationId,
            now: Date.now(),
        }),
        /drifted/u,
    );
});

test('startup recovery marks prepared-with-old-pointer promotions as failed without moving live authority', async () => {
    const root = makeTempRoot();
    const request = buildRequest(root);

    const seed = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_parent',
        chatInstanceId: 'chat_parent',
        chatFileName: 'Parent Session',
        decisionId: 'parent-decision',
        decisionText: 'Establish parent live authority.',
    });
    const seedInit = await initCandidateRebuildRun(request, {
        memoryScopeId: seed.memoryScopeId,
        requestKey: 'seed-parent',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const seedAuth = createPromotionAuthorization(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    executePromotionAuthorization(request, {
        authorizationId: seedAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const target = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_target',
        chatInstanceId: 'chat_target',
        chatFileName: 'Target Session',
        decisionId: 'target-decision',
        decisionText: 'Promote target scope.',
    });
    const targetInit = await initCandidateRebuildRun(request, {
        memoryScopeId: target.memoryScopeId,
        requestKey: 'target-parent',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const targetAuth = createPromotionAuthorization(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    const execute = executePromotionAuthorization(request, {
        authorizationId: targetAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const paths = getStoragePaths(root);
    const marker = readOperationalStateMarker(paths);
    writeOperationalStateMarkerDescriptor(paths, {
        liveAuthority: {
            generationId: marker.promotionJournal.parentLiveAuthority.generationId,
            dbRelativePath: marker.promotionJournal.parentLiveAuthority.dbRelativePath,
            authorityHash: marker.promotionJournal.parentLiveAuthority.authorityHash,
        },
        promotionJournal: {
            ...marker.promotionJournal,
            lastState: 'PREPARED',
            updatedAt: Date.now(),
        },
    });

    const recovered = recoverPromotionState(request, { now: Date.now() });
    const after = readOperationalStateMarker(paths);

    assert.equal(recovered.recovered, true);
    assert.equal(recovered.state, 'FAILED');
    assert.equal(after.promotionJournal.lastState, 'FAILED');
    assert.equal(after.liveAuthority.generationId, marker.promotionJournal.parentLiveAuthority.generationId);
    assert.equal(after.liveAuthority.dbRelativePath, marker.promotionJournal.parentLiveAuthority.dbRelativePath);
    assert.equal(execute.ok, true);
});

test('startup recovery completes verifying state when staged live generation is valid', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const request = buildRequest(root);

    const init = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: 'recover-valid',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const auth = createPromotionAuthorization(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    executePromotionAuthorization(request, {
        authorizationId: auth.authorization.authorizationId,
        now: Date.now(),
    });

    const paths = getStoragePaths(root);
    const marker = readOperationalStateMarker(paths);
    writeOperationalStateMarkerDescriptor(paths, {
        promotionJournal: {
            ...marker.promotionJournal,
            lastState: 'VERIFYING',
            updatedAt: Date.now(),
        },
    });

    const recovered = recoverPromotionState(request, { now: Date.now() });
    const after = readOperationalStateMarker(paths);

    assert.equal(recovered.recovered, true);
    assert.equal(recovered.state, 'COMMITTED');
    assert.equal(after.promotionJournal.lastState, 'COMMITTED');
    assert.equal(after.liveAuthority.generationId, marker.liveAuthority.generationId);
});

test('startup recovery rolls back verifying state when staged live generation is invalid', async () => {
    const root = makeTempRoot();
    const request = buildRequest(root);

    const seed = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_parent',
        chatInstanceId: 'chat_parent',
        chatFileName: 'Parent Session',
        decisionId: 'parent-decision',
        decisionText: 'Establish parent live authority.',
    });
    const seedInit = await initCandidateRebuildRun(request, {
        memoryScopeId: seed.memoryScopeId,
        requestKey: 'seed-parent-recover',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const seedAuth = createPromotionAuthorization(request, {
        reconstructionRunId: seedInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    executePromotionAuthorization(request, {
        authorizationId: seedAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const target = await writeArchitecturalChat(root, {
        memoryScopeId: 'scope_target',
        chatInstanceId: 'chat_target',
        chatFileName: 'Target Session',
        decisionId: 'target-decision',
        decisionText: 'Promote target scope.',
    });
    const targetInit = await initCandidateRebuildRun(request, {
        memoryScopeId: target.memoryScopeId,
        requestKey: 'target-recover-invalid',
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const targetAuth = createPromotionAuthorization(request, {
        reconstructionRunId: targetInit.manifest.reconstructionRunId,
        authorizedBy: 'test-suite',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    executePromotionAuthorization(request, {
        authorizationId: targetAuth.authorization.authorizationId,
        now: Date.now(),
    });

    const paths = getStoragePaths(root);
    const marker = readOperationalStateMarker(paths);
    const stagedPath = path.join(paths.storageRoot, marker.promotionJournal.liveDbRelativePath);
    fs.writeFileSync(stagedPath, Buffer.from('corrupt-staged-live'));
    writeOperationalStateMarkerDescriptor(paths, {
        promotionJournal: {
            ...marker.promotionJournal,
            lastState: 'VERIFYING',
            updatedAt: Date.now(),
        },
    });

    const recovered = recoverPromotionState(request, { now: Date.now() });
    const after = readOperationalStateMarker(paths);

    assert.equal(recovered.recovered, true);
    assert.equal(recovered.state, 'ROLLED_BACK');
    assert.equal(after.promotionJournal.lastState, 'ROLLED_BACK');
    assert.equal(after.liveAuthority.generationId, marker.promotionJournal.parentLiveAuthority.generationId);
    assert.equal(after.liveAuthority.dbRelativePath, marker.promotionJournal.parentLiveAuthority.dbRelativePath);
});
