import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { JOURNAL_MODE, PLUGIN_ID, SCHEMA_VERSION, SERVICE_VERSION, schemaStatements } from './schema.js';
let createNodeSqliteAdapter = null;
let createBunSqliteAdapter = null;

if (typeof process?.versions?.bun === 'string') {
    ({ createBunSqliteAdapter } = await import('./sqlite-bun.js'));
} else {
    ({ createNodeSqliteAdapter } = await import('./sqlite-node.js'));
}

export {
    JOURNAL_MODE,
    PLUGIN_ID,
    SCHEMA_VERSION,
    SERVICE_VERSION,
};

export const CAPABILITIES = Object.freeze({
    phase: 'c0',
    rebuildAvailable: true,
    browserMigration: true,
    projectionRegistry: true,
    ordinaryChatPatching: false,
    c0_25a: Object.freeze({
        readOnlyScanner: true,
        nestedMetadataPreferred: true,
        corpusMutation: false,
        persistedChatInspection: true,
    }),
    c0_5a: Object.freeze({
        candidateRebuildOrchestration: true,
        candidateReportRetrieval: true,
        candidatePinning: true,
        candidateCleanup: true,
        promotionAvailable: false,
        liveAuthorityMutation: false,
        readOnlyCorpusDiscovery: true,
    }),
    c0_75_1: Object.freeze({
        candidateQualification: true,
        boundPromotionEvidence: true,
        candidateLiveDiff: true,
        rollbackPlanningEvidence: true,
        promotionAvailable: false,
        liveAuthorityMutation: false,
        readOnlyOnly: true,
    }),
    c0_75_2: Object.freeze({
        manualAuthorization: true,
        atomicGenerationTransition: true,
        globalTransitionLock: true,
        fullGenerationMerge: true,
        promotionAvailable: true,
        automaticPromotion: false,
        liveAuthorityMutation: true,
    }),
    c0_6_1: Object.freeze({
        interpretiveLedgerAuthority: true,
        interpretiveCandidateStorage: true,
        deterministicPolicyRouting: true,
        deterministicReviewerResolution: true,
        continuityPublicationAvailable: false,
        structuralAuthorityMutation: false,
        modelInterpretationAvailable: false,
    }),
    c0_6_2: Object.freeze({
        reviewerDispositionSubmission: true,
        immutableEditRevision: true,
        subjectDispositionRecording: true,
        continuityPublicationAvailable: false,
        structuralAuthorityMutation: false,
        modelInterpretationAvailable: false,
    }),
    c0_6_3: Object.freeze({
        synthesisPolicyStorage: true,
        boundedSynthesisRunContract: true,
        frozenSourceManifest: true,
        continuityPublicationAvailable: false,
        structuralAuthorityMutation: false,
        modelSynthesisAvailable: false,
    }),
    c0_5: false,
    c1: false,
    c2: false,
});

export const MESSAGE_IDENTITY_SCAN_SCHEMA = Object.freeze({
    namespace: 'summary_sharder',
    messageIdentityPath: 'extra.summary_sharder.messageIdentity',
    archivePath: 'extra.summary_sharder.archive',
    evidencePolicyPath: 'extra.summary_sharder.evidencePolicy',
    speakerIdentityPath: 'extra.summary_sharder.speakerIdentity',
    chatIdentityStatusPath: 'chat_metadata.summary_sharder.messageIdentity',
    promptVisibilityField: 'is_system',
    evidencePolicyDefault: 'include',
});

export function createId(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function nowTimestamp(value = Date.now()) {
    return Number.isFinite(value) ? Number(value) : Date.now();
}

export function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function sanitizeIdentifier(value, fieldName = 'identifier') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw createError(400, `${fieldName} is required`, 'ARCH_INVALID_IDENTIFIER');
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw createError(400, `${fieldName} contains illegal characters`, 'ARCH_INVALID_IDENTIFIER');
    }
    return normalized;
}

