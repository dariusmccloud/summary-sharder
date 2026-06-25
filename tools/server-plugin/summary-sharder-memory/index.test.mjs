import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildManagedShardManifest } from '../../../core/summarization/shard-integrity-core.js';
import { init } from './index.js';

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

test('route surface exposes candidate lifecycle routes and no promotion route', async () => {
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
