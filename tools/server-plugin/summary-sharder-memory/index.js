import {
    CAPABILITIES,
    JOURNAL_MODE,
    PLUGIN_ID,
    SCHEMA_VERSION,
    SERVICE_VERSION,
    buildHealthResponse,
    cloneJson,
    createError,
    createId,
    getAuthenticatedUserRoot,
    getStoragePaths,
    handleError,
    hydrateDecisionRecord,
    loadManifest,
    MESSAGE_IDENTITY_SCAN_SCHEMA,
    normalizeChatLocator,
    nowTimestamp,
    openOperationalDatabase,
    parseNullableJson,
    readCurrentDecision,
    scanPersistedChatMetadata,
    sanitizeIdentifier,
    snapshotOperationalDatabase,
    validateArray,
} from './core.js';

export const info = {
    id: PLUGIN_ID,
    name: 'Summary Sharder Memory',
    description: 'Architectural Memory operational database companion plugin.',
};

export async function init(router) {
    router.get('/health', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const adapter = openOperationalDatabase(paths);
            try {
                const manifest = loadManifest(adapter);
                return response.send(buildHealthResponse(adapter, manifest));
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/capabilities', async (_request, response) => {
        return response.send({
            ok: true,
            pluginId: PLUGIN_ID,
            serviceVersion: SERVICE_VERSION,
            schemaVersion: SCHEMA_VERSION,
            capabilities: CAPABILITIES,
        });
    });

    router.get('/c0-25a/schema', async (_request, response) => {
        return response.send({
            ok: true,
            phase: 'c0.25a',
            schema: cloneJson(MESSAGE_IDENTITY_SCAN_SCHEMA),
            capabilities: CAPABILITIES.c0_25a,
        });
    });

    router.post('/c0-25a/scan-chat', async (request, response) => {
        try {
            const result = scanPersistedChatMetadata(request, {
                isGroup: request.body?.isGroup === true,
                groupId: request.body?.groupId || null,
                avatarUrl: request.body?.avatarUrl || null,
                chatLocator: request.body?.chatLocator || null,
            });
            return response.send({
                ok: true,
                phase: 'c0.25a',
                ...result,
            });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/init', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const adapter = openOperationalDatabase(paths);
            try {
                const manifest = loadManifest(adapter);
                snapshotOperationalDatabase(adapter, paths);
                return response.send({
                    ok: true,
                    pluginId: PLUGIN_ID,
                    serviceVersion: SERVICE_VERSION,
                    manifest: buildManifestPayload(paths, adapter, manifest),
                });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/manifest', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const adapter = openOperationalDatabase(paths);
            try {
                const manifest = loadManifest(adapter);
                return response.send({
                    ok: true,
                    manifest: buildManifestPayload(paths, adapter, manifest),
                });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/scopes/ensure', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.body?.memoryScopeId, 'memoryScopeId');
            const scopeAlias = String(request.body?.scopeAlias || '').trim();
            const timestamp = nowTimestamp(request.body?.now);

            const adapter = openOperationalDatabase(paths);
            try {
                const registry = ensureScope(adapter, memoryScopeId, scopeAlias, timestamp);
                snapshotOperationalDatabase(adapter, paths);
                return response.send({ ok: true, registry });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/scopes/:memoryScopeId', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const adapter = openOperationalDatabase(paths);
            try {
                const registry = loadScope(adapter, memoryScopeId);
                if (!registry) {
                    throw createError(404, `Scope ${memoryScopeId} was not found`, 'ARCH_SCOPE_NOT_FOUND');
                }
                return response.send({ ok: true, registry });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/scopes/:memoryScopeId/bind-chat', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const chatInstanceId = sanitizeIdentifier(request.body?.chatInstanceId, 'chatInstanceId');
            const chatLocator = normalizeChatLocator(request.body?.chatLocator);
            if (!chatLocator) {
                throw createError(400, 'chatLocator is required', 'ARCH_INVALID_CHAT_LOCATOR');
            }

            const scopeAlias = String(request.body?.scopeAlias || '').trim();
            const timestamp = nowTimestamp(request.body?.now);
            const branchedFromChatInstanceId = request.body?.branchedFromChatInstanceId
                ? sanitizeIdentifier(request.body.branchedFromChatInstanceId, 'branchedFromChatInstanceId')
                : null;
            const importedFromChatInstanceId = request.body?.importedFromChatInstanceId
                ? sanitizeIdentifier(request.body.importedFromChatInstanceId, 'importedFromChatInstanceId')
                : null;

            const adapter = openOperationalDatabase(paths);
            try {
                const registry = ensureScope(adapter, memoryScopeId, scopeAlias, timestamp);
                const binding = bindChat(adapter, {
                    memoryScopeId,
                    chatInstanceId,
                    chatLocator,
                    scopeAlias: registry.scopeAlias || scopeAlias,
                    branchedFromChatInstanceId,
                    importedFromChatInstanceId,
                    timestamp,
                });
                snapshotOperationalDatabase(adapter, paths);
                return response.send({ ok: true, registry, binding });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/scopes/:memoryScopeId/decisions/current', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const ids = String(request.query?.ids || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
                .map((value) => sanitizeIdentifier(value, 'decisionId'));

            const adapter = openOperationalDatabase(paths);
            try {
                const decisions = {};
                for (const decisionId of ids) {
                    const authority = readCurrentDecision(adapter, memoryScopeId, decisionId);
                    if (authority?.pointer) {
                        decisions[decisionId] = authority;
                    }
                }
                return response.send({ ok: true, decisions });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/scopes/:memoryScopeId/decisions/:decisionId', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const decisionId = sanitizeIdentifier(request.params.decisionId, 'decisionId');
            const adapter = openOperationalDatabase(paths);
            try {
                const authority = readCurrentDecision(adapter, memoryScopeId, decisionId);
                if (!authority?.pointer) {
                    throw createError(404, `Decision ${decisionId} was not found`, 'ARCH_DECISION_NOT_FOUND');
                }
                return response.send({ ok: true, authority });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.get('/scopes/:memoryScopeId/projections/:chatInstanceId', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const chatInstanceId = sanitizeIdentifier(request.params.chatInstanceId, 'chatInstanceId');
            const adapter = openOperationalDatabase(paths);
            try {
                const binding = adapter.get(
                    'SELECT * FROM chat_bindings WHERE chat_instance_id = ? AND memory_scope_id = ?',
                    [chatInstanceId, memoryScopeId],
                );
                if (!binding) {
                    throw createError(404, `Projection binding ${chatInstanceId} was not found`, 'ARCH_PROJECTION_NOT_FOUND');
                }
                return response.send({
                    ok: true,
                    binding: {
                        chatInstanceId: binding.chat_instance_id,
                        memoryScopeId: binding.memory_scope_id,
                        chatLocator: binding.chat_locator,
                        scopeAlias: binding.scope_alias,
                        branchedFromChatInstanceId: binding.branched_from_chat_instance_id,
                        importedFromChatInstanceId: binding.imported_from_chat_instance_id,
                        boundAt: Number(binding.bound_at),
                        updatedAt: Number(binding.updated_at),
                    },
                });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/scopes/:memoryScopeId/commit', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const memoryScopeId = sanitizeIdentifier(request.params.memoryScopeId, 'memoryScopeId');
            const scopeAlias = String(request.body?.scopeAlias || '').trim();
            const sourceChatInstanceId = request.body?.sourceChatInstanceId
                ? sanitizeIdentifier(request.body.sourceChatInstanceId, 'sourceChatInstanceId')
                : null;
            const expectedScopeVersion = request.body?.expectedScopeVersion === null || request.body?.expectedScopeVersion === undefined
                ? null
                : Number(request.body.expectedScopeVersion);
            const expectedDecisionVersionsById = normalizeExpectedVersions(request.body?.expectedDecisionVersionsById || {});
            const decisions = validateArray(request.body?.decisions || [], 'decisions')
                .map(normalizeDecisionPayload);
            const timestamp = nowTimestamp(request.body?.now);

            const adapter = openOperationalDatabase(paths);
            try {
                const result = adapter.transaction(() => commitAuthorityUpdate(adapter, {
                    memoryScopeId,
                    scopeAlias,
                    expectedScopeVersion,
                    expectedDecisionVersionsById,
                    decisions,
                    sourceChatInstanceId,
                    timestamp,
                }));
                snapshotOperationalDatabase(adapter, paths);
                return response.send({ ok: true, ...result });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/validate-browser-migration', async (request, response) => {
        try {
            const payload = normalizeBrowserMigrationPayload(request.body?.payload || {});
            const summary = summarizeMigrationPayload(payload);
            return response.send({ ok: true, summary });
        } catch (error) {
            return handleError(response, error);
        }
    });

    router.post('/migrate-browser-store', async (request, response) => {
        try {
            const paths = getStoragePaths(getAuthenticatedUserRoot(request));
            const payload = normalizeBrowserMigrationPayload(request.body?.payload || {});
            const timestamp = nowTimestamp(request.body?.now);
            const adapter = openOperationalDatabase(paths);
            try {
                const summary = adapter.transaction(() => importBrowserMigrationPayload(adapter, payload, timestamp));
                snapshotOperationalDatabase(adapter, paths);
                return response.send({ ok: true, summary });
            } finally {
                adapter.close();
            }
        } catch (error) {
            return handleError(response, error);
        }
    });
}

function buildManifestPayload(paths, adapter, manifest) {
    return {
        ...manifest,
        pluginId: PLUGIN_ID,
        dbPath: paths.dbPath,
        snapshotPath: paths.snapshotPath,
        runtime: adapter.runtime,
        capabilities: CAPABILITIES,
    };
}

function ensureScope(adapter, memoryScopeId, scopeAlias, timestamp) {
    const existing = loadScope(adapter, memoryScopeId);
    if (existing) {
        return existing;
    }

    adapter.run(
        'INSERT INTO memory_scopes (memory_scope_id, scope_alias, scope_version, current_scope_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [memoryScopeId, scopeAlias, 1, 0, timestamp, timestamp],
    );
    touchManifest(adapter, timestamp);
    return loadScope(adapter, memoryScopeId);
}

function loadScope(adapter, memoryScopeId) {
    const scope = adapter.get('SELECT * FROM memory_scopes WHERE memory_scope_id = ?', [memoryScopeId]);
    if (!scope) {
        return null;
    }
    const bindings = adapter.all('SELECT * FROM chat_bindings WHERE memory_scope_id = ? ORDER BY updated_at ASC', [memoryScopeId]);
    return {
        memoryScopeId: scope.memory_scope_id,
        scopeAlias: scope.scope_alias,
        scopeVersion: Number(scope.scope_version),
        currentScopeRun: Number(scope.current_scope_run),
        createdAt: Number(scope.created_at),
        updatedAt: Number(scope.updated_at),
        chatBindings: Object.fromEntries(
            bindings.map((binding) => [binding.chat_instance_id, {
                chatInstanceId: binding.chat_instance_id,
                memoryScopeId: binding.memory_scope_id,
                chatLocator: binding.chat_locator,
                scopeAlias: binding.scope_alias,
                branchedFromChatInstanceId: binding.branched_from_chat_instance_id,
                importedFromChatInstanceId: binding.imported_from_chat_instance_id,
                boundAt: Number(binding.bound_at),
                updatedAt: Number(binding.updated_at),
            }]),
        ),
    };
}

function bindChat(adapter, options) {
    const existingById = adapter.get(
        'SELECT * FROM chat_bindings WHERE chat_instance_id = ?',
        [options.chatInstanceId],
    );
    if (existingById && (existingById.memory_scope_id !== options.memoryScopeId || existingById.chat_locator !== options.chatLocator)) {
        throw createError(409, `Chat instance ${options.chatInstanceId} is already bound elsewhere`, 'ARCH_CHAT_INSTANCE_CONFLICT');
    }

    const existingByLocator = adapter.get(
        'SELECT * FROM chat_bindings WHERE chat_locator = ? AND memory_scope_id = ?',
        [options.chatLocator, options.memoryScopeId],
    );

    if (existingByLocator && existingByLocator.chat_instance_id !== options.chatInstanceId) {
        throw createError(409, `Chat locator ${options.chatLocator} is already bound to a different chat instance`, 'ARCH_CHAT_LOCATOR_CONFLICT');
    }

    if (existingById) {
        adapter.run(
            `UPDATE chat_bindings
                SET scope_alias = ?, branched_from_chat_instance_id = ?, imported_from_chat_instance_id = ?, updated_at = ?
              WHERE chat_instance_id = ?`,
            [
                options.scopeAlias,
                options.branchedFromChatInstanceId,
                options.importedFromChatInstanceId,
                options.timestamp,
                options.chatInstanceId,
            ],
        );
    } else {
        adapter.run(
            `INSERT INTO chat_bindings (
                chat_instance_id, memory_scope_id, chat_locator, scope_alias,
                branched_from_chat_instance_id, imported_from_chat_instance_id, bound_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                options.chatInstanceId,
                options.memoryScopeId,
                options.chatLocator,
                options.scopeAlias,
                options.branchedFromChatInstanceId,
                options.importedFromChatInstanceId,
                options.timestamp,
                options.timestamp,
            ],
        );
    }

    touchManifest(adapter, options.timestamp);
    return loadScope(adapter, options.memoryScopeId).chatBindings[options.chatInstanceId];
}

function normalizeExpectedVersions(value) {
    const output = {};
    for (const [key, version] of Object.entries(value || {})) {
        output[sanitizeIdentifier(key, 'decisionId')] = Number(version);
    }
    return output;
}

function normalizeDecisionPayload(value) {
    const decisionId = sanitizeIdentifier(value?.decisionId, 'decisionId');
    const canonicalHash = String(value?.canonicalHash || '').trim();
    if (!canonicalHash) {
        throw createError(400, `Decision ${decisionId} is missing canonicalHash`, 'ARCH_INVALID_DECISION_PAYLOAD');
    }
    return {
        decisionId,
        status: String(value?.status || '').trim(),
        sourceRef: value?.sourceRef ? String(value.sourceRef).trim() : null,
        content: String(value?.content || ''),
        fields: cloneJson(value?.fields || {}),
        semanticPayload: String(value?.semanticPayload || ''),
        canonicalHash,
        canonicalHashVersion: Number(value?.canonicalHashVersion || 1),
        hashAlgorithm: String(value?.hashAlgorithm || 'SHA-256'),
        parserErrors: Array.isArray(value?.parserErrors) ? value.parserErrors.map((entry) => String(entry)) : [],
        parserWarnings: Array.isArray(value?.parserWarnings) ? value.parserWarnings.map((entry) => String(entry)) : [],
    };
}

function touchManifest(adapter, timestamp) {
    adapter.run('UPDATE manifest SET updated_at = ? WHERE id = 1', [timestamp]);
}

function commitAuthorityUpdate(adapter, options) {
    const registry = ensureScope(adapter, options.memoryScopeId, options.scopeAlias, options.timestamp);
    if (options.expectedScopeVersion !== null && Number(registry.scopeVersion) !== Number(options.expectedScopeVersion)) {
        throw createError(409, 'Scope version conflict', 'ARCH_SCOPE_VERSION_CONFLICT', {
            currentScopeVersion: registry.scopeVersion,
        });
    }

    const projectionState = {};

    for (const decision of options.decisions) {
        if (decision.parserErrors.length > 0) {
            continue;
        }

        const authority = readCurrentDecision(adapter, options.memoryScopeId, decision.decisionId);
        const currentPointer = authority?.pointer || null;
        const currentRecord = authority?.record || null;
        const expectedDecisionVersion = options.expectedDecisionVersionsById?.[decision.decisionId] ?? null;

        if (currentPointer && expectedDecisionVersion !== null
            && Number(currentPointer.currentRecordVersion) !== Number(expectedDecisionVersion)) {
            throw createError(409, `Decision ${decision.decisionId} version conflict`, 'ARCH_DECISION_VERSION_CONFLICT', {
                recordId: decision.decisionId,
                currentRecordVersion: currentPointer.currentRecordVersion,
                expectedRecordVersion: expectedDecisionVersion,
            });
        }

        if (currentPointer && expectedDecisionVersion === null
            && currentRecord?.canonicalHash
            && currentRecord.canonicalHash !== decision.canonicalHash) {
            throw createError(409, `Decision ${decision.decisionId} update is unproven without an expected version`, 'ARCH_DECISION_UNPROVEN_COLLISION', {
                recordId: decision.decisionId,
            });
        }

        let nextRecordVersion = currentPointer?.currentRecordVersion || 0;
        let pointerPayload = currentPointer;
        let changed = false;

        if (!currentRecord) {
            nextRecordVersion = 1;
            insertDecisionRecord(adapter, options.memoryScopeId, decision, {
                recordVersion: nextRecordVersion,
                priorVersion: null,
                sourceChatInstanceId: options.sourceChatInstanceId,
                lastUpdatingChatInstanceId: options.sourceChatInstanceId,
                provenance: buildProvenance(decision, options.sourceChatInstanceId),
                timestamp: options.timestamp,
            });
            pointerPayload = {
                memoryScopeId: options.memoryScopeId,
                decisionId: decision.decisionId,
                currentRecordVersion: nextRecordVersion,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                authorityLocation: 'active',
                archivePointer: null,
                stubPointer: null,
                updatedAt: options.timestamp,
            };
            upsertCurrentDecision(adapter, pointerPayload);
            changed = true;
        } else if (currentRecord.canonicalHash !== decision.canonicalHash) {
            nextRecordVersion = Number(currentPointer.currentRecordVersion || currentRecord.recordVersion || 0) + 1;
            insertDecisionRecord(adapter, options.memoryScopeId, decision, {
                recordVersion: nextRecordVersion,
                priorVersion: currentRecord.recordVersion,
                sourceChatInstanceId: currentRecord.sourceChatInstanceId || options.sourceChatInstanceId,
                lastUpdatingChatInstanceId: options.sourceChatInstanceId,
                provenance: mergeProvenance(currentRecord.provenance || [], buildProvenance(decision, options.sourceChatInstanceId)),
                timestamp: options.timestamp,
            });
            pointerPayload = {
                ...currentPointer,
                currentRecordVersion: nextRecordVersion,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                authorityLocation: 'active',
                archivePointer: null,
                stubPointer: null,
                updatedAt: options.timestamp,
            };
            upsertCurrentDecision(adapter, pointerPayload);
            changed = true;
        }

        if (!pointerPayload) {
            continue;
        }

        projectionState[decision.decisionId] = {
            memoryScopeId: options.memoryScopeId,
            decisionId: decision.decisionId,
            currentRecordVersion: pointerPayload.currentRecordVersion || nextRecordVersion,
            canonicalHash: pointerPayload.canonicalHash || decision.canonicalHash,
            canonicalHashVersion: pointerPayload.canonicalHashVersion || decision.canonicalHashVersion,
            hashAlgorithm: pointerPayload.hashAlgorithm || decision.hashAlgorithm,
            authorityLocation: pointerPayload.authorityLocation || 'active',
        };

        if (changed) {
            // no-op branch; changed is retained for clarity
        }
    }

    adapter.run(
        'UPDATE memory_scopes SET scope_alias = ?, scope_version = ?, current_scope_run = ?, updated_at = ? WHERE memory_scope_id = ?',
        [
            registry.scopeAlias || options.scopeAlias || '',
            Number(registry.scopeVersion || 0) + 1,
            Number(registry.currentScopeRun || 0) + 1,
            options.timestamp,
            options.memoryScopeId,
        ],
    );
    touchManifest(adapter, options.timestamp);

    return {
        registry: loadScope(adapter, options.memoryScopeId),
        projectionState,
    };
}

function insertDecisionRecord(adapter, memoryScopeId, decision, options) {
    adapter.run(
        `INSERT INTO decision_records (
            memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
            hash_algorithm, semantic_payload, fields_json, status, prior_version,
            source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            memoryScopeId,
            decision.decisionId,
            options.recordVersion,
            decision.canonicalHash,
            decision.canonicalHashVersion,
            decision.hashAlgorithm,
            decision.semanticPayload,
            JSON.stringify(decision.fields || {}),
            decision.status || '',
            options.priorVersion,
            options.sourceChatInstanceId,
            options.lastUpdatingChatInstanceId,
            JSON.stringify(options.provenance || []),
            options.timestamp,
            options.timestamp,
        ],
    );
}

function upsertCurrentDecision(adapter, pointer) {
    const existing = adapter.get(
        'SELECT decision_id FROM current_decisions WHERE memory_scope_id = ? AND decision_id = ?',
        [pointer.memoryScopeId, pointer.decisionId],
    );

    const params = [
        pointer.currentRecordVersion,
        pointer.canonicalHash,
        pointer.canonicalHashVersion,
        pointer.hashAlgorithm,
        pointer.authorityLocation,
        JSON.stringify(pointer.archivePointer || null),
        JSON.stringify(pointer.stubPointer || null),
        pointer.updatedAt,
        pointer.memoryScopeId,
        pointer.decisionId,
    ];

    if (existing) {
        adapter.run(
            `UPDATE current_decisions
                SET current_record_version = ?, canonical_hash = ?, canonical_hash_version = ?,
                    hash_algorithm = ?, authority_location = ?, archive_pointer_json = ?,
                    stub_pointer_json = ?, updated_at = ?
              WHERE memory_scope_id = ? AND decision_id = ?`,
            params,
        );
        return;
    }

    adapter.run(
        `INSERT INTO current_decisions (
            current_record_version, canonical_hash, canonical_hash_version, hash_algorithm,
            authority_location, archive_pointer_json, stub_pointer_json, updated_at,
            memory_scope_id, decision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params,
    );
}

function buildProvenance(decision, sourceChatInstanceId) {
    if (!decision.sourceRef) {
        return [];
    }
    return [{
        chatId: sourceChatInstanceId || null,
        collectionId: null,
        sourceRef: decision.sourceRef,
    }];
}

function mergeProvenance(existing, added) {
    const entries = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(added) ? added : [])];
    const seen = new Set();
    const output = [];
    for (const entry of entries) {
        const key = JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(entry);
    }
    return output;
}

function normalizeBrowserMigrationPayload(payload) {
    return {
        registries: validateArray(payload.registries || [], 'payload.registries'),
        decisionRecords: validateArray(payload.decisionRecords || [], 'payload.decisionRecords'),
        currentPointers: validateArray(payload.currentPointers || [], 'payload.currentPointers'),
        stubs: validateArray(payload.stubs || [], 'payload.stubs'),
        movementRecords: validateArray(payload.movementRecords || [], 'payload.movementRecords'),
        referenceSnapshots: validateArray(payload.referenceSnapshots || [], 'payload.referenceSnapshots'),
    };
}

function summarizeMigrationPayload(payload) {
    return {
        registries: payload.registries.length,
        decisionRecords: payload.decisionRecords.length,
        currentPointers: payload.currentPointers.length,
        stubs: payload.stubs.length,
        movementRecords: payload.movementRecords.length,
        referenceSnapshots: payload.referenceSnapshots.length,
    };
}

function importBrowserMigrationPayload(adapter, payload, timestamp) {
    const existingCounts = {
        scopes: Number(adapter.scalar('SELECT COUNT(*) FROM memory_scopes') || 0),
        currentDecisions: Number(adapter.scalar('SELECT COUNT(*) FROM current_decisions') || 0),
        decisionRecords: Number(adapter.scalar('SELECT COUNT(*) FROM decision_records') || 0),
    };

    if (existingCounts.scopes > 0 || existingCounts.currentDecisions > 0 || existingCounts.decisionRecords > 0) {
        throw createError(409, 'Browser migration is only allowed into an empty operational database', 'ARCH_MIGRATION_CONFLICT');
    }

    for (const registry of payload.registries) {
        const memoryScopeId = sanitizeIdentifier(registry.memoryScopeId, 'memoryScopeId');
        adapter.run(
            'INSERT INTO memory_scopes (memory_scope_id, scope_alias, scope_version, current_scope_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [
                memoryScopeId,
                String(registry.scopeAlias || ''),
                Number(registry.scopeVersion || 1),
                Number(registry.currentScopeRun || 0),
                Number(registry.createdAt || timestamp),
                Number(registry.updatedAt || timestamp),
            ],
        );

        for (const [chatId, binding] of Object.entries(registry.chatBindings || {})) {
            const chatInstanceId = sanitizeIdentifier(binding.chatInstanceId || binding.chatId || chatId, 'chatInstanceId');
            adapter.run(
                `INSERT INTO chat_bindings (
                    chat_instance_id, memory_scope_id, chat_locator, scope_alias,
                    branched_from_chat_instance_id, imported_from_chat_instance_id, bound_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    chatInstanceId,
                    memoryScopeId,
                    normalizeChatLocator(binding.chatLocator || binding.chatId || chatId),
                    String(binding.scopeAlias || registry.scopeAlias || ''),
                    binding.branchedFromChatInstanceId || null,
                    binding.importedFromChatInstanceId || null,
                    Number(binding.boundAt || registry.createdAt || timestamp),
                    Number(binding.updatedAt || registry.updatedAt || timestamp),
                ],
            );
        }
    }

    for (const record of payload.decisionRecords) {
        adapter.run(
            `INSERT INTO decision_records (
                memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
                hash_algorithm, semantic_payload, fields_json, status, prior_version,
                source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sanitizeIdentifier(record.memoryScopeId, 'memoryScopeId'),
                sanitizeIdentifier(record.decisionId, 'decisionId'),
                Number(record.recordVersion),
                String(record.canonicalHash || ''),
                Number(record.canonicalHashVersion || 1),
                String(record.hashAlgorithm || 'SHA-256'),
                String(record.semanticPayload || ''),
                JSON.stringify(record.fields || {}),
                String(record.status || ''),
                record.priorVersion === null || record.priorVersion === undefined ? null : Number(record.priorVersion),
                record.sourceChatInstanceId || null,
                record.lastUpdatingChatInstanceId || null,
                JSON.stringify(record.provenance || []),
                Number(record.createdAt || timestamp),
                Number(record.updatedAt || timestamp),
            ],
        );
    }

    for (const pointer of payload.currentPointers) {
        upsertCurrentDecision(adapter, {
            memoryScopeId: sanitizeIdentifier(pointer.memoryScopeId, 'memoryScopeId'),
            decisionId: sanitizeIdentifier(pointer.decisionId, 'decisionId'),
            currentRecordVersion: Number(pointer.currentRecordVersion),
            canonicalHash: String(pointer.canonicalHash || ''),
            canonicalHashVersion: Number(pointer.canonicalHashVersion || 1),
            hashAlgorithm: String(pointer.hashAlgorithm || 'SHA-256'),
            authorityLocation: String(pointer.authorityLocation || 'active'),
            archivePointer: cloneJson(pointer.archivePointer || null),
            stubPointer: cloneJson(pointer.stubPointer || null),
            updatedAt: Number(pointer.updatedAt || timestamp),
        });
    }

    for (const stub of payload.stubs) {
        adapter.run(
            'INSERT INTO decision_stubs (memory_scope_id, decision_id, payload_json, updated_at) VALUES (?, ?, ?, ?)',
            [
                sanitizeIdentifier(stub.memoryScopeId, 'memoryScopeId'),
                sanitizeIdentifier(stub.decisionId, 'decisionId'),
                JSON.stringify(stub),
                Number(stub.updatedAt || timestamp),
            ],
        );
    }

    for (const movement of payload.movementRecords) {
        adapter.run(
            'INSERT INTO movement_records (memory_scope_id, movement_id, payload_json, updated_at) VALUES (?, ?, ?, ?)',
            [
                sanitizeIdentifier(movement.memoryScopeId, 'memoryScopeId'),
                sanitizeIdentifier(movement.movementId, 'movementId'),
                JSON.stringify(movement),
                Number(movement.updatedAt || timestamp),
            ],
        );
    }

    for (const snapshot of payload.referenceSnapshots) {
        adapter.run(
            'INSERT INTO reference_index_snapshots (memory_scope_id, payload_json, updated_at) VALUES (?, ?, ?)',
            [
                sanitizeIdentifier(snapshot.memoryScopeId, 'memoryScopeId'),
                JSON.stringify(snapshot),
                Number(snapshot.updatedAt || timestamp),
            ],
        );
    }

    adapter.run(
        'INSERT INTO migration_audit (migration_id, migration_kind, source_kind, status, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
            createId('migration'),
            'browser-local-authority',
            'localStorage',
            'imported',
            JSON.stringify(summarizeMigrationPayload(payload)),
            timestamp,
        ],
    );
    touchManifest(adapter, timestamp);

    return summarizeMigrationPayload(payload);
}