export function normalizeChatLocator(value) {
    return String(value || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

export function createError(status, message, code, extra = {}) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    Object.assign(error, extra);
    return error;
}

export function getAuthenticatedUserRoot(request) {
    const root = request?.user?.directories?.root;
    if (root && typeof root === 'string') {
        return path.resolve(root);
    }
    const chats = request?.user?.directories?.chats;
    if (chats && typeof chats === 'string') {
        return path.resolve(chats, '..');
    }
    throw createError(500, 'Authenticated user root is unavailable', 'ARCH_USER_ROOT_UNAVAILABLE');
}

export function getStoragePaths(userRoot) {
    const storageRoot = path.join(userRoot, 'summary-sharder');
    const dbPath = path.join(storageRoot, 'architectural-memory.db');
    const snapshotPath = path.join(storageRoot, 'architectural-memory.snapshot.db');
    const statePath = path.join(storageRoot, 'architectural-memory.state.json');
    const interpretiveGovernanceLedgerPath = path.join(storageRoot, 'interpretive-governance-ledger.jsonl');
    const generationsRoot = path.join(storageRoot, 'generations');
    const promotionsRoot = path.join(storageRoot, 'promotions');
    const promotionAuthorizationsRoot = path.join(promotionsRoot, 'authorizations');
    const promotionJournalPath = path.join(promotionsRoot, 'promotion-journal.jsonl');
    const locksRoot = path.join(storageRoot, 'locks');
    const authorityTransitionLockPath = path.join(locksRoot, 'authority-transition.lock');
    return {
        storageRoot,
        dbPath,
        snapshotPath,
        statePath,
        interpretiveGovernanceLedgerPath,
        generationsRoot,
        promotionsRoot,
        promotionAuthorizationsRoot,
        promotionJournalPath,
        locksRoot,
        authorityTransitionLockPath,
    };
}

export function ensureStorageRoot(storageRoot) {
    fs.mkdirSync(storageRoot, { recursive: true });
}

export function atomicWriteFile(targetPath, content) {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, targetPath);
}

export function quarantinePath(filePath, reason = 'invalid') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${filePath}.quarantine.${reason}.${stamp}`;
}

export function readOperationalStateMarker(paths) {
    if (!fs.existsSync(paths.statePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(paths.statePath, 'utf8'));
    } catch {
        return null;
    }
}

function buildOperationalStateMarker(existing, descriptor = {}, now = Date.now()) {
    const adoptedAt = Number.isFinite(Number(descriptor?.adoptedAt))
        ? Number(descriptor.adoptedAt)
        : Number.isFinite(Number(existing?.adoptedAt))
            ? Number(existing.adoptedAt)
            : nowTimestamp(now);
    const marker = {
        schemaVersion: Number.isFinite(Number(descriptor?.schemaVersion))
            ? Number(descriptor.schemaVersion)
            : Number.isFinite(Number(existing?.schemaVersion))
                ? Number(existing.schemaVersion)
                : SCHEMA_VERSION,
        serviceVersion: String(descriptor?.serviceVersion || existing?.serviceVersion || SERVICE_VERSION),
        runtimeAdapter: String(descriptor?.runtimeAdapter || existing?.runtimeAdapter || ''),
        journalMode: String(descriptor?.journalMode || existing?.journalMode || JOURNAL_MODE),
        adoptedAt,
    };
    if (descriptor?.liveAuthority !== undefined) {
        marker.liveAuthority = cloneJson(descriptor.liveAuthority);
    } else if (existing?.liveAuthority !== undefined) {
        marker.liveAuthority = cloneJson(existing.liveAuthority);
    }
    if (descriptor?.promotionJournal !== undefined) {
        marker.promotionJournal = cloneJson(descriptor.promotionJournal);
    } else if (existing?.promotionJournal !== undefined) {
        marker.promotionJournal = cloneJson(existing.promotionJournal);
    }
    return marker;
}

export function writeOperationalStateMarkerDescriptor(paths, descriptor = {}, now = Date.now()) {
    ensureStorageRoot(paths.storageRoot);
    const existing = readOperationalStateMarker(paths);
    const marker = buildOperationalStateMarker(existing, descriptor, now);
    if (existing && stableStringify(existing) === stableStringify(marker)) {
        return marker;
    }
    atomicWriteFile(paths.statePath, JSON.stringify(marker, null, 2));
    return marker;
}

function writeOperationalStateMarker(paths, adapter, now = Date.now()) {
    return writeOperationalStateMarkerDescriptor(paths, {
        schemaVersion: SCHEMA_VERSION,
        serviceVersion: SERVICE_VERSION,
        runtimeAdapter: adapter.runtime,
        journalMode: JOURNAL_MODE,
    }, now);
}

function hasOperationalStateMarker(paths) {
    return fs.existsSync(paths.statePath);
}

export function resolveOperationalDbPath(paths, stateMarker = readOperationalStateMarker(paths)) {
    const relativePath = String(stateMarker?.liveAuthority?.dbRelativePath || '').trim();
    if (!relativePath) {
        return paths.dbPath;
    }
    const resolved = path.resolve(paths.storageRoot, relativePath);
    const storageRoot = path.resolve(paths.storageRoot);
    if (!resolved.startsWith(storageRoot)) {
        throw createError(500, 'Resolved live DB path escaped storage root', 'ARCH_LIVE_DB_PATH_INVALID');
    }
    return resolved;
}

export function createAdapter(dbPath) {
    if (typeof process?.versions?.bun === 'string') {
        if (typeof createBunSqliteAdapter !== 'function') {
            throw createError(500, 'Bun SQLite adapter is unavailable', 'ARCH_SQLITE_ADAPTER_UNAVAILABLE');
        }
        return createBunSqliteAdapter(dbPath);
    }
    if (typeof createNodeSqliteAdapter !== 'function') {
        throw createError(500, 'Node SQLite adapter is unavailable', 'ARCH_SQLITE_ADAPTER_UNAVAILABLE');
    }
    return createNodeSqliteAdapter(dbPath);
}

export function initializeDatabase(adapter, now = Date.now()) {
    for (const statement of schemaStatements()) {
        adapter.exec(statement);
    }

    adapter.exec(`PRAGMA journal_mode=${JOURNAL_MODE}`);
    const manifest = adapter.get('SELECT * FROM manifest WHERE id = 1');
    if (!manifest) {
        const timestamp = nowTimestamp(now);
        adapter.run(
            `INSERT INTO manifest (
                id, schema_version, service_version, runtime_adapter, journal_mode,
                migration_state, rebuild_state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                1,
                SCHEMA_VERSION,
                SERVICE_VERSION,
                adapter.runtime,
                JOURNAL_MODE,
                'ready',
                'idle',
                timestamp,
                timestamp,
            ],
        );
    } else if (Number(manifest.schema_version) !== SCHEMA_VERSION) {
        throw createError(500, `Unsupported schema version ${manifest.schema_version}`, 'ARCH_SCHEMA_VERSION_UNSUPPORTED');
    }
}

