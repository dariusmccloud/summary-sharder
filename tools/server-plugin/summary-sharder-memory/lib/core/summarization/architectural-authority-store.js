import { parseArchitecturalDecisionRecord } from './architectural-record-parser.js';

export const ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION = 1;
export const ARCHITECTURAL_HASH_ALGORITHM = 'SHA-256';
export const ARCHITECTURAL_CANONICAL_HASH_VERSION = 1;
export const ARCHITECTURAL_CURRENT_POINTER_ACTIVE = 'active';
export const ARCHITECTURAL_CURRENT_POINTER_ARCHIVE = 'archive';

const STORE_PREFIX = 'summary-sharder:architectural-memory';
const FALLBACK_STORE = new Map();

let backendOverride = null;

function getCryptoApi() {
    const cryptoApi = globalThis?.crypto;
    if (!cryptoApi?.subtle) {
        throw new Error('Web Crypto API is unavailable');
    }
    return cryptoApi;
}

function defaultBackend() {
    if (typeof localStorage !== 'undefined' && localStorage) {
        return {
            async get(key) {
                const raw = localStorage.getItem(key);
                return raw === null ? null : JSON.parse(raw);
            },
            async set(key, value) {
                localStorage.setItem(key, JSON.stringify(value));
            },
            async delete(key) {
                localStorage.removeItem(key);
            },
            async list(prefix) {
                const keys = [];
                for (let index = 0; index < localStorage.length; index += 1) {
                    const key = localStorage.key(index);
                    if (key && key.startsWith(prefix)) {
                        keys.push(key);
                    }
                }
                return keys.sort();
            },
        };
    }

    return {
        async get(key) {
            return FALLBACK_STORE.has(key) ? structuredClone(FALLBACK_STORE.get(key)) : null;
        },
        async set(key, value) {
            FALLBACK_STORE.set(key, structuredClone(value));
        },
        async delete(key) {
            FALLBACK_STORE.delete(key);
        },
        async list(prefix) {
            return [...FALLBACK_STORE.keys()].filter((key) => key.startsWith(prefix)).sort();
        },
    };
}

function getBackend() {
    return backendOverride || defaultBackend();
}

function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

function nowTimestamp(now = Date.now()) {
    return Number.isFinite(now) ? now : Date.now();
}

function generateScopeId() {
    const cryptoApi = globalThis?.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }
    return `scope-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function generateChatInstanceId() {
    const cryptoApi = globalThis?.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return `chat_${cryptoApi.randomUUID().replace(/-/g, '')}`;
    }
    return `chat_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function registryKey(memoryScopeId) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:registry`;
}

function currentPointerKey(memoryScopeId, decisionId) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:decision:${decisionId}:current`;
}

function recordKey(memoryScopeId, decisionId, recordVersion) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:decision:${decisionId}:record:${recordVersion}`;
}

function stubKey(memoryScopeId, decisionId) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:decision:${decisionId}:stub`;
}

