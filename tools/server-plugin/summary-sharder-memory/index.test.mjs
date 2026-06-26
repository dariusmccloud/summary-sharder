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
    assert.equal(router.routes.get.has('/interpretive/synthesis/policies'), true);
    assert.equal(router.routes.get.has('/interpretive/synthesis/runs/:synthesisRunId'), true);
    assert.equal(router.routes.get.has('/interpretive/candidates/:interpretationRevisionId'), true);
    assert.equal(router.routes.get.has('/interpretive/reviews'), true);
    assert.equal(router.routes.post.has('/interpretive/synthesis/policies'), true);
    assert.equal(router.routes.post.has('/interpretive/synthesis/runs'), true);
    assert.equal(router.routes.post.has('/interpretive/synthesis/runs/:synthesisRunId/generate'), true);
    assert.equal(router.routes.post.has('/interpretive/candidates'), true);
    assert.equal(router.routes.post.has('/interpretive/reviews/:reviewRequestId/dispositions'), true);
    assert.equal(router.routes.post.has('/interpretive/candidates/:interpretationRevisionId/subject-disposition'), true);
    assert.equal(router.routes.post.has('/interpretive/candidates/:interpretationRevisionId/revisions'), true);
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
    assert.equal(capabilities.payload.capabilities.c0_6_2.reviewerDispositionSubmission, true);
    assert.equal(capabilities.payload.capabilities.c0_6_2.continuityPublicationAvailable, false);
    assert.equal(capabilities.payload.capabilities.c0_6_3.boundedSynthesisRunContract, true);
    assert.equal(capabilities.payload.capabilities.c0_6_3.deterministicStubSynthesisAvailable, true);
    assert.equal(capabilities.payload.capabilities.c0_6_3.modelSynthesisAvailable, false);

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