export function loadManifest(adapter) {
    const manifest = adapter.get('SELECT * FROM manifest WHERE id = 1');
    if (!manifest) {
        throw createError(500, 'Manifest is missing after initialization', 'ARCH_MANIFEST_MISSING');
    }
    return {
        schemaVersion: Number(manifest.schema_version),
        serviceVersion: String(manifest.service_version),
        runtimeAdapter: String(manifest.runtime_adapter),
        journalMode: String(manifest.journal_mode),
        migrationState: String(manifest.migration_state),
        rebuildState: String(manifest.rebuild_state),
        createdAt: Number(manifest.created_at),
        updatedAt: Number(manifest.updated_at),
    };
}

function openSnapshotForVerification(snapshotPath) {
    if (!fs.existsSync(snapshotPath)) {
        return { ok: false, reason: 'missing' };
    }

    const adapter = createAdapter(snapshotPath);
    try {
        initializeDatabase(adapter);
        if (!adapter.verifyIntegrity()) {
            return { ok: false, reason: 'integrity-failed' };
        }
        return {
            ok: true,
            manifest: loadManifest(adapter),
        };
    } catch (error) {
        return { ok: false, reason: String(error?.code || 'open-failed').toLowerCase() };
    } finally {
        adapter.close();
    }
}

function restoreFromSnapshot(paths, targetDbPath = resolveOperationalDbPath(paths)) {
    const verification = openSnapshotForVerification(paths.snapshotPath);
    if (!verification.ok) {
        if (fs.existsSync(paths.snapshotPath)) {
            fs.renameSync(paths.snapshotPath, quarantinePath(paths.snapshotPath, verification.reason));
        }
        throw createError(503, 'Operational database requires rebuild; no verified snapshot is available.', 'ARCH_REBUILD_REQUIRED');
    }

    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    if (fs.existsSync(targetDbPath)) {
        fs.renameSync(targetDbPath, quarantinePath(targetDbPath, 'corrupt'));
    }
    if (fs.existsSync(`${targetDbPath}-wal`)) {
        fs.renameSync(`${targetDbPath}-wal`, quarantinePath(`${targetDbPath}-wal`, 'wal'));
    }
    if (fs.existsSync(`${targetDbPath}-shm`)) {
        fs.renameSync(`${targetDbPath}-shm`, quarantinePath(`${targetDbPath}-shm`, 'shm'));
    }
    fs.copyFileSync(paths.snapshotPath, targetDbPath);
}

