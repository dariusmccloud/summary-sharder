import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { buildManagedShardManifest } from '../../core/summarization/shard-integrity-core.js';

const DEFAULT_HOST_ROOTS = Object.freeze([
    'D:/AI/Projects/SillyTavern',
    'D:/AI/Projects/SillyBunny',
]);

const FIXTURE_TIMESTAMP = Date.parse('2026-06-25T12:00:00.000Z');
const FIXTURE_CHARACTER = 'Promotion Proof';

function makeMessageId(suffix) {
    const hex = crypto.createHash('sha256').update(String(suffix || '')).digest('hex').slice(0, 32);
    return `msg_${hex}`;
}

function userMessage(idSuffix, mes, overrides = {}) {
    return {
        name: 'Chris',
        is_user: true,
        is_system: false,
        send_date: overrides.send_date || `2026-06-25T12:00:${String(idSuffix).slice(0, 2)}.000Z`,
        mes,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId(idSuffix),
                    initFingerprint: overrides.initFingerprint || `sha256:init-${idSuffix}`,
                    revisionHash: overrides.revisionHash || `sha256:rev-${idSuffix}`,
                },
                speakerIdentity: {
                    speakerEntityId: 'user:Chris',
                    sourceType: 'user',
                },
            },
        },
        ...overrides,
    };
}

function shardMessage(idSuffix, decisionId, decisionText, overrides = {}) {
    return {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: overrides.send_date || `2026-06-25T12:10:${String(idSuffix).slice(0, 2)}.000Z`,
        mes: `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: ${decisionId} | RECORD-VERSION: 1 | DECISION: ${decisionText}

===END===`,
        extra: {
            summary_sharder: {
                messageIdentity: {
                    schemaVersion: 1,
                    messageId: makeMessageId(idSuffix),
                    initFingerprint: overrides.initFingerprint || `sha256:init-${idSuffix}`,
                    revisionHash: overrides.revisionHash || `sha256:rev-${idSuffix}`,
                },
                speakerIdentity: {
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
        ...overrides,
    };
}

async function writeChat(userRoot, fixture) {
    const chatsRoot = path.join(userRoot, 'chats');
    const charDir = path.join(chatsRoot, FIXTURE_CHARACTER);
    fs.mkdirSync(charDir, { recursive: true });
    const chatFilePath = path.join(charDir, `${fixture.chatLocator}.jsonl`);
    const messages = fixture.messages;

    const shardManifests = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message?.is_system !== true || !/\[MEMORY SHARD:/u.test(String(message.mes || ''))) {
            continue;
        }
        const manifest = await buildManagedShardManifest(messages, {
            startIndex: 0,
            endIndex: Math.max(0, index - 1),
            artifactKind: 'system-shard',
            outputUID: message.send_date,
            promptPolicy: 'replace_source',
            now: FIXTURE_TIMESTAMP,
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
                    memoryScopeId: fixture.memoryScopeId,
                    chatInstanceId: fixture.chatInstanceId,
                    chatId: fixture.chatLocator,
                    scopeAlias: fixture.scopeAlias || '',
                    boundAt: FIXTURE_TIMESTAMP,
                    updatedAt: FIXTURE_TIMESTAMP,
                },
                shardManifests,
            },
        },
        user_name: 'Chris',
        character_name: 'Jeep',
    };

    const lines = [JSON.stringify(header), ...messages.map((message) => JSON.stringify(message))];
    fs.writeFileSync(chatFilePath, `${lines.join('\n')}\n`, 'utf8');
    return chatFilePath;
}

function buildFixtures() {
    return [
        {
            memoryScopeId: 'scope.c0.75.seed',
            chatInstanceId: 'chat.c075.seed',
            chatLocator: 'C0.75 Seed',
            scopeAlias: 'c075-seed',
            messages: [
                userMessage('seed001', 'Seed the first live authority generation.'),
                shardMessage('seed002', 'c075-seed-decision', 'The first live generation should be created from a promotable candidate.'),
            ],
        },
        {
            memoryScopeId: 'scope.c0.75.target',
            chatInstanceId: 'chat.c075.target',
            chatLocator: 'C0.75 Target',
            scopeAlias: 'c075-target',
            messages: [
                userMessage('tgt001', 'Promote a second scope without disturbing the first.'),
                shardMessage('tgt002', 'c075-target-decision', 'Scope-local promotion must preserve unrelated live scope state.'),
            ],
        },
        {
            memoryScopeId: 'scope.c0.75.stale',
            chatInstanceId: 'chat.c075.stale',
            chatLocator: 'C0.75 Stale Authorization',
            scopeAlias: 'c075-stale',
            messages: [
                userMessage('stl001', 'Authorize this candidate and then let live drift invalidate it.'),
                shardMessage('stl002', 'c075-stale-decision', 'A stale authorization must refuse execution after live drift.'),
            ],
        },
        {
            memoryScopeId: 'scope.c0.75.recovery.prepared',
            chatInstanceId: 'chat.c075.recovery.prepared',
            chatLocator: 'C0.75 Recovery Prepared',
            scopeAlias: 'c075-recovery-prepared',
            messages: [
                userMessage('rcp001', 'This scope is used to prove prepared-state restart recovery.'),
                shardMessage('rcp002', 'c075-recovery-prepared-decision', 'Prepared recovery should fail closed without moving live authority.'),
            ],
        },
        {
            memoryScopeId: 'scope.c0.75.recovery.valid',
            chatInstanceId: 'chat.c075.recovery.valid',
            chatLocator: 'C0.75 Recovery Valid',
            scopeAlias: 'c075-recovery-valid',
            messages: [
                userMessage('rcv001', 'This scope is used to prove verifying-state restart completion.'),
                shardMessage('rcv002', 'c075-recovery-valid-decision', 'Valid verifying recovery should complete to committed live authority.'),
            ],
        },
        {
            memoryScopeId: 'scope.c0.75.recovery.invalid',
            chatInstanceId: 'chat.c075.recovery.invalid',
            chatLocator: 'C0.75 Recovery Invalid',
            scopeAlias: 'c075-recovery-invalid',
            messages: [
                userMessage('rci001', 'This scope is used to prove invalid staged-live rollback recovery.'),
                shardMessage('rci002', 'c075-recovery-invalid-decision', 'Invalid verifying recovery should roll back to the parent live generation.'),
            ],
        },
    ];
}

function getHostRoots() {
    const argvRoots = process.argv.slice(2).filter(Boolean);
    return argvRoots.length > 0 ? argvRoots : DEFAULT_HOST_ROOTS;
}

const fixtures = buildFixtures();
const hostRoots = getHostRoots();
const written = [];

for (const hostRoot of hostRoots) {
    const userRoot = path.join(hostRoot, 'data', 'default-user');
    const charDir = path.join(userRoot, 'chats', FIXTURE_CHARACTER);
    fs.rmSync(charDir, { recursive: true, force: true });
    for (const fixture of fixtures) {
        const chatFilePath = await writeChat(userRoot, fixture);
        written.push({
            hostRoot,
            memoryScopeId: fixture.memoryScopeId,
            chatInstanceId: fixture.chatInstanceId,
            chatLocator: fixture.chatLocator,
            chatFilePath,
        });
    }
}

process.stdout.write(JSON.stringify({
    ok: true,
    fixtureTimestamp: FIXTURE_TIMESTAMP,
    characterName: FIXTURE_CHARACTER,
    written,
}));