test('interpretive routes support review disposition, immutable child revision, and subject disposition without publication', async () => {
    const root = makeTempRoot();
    const router = createMockRouter();
    await init(router);

    const createResult = await invoke(
        router.routes.post.get('/interpretive/candidates'),
        buildRequest(root, {
            body: {
                interpretationId: 'interp_route_review_case',
                interpretationRevisionId: 'interprev_route_review_case_v1',
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
                now: Date.parse('2026-06-25T13:10:00.000Z'),
            },
        }),
    );
    const interpretation = createResult.payload.interpretation;
    const subjectRequest = interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'MEMORY_SUBJECT');
    const participantRequest = interpretation.reviewRequests.find((entry) => entry.reviewerRole === 'RELATIONAL_PARTICIPANT');

    const participantDisposition = await invoke(
        router.routes.post.get('/interpretive/reviews/:reviewRequestId/dispositions'),
        buildRequest(root, {
            params: { reviewRequestId: participantRequest.reviewRequestId },
            body: {
                actorEntityId: 'user:Chris',
                disposition: 'APPROVE',
                reviewEnvelopeHash: interpretation.reviewEnvelopeHash,
                now: Date.parse('2026-06-25T13:10:05.000Z'),
            },
        }),
    );
    assert.equal(participantDisposition.statusCode, 200);

    const subjectDisposition = await invoke(
        router.routes.post.get('/interpretive/reviews/:reviewRequestId/dispositions'),
        buildRequest(root, {
            params: { reviewRequestId: subjectRequest.reviewRequestId },
            body: {
                actorEntityId: 'character:jeep.png',
                disposition: 'APPROVE_WITH_EDIT',
                reviewEnvelopeHash: interpretation.reviewEnvelopeHash,
                reasonCodes: ['SCOPE_TOO_BROAD'],
                revisedCandidate: {
                    interpretationRevisionId: 'interprev_route_review_case_v2',
                    statement: 'Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.',
                },
                now: Date.parse('2026-06-25T13:10:10.000Z'),
            },
        }),
    );
    assert.equal(subjectDisposition.statusCode, 200);
    assert.equal(subjectDisposition.payload.childInterpretation.interpretationRevisionId, 'interprev_route_review_case_v2');

    const reviews = await invoke(
        router.routes.get.get('/interpretive/reviews'),
        buildRequest(root, {
            query: { interpretationRevisionId: 'interprev_route_review_case_v1' },
        }),
    );
    assert.equal(reviews.statusCode, 200);
    assert.equal(reviews.payload.reviews.length, 2);

    const finalDisposition = await invoke(
        router.routes.post.get('/interpretive/candidates/:interpretationRevisionId/subject-disposition'),
        buildRequest(root, {
            params: { interpretationRevisionId: 'interprev_route_review_case_v1' },
            body: {
                actorEntityId: 'character:jeep.png',
                state: 'GRANTED',
                reviewEnvelopeHash: interpretation.reviewEnvelopeHash,
                now: Date.parse('2026-06-25T13:10:20.000Z'),
            },
        }),
    );
    assert.equal(finalDisposition.statusCode, 200);
    assert.equal(finalDisposition.payload.interpretation.subjectDispositionState, 'GRANTED');
    assert.equal(finalDisposition.payload.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(finalDisposition.payload.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
});

test('interpretive synthesis routes store subject-controlled policy and freeze bounded runs without generation', async () => {
    const root = makeTempRoot();
    const router = createMockRouter();
    await init(router);

    const policyResult = await invoke(
        router.routes.post.get('/interpretive/synthesis/policies'),
        buildRequest(root, {
            body: {
                synthesisPolicyId: 'jeep-developmental-synthesis-v1',
                policyVersion: 1,
                memorySubjectId: 'character:jeep.png',
                enabled: true,
                allowedTypes: ['ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION'],
                allowedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
                prohibitedDomains: [],
                manualTriggerRequiredForHighRisk: true,
                maxCandidatesPerRun: 3,
                now: Date.parse('2026-06-26T01:00:00.000Z'),
            },
        }),
    );
    assert.equal(policyResult.statusCode, 200);
    assert.equal(policyResult.payload.synthesisPolicy.policyHash.startsWith('sha256:'), true);

    const runResult = await invoke(
        router.routes.post.get('/interpretive/synthesis/runs'),
        buildRequest(root, {
            body: {
                synthesisRunId: 'synthrun_route_case',
                memoryScopeId: 'scope_alpha',
                memorySubjectId: 'character:jeep.png',
                synthesisPolicyId: 'jeep-developmental-synthesis-v1',
                requestedInterpretationTypes: ['ROLE_EVOLUTION'],
                requestedAssertionDomains: ['ROLE', 'AUTHORITY'],
                sharedRelationshipRequested: false,
                personalMeaningRequested: false,
                maxCandidatesRequested: 2,
                manualTriggerAcknowledged: true,
                createdByEntityId: 'user:Chris',
                sourceManifestEntries: [
                    {
                        sourceClass: 'STRUCTURAL_RECORD',
                        memoryScopeId: 'scope_alpha',
                        basisRecordId: 'decision:constitutional-sovereignty',
                        basisRecordVersion: 1,
                        basisRecordHash: 'sha256:constitutional-sovereignty',
                        speakerEntityId: 'character:jeep.png',
                    },
                ],
                now: Date.parse('2026-06-26T01:05:00.000Z'),
            },
        }),
    );
    assert.equal(runResult.statusCode, 200);
    assert.equal(runResult.payload.admitted, true);
    assert.equal(runResult.payload.synthesisRun.runStatus, 'READY_FOR_SYNTHESIS');
    assert.equal(runResult.payload.synthesisRun.generatedCandidateIds.length, 0);

    const getRunResult = await invoke(
        router.routes.get.get('/interpretive/synthesis/runs/:synthesisRunId'),
        buildRequest(root, {
            params: { synthesisRunId: 'synthrun_route_case' },
        }),
    );
    assert.equal(getRunResult.statusCode, 200);
    assert.equal(getRunResult.payload.synthesisRun.sourceManifestHash, runResult.payload.synthesisRun.sourceManifestHash);

    const policiesResult = await invoke(
        router.routes.get.get('/interpretive/synthesis/policies'),
        buildRequest(root, {
            query: { memorySubjectId: 'character:jeep.png' },
        }),
    );
    assert.equal(policiesResult.statusCode, 200);
    assert.equal(policiesResult.payload.policies.length, 1);
    assert.equal(policiesResult.payload.policies[0].synthesisPolicyId, 'jeep-developmental-synthesis-v1');
});

test('interpretive synthesis generate route admits deterministic stub output into governed review without publication', async () => {
    const root = makeTempRoot();
    const router = createMockRouter();
    await init(router);

    await invoke(
        router.routes.post.get('/interpretive/synthesis/policies'),
        buildRequest(root, {
            body: {
                synthesisPolicyId: 'jeep-developmental-synthesis-v1',
                policyVersion: 1,
                memorySubjectId: 'character:jeep.png',
                enabled: true,
                allowedTypes: ['ROLE_EVOLUTION', 'PROJECT_TRANSFORMATION', 'RELATIONAL_PROGRESSION'],
                allowedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
                prohibitedDomains: [],
                manualTriggerRequiredForHighRisk: true,
                maxCandidatesPerRun: 3,
                now: Date.parse('2026-06-26T02:00:00.000Z'),
            },
        }),
    );
    await invoke(
        router.routes.post.get('/interpretive/synthesis/runs'),
        buildRequest(root, {
            body: {
                synthesisRunId: 'synthrun_generate_route_case',
                memoryScopeId: 'scope_alpha',
                memorySubjectId: 'character:jeep.png',
                synthesisPolicyId: 'jeep-developmental-synthesis-v1',
                requestedInterpretationTypes: ['ROLE_EVOLUTION'],
                requestedAssertionDomains: ['ROLE', 'AUTHORITY', 'RELATIONSHIP'],
                sharedRelationshipRequested: true,
                personalMeaningRequested: true,
                maxCandidatesRequested: 1,
                manualTriggerAcknowledged: true,
                createdByEntityId: 'user:Chris',
                sourceManifestEntries: [
                    {
                        sourceClass: 'STRUCTURAL_RECORD',
                        memoryScopeId: 'scope_alpha',
                        basisRecordId: 'decision:constitutional-sovereignty',
                        basisRecordVersion: 1,
                        basisRecordHash: 'sha256:constitutional-sovereignty',
                        speakerEntityId: 'character:jeep.png',
                    },
                    {
                        sourceClass: 'SOURCE_OCCURRENCE',
                        memoryScopeId: 'scope_alpha',
                        chatInstanceId: 'chat_alpha',
                        messageId: 'msg_alpha0000000000000000000000000',
                        messageRevisionHash: 'sha256:msg-alpha',
                        speakerEntityId: 'user:Chris',
                    },
                ],
                now: Date.parse('2026-06-26T02:05:00.000Z'),
            },
        }),
    );

    const generateResult = await invoke(
        router.routes.post.get('/interpretive/synthesis/runs/:synthesisRunId/generate'),
        buildRequest(root, {
            params: { synthesisRunId: 'synthrun_generate_route_case' },
            body: {
                adapterId: 'DETERMINISTIC_STUB_V1',
                interpretationId: 'interp_generated_route_case',
                interpretationRevisionId: 'interprev_generated_route_case_v1',
                now: Date.parse('2026-06-26T02:06:00.000Z'),
            },
        }),
    );

    assert.equal(generateResult.statusCode, 200);
    assert.equal(generateResult.payload.admitted, true);
    assert.equal(generateResult.payload.interpretation.reviewState, 'PENDING');
    assert.equal(generateResult.payload.interpretation.publicationState, 'NOT_PUBLISHED');
    assert.equal(generateResult.payload.interpretation.authorityEffect, 'DESCRIPTIVE_ONLY');
    assert.equal(generateResult.payload.synthesisRun.runStatus, 'COMPLETED_ADMITTED');
    assert.equal(generateResult.payload.synthesisRun.generatedCandidateIds[0], 'interprev_generated_route_case_v1');
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