export function openOperationalDatabase(paths, options = {}) {
    ensureStorageRoot(paths.storageRoot);
    const activeDbPath = resolveOperationalDbPath(paths);
    fs.mkdirSync(path.dirname(activeDbPath), { recursive: true });

    if (!fs.existsSync(activeDbPath)) {
        if (fs.existsSync(paths.snapshotPath)) {
            restoreFromSnapshot(paths, activeDbPath);
        } else if (hasOperationalStateMarker(paths)) {
            throw createError(503, 'Operational database requires rebuild; both primary and snapshot copies are unavailable.', 'ARCH_REBUILD_REQUIRED');
        }
    }

    let adapter = createAdapter(activeDbPath);
    try {
        initializeDatabase(adapter, options.now);
        writeOperationalStateMarker(paths, adapter, options.now);
        if (!adapter.verifyIntegrity()) {
            adapter.close();
            restoreFromSnapshot(paths, activeDbPath);
            adapter = createAdapter(activeDbPath);
            initializeDatabase(adapter, options.now);
            writeOperationalStateMarker(paths, adapter, options.now);
            if (!adapter.verifyIntegrity()) {
                throw createError(503, 'Operational database requires rebuild after failed snapshot restore.', 'ARCH_REBUILD_REQUIRED');
            }
        }
        return adapter;
    } catch (error) {
        try {
            adapter.close();
        } catch {
            // ignore close failures during error unwind
        }
        const hasDbFile = fs.existsSync(activeDbPath);
        const canAttemptRestore = hasDbFile && String(error?.code || '').includes('SQLITE');
        if (canAttemptRestore) {
            restoreFromSnapshot(paths, activeDbPath);
            const restored = createAdapter(activeDbPath);
            try {
                initializeDatabase(restored, options.now);
                writeOperationalStateMarker(paths, restored, options.now);
                if (!restored.verifyIntegrity()) {
                    throw createError(503, 'Operational database requires rebuild after failed snapshot restore.', 'ARCH_REBUILD_REQUIRED');
                }
                return restored;
            } catch (restoreError) {
                try {
                    restored.close();
                } catch {
                    // ignore close failures during restore unwind
                }
                throw restoreError;
            }
        }
        throw error;
    }
}

export function snapshotOperationalDatabase(adapter, paths) {
    adapter.createManagedSnapshot(paths.snapshotPath);
    writeOperationalStateMarker(paths, adapter);
    const verification = openSnapshotForVerification(paths.snapshotPath);
    if (!verification.ok) {
        if (fs.existsSync(paths.snapshotPath)) {
            fs.renameSync(paths.snapshotPath, quarantinePath(paths.snapshotPath, verification.reason));
        }
        throw createError(500, 'Managed snapshot verification failed', 'ARCH_SNAPSHOT_VERIFICATION_FAILED');
    }
    return verification.manifest;
}

export function readCurrentDecision(adapter, memoryScopeId, decisionId) {
    const pointer = adapter.get(
        'SELECT * FROM current_decisions WHERE memory_scope_id = ? AND decision_id = ?',
        [memoryScopeId, decisionId],
    );
    if (!pointer) {
        return null;
    }
    const record = adapter.get(
        'SELECT * FROM decision_records WHERE memory_scope_id = ? AND decision_id = ? AND record_version = ?',
        [memoryScopeId, decisionId, Number(pointer.current_record_version)],
    );
    const stub = adapter.get(
        'SELECT * FROM decision_stubs WHERE memory_scope_id = ? AND decision_id = ?',
        [memoryScopeId, decisionId],
    );
    return {
        pointer: pointer && {
            memoryScopeId: pointer.memory_scope_id,
            decisionId: pointer.decision_id,
            currentRecordVersion: Number(pointer.current_record_version),
            canonicalHash: pointer.canonical_hash,
            canonicalHashVersion: Number(pointer.canonical_hash_version),
            hashAlgorithm: pointer.hash_algorithm,
            authorityLocation: pointer.authority_location,
            archivePointer: parseNullableJson(pointer.archive_pointer_json),
            stubPointer: parseNullableJson(pointer.stub_pointer_json),
            updatedAt: Number(pointer.updated_at),
        },
        record: record && hydrateDecisionRecord(record),
        stub: stub ? JSON.parse(stub.payload_json) : null,
    };
}

