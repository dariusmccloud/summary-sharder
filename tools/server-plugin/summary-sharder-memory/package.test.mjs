import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { packageSummarySharderMemoryPlugin } from '../package-summary-sharder-memory.mjs';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-packaged-plugin-'));
}

function parseRelativeImports(sourceText) {
    const imports = [];
    const patterns = [
        /import\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /import\s*['"]([^'"]+)['"]/g,
        /export\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(sourceText)) !== null) {
            const specifier = match[1];
            if (specifier.startsWith('.')) {
                imports.push(specifier);
            }
        }
    }
    return [...new Set(imports)];
}

function resolveModulePath(fromFile, specifier) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
    }
    if (fs.existsSync(`${resolved}.js`)) {
        return `${resolved}.js`;
    }
    if (fs.existsSync(path.join(resolved, 'index.js'))) {
        return path.join(resolved, 'index.js');
    }
    throw new Error(`Unable to resolve ${specifier} from ${fromFile}`);
}

function assertImportsStayWithinRoot(entryFile, pluginRoot) {
    const stack = [entryFile];
    const visited = new Set();
    const resolvedFiles = new Set();

    while (stack.length > 0) {
        const current = stack.pop();
        const normalized = path.normalize(current);
        if (visited.has(normalized)) continue;
        visited.add(normalized);
        resolvedFiles.add(normalized);
        const source = fs.readFileSync(normalized, 'utf8');
        for (const specifier of parseRelativeImports(source)) {
            const resolved = resolveModulePath(normalized, specifier);
            const relative = path.relative(pluginRoot, resolved);
            assert.equal(relative.startsWith('..'), false, `Resolved import escaped plugin root: ${normalized} -> ${resolved}`);
            stack.push(resolved);
        }
    }

    return [...resolvedFiles].sort((a, b) => a.localeCompare(b));
}

function stagePackagedPlugin() {
    const tempRoot = makeTempRoot();
    const pluginRoot = path.join(tempRoot, 'plugins', 'summary-sharder-memory');
    const payloadManifest = packageSummarySharderMemoryPlugin({ outputPluginRoot: pluginRoot });

    return {
        tempRoot,
        pluginRoot,
        payloadManifest,
    };
}

async function writeSmokeChat(stageRoot, memoryScopeId, chatInstanceId, chatLocator) {
    const { buildManagedShardManifest } = await import(pathToFileURL(path.join(stageRoot, 'lib', 'core', 'summarization', 'shard-integrity-core.js')).href);

    function makeMessageId(suffix) {
        return `msg_${suffix.padEnd(32, '0').slice(0, 32)}`;
    }

    const userRoot = path.join(path.dirname(path.dirname(stageRoot)), 'user');
    const chatDir = path.join(userRoot, 'chats', 'PackagedSmoke');
    fs.mkdirSync(chatDir, { recursive: true });
    const chatFilePath = path.join(chatDir, `${chatLocator}.jsonl`);

    const messages = [
        {
            name: 'Chris',
            is_user: true,
            is_system: false,
            send_date: '2026-06-24T20:00:00.000Z',
            mes: 'Packaged plugin smoke A.',
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
            send_date: '2026-06-24T20:00:10.000Z',
            mes: 'Packaged plugin smoke B.',
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
            send_date: '2026-06-24T20:00:20.000Z',
            mes: `[MEMORY SHARD: Messages 0-1]\n\n[KEY]\nProfile: architectural-memory\nSchema: architectural-memory/v1\n\n[DECISIONS]\n[S1:1] | STATUS: PROPOSED | ID: packaged-plugin-smoke | DECISION: Self-contained plugin artifact can rebuild candidate state.\n\n===END===`,
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
                    chatId: chatLocator,
                    scopeAlias: 'packaged-smoke',
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
    return {
        userRoot,
        chatFilePath,
    };
}

test('packaged plugin stages only declared payload and resolves runtime imports within plugin root', async () => {
    const staged = stagePackagedPlugin();
    const payloadManifestPath = path.join(staged.pluginRoot, 'payload-manifest.json');

    assert.equal(fs.existsSync(payloadManifestPath), true);
    const resolvedFiles = assertImportsStayWithinRoot(path.join(staged.pluginRoot, 'index.js'), staged.pluginRoot);
    assert.equal(resolvedFiles.some((filePath) => filePath.includes('OneDrive')), false);
});

test('packaged plugin smoke succeeds under Node from staged payload only', async () => {
    const staged = stagePackagedPlugin();
    const { userRoot } = await writeSmokeChat(staged.pluginRoot, 'scope.packaged.node', 'chat.packaged.node', 'Packaged Node Smoke');
    const rebuildModule = await import(pathToFileURL(path.join(staged.pluginRoot, 'rebuild.js')).href);

    const request = {
        user: {
            directories: {
                root: userRoot,
                chats: path.join(userRoot, 'chats'),
                groupChats: path.join(userRoot, 'group chats'),
            },
        },
    };

    const init = await rebuildModule.initCandidateRebuildRun(request, {
        memoryScopeId: 'scope.packaged.node',
        requestKey: 'node-packaged-smoke',
        now: Date.now(),
    });
    const run = await rebuildModule.runCandidateRebuild(request, {
        reconstructionRunId: init.manifest.reconstructionRunId,
        now: Date.now(),
    });
    const report = rebuildModule.loadCandidateRebuildReport(request, init.manifest.reconstructionRunId);

    assert.equal(run.ok, true);
    assert.equal(report.report.status, 'success');
    assert.equal(typeof report.report.determinism.canonicalCandidateHash, 'string');
});

test('packaged plugin smoke succeeds under Bun from staged payload only', async () => {
    const staged = stagePackagedPlugin();
    const { userRoot } = await writeSmokeChat(staged.pluginRoot, 'scope.packaged.bun', 'chat.packaged.bun', 'Packaged Bun Smoke');
    const helperPath = path.join(staged.tempRoot, 'run-bun-smoke.mjs');
    fs.writeFileSync(helperPath, `
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginRoot = ${JSON.stringify(staged.pluginRoot)};
const userRoot = ${JSON.stringify(userRoot)};
const rebuildModule = await import(pathToFileURL(path.join(pluginRoot, 'rebuild.js')).href);
const request = {
  user: {
    directories: {
      root: userRoot,
      chats: path.join(userRoot, 'chats'),
      groupChats: path.join(userRoot, 'group chats'),
    },
  },
};
const init = await rebuildModule.initCandidateRebuildRun(request, {
  memoryScopeId: 'scope.packaged.bun',
  requestKey: 'bun-packaged-smoke',
  now: Date.now(),
});
const run = await rebuildModule.runCandidateRebuild(request, {
  reconstructionRunId: init.manifest.reconstructionRunId,
  now: Date.now(),
});
const report = rebuildModule.loadCandidateRebuildReport(request, init.manifest.reconstructionRunId);
console.log(JSON.stringify({
  ok: run.ok,
  status: report.report.status,
  hash: report.report.determinism.canonicalCandidateHash,
}, null, 2));
`, 'utf8');

    const bunResult = spawnSync('bun', [helperPath], {
        cwd: staged.tempRoot,
        encoding: 'utf8',
    });

    assert.equal(bunResult.status, 0, bunResult.stderr || bunResult.stdout);
    const payload = JSON.parse(bunResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'success');
    assert.equal(typeof payload.hash, 'string');
});
