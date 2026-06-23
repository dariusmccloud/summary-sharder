import fs from 'node:fs';
import path from 'node:path';

import {
    ARTIFACT_KIND,
    PLUGIN_ID,
    PROTOTYPE_VERSION,
    appendMetadataReceipt,
    buildAnchorArtifactHeader,
    buildAnchorEvent,
    buildHiddenReceiptRecord,
    buildReceipt,
    classifyReplay,
    collectMetadataReceipts,
    computeRevisionHash,
    createId,
    detectDuplicateChatInstanceIds,
    ensureRuntimeMetadata,
    getAnchorArtifactFromHeader,
    getAnchorEvent,
    getHiddenReceiptRecord,
    validateAnchorArtifact,
} from './core.js';

export const info = {
    id: PLUGIN_ID,
    name: 'Summary Sharder Memory Prototype',
    description: 'Host-substrate feasibility prototype for architectural authority anchor and receipts.',
};

const scopeLocks = new Map();

export async function init(router) {
    router.get('/health', async (_request, response) => {
        return response.send({
            ok: true,
            pluginId: PLUGIN_ID,
            prototypeVersion: PROTOTYPE_VERSION,
        });
    });

    router.post('/prototype/init-scope', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = requireString(request.body?.memoryScopeId, 'memoryScopeId');
            const result = await withScopeLock(memoryScopeId, async () => {
                ensureDirectory(anchorDirectory(chatRoot));
                const discovery = discoverScopeAnchors(chatRoot, memoryScopeId);

                if (discovery.status === 'ambiguous') {
                    return discovery;
                }

                if (discovery.status === 'found') {
                    return {
                        status: 'found',
                        anchor: serializeAnchorCandidate(discovery.anchor),
                    };
                }

                const filePath = path.join(anchorDirectory(chatRoot), `__summary_sharder_scope__${memoryScopeId}.jsonl`);
                const header = buildAnchorArtifactHeader(memoryScopeId);
                writeLinesAtomic(filePath, [header]);
                const created = readJsonlFile(filePath);
                return {
                    status: 'created',
                    anchor: serializeAnchorCandidate({
                        filePath,
                        header: created[0],
                        artifact: getAnchorArtifactFromHeader(created[0]),
                        validation: validateAnchorArtifact(getAnchorArtifactFromHeader(created[0]), memoryScopeId),
                        fileNameScopeId: memoryScopeId,
                    }),
                };
            });

            return response.send({ ok: true, ...result });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/prototype/load-anchor', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = requireString(request.query?.memoryScopeId ?? request.body?.memoryScopeId, 'memoryScopeId');
            const discovery = discoverScopeAnchors(chatRoot, memoryScopeId);

            if (discovery.status !== 'found') {
                return response.send({ ok: false, ...discovery });
            }

            const lines = readJsonlFile(discovery.anchor.filePath);
            const events = lines.slice(1).map(getAnchorEvent).filter(Boolean);

            return response.send({
                ok: true,
                status: 'found',
                anchor: serializeAnchorCandidate(discovery.anchor),
                eventCount: events.length,
                events,
                head: events.length > 0 ? events[events.length - 1].eventHash : null,
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/append-anchor-event', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = requireString(request.body?.memoryScopeId, 'memoryScopeId');
            const expectedHead = normalizeNullableString(request.body?.expectedHead);
            const canonicalRecord = request.body?.canonicalRecord;
            const decisionId = requireString(request.body?.decisionId, 'decisionId');
            const originChatInstanceId = requireString(request.body?.originChatInstanceId, 'originChatInstanceId');
            const originShardId = normalizeNullableString(request.body?.originShardId);
            const sourceRefs = Array.isArray(request.body?.sourceRefs) ? request.body.sourceRefs : [];

            const result = await withScopeLock(memoryScopeId, async () => {
                const discovery = discoverScopeAnchors(chatRoot, memoryScopeId);
                if (discovery.status !== 'found') {
                    return { ok: false, ...discovery };
                }

                const lines = readJsonlFile(discovery.anchor.filePath);
                const events = lines.slice(1).map(getAnchorEvent).filter(Boolean);
                const currentHead = events.length > 0 ? events[events.length - 1].eventHash : null;

                if (currentHead !== expectedHead) {
                    return {
                        ok: false,
                        status: 'conflict',
                        code: 'ARCH_VERSION_CONFLICT',
                        expectedHead,
                        actualHead: currentHead,
                    };
                }

                const eventRecord = buildAnchorEvent({
                    memoryScopeId,
                    decisionId,
                    expectedHead,
                    priorJournalHash: currentHead,
                    canonicalRecord,
                    originChatInstanceId,
                    originShardId,
                    sourceRefs,
                    sequence: events.length + 1,
                });

                lines.push(eventRecord);
                writeLinesAtomic(discovery.anchor.filePath, lines);
                const event = getAnchorEvent(eventRecord);

                return {
                    ok: true,
                    status: 'appended',
                    event,
                    actualHead: event.eventHash,
                };
            });

            const httpStatus = result.status === 'conflict' ? 409 : 200;
            return response.status(httpStatus).send(result);
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/write-receipt', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const target = resolveChatTarget(request);
            const mode = request.body?.surface === 'hidden-message' ? 'hidden-message' : 'metadata';
            const expectedRevision = requireString(request.body?.expectedRevision, 'expectedRevision');
            const memoryScopeId = requireString(request.body?.memoryScopeId, 'memoryScopeId');
            const event = request.body?.event;

            if (!event || typeof event !== 'object') {
                throw new Error('Missing event payload');
            }

            const currentText = fs.existsSync(target.filePath) ? fs.readFileSync(target.filePath, 'utf8') : '';
            const actualRevision = computeRevisionHash(currentText);
            if (actualRevision !== expectedRevision) {
                return response.status(409).send({
                    ok: false,
                    status: 'conflict',
                    code: 'ARCH_CHAT_REVISION_CONFLICT',
                    expectedRevision,
                    actualRevision,
                });
            }

            const lines = parseJsonlText(currentText);
            if (lines.length === 0) {
                throw new Error(`Target chat is empty or unreadable: ${target.filePath}`);
            }

            const header = lines[0];
            const runtimeDefaults = {
                chatInstanceId: normalizeNullableString(request.body?.chatInstanceId) ?? createId('chat'),
                memoryScopeId,
                branchedFromChatInstanceId: normalizeNullableString(request.body?.branchedFromChatInstanceId),
                importedFromChatInstanceId: normalizeNullableString(request.body?.importedFromChatInstanceId),
            };
            header.chat_metadata = ensureRuntimeMetadata(header.chat_metadata, runtimeDefaults);
            const currentChatInstanceId = header.chat_metadata.summarySharderRuntime.chatInstanceId;
            const duplicateRuntimeEntry = scanAllRuntimeEntries(chatRoot)
                .filter(entry => entry.filePath !== target.filePath)
                .find(entry => entry.chatInstanceId === currentChatInstanceId);

            if (duplicateRuntimeEntry) {
                return response.status(409).send({
                    ok: false,
                    status: 'conflict',
                    code: 'ARCH_CHAT_INSTANCE_CONFLICT',
                    chatInstanceId: currentChatInstanceId,
                    filePathHint: path.basename(target.filePath),
                    conflictingFilePathHint: path.basename(duplicateRuntimeEntry.filePath),
                });
            }

            const receipt = buildReceipt({
                event,
                originChatInstanceId: currentChatInstanceId,
                originShardId: normalizeNullableString(request.body?.originShardId),
            });

            if (mode === 'metadata') {
                header.chat_metadata = appendMetadataReceipt(header.chat_metadata, receipt);
            } else {
                const exists = lines.slice(1).some(line => getHiddenReceiptRecord(line)?.eventId === receipt.eventId);
                if (!exists) {
                    lines.push(buildHiddenReceiptRecord(receipt));
                }
            }

            writeLinesAtomic(target.filePath, lines);
            const nextText = fs.readFileSync(target.filePath, 'utf8');

            return response.send({
                ok: true,
                status: 'written',
                surface: mode,
                chatInstanceId: header.chat_metadata.summarySharderRuntime.chatInstanceId,
                revision: computeRevisionHash(nextText),
                filePathHint: path.basename(target.filePath),
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/scan-chat-runtime', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const target = resolveChatTarget(request);
            const text = fs.existsSync(target.filePath) ? fs.readFileSync(target.filePath, 'utf8') : '';
            const lines = parseJsonlText(text);
            const header = lines[0] ?? {};
            const runtime = header.chat_metadata?.summarySharderRuntime ?? null;
            const metadataReceipts = collectMetadataReceipts(header.chat_metadata, request.body?.memoryScopeId);
            const hiddenReceipts = lines.slice(1).map(getHiddenReceiptRecord).filter(Boolean)
                .filter(receipt => !request.body?.memoryScopeId || receipt.memoryScopeId === request.body.memoryScopeId);

            const runtimeEntries = scanAllRuntimeEntries(chatRoot);
            const duplicateChatInstanceIds = detectDuplicateChatInstanceIds(runtimeEntries);

            return response.send({
                ok: true,
                revision: computeRevisionHash(text),
                runtime,
                metadataReceiptCount: metadataReceipts.length,
                hiddenReceiptCount: hiddenReceipts.length,
                metadataReceipts,
                hiddenReceipts,
                duplicateChatInstanceIds,
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/verify-replay', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = requireString(request.body?.memoryScopeId, 'memoryScopeId');
            const discovery = discoverScopeAnchors(chatRoot, memoryScopeId);

            const anchorEvents = discovery.status === 'found'
                ? readJsonlFile(discovery.anchor.filePath).slice(1).map(getAnchorEvent).filter(Boolean)
                : [];

            const allRuntimeEntries = scanAllRuntimeEntries(chatRoot);
            const receiptRecords = [];
            const unavailableOriginChats = [];

            for (const entry of allRuntimeEntries) {
                try {
                    const lines = readJsonlFile(entry.filePath);
                    const header = lines[0] ?? {};
                    receiptRecords.push(...collectMetadataReceipts(header.chat_metadata, memoryScopeId));
                    receiptRecords.push(
                        ...lines.slice(1).map(getHiddenReceiptRecord).filter(Boolean).filter(receipt => receipt.memoryScopeId === memoryScopeId),
                    );
                } catch {
                    unavailableOriginChats.push(entry.filePath);
                }
            }

            const coverage = classifyReplay(anchorEvents, receiptRecords);
            coverage.unavailableOriginChats = unavailableOriginChats;
            if (coverage.classification === 'exact' && unavailableOriginChats.length > 0) {
                coverage.classification = 'incomplete';
            }

            return response.send({
                ok: true,
                anchorDiscovery: discovery.status,
                coverage,
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/simulate-conflict', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = requireString(request.body?.memoryScopeId, 'memoryScopeId');
            const discovery = discoverScopeAnchors(chatRoot, memoryScopeId);
            if (discovery.status !== 'found') {
                return response.status(404).send({ ok: false, ...discovery });
            }

            const lines = readJsonlFile(discovery.anchor.filePath);
            const events = lines.slice(1).map(getAnchorEvent).filter(Boolean);
            const expectedHead = events.length > 0 ? events[events.length - 1].eventHash : null;

            const basePayload = {
                memoryScopeId,
                expectedHead,
                canonicalRecord: request.body?.canonicalRecord ?? { test: true },
                originChatInstanceId: requireString(request.body?.originChatInstanceId, 'originChatInstanceId'),
                decisionId: requireString(request.body?.decisionId, 'decisionId'),
                originShardId: normalizeNullableString(request.body?.originShardId),
                sourceRefs: Array.isArray(request.body?.sourceRefs) ? request.body.sourceRefs : [],
            };

            const first = await appendEventWithLock(chatRoot, basePayload);
            const second = await appendEventWithLock(chatRoot, {
                ...basePayload,
                canonicalRecord: request.body?.secondCanonicalRecord ?? basePayload.canonicalRecord,
            });

            return response.send({
                ok: true,
                first,
                second,
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/prototype/cleanup', async (request, response) => {
        try {
            const chatRoot = getAuthenticatedChatRoot(request);
            const memoryScopeId = normalizeNullableString(request.body?.memoryScopeId);
            const removed = {
                anchors: [],
                malformedAnchors: [],
                metadataReceipts: 0,
                hiddenReceipts: 0,
            };

            const anchorListing = listScopeAnchors(chatRoot);
            if (anchorListing.status !== 'missing-directory') {
                for (const candidate of anchorListing.candidates) {
                    if (candidate.artifact.prototypeVersion !== PROTOTYPE_VERSION) {
                        continue;
                    }

                    if (memoryScopeId && candidate.artifact.memoryScopeId !== memoryScopeId) {
                        continue;
                    }

                    fs.unlinkSync(candidate.filePath);
                    removed.anchors.push(candidate.filePath);
                }

                for (const malformed of anchorListing.malformed) {
                    const fileNameScopeId = malformed.fileNameScopeId;
                    if (memoryScopeId && fileNameScopeId !== memoryScopeId) {
                        continue;
                    }

                    let prototypeVersion = null;
                    try {
                        const lines = readJsonlFile(malformed.filePath);
                        const header = lines[0] ?? {};
                        const fromExtra = header?.extra?.summarySharderPrototype?.prototypeVersion;
                        const fromMetadata = header?.chat_metadata?.summarySharderPrototype?.artifact?.prototypeVersion;
                        prototypeVersion = fromExtra ?? fromMetadata ?? null;
                    } catch {
                        prototypeVersion = null;
                    }

                    if (prototypeVersion !== PROTOTYPE_VERSION) {
                        continue;
                    }

                    fs.unlinkSync(malformed.filePath);
                    removed.malformedAnchors.push(malformed.filePath);
                }
            }

            for (const entry of walkJsonlFiles(chatRoot)) {
                if (entry.includes(`${path.sep}__summary_sharder_scopes__${path.sep}`)) {
                    continue;
                }

                let changed = false;
                const lines = readJsonlFile(entry);
                if (lines.length === 0) {
                    continue;
                }

                const header = lines[0];
                const allMetadataReceipts = Array.isArray(header?.chat_metadata?.summarySharderPrototypeReceipts)
                    ? header.chat_metadata.summarySharderPrototypeReceipts
                    : [];
                const keptMetadataReceipts = allMetadataReceipts.filter(receipt => receipt?.prototypeVersion !== PROTOTYPE_VERSION || (memoryScopeId && receipt?.memoryScopeId !== memoryScopeId));
                if (keptMetadataReceipts.length !== allMetadataReceipts.length) {
                    header.chat_metadata.summarySharderPrototypeReceipts = keptMetadataReceipts;
                    removed.metadataReceipts += allMetadataReceipts.length - keptMetadataReceipts.length;
                    changed = true;
                }

                const keptLines = [header];
                for (const line of lines.slice(1)) {
                    const receipt = getHiddenReceiptRecord(line);
                    if (receipt && receipt.prototypeVersion === PROTOTYPE_VERSION && (!memoryScopeId || receipt.memoryScopeId === memoryScopeId)) {
                        removed.hiddenReceipts += 1;
                        changed = true;
                        continue;
                    }

                    keptLines.push(line);
                }

                if (changed) {
                    writeLinesAtomic(entry, keptLines);
                }
            }

            return response.send({ ok: true, removed });
        } catch (error) {
            return handleError(response, error);
        }
    });
}

async function appendEventWithLock(chatRoot, payload) {
    return withScopeLock(payload.memoryScopeId, async () => {
        const discovery = discoverScopeAnchors(chatRoot, payload.memoryScopeId);
        if (discovery.status !== 'found') {
            return { ok: false, ...discovery };
        }

        const lines = readJsonlFile(discovery.anchor.filePath);
        const events = lines.slice(1).map(getAnchorEvent).filter(Boolean);
        const actualHead = events.length > 0 ? events[events.length - 1].eventHash : null;
        if (actualHead !== payload.expectedHead) {
            return {
                ok: false,
                status: 'conflict',
                code: 'ARCH_VERSION_CONFLICT',
                expectedHead: payload.expectedHead,
                actualHead,
            };
        }

        const eventRecord = buildAnchorEvent({
            ...payload,
            priorJournalHash: actualHead,
            sequence: events.length + 1,
        });
        lines.push(eventRecord);
        writeLinesAtomic(discovery.anchor.filePath, lines);
        const event = getAnchorEvent(eventRecord);
        return {
            ok: true,
            status: 'appended',
            actualHead: event.eventHash,
            event,
        };
    });
}

function getAuthenticatedChatRoot(request) {
    const chatRoot = request?.user?.directories?.chats;
    if (!chatRoot || typeof chatRoot !== 'string') {
        throw new Error('Authenticated chat root is unavailable');
    }

    return path.resolve(chatRoot);
}

function anchorDirectory(chatRoot) {
    return path.join(chatRoot, '__summary_sharder_scopes__');
}

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function resolveChatTarget(request) {
    const chatRoot = getAuthenticatedChatRoot(request);
    const avatarUrl = requireString(request.body?.avatarUrl ?? request.body?.avatar_url, 'avatarUrl');
    const fileName = requireString(request.body?.fileName ?? request.body?.file_name, 'fileName');
    const avatarBase = avatarUrl.replace('.png', '');
    const filePath = path.resolve(path.join(chatRoot, avatarBase, `${stripJsonl(fileName)}.jsonl`));
    ensurePathWithin(chatRoot, filePath);
    return { filePath };
}

function stripJsonl(fileName) {
    return fileName.endsWith('.jsonl') ? fileName.slice(0, -6) : fileName;
}

function ensurePathWithin(parent, target) {
    const relative = path.relative(path.resolve(parent), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Resolved path escaped authenticated chat root');
    }
}

function discoverScopeAnchors(chatRoot, expectedScopeId) {
    const { candidates, malformed, status } = listScopeAnchors(chatRoot);
    if (status === 'missing-directory') {
        return { status };
    }

    const matching = candidates.filter(candidate => candidate.artifact.memoryScopeId === expectedScopeId);
    if (matching.length > 1) {
        return {
            status: 'ambiguous',
            code: 'ARCH_ANCHOR_AMBIGUOUS',
            anchors: matching.map(serializeAnchorCandidate),
            malformed,
        };
    }

    if (matching.length === 1) {
        const candidate = matching[0];
        const fileNameScopeMismatch = candidate.fileNameScopeId && candidate.fileNameScopeId !== expectedScopeId;
        return {
            status: 'found',
            anchor: {
                ...candidate,
                fileNameScopeMismatch,
            },
            malformed,
        };
    }

    return {
        status: 'not-found',
        malformed,
        unrelatedFiles: candidates.filter(candidate => candidate.artifact.memoryScopeId !== expectedScopeId).map(serializeAnchorCandidate),
    };
}

function listScopeAnchors(chatRoot) {
    const dirPath = anchorDirectory(chatRoot);
    if (!fs.existsSync(dirPath)) {
        return {
            status: 'missing-directory',
            candidates: [],
            malformed: [],
        };
    }

    const files = fs.readdirSync(dirPath)
        .filter(fileName => fileName.endsWith('.jsonl'))
        .map(fileName => path.join(dirPath, fileName));

    const candidates = [];
    const malformed = [];

    for (const filePath of files) {
        try {
            const lines = readJsonlFile(filePath);
            const header = lines[0];
            const artifact = getAnchorArtifactFromHeader(header);
            const validation = validateAnchorArtifact(artifact);
            const fileNameScopeId = parseScopeIdFromFileName(path.basename(filePath));

            if (!validation.valid) {
                malformed.push({
                    filePath,
                    reason: validation.reason,
                    fileNameScopeId,
                });
                continue;
            }

            candidates.push({
                filePath,
                header,
                artifact,
                validation,
                fileNameScopeId,
            });
        } catch (error) {
            malformed.push({
                filePath,
                reason: `unreadable:${error.message}`,
                fileNameScopeId: parseScopeIdFromFileName(path.basename(filePath)),
            });
        }
    }

    return {
        status: 'ok',
        candidates,
        malformed,
    };
}

function parseScopeIdFromFileName(fileName) {
    const match = fileName.match(/__summary_sharder_scope__(.+)\.jsonl$/);
    return match ? match[1] : null;
}

function serializeAnchorCandidate(candidate) {
    return {
        filePath: candidate.filePath,
        fileName: path.basename(candidate.filePath),
        memoryScopeId: candidate.artifact?.memoryScopeId ?? null,
        fileNameScopeId: candidate.fileNameScopeId ?? null,
        kind: candidate.artifact?.kind ?? null,
        schemaVersion: candidate.artifact?.schemaVersion ?? null,
        prototypeVersion: candidate.artifact?.prototypeVersion ?? null,
        fileNameScopeMismatch: !!candidate.fileNameScopeMismatch,
    };
}

function scanAllRuntimeEntries(chatRoot) {
    const entries = [];
    if (!fs.existsSync(chatRoot)) {
        return entries;
    }

    for (const entry of walkJsonlFiles(chatRoot)) {
        if (entry.includes(`${path.sep}__summary_sharder_scopes__${path.sep}`)) {
            continue;
        }

        try {
            const lines = readJsonlFile(entry);
            const header = lines[0] ?? {};
            const runtime = header.chat_metadata?.summarySharderRuntime;
            if (!runtime) {
                continue;
            }

            entries.push({
                filePath: entry,
                chatInstanceId: runtime.chatInstanceId ?? null,
                memoryScopeId: runtime.memoryScopeId ?? null,
                branchedFromChatInstanceId: runtime.branchedFromChatInstanceId ?? null,
                importedFromChatInstanceId: runtime.importedFromChatInstanceId ?? null,
            });
        } catch {
            continue;
        }
    }

    return entries;
}

function* walkJsonlFiles(dirPath) {
    const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
        const fullPath = path.join(dirPath, dirent.name);
        if (dirent.isDirectory()) {
            yield* walkJsonlFiles(fullPath);
            continue;
        }

        if (dirent.isFile() && dirent.name.endsWith('.jsonl')) {
            yield fullPath;
        }
    }
}

function parseJsonlText(text) {
    const rawLines = String(text ?? '').split(/\r?\n/).filter(line => line.trim().length > 0);
    return rawLines.map(line => JSON.parse(line));
}

function readJsonlFile(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    return parseJsonlText(text);
}

function writeLinesAtomic(filePath, lines) {
    const nextText = `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, nextText, 'utf8');
    fs.renameSync(tempPath, filePath);
}

async function withScopeLock(scopeId, operation) {
    const previous = scopeLocks.get(scopeId) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => {
        release = resolve;
    });

    scopeLocks.set(scopeId, previous.then(() => current));
    await previous;

    try {
        return await operation();
    } finally {
        release();
        if (scopeLocks.get(scopeId) === current) {
            scopeLocks.delete(scopeId);
        }
    }
}

function requireString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Missing required field: ${fieldName}`);
    }

    return value.trim();
}

function normalizeNullableString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function handleError(response, error) {
    console.error(`[${PLUGIN_ID}]`, error);
    return response.status(500).send({
        ok: false,
        error: error.message,
    });
}