function movementKey(memoryScopeId, movementId) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:movement:${movementId}`;
}

function referenceIndexKey(memoryScopeId) {
    return `${STORE_PREFIX}:scope:${memoryScopeId}:reference-index`;
}

function sortUniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))].sort();
}

function normalizeDecisionListField(value) {
    if (Array.isArray(value)) {
        return sortUniqueStrings(value).map((entry) => entry.toUpperCase());
    }
    return sortUniqueStrings(String(value || '').split(',')).map((entry) => entry.toUpperCase());
}

function normalizeDecisionSemanticFields(fields = {}) {
    const rawEntries = Object.entries(fields)
        .map(([key, value]) => [String(key || '').trim().toUpperCase(), value])
        .filter(([key]) => key);

    const normalized = {};

    for (const [key, value] of rawEntries) {
        if (value === undefined) continue;

        if (key === 'TYPE') {
            const types = normalizeDecisionListField(value);
            if (types.length > 0) {
                normalized.TYPE = types;
            }
            continue;
        }

        if (Array.isArray(value)) {
            const items = value.map((entry) => String(entry || '').trim());
            normalized[key] = items;
            continue;
        }

        const text = String(value ?? '').trim();
        if (text === '' && value !== '') {
            normalized[key] = '';
        } else if (text !== '' || value === '') {
            normalized[key] = text;
        }
    }

    return normalized;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function sha256Hex(text) {
    const cryptoApi = getCryptoApi();
    const buffer = new TextEncoder().encode(String(text || ''));
    const digest = await cryptoApi.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function setArchitecturalAuthorityBackend(backend) {
    backendOverride = backend || null;
}

export function resetArchitecturalAuthorityBackend() {
    backendOverride = null;
    FALLBACK_STORE.clear();
}

export function createInMemoryArchitecturalAuthorityBackend() {
    const map = new Map();
    return {
        async get(key) {
            return map.has(key) ? structuredClone(map.get(key)) : null;
        },
        async set(key, value) {
            map.set(key, structuredClone(value));
        },
        async delete(key) {
            map.delete(key);
        },
        async list(prefix) {
            return [...map.keys()].filter((key) => key.startsWith(prefix)).sort();
        },
        _dump() {
            return new Map(map);
        },
    };
}

export async function buildArchitecturalDecisionCanonicalHash(fields) {
    const normalizedFields = normalizeDecisionSemanticFields(fields);
    const semanticPayload = stableStringify(normalizedFields);
    const canonicalHash = await sha256Hex(semanticPayload);

    return {
        canonicalHash,
        canonicalHashVersion: ARCHITECTURAL_CANONICAL_HASH_VERSION,
        hashAlgorithm: ARCHITECTURAL_HASH_ALGORITHM,
        semanticPayload,
        normalizedFields,
    };
}

export async function buildArchitecturalDecisionAuthorityInput(itemOrContent) {
    const content = typeof itemOrContent === 'string'
        ? itemOrContent
        : String(itemOrContent?.content || '');
    const parsed = parseArchitecturalDecisionRecord(content);
    const decisionId = String(parsed?.fields?.ID || '').trim();
    const status = String(parsed?.fields?.STATUS || '').trim();
    const sourceRef = parsed?.sourceRef ? String(parsed.sourceRef).trim() : null;
    const hashInfo = await buildArchitecturalDecisionCanonicalHash(parsed?.fields || {});

    return {
        decisionId,
        status,
        sourceRef,
        content,
        fields: hashInfo.normalizedFields,
        semanticPayload: hashInfo.semanticPayload,
        canonicalHash: hashInfo.canonicalHash,
        canonicalHashVersion: hashInfo.canonicalHashVersion,
        hashAlgorithm: hashInfo.hashAlgorithm,
        parserErrors: [...(parsed?.errors || [])],
        parserWarnings: [...(parsed?.warnings || [])],
    };
}

export async function loadArchitecturalScopeRegistry(memoryScopeId) {
    return await getBackend().get(registryKey(memoryScopeId));
}

export async function ensureArchitecturalScopeRegistry(memoryScopeId, scopeAlias = '', options = {}) {
    const backend = getBackend();
    const existing = await backend.get(registryKey(memoryScopeId));
    if (existing) {
        return existing;
    }

    const timestamp = nowTimestamp(options.now);
    const created = {
        schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
        memoryScopeId,
        scopeAlias: String(scopeAlias || '').trim(),
        scopeVersion: 1,
        currentScopeRun: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        chatBindings: {},
    };
    await backend.set(registryKey(memoryScopeId), created);
    return created;
}

export async function bindChatToArchitecturalMemoryScope(chatBindingState, options = {}) {
    const {
        chatId,
        requestedScopeId = null,
        requestedScopeAlias = '',
        now = Date.now(),
    } = options;

    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) {
        throw new Error('Chat ID is required for Architectural Memory scope binding');
    }

    const root = chatBindingState || {};
    if (!root.summary_sharder) {
        root.summary_sharder = {};
    }

    const existingBinding = root.summary_sharder.architecturalMemoryBinding || null;
    const resolvedScopeId = String(requestedScopeId || existingBinding?.memoryScopeId || generateScopeId()).trim();
    const resolvedAlias = String(requestedScopeAlias || existingBinding?.scopeAlias || '').trim();

    if (existingBinding?.memoryScopeId && existingBinding.memoryScopeId !== resolvedScopeId) {
        const error = new Error('Architectural Memory scope reassignment is blocked once a chat is bound.');
        error.code = 'ARCH_SCOPE_REASSIGN_BLOCKED';
        throw error;
    }

    const chatIdChanged = existingBinding?.chatId && existingBinding.chatId !== normalizedChatId;
    const binding = chatIdChanged
        ? {
            memoryScopeId: resolvedScopeId,
            scopeAlias: resolvedAlias,
            chatId: normalizedChatId,
            chatInstanceId: generateChatInstanceId(),
            branchedFromChatInstanceId: existingBinding?.chatInstanceId || null,
            boundAt: nowTimestamp(now),
            updatedAt: nowTimestamp(now),
            imported: existingBinding?.imported === true,
        }
        : {
            memoryScopeId: resolvedScopeId,
            scopeAlias: resolvedAlias,
            chatId: normalizedChatId,
            chatInstanceId: existingBinding?.chatInstanceId || generateChatInstanceId(),
            branchedFromChatInstanceId: existingBinding?.branchedFromChatInstanceId || null,
            boundAt: existingBinding?.boundAt || nowTimestamp(now),
            updatedAt: nowTimestamp(now),
            imported: existingBinding?.imported === true,
        };

    root.summary_sharder.architecturalMemoryBinding = binding;
    return binding;
}

export async function attachChatBindingToScopeRegistry(binding, options = {}) {
    const timestamp = nowTimestamp(options.now);
    const registry = await ensureArchitecturalScopeRegistry(binding.memoryScopeId, binding.scopeAlias, options);

    if (registry.chatBindings?.[binding.chatId]?.memoryScopeId
        && registry.chatBindings[binding.chatId].memoryScopeId !== binding.memoryScopeId) {
        const error = new Error('Architectural Memory scope registry refuses conflicting chat binding.');
        error.code = 'ARCH_SCOPE_BINDING_CONFLICT';
        throw error;
    }

    const nextRegistry = {
        ...registry,
        scopeAlias: registry.scopeAlias || binding.scopeAlias || '',
        chatBindings: {
            ...(registry.chatBindings || {}),
            [binding.chatId]: {
                chatId: binding.chatId,
                chatInstanceId: binding.chatInstanceId || binding.chatId,
                memoryScopeId: binding.memoryScopeId,
                scopeAlias: binding.scopeAlias || '',
                branchedFromChatInstanceId: binding.branchedFromChatInstanceId || null,
                boundAt: registry.chatBindings?.[binding.chatId]?.boundAt || binding.boundAt || timestamp,
                updatedAt: timestamp,
            },
        },
        scopeVersion: Number(registry.scopeVersion || 0) + 1,
        updatedAt: timestamp,
    };

    await getBackend().set(registryKey(binding.memoryScopeId), nextRegistry);
    return nextRegistry;
}

async function loadCurrentPointer(memoryScopeId, decisionId) {
    return await getBackend().get(currentPointerKey(memoryScopeId, decisionId));
}

async function loadDecisionRecord(memoryScopeId, decisionId, recordVersion) {
    return await getBackend().get(recordKey(memoryScopeId, decisionId, recordVersion));
}

export async function loadArchitecturalCurrentAuthority(memoryScopeId, decisionId) {
    const pointer = await loadCurrentPointer(memoryScopeId, decisionId);
    if (!pointer) {
        return null;
    }

    const record = await loadDecisionRecord(memoryScopeId, decisionId, pointer.currentRecordVersion);
    const stub = pointer.authorityLocation === ARCHITECTURAL_CURRENT_POINTER_ARCHIVE
        ? await getBackend().get(stubKey(memoryScopeId, decisionId))
        : null;

    return {
        pointer,
        record,
        stub,
    };
}

export async function loadAllArchitecturalScopeAuthorities(memoryScopeId) {
    const backend = getBackend();
    const keys = await backend.list(`${STORE_PREFIX}:scope:${memoryScopeId}:decision:`);
    const currentKeys = keys.filter((key) => key.endsWith(':current'));
    const authorities = [];

    for (const key of currentKeys) {
        const pointer = await backend.get(key);
        if (!pointer?.decisionId) continue;
        const authority = await loadArchitecturalCurrentAuthority(memoryScopeId, pointer.decisionId);
        if (authority) {
            authorities.push(authority);
        }
    }

    return authorities;
}

export async function validateArchitecturalAuthorityState(memoryScopeId) {
    const diagnostics = [];
    const authorities = await loadAllArchitecturalScopeAuthorities(memoryScopeId);
    const seen = new Map();

    for (const authority of authorities) {
        const id = String(authority?.pointer?.decisionId || '').trim();
        if (!id) continue;

        const prior = seen.get(id);
        if (!prior) {
            seen.set(id, authority);
            continue;
        }

        diagnostics.push({
            level: 'error',
            code: 'ARCH_DUPLICATE_AUTHORITATIVE_RECORD',
            message: `Competing current authorities exist for decision ${id}.`,
            recordId: id,
        });
    }

    return diagnostics;
}

async function writeRecordSet(recordWrites = []) {
    const backend = getBackend();
    for (const write of recordWrites) {
        if (write.type === 'delete') {
            await backend.delete(write.key);
        } else {
            await backend.set(write.key, write.value);
        }
    }
}

export async function commitArchitecturalScopeAuthorityUpdate(options = {}) {
    const {
        memoryScopeId,
        scopeAlias = '',
        expectedScopeVersion = null,
        expectedDecisionVersionsById = {},
        decisions = [],
        sourceChatId = '',
        now = Date.now(),
    } = options;

    if (!memoryScopeId) {
        throw new Error('memoryScopeId is required');
    }

    const backend = getBackend();
    const timestamp = nowTimestamp(now);
    const registry = await ensureArchitecturalScopeRegistry(memoryScopeId, scopeAlias, { now: timestamp });

    if (expectedScopeVersion !== null && Number(registry.scopeVersion) !== Number(expectedScopeVersion)) {
        const error = new Error('Scope version conflict');
        error.code = 'ARCH_SCOPE_VERSION_CONFLICT';
        error.currentScopeVersion = registry.scopeVersion;
        throw error;
    }

    const authorityInputs = [];
    for (const decision of (Array.isArray(decisions) ? decisions : [])) {
        const authorityInput = decision?.canonicalHash
            ? decision
            : await buildArchitecturalDecisionAuthorityInput(decision);
        if (!authorityInput.decisionId) continue;
        authorityInputs.push(authorityInput);
    }

    const updates = [];
    const projectionState = {};

    for (const decision of authorityInputs) {
        const currentAuthority = await loadArchitecturalCurrentAuthority(memoryScopeId, decision.decisionId);
        const currentPointer = currentAuthority?.pointer || null;
        const currentRecord = currentAuthority?.record || null;
        const expectedDecisionVersion = expectedDecisionVersionsById?.[decision.decisionId] ?? null;

        if (currentPointer && expectedDecisionVersion !== null
            && Number(currentPointer.currentRecordVersion) !== Number(expectedDecisionVersion)) {
            const error = new Error(`Decision ${decision.decisionId} version conflict`);
            error.code = 'ARCH_DECISION_VERSION_CONFLICT';
            error.recordId = decision.decisionId;
            error.expectedRecordVersion = expectedDecisionVersion;
            error.currentRecordVersion = currentPointer.currentRecordVersion;
            throw error;
        }

        if (currentPointer && expectedDecisionVersion === null
            && currentRecord?.canonicalHash
            && currentRecord.canonicalHash !== decision.canonicalHash) {
            const error = new Error(`Decision ${decision.decisionId} update is unproven without an expected version`);
            error.code = 'ARCH_DECISION_UNPROVEN_COLLISION';
            error.recordId = decision.decisionId;
            throw error;
        }

        let nextRecordVersion = currentPointer?.currentRecordVersion || 0;
        let nextPointer = currentPointer;
        let nextRecord = currentRecord;
        let changed = false;

        if (!currentRecord) {
            nextRecordVersion = 1;
            nextRecord = {
                schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
                memoryScopeId,
                decisionId: decision.decisionId,
                recordVersion: nextRecordVersion,
                priorVersion: null,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                semanticPayload: decision.semanticPayload,
                fields: decision.fields,
                status: decision.status || '',
                createdAt: timestamp,
                updatedAt: timestamp,
                sourceChatId: normalizeChatId(sourceChatId),
                lastUpdatingChatId: normalizeChatId(sourceChatId),
                provenance: decision.sourceRef ? [{
                    chatId: normalizeChatId(sourceChatId),
                    collectionId: null,
                    sourceRef: decision.sourceRef,
                }] : [],
            };
            nextPointer = {
                memoryScopeId,
                decisionId: decision.decisionId,
                currentRecordVersion: nextRecordVersion,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                authorityLocation: ARCHITECTURAL_CURRENT_POINTER_ACTIVE,
                archivePointer: null,
                stubPointer: null,
                updatedAt: timestamp,
            };
            changed = true;
        } else if (currentRecord.canonicalHash !== decision.canonicalHash) {
            nextRecordVersion = Number(currentPointer.currentRecordVersion || currentRecord.recordVersion || 0) + 1;
            nextRecord = {
                ...currentRecord,
                schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
                memoryScopeId,
                decisionId: decision.decisionId,
                recordVersion: nextRecordVersion,
                priorVersion: currentRecord.recordVersion,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                semanticPayload: decision.semanticPayload,
                fields: decision.fields,
                status: decision.status || '',
                createdAt: timestamp,
                updatedAt: timestamp,
                sourceChatId: currentRecord.sourceChatId || normalizeChatId(sourceChatId),
                lastUpdatingChatId: normalizeChatId(sourceChatId),
                provenance: decision.sourceRef ? sortUniqueStrings([
                    ...(currentRecord.provenance || []).map((entry) => JSON.stringify(entry)),
                    JSON.stringify({
                        chatId: normalizeChatId(sourceChatId),
                        collectionId: null,
                        sourceRef: decision.sourceRef,
                    }),
                ]).map((entry) => JSON.parse(entry)) : (currentRecord.provenance || []),
            };
            nextPointer = {
                ...currentPointer,
                currentRecordVersion: nextRecordVersion,
                canonicalHash: decision.canonicalHash,
                canonicalHashVersion: decision.canonicalHashVersion,
                hashAlgorithm: decision.hashAlgorithm,
                authorityLocation: ARCHITECTURAL_CURRENT_POINTER_ACTIVE,
                archivePointer: null,
                stubPointer: null,
                updatedAt: timestamp,
            };
            changed = true;
        }

        if (changed) {
            updates.push({ type: 'set', key: recordKey(memoryScopeId, decision.decisionId, nextRecord.recordVersion), value: nextRecord });
            updates.push({ type: 'set', key: currentPointerKey(memoryScopeId, decision.decisionId), value: nextPointer });
        }

        projectionState[decision.decisionId] = {
            memoryScopeId,
            decisionId: decision.decisionId,
            currentRecordVersion: nextPointer?.currentRecordVersion || nextRecord?.recordVersion || nextRecordVersion,
            canonicalHash: nextPointer?.canonicalHash || nextRecord?.canonicalHash || decision.canonicalHash,
            canonicalHashVersion: ARCHITECTURAL_CANONICAL_HASH_VERSION,
            hashAlgorithm: ARCHITECTURAL_HASH_ALGORITHM,
            authorityLocation: nextPointer?.authorityLocation || ARCHITECTURAL_CURRENT_POINTER_ACTIVE,
        };
    }

    const nextRegistry = {
        ...registry,
        scopeAlias: registry.scopeAlias || scopeAlias || '',
        scopeVersion: Number(registry.scopeVersion || 0) + 1,
        currentScopeRun: Number(registry.currentScopeRun || 0) + 1,
        updatedAt: timestamp,
    };
    updates.push({ type: 'set', key: registryKey(memoryScopeId), value: nextRegistry });

    await writeRecordSet(updates);

    return {
        registry: nextRegistry,
        projectionState,
    };
}

export async function persistArchitecturalStubRecord(stubRecord) {
    if (!stubRecord?.memoryScopeId || !stubRecord?.decisionId) {
        throw new Error('Stub record requires memoryScopeId and decisionId');
    }
    await getBackend().set(stubKey(stubRecord.memoryScopeId, stubRecord.decisionId), {
        schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
        ...stubRecord,
    });
}

export async function persistArchitecturalMovementRecord(movementRecord) {
    if (!movementRecord?.memoryScopeId || !movementRecord?.movementId) {
        throw new Error('Movement record requires memoryScopeId and movementId');
    }
    await getBackend().set(movementKey(movementRecord.memoryScopeId, movementRecord.movementId), {
        schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
        ...movementRecord,
    });
}

export async function persistArchitecturalReferenceIndexSnapshot(snapshot) {
    if (!snapshot?.memoryScopeId) {
        throw new Error('Reference index snapshot requires memoryScopeId');
    }
    await getBackend().set(referenceIndexKey(snapshot.memoryScopeId), {
        schemaVersion: ARCHITECTURAL_AUTHORITY_SCHEMA_VERSION,
        ...snapshot,
    });
}

export async function loadArchitecturalReferenceIndexSnapshot(memoryScopeId) {
    return await getBackend().get(referenceIndexKey(memoryScopeId));
}

export function evaluateProjectionStaleness(currentAuthority, projectionRef) {
    if (!currentAuthority?.pointer || !projectionRef) {
        return { isStale: false, reason: null };
    }

    if (String(currentAuthority.pointer.canonicalHash || '') !== String(projectionRef.canonicalHash || '')
        || Number(currentAuthority.pointer.currentRecordVersion || 0) !== Number(projectionRef.currentRecordVersion || 0)) {
        return {
            isStale: true,
            reason: 'authority-advanced',
        };
    }

    return { isStale: false, reason: null };
}

export async function resolveProjectionAuthoritySet(memoryScopeId, projectionState = {}) {
    const resolved = {};
    const diagnostics = [];

    for (const [decisionId, projectionRef] of Object.entries(projectionState || {})) {
        const currentAuthority = await loadArchitecturalCurrentAuthority(memoryScopeId, decisionId);
        if (!currentAuthority?.pointer) continue;

        const staleness = evaluateProjectionStaleness(currentAuthority, projectionRef);
        resolved[decisionId] = {
            ...projectionRef,
            authority: currentAuthority.pointer,
            stale: staleness.isStale,
        };

        if (staleness.isStale) {
            diagnostics.push({
                level: 'warning',
                code: 'ARCH_SCOPE_PROJECTION_STALE',
                message: `Projection for decision ${decisionId} is stale relative to current scope authority.`,
                recordId: decisionId,
            });
        }
    }

    return {
        projectionState: resolved,
        diagnostics,
    };
}

export function buildArchitecturalImportedProjectionDiagnostic(binding, scopeRegistry) {
    if (!binding?.memoryScopeId) {
        return null;
    }
    if (scopeRegistry) {
        return null;
    }
    return {
        level: 'warning',
        code: 'ARCH_IMPORTED_SCOPE_RECONCILIATION_REQUIRED',
        message: `Imported Architectural projection is bound to scope ${binding.memoryScopeId}, but the local authoritative scope registry is unavailable.`,
        memoryScopeId: binding.memoryScopeId,
    };
}

export async function materializeArchivedCurrentPointer(options = {}) {
    const {
        memoryScopeId,
        decisionId,
        recordVersion,
        canonicalHash,
        archivePointer,
        stubRecord,
        now = Date.now(),
    } = options;

    const timestamp = nowTimestamp(now);
    const pointer = {
        memoryScopeId,
        decisionId,
        currentRecordVersion: recordVersion,
        canonicalHash,
        canonicalHashVersion: ARCHITECTURAL_CANONICAL_HASH_VERSION,
        hashAlgorithm: ARCHITECTURAL_HASH_ALGORITHM,
        authorityLocation: ARCHITECTURAL_CURRENT_POINTER_ARCHIVE,
        archivePointer: archivePointer || null,
        stubPointer: stubRecord ? { memoryScopeId, decisionId } : null,
        updatedAt: timestamp,
    };
    await getBackend().set(currentPointerKey(memoryScopeId, decisionId), pointer);
    if (stubRecord) {
        await persistArchitecturalStubRecord(stubRecord);
    }
    return pointer;
}

function parseExportRecordKey(key) {
    const scopeMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):registry$/);
    if (scopeMatch) {
        return { type: 'registry', memoryScopeId: scopeMatch[1] };
    }

    const currentMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):decision:([^:]+):current$/);
    if (currentMatch) {
        return { type: 'current', memoryScopeId: currentMatch[1], decisionId: currentMatch[2] };
    }

    const recordMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):decision:([^:]+):record:(\d+)$/);
    if (recordMatch) {
        return {
            type: 'record',
            memoryScopeId: recordMatch[1],
            decisionId: recordMatch[2],
            recordVersion: Number(recordMatch[3]),
        };
    }

    const stubMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):decision:([^:]+):stub$/);
    if (stubMatch) {
        return { type: 'stub', memoryScopeId: stubMatch[1], decisionId: stubMatch[2] };
    }

    const movementMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):movement:([^:]+)$/);
    if (movementMatch) {
        return { type: 'movement', memoryScopeId: movementMatch[1], movementId: movementMatch[2] };
    }

    const referenceMatch = key.match(/^summary-sharder:architectural-memory:scope:([^:]+):reference-index$/);
    if (referenceMatch) {
        return { type: 'reference-index', memoryScopeId: referenceMatch[1] };
    }

    return null;
}

export async function hasLegacyArchitecturalAuthorityData() {
    const keys = await getBackend().list(`${STORE_PREFIX}:scope:`);
    return keys.length > 0;
}

export async function exportLegacyArchitecturalAuthorityPayload() {
    const backend = getBackend();
    const keys = await backend.list(`${STORE_PREFIX}:scope:`);
    const payload = {
        registries: [],
        decisionRecords: [],
        currentPointers: [],
        stubs: [],
        movementRecords: [],
        referenceSnapshots: [],
    };

    for (const key of keys) {
        const descriptor = parseExportRecordKey(key);
        if (!descriptor) {
            continue;
        }
        const value = await backend.get(key);
        if (!value) {
            continue;
        }

        switch (descriptor.type) {
            case 'registry':
                payload.registries.push(value);
                break;
            case 'record':
                payload.decisionRecords.push(value);
                break;
            case 'current':
                payload.currentPointers.push(value);
                break;
            case 'stub':
                payload.stubs.push(value);
                break;
            case 'movement':
                payload.movementRecords.push(value);
                break;
            case 'reference-index':
                payload.referenceSnapshots.push(value);
                break;
            default:
                break;
        }
    }

    return payload;
}
