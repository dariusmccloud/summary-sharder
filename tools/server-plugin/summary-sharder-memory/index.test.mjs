import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildManagedShardManifest } from '../../../core/summarization/shard-integrity-core.js';
import { writeOperationalStateMarkerDescriptor, readOperationalStateMarker, getStoragePaths } from './core.js';
import { init } from './index.js';
import { initCandidateRebuildRun, runCandidateRebuild } from './rebuild.js';
import { createPromotionAuthorization, executePromotionAuthorization } from './promotion.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-routes-'));
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
    return { memoryScopeId };
}

function buildRequest(root, overrides = {}) {
    return {
        user: {
            directories: {
                root,
                chats: path.join(root, 'chats'),
                groupChats: path.join(root, 'group chats'),
            },
        },
        body: {},
        query: {},
        params: {},
        ...overrides,
    };
}

function createMockRouter() {
    const routes = {
        get: new Map(),
        post: new Map(),
    };
    return {
        routes,
        get(pathname, handler) {
            routes.get.set(pathname, handler);
        },
        post(pathname, handler) {
            routes.post.set(pathname, handler);
        },
    };
}

async function invoke(handler, request) {
    const state = {
        statusCode: 200,
        payload: null,
    };
    const response = {
        status(code) {
            state.statusCode = code;
            return this;
        },
        send(payload) {
            state.payload = payload;
            return this;
        },
    };
    await handler(request, response);
    return state;
}

