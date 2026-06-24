import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildManagedShardManifest } from '../../../core/summarization/shard-integrity-core.js';
import {
    initCandidateRebuildRun,
    runCandidateRebuild,
} from './rebuild.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-rebuild-tier2-'));
}

function makeMessageId(suffix) {
    return `msg_${suffix.padEnd(32, '0').slice(0, 32)}`;
}

async function writeChat(root, options = {}) {
    const memoryScopeId = options.memoryScopeId || 'scope_alpha';
    const chatInstanceId = options.chatInstanceId || 'chat_alpha';
    const chatLocator = options.chatLocator || 'Session A';
    const chatsRoot = path.join(root, 'chats');
    const charDir = path.join(chatsRoot, 'Jeep');
    fs.mkdirSync(charDir, { recursive: true });
    const chatFilePath = path.join(charDir, `${chatLocator}.jsonl`);
    const messages = options.messages || [];

    const shardMessageIndex = messages.findIndex((entry) => entry.is_system === true && /\[MEMORY SHARD:/u.test(String(entry.mes || '')));
    let shardManifest = null;
    if (shardMessageIndex >= 0) {
        shardManifest = await buildManagedShardManifest(messages, {
            startIndex: 0,
            endIndex: Math.max(0, shardMessageIndex - 1),
            artifactKind: 'system-shard',
            outputUID: messages[shardMessageIndex].send_date,
            promptPolicy: 'replace_source',
            now: Date.now(),
            cryptoApi: globalThis.crypto,
        });
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
                    chatId: chatLocator,
                    scopeAlias: '',
                    boundAt: Date.now(),
                    updatedAt: Date.now(),
                    branchedFromChatInstanceId: options.branchedFromChatInstanceId || null,
                },
                shardManifests: shardManifest ? [shardManifest] : [],
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

function userMessage(idSuffix, mes, overrides = {}) {
    return {
        name: 'Chris',
        is_user: true,
        is_system: false,
        send_date: overrides.send_date || `2026-06-24T10:00:${idSuffix.slice(0, 2)}.000Z`,
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
                ...(overrides.summary_sharder || {}),
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
        send_date: overrides.send_date || `2026-06-24T10:10:${idSuffix.slice(0, 2)}.000Z`,
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

test('explicit Tier-1 record id corroborates deterministically without duplicate authority record', async () => {
    const root = makeTempRoot();
    await writeChat(root, {
        messages: [
            userMessage('a1', 'Decision gain-modulation-boundary: Keep browser-local state non-authoritative.'),
            shardMessage('a2', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: gain-modulation-boundary | DECISION: Keep browser-local state non-authoritative.

===END===`),
        ],
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_alpha', requestKey: 'tier2-corroborate', now: Date.now() });
    const run = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(run.ok, true);
    assert.equal(run.report.outputSummary.candidateAuthorityRecordCount, 1);
    assert.equal(run.report.inputSummary.tier2ClaimsDetected, 1);
    assert.equal(run.report.coverage.corroborated.count, 1);
    assert.equal(run.report.tier2Claims[0].admissionStatus, 'admitted');
});

test('exact decision text without explicit id becomes possible corroboration review only', async () => {
    const root = makeTempRoot();
    await writeChat(root, {
        messages: [
            userMessage('b1', 'We should keep browser-local state non-authoritative.'),
            shardMessage('b2', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: gain-modulation-boundary | DECISION: Keep browser-local state non-authoritative.

===END===`),
        ],
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_alpha', requestKey: 'tier2-review-only', now: Date.now() });
    const run = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(run.ok, true);
    assert.equal(run.report.outputSummary.candidateAuthorityRecordCount, 1);
    assert.equal(run.report.tier2Claims[0].admissionStatus, 'review_only');
    assert.equal(run.report.reviewItems[0].reviewKind, 'POSSIBLE_CORROBORATION');
});

test('branch copies do not count as independent corroboration', async () => {
    const root = makeTempRoot();
    const sharedInitFingerprint = 'sha256:shared-lineage';
    await writeChat(root, {
        chatInstanceId: 'chat_parent',
        chatLocator: 'Session Parent',
        messages: [
            userMessage('c1', 'Decision gain-modulation-boundary: Keep browser-local state non-authoritative.', { initFingerprint: sharedInitFingerprint }),
            shardMessage('c2', `[MEMORY SHARD: Messages 0-0]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] | STATUS: PROPOSED | ID: gain-modulation-boundary | DECISION: Keep browser-local state non-authoritative.

===END===`),
        ],
    });
    await writeChat(root, {
        chatInstanceId: 'chat_branch',
        branchedFromChatInstanceId: 'chat_parent',
        chatLocator: 'Session Branch',
        messages: [
            userMessage('c3', 'Decision gain-modulation-boundary: Keep browser-local state non-authoritative.', { initFingerprint: sharedInitFingerprint }),
        ],
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_alpha', requestKey: 'tier2-lineage', now: Date.now() });
    const run = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(run.ok, true);
    assert.equal(run.report.inputSummary.tier2ClaimsDetected, 2);
    assert.equal(run.report.coverage.corroborated.count, 1);
});

test('evidence policy exclusion blocks deterministic admission', async () => {
    const root = makeTempRoot();
    await writeChat(root, {
        messages: [
            userMessage('d1', 'Decision blocked-candidate: Keep browser-local state non-authoritative.', {
                summary_sharder: {
                    evidencePolicy: 'exclude',
                },
            }),
        ],
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_alpha', requestKey: 'tier2-exclude', now: Date.now() });
    const run = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(run.ok, true);
    assert.equal(run.report.outputSummary.candidateAuthorityRecordCount, 0);
    assert.equal(run.report.inputSummary.tier2ClaimsBlocked, 1);
    assert.equal(run.report.tier2Claims[0].admissionStatus, 'blocked');
});

test('mention-only detections are compacted without changing detailed counts', async () => {
    const root = makeTempRoot();
    await writeChat(root, {
        messages: [
            userMessage('e1', '```text\nDecision gain-modulation-boundary: Keep browser-local state non-authoritative.\n```'),
            userMessage('e2', '```json\n{"decision":"gain-modulation-boundary"}\n```'),
        ],
    });
    const request = buildRequest(root);
    const init = await initCandidateRebuildRun(request, { memoryScopeId: 'scope_alpha', requestKey: 'tier2-mention-compact', now: Date.now() });
    const run = await runCandidateRebuild(request, { reconstructionRunId: init.manifest.reconstructionRunId, now: Date.now() });

    assert.equal(run.ok, true);
    assert.equal(run.report.tier2Summary.mentionOnly, 2);
    assert.equal(run.report.reviewSummary.reconciliation.mentionOnlySummaryCount, 2);
    assert.equal(run.report.reviewSummary.reconciliation.mentionOnlyBucketCount, 2);
    assert.equal(run.report.reviewSummary.reconciliation.mentionOnlyDetailedRowCount, 2);
    assert.equal(run.report.reviewSummary.reconciliation.mentionOnlyCountsMatch, true);
    assert.equal(run.report.detailedReview.mentionOnlyRows.length, 2);
    assert.equal(run.report.detailedReview.mentionOnlyRows[0].stableSourceIdentity.localeCompare(run.report.detailedReview.mentionOnlyRows[1].stableSourceIdentity) <= 0, true);
});