export function hydrateDecisionRecord(row) {
    return {
        memoryScopeId: row.memory_scope_id,
        decisionId: row.decision_id,
        recordVersion: Number(row.record_version),
        canonicalHash: row.canonical_hash,
        canonicalHashVersion: Number(row.canonical_hash_version),
        hashAlgorithm: row.hash_algorithm,
        semanticPayload: row.semantic_payload,
        fields: JSON.parse(row.fields_json),
        status: row.status,
        priorVersion: row.prior_version === null ? null : Number(row.prior_version),
        sourceChatInstanceId: row.source_chat_instance_id,
        lastUpdatingChatInstanceId: row.last_updating_chat_instance_id,
        provenance: JSON.parse(row.provenance_json),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

export function parseNullableJson(value) {
    if (!value) return null;
    return JSON.parse(value);
}

export function buildHealthResponse(adapter, manifest) {
    return {
        ok: true,
        pluginId: PLUGIN_ID,
        serviceVersion: SERVICE_VERSION,
        runtime: adapter.runtime,
        db: {
            healthy: true,
            schemaVersion: manifest.schemaVersion,
            migrationState: manifest.migrationState,
            rebuildState: manifest.rebuildState,
            journalMode: manifest.journalMode,
        },
    };
}

export function validateArray(value, fieldName) {
    if (!Array.isArray(value)) {
        throw createError(400, `${fieldName} must be an array`, 'ARCH_INVALID_PAYLOAD');
    }
    return value;
}

function sanitizeChatFileStem(value) {
    const normalized = String(value || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
    if (!normalized) {
        throw createError(400, 'chatLocator is required', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    if (normalized.includes('/') || normalized.includes('\\')) {
        throw createError(400, 'chatLocator must not contain path separators', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    if (path.basename(normalized) !== normalized) {
        throw createError(400, 'chatLocator is invalid', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    return normalized;
}

function sanitizeAvatarUrl(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw createError(400, 'avatarUrl is required for character chats', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    if (normalized.includes('/') || normalized.includes('\\')) {
        throw createError(400, 'avatarUrl must not contain path separators', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    const basename = path.basename(normalized);
    if (basename !== normalized) {
        throw createError(400, 'avatarUrl is invalid', 'ARCH_INVALID_CHAT_LOCATOR');
    }
    return basename.replace(/\.png$/i, '');
}

export function resolveChatJsonlPath(request, locator = {}) {
    const isGroup = locator?.isGroup === true;
    const chatFileStem = sanitizeChatFileStem(locator?.chatLocator);
    const chatFileName = `${chatFileStem}.jsonl`;

    if (isGroup) {
        const groupId = sanitizeChatFileStem(locator?.groupId);
        const filePath = path.join(request.user.directories.groupChats, `${groupId}.jsonl`);
        return {
            kind: 'group',
            locator: {
                isGroup: true,
                groupId,
                chatLocator: chatFileStem,
            },
            chatFilePath: filePath,
        };
    }

    const avatarDir = sanitizeAvatarUrl(locator?.avatarUrl);
    const chatDirectory = path.join(request.user.directories.chats, avatarDir);
    const filePath = path.join(chatDirectory, chatFileName);
    if (!path.resolve(filePath).startsWith(path.resolve(request.user.directories.chats))) {
        throw createError(400, 'Resolved chat path escaped chats root', 'ARCH_INVALID_CHAT_LOCATOR');
    }

    return {
        kind: 'character',
        locator: {
            isGroup: false,
            avatarUrl: locator?.avatarUrl,
            chatLocator: chatFileStem,
        },
        chatFilePath: filePath,
    };
}

export function parseJsonlRecords(jsonlText) {
    const records = [];
    const invalidLines = [];
    const lines = String(jsonlText || '').split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) continue;
        try {
            records.push(JSON.parse(line));
        } catch (error) {
            invalidLines.push({
                lineNumber: index + 1,
                error: String(error?.message || 'Invalid JSON'),
            });
        }
    }
    return { records, invalidLines };
}

export function summarizePersistedChatMetadata(records = [], invalidLines = []) {
    const summary = {
        schema: cloneJson(MESSAGE_IDENTITY_SCAN_SCHEMA),
        headerPresent: false,
        recordCount: Array.isArray(records) ? records.length : 0,
        invalidLineCount: Array.isArray(invalidLines) ? invalidLines.length : 0,
        invalidLines: Array.isArray(invalidLines) ? invalidLines : [],
        messageCount: 0,
        promptHiddenCount: 0,
        swipeCarrierCount: 0,
        identity: {
            presentCount: 0,
            missingCount: 0,
            malformedCount: 0,
            duplicateIds: [],
        },
        archive: {
            archivedCount: 0,
            promptVisibilityBeforeArchiveCount: 0,
        },
        evidencePolicy: {
            includeCount: 0,
            excludeCount: 0,
            unexpectedValues: [],
        },
        speakerIdentityCount: 0,
        chatIdentityStatus: null,
    };

    const duplicateIds = new Set();
    const seenIds = new Set();
    const unexpectedValues = new Set();

    const header = Array.isArray(records) ? records[0] : null;
    if (header?.chat_metadata && typeof header.chat_metadata === 'object') {
        summary.headerPresent = true;
        const chatIdentityStatus = header.chat_metadata?.summary_sharder?.messageIdentity;
        if (chatIdentityStatus && typeof chatIdentityStatus === 'object') {
            summary.chatIdentityStatus = cloneJson(chatIdentityStatus);
        }
    }

    const messages = Array.isArray(records) ? records.slice(summary.headerPresent ? 1 : 0) : [];
    summary.messageCount = messages.length;

    for (const message of messages) {
        if (message?.is_system === true) {
            summary.promptHiddenCount += 1;
        }
        if (Array.isArray(message?.swipes) || message?.swipe_id !== undefined || message?.swipe_info !== undefined) {
            summary.swipeCarrierCount += 1;
        }

        const ss = message?.extra?.summary_sharder && typeof message.extra.summary_sharder === 'object'
            ? message.extra.summary_sharder
            : null;

        const identity = ss?.messageIdentity;
        if (identity && typeof identity === 'object') {
            const messageId = String(identity.messageId || '').trim();
            const initFingerprint = String(identity.initFingerprint || '').trim();
            const revisionHash = String(identity.revisionHash || '').trim();
            if (messageId && initFingerprint && revisionHash) {
                summary.identity.presentCount += 1;
                if (seenIds.has(messageId)) {
                    duplicateIds.add(messageId);
                } else {
                    seenIds.add(messageId);
                }
            } else {
                summary.identity.malformedCount += 1;
            }
        } else {
            summary.identity.missingCount += 1;
        }

        const archive = ss?.archive;
        if (archive?.isArchived === true) {
            summary.archive.archivedCount += 1;
            if (archive.promptVisibilityBeforeArchive !== undefined && archive.promptVisibilityBeforeArchive !== null) {
                summary.archive.promptVisibilityBeforeArchiveCount += 1;
            }
        }

        const evidencePolicy = ss?.evidencePolicy;
        if (evidencePolicy === 'exclude') {
            summary.evidencePolicy.excludeCount += 1;
        } else {
            summary.evidencePolicy.includeCount += 1;
            if (evidencePolicy !== undefined && evidencePolicy !== null && evidencePolicy !== 'include') {
                unexpectedValues.add(String(evidencePolicy));
            }
        }

        if (ss?.speakerIdentity && typeof ss.speakerIdentity === 'object') {
            summary.speakerIdentityCount += 1;
        }
    }

    summary.identity.duplicateIds = [...duplicateIds].sort();
    summary.evidencePolicy.unexpectedValues = [...unexpectedValues].sort();
    return summary;
}

export function scanPersistedChatMetadata(request, locator = {}) {
    const resolution = resolveChatJsonlPath(request, locator);
    if (!fs.existsSync(resolution.chatFilePath)) {
        throw createError(404, `Chat file was not found for ${resolution.locator.chatLocator}`, 'ARCH_CHAT_FILE_NOT_FOUND');
    }
    const raw = fs.readFileSync(resolution.chatFilePath, 'utf8');
    const { records, invalidLines } = parseJsonlRecords(raw);
    return {
        locator: resolution.locator,
        file: {
            kind: resolution.kind,
            exists: true,
            fileName: path.basename(resolution.chatFilePath),
        },
        summary: summarizePersistedChatMetadata(records, invalidLines),
    };
}

export function handleError(response, error) {
    const status = Number(error?.status) || 500;
    console.error(`[${PLUGIN_ID}]`, error);
    return response.status(status).send({
        ok: false,
        code: String(error?.code || 'ARCH_INTERNAL_ERROR'),
        error: String(error?.message || 'Internal error'),
    });
}