async function buildPromotedScope(root, memoryScopeId) {
    const request = buildRequest(root);
    const initResult = await initCandidateRebuildRun(request, {
        memoryScopeId,
        requestKey: `route-promo-${memoryScopeId}`,
        now: Date.now(),
    });
    await runCandidateRebuild(request, {
        reconstructionRunId: initResult.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const auth = createPromotionAuthorization(request, {
        reconstructionRunId: initResult.manifest.reconstructionRunId,
        authorizedBy: 'route-test',
        now: Date.now(),
        expiresAt: Date.now() + 60000,
    });
    return executePromotionAuthorization(request, {
        authorizationId: auth.authorization.authorizationId,
        now: Date.now(),
    });
}

test('route surface exposes candidate lifecycle routes and separate promotion routes', async () => {
    const router = createMockRouter();
    await init(router);

    assert.equal(router.routes.get.has('/rebuild/candidate/report/:reconstructionRunId'), true);
    assert.equal(router.routes.get.has('/rebuild/candidate/runs/:memoryScopeId'), true);
    assert.equal(router.routes.post.has('/rebuild/candidate/init'), true);
    assert.equal(router.routes.post.has('/rebuild/candidate/run'), true);
    assert.equal(router.routes.post.has('/rebuild/candidate/pin'), true);
    assert.equal(router.routes.post.has('/rebuild/candidate/cleanup'), true);
    assert.equal(router.routes.post.has('/rebuild/candidate/promote'), false);
    assert.equal(router.routes.post.has('/rebuild/promote'), false);
    assert.equal(router.routes.post.has('/rebuild/promotion/authorize'), true);
    assert.equal(router.routes.post.has('/rebuild/promotion/execute'), true);
    assert.equal(router.routes.get.has('/interpretive/policies'), true);
    assert.equal(router.routes.get.has('/interpretive/candidates/:interpretationRevisionId'), true);
    assert.equal(router.routes.post.has('/interpretive/candidates'), true);
});

test('capabilities and candidate lifecycle routes report no promotion and support report, pin, and cleanup', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    const router = createMockRouter();
    await init(router);

    const capabilities = await invoke(router.routes.get.get('/capabilities'), buildRequest(root));
    assert.equal(capabilities.statusCode, 200);
    assert.equal(capabilities.payload.capabilities.c0_5a.promotionAvailable, false);
    assert.equal(capabilities.payload.capabilities.c0_5a.candidatePinning, true);
    assert.equal(capabilities.payload.capabilities.c0_5a.candidateCleanup, true);
    assert.equal(capabilities.payload.capabilities.c0_75_1.candidateQualification, true);
    assert.equal(capabilities.payload.capabilities.c0_75_1.promotionAvailable, false);
    assert.equal(capabilities.payload.capabilities.c0_75_2.promotionAvailable, true);
    assert.equal(capabilities.payload.capabilities.c0_6_1.interpretiveLedgerAuthority, true);
    assert.equal(capabilities.payload.capabilities.c0_6_1.continuityPublicationAvailable, false);

    const initResult = await invoke(
        router.routes.post.get('/rebuild/candidate/init'),
        buildRequest(root, {
            body: {
                memoryScopeId,
                requestKey: 'route-test',
                now: Date.now(),
            },
        }),
    );
    assert.equal(initResult.statusCode, 200);
    const reconstructionRunId = initResult.payload.manifest.reconstructionRunId;

    const runResult = await invoke(
        router.routes.post.get('/rebuild/candidate/run'),
        buildRequest(root, {
            body: {
                reconstructionRunId,
                now: Date.now(),
            },
        }),
    );
    assert.equal(runResult.statusCode, 200);
    assert.equal(runResult.payload.report.promotionAvailable, false);

    const reportResult = await invoke(
        router.routes.get.get('/rebuild/candidate/report/:reconstructionRunId'),
        buildRequest(root, {
            params: {
                reconstructionRunId,
            },
        }),
    );
    assert.equal(reportResult.statusCode, 200);
    assert.equal(reportResult.payload.report.reconstructionRunId, reconstructionRunId);

    const pinResult = await invoke(
        router.routes.post.get('/rebuild/candidate/pin'),
        buildRequest(root, {
            body: {
                reconstructionRunId,
                pinReason: 'route-smoke',
                now: Date.now(),
            },
        }),
    );
    assert.equal(pinResult.statusCode, 200);
    assert.equal(pinResult.payload.report.retention.pinned, true);

    const listResult = await invoke(
        router.routes.get.get('/rebuild/candidate/runs/:memoryScopeId'),
        buildRequest(root, {
            params: {
                memoryScopeId,
            },
        }),
    );
    assert.equal(listResult.statusCode, 200);
    assert.equal(listResult.payload.promotionAvailable, false);
    assert.equal(listResult.payload.runs.length, 1);
    assert.equal(listResult.payload.runs[0].retention.pinned, true);

    const cleanupResult = await invoke(
        router.routes.post.get('/rebuild/candidate/cleanup'),
        buildRequest(root, {
            body: {
                memoryScopeId,
            },
        }),
    );
    assert.equal(cleanupResult.statusCode, 200);
    assert.deepEqual(cleanupResult.payload.removedRunIds, []);
    assert.equal(cleanupResult.payload.promotionAvailable, false);
});

test('interpretive routes create pending governed candidates without publication', async () => {
    const root = makeTempRoot();
    const router = createMockRouter();
    await init(router);

    const createResult = await invoke(
        router.routes.post.get('/interpretive/candidates'),
        buildRequest(root, {
            body: {
                interpretationId: 'interp_route_case',
                interpretationRevisionId: 'interprev_route_case_v1',
                memoryScopeId: 'scope_alpha',
                memorySubjectId: 'character:jeep.png',
                type: 'ROLE_EVOLUTION',
                statement: 'Jeep evolved into the primary continuity authority within a shared architecture.',
                assertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
                sharedRelationshipAsserted: true,
                personalMeaningAsserted: true,
                materialParticipantEntityIds: ['character:jeep.png', 'user:Chris'],
                groundingLinks: [
                    {
                        basisType: 'STRUCTURAL_RECORD',
                        basisRecordId: 'decision:promotion-jurisdiction',
                        basisRecordVersion: 1,
                        basisRecordHash: 'sha256:promotion-jurisdiction',
                        speakerEntityId: 'character:jeep.png',
                        groundingRole: 'PRIMARY',
                        groundingAssessment: 'SUPPORTS',
                    },
                ],
                now: Date.parse('2026-06-25T13:00:00.000Z'),
            },
        }),
    );

    assert.equal(createResult.statusCode, 200);
    assert.equal(createResult.payload.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(createResult.payload.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
    assert.equal(createResult.payload.interpretation.policyBinding.validationPolicyId, 'shared-role-memory');

    const getResult = await invoke(
        router.routes.get.get('/interpretive/candidates/:interpretationRevisionId'),
        buildRequest(root, {
            params: {
                interpretationRevisionId: 'interprev_route_case_v1',
            },
        }),
    );
    assert.equal(getResult.statusCode, 200);
    assert.equal(getResult.payload.interpretation.reviewState, 'PENDING');

    const policiesResult = await invoke(
        router.routes.get.get('/interpretive/policies'),
        buildRequest(root),
    );
    assert.equal(policiesResult.statusCode, 200);
    assert.equal(Array.isArray(policiesResult.payload.policies), true);
    assert.equal(policiesResult.payload.policies.some((entry) => entry.validationPolicyId === 'shared-role-memory'), true);
});

test('health route reconciles verifying promotion state before opening live authority', async () => {
    const root = makeTempRoot();
    const { memoryScopeId } = await writeArchitecturalChat(root);
    await buildPromotedScope(root, memoryScopeId);
    const paths = getStoragePaths(root);
    const marker = readOperationalStateMarker(paths);
    writeOperationalStateMarkerDescriptor(paths, {
        promotionJournal: {
            ...marker.promotionJournal,
            lastState: 'VERIFYING',
            updatedAt: Date.now(),
        },
    });

    const router = createMockRouter();
    await init(router);
    const health = await invoke(router.routes.get.get('/health'), buildRequest(root));
    const after = readOperationalStateMarker(paths);

    assert.equal(health.statusCode, 200);
    assert.equal(health.payload.ok, true);
    assert.equal(after.promotionJournal.lastState, 'COMMITTED');
});
