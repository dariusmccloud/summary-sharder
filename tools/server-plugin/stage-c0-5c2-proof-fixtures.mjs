import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildManagedShardManifest } from '../../core/summarization/shard-integrity-core.js';

const DEFAULT_HOST_ROOTS = Object.freeze([
    'D:/AI/Projects/SillyTavern',
    'D:/AI/Projects/SillyBunny',
]);
const FIXTURE_TIMESTAMP = 1782342000000;

function makeMessageId(suffix) {
    const hex = crypto.createHash('sha256').update(String(suffix || '')).digest('hex').slice(0, 32);
    return `msg_${hex}`;
}

function userMessage(idSuffix, mes, overrides = {}) {
    return {
        name: 'Chris',
        is_user: true,
        is_system: false,
        send_date: overrides.send_date || `2026-06-24T20:00:${String(idSuffix).slice(0, 2)}.000Z`,
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

function shardMessage(idSuffix, mes, overrides = {}) {
    return {
        name: 'System',
        is_user: false,
        is_system: true,
        send_date: overrides.send_date || `2026-06-24T20:10:${String(idSuffix).slice(0, 2)}.000Z`,
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
                    speakerEntityId: 'system:system',
                    sourceType: 'system',
                },
            },
        },
        ...overrides,
    };
}

async function writeChat(userRoot, options) {
    const chatsRoot = path.join(userRoot, 'chats');
    const charDir = path.join(chatsRoot, 'Summary Sharder Proof');
    fs.mkdirSync(charDir, { recursive: true });
    const chatFilePath = path.join(charDir, `${options.chatLocator}.jsonl`);
    const messages = options.messages || [];

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
                    memoryScopeId: options.memoryScopeId,
                    chatInstanceId: options.chatInstanceId,
                    chatId: options.chatLocator,
                    scopeAlias: options.scopeAlias || '',
                    boundAt: FIXTURE_TIMESTAMP,
                    updatedAt: FIXTURE_TIMESTAMP,
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
    return chatFilePath;
}

function buildFixtures() {
    return [
        {
            memoryScopeId: 'scope.c0.5c2.success',
            chatInstanceId: 'chat.c05c2.success.parent',
            chatLocator: 'C0.5C2 Success Parent',
            scopeAlias: 'c05c2-success',
            messages: [
                userMessage('suc001', 'The same decision should survive deterministic reconstruction.'),
                shardMessage('suc002', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: c05c2-shared-decision | RECORD-VERSION: 1 | DECISION: Preserve duplicate provenance inside a deterministic candidate rebuild.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.success',
            chatInstanceId: 'chat.c05c2.success.branch',
            branchedFromChatInstanceId: 'chat.c05c2.success.parent',
            chatLocator: 'C0.5C2 Success Branch',
            scopeAlias: 'c05c2-success',
            messages: [
                userMessage('suc003', 'A branch copy should classify as shared lineage, not fresh authority.'),
                shardMessage('suc004', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: c05c2-shared-decision | RECORD-VERSION: 1 | DECISION: Preserve duplicate provenance inside a deterministic candidate rebuild.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.success',
            chatInstanceId: 'chat.c05c2.success.update',
            chatLocator: 'C0.5C2 Success Update',
            scopeAlias: 'c05c2-success',
            messages: [
                userMessage('suc005', 'The same decision advanced to version two.'),
                shardMessage('suc006', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: c05c2-shared-decision | RECORD-VERSION: 2 | PRIOR-VERSION: 1 | DECISION: Preserve duplicate provenance inside a deterministic candidate rebuild.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.success',
            chatInstanceId: 'chat.c05c2.success.supersession',
            chatLocator: 'C0.5C2 Success Supersession',
            scopeAlias: 'c05c2-success',
            messages: [
                userMessage('suc007', 'One decision was explicitly superseded by another.'),
                shardMessage('suc008', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: SUPERSEDED | ID: c05c2-browser-authority | SUPERSEDED-BY: c05c2-db-authority | DECISION: Keep browser-local state authoritative.
[S1:2] | STATUS: ACCEPTED | ID: c05c2-db-authority | SUPERSEDES: c05c2-browser-authority | DECISION: Move authority into the operational database.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.conflict',
            chatInstanceId: 'chat.c05c2.conflict.a',
            chatLocator: 'C0.5C2 Conflict A',
            scopeAlias: 'c05c2-conflict',
            messages: [
                userMessage('con001', 'This conflict should remain unresolved.'),
                shardMessage('con002', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: c05c2-conflict-decision | RECORD-VERSION: 1 | DECISION: Treat the browser as authoritative.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.conflict',
            chatInstanceId: 'chat.c05c2.conflict.b',
            chatLocator: 'C0.5C2 Conflict B',
            scopeAlias: 'c05c2-conflict',
            messages: [
                userMessage('con003', 'The same version now disagrees semantically.'),
                shardMessage('con004', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: ACCEPTED | ID: c05c2-conflict-decision | RECORD-VERSION: 1 | DECISION: Move authority into the operational database.

===END===`),
            ],
        },
        {
            memoryScopeId: 'scope.c0.5c2.malformed',
            chatInstanceId: 'chat.c05c2.malformed',
            chatLocator: 'C0.5C2 Malformed',
            scopeAlias: 'c05c2-malformed',
            messages: [
                userMessage('mal001', 'Malformed structured members must block canonicalization.'),
                shardMessage('mal002', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: c05c2-malformed-decision | RECORD-VERSION: 1 | DECISION: Keep the candidate deterministic.

===END===`),
                shardMessage('mal003', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: c05c2-malformed-decision | RECORD-VERSION: not-a-number | DECISION: Keep the candidate deterministic.

===END===`),
            ],
        },
    ];
}

export async function stageC05C2ProofFixtures(options = {}) {
    const hostRoots = options.hostRoots?.length ? options.hostRoots : DEFAULT_HOST_ROOTS;
    const fixtures = buildFixtures();
    const written = [];

    for (const hostRoot of hostRoots) {
        const userRoot = path.join(hostRoot, 'data', 'default-user');
        for (const fixture of fixtures) {
            const chatFilePath = await writeChat(userRoot, fixture);
            written.push({
                hostRoot,
                memoryScopeId: fixture.memoryScopeId,
                chatLocator: fixture.chatLocator,
                chatFilePath,
            });
        }
    }

    return {
        ok: true,
        fixtureCount: fixtures.length,
        hostCount: hostRoots.length,
        written,
    };
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const result = await stageC05C2ProofFixtures();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
