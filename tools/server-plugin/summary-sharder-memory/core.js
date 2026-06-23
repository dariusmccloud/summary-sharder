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
    rebuildAvailable: false,
    browserMigration: true,
    projectionRegistry: true,
    ordinaryChatPatching: false,
    c0_5: false,
    c1: false,
    c2: false,
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
    return {
        storageRoot,
        dbPath,
        snapshotPath,
        statePath,
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

function writeOperationalStateMarker(paths, adapter, now = Date.now()) {
    const marker = {
        schemaVersion: SCHEMA_VERSION,
        serviceVersion: SERVICE_VERSION,
        runtimeAdapter: adapter.runtime,
        journalMode: JOURNAL_MODE,
        adoptedAt: nowTimestamp(now),
    };
    atomicWriteFile(paths.statePath, JSON.stringify(marker, null, 2));
}

function hasOperationalStateMarker(paths) {
    return fs.existsSync(paths.statePath);
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

function restoreFromSnapshot(paths) {
    const verification = openSnapshotForVerification(paths.snapshotPath);
    if (!verification.ok) {
        if (fs.existsSync(paths.snapshotPath)) {
            fs.renameSync(paths.snapshotPath, quarantinePath(paths.snapshotPath, verification.reason));
        }
        throw createError(503, 'Operational database requires rebuild; no verified snapshot is available.', 'ARCH_REBUILD_REQUIRED');
    }

    if (fs.existsSync(paths.dbPath)) {
        fs.renameSync(paths.dbPath, quarantinePath(paths.dbPath, 'corrupt'));
    }
    if (fs.existsSync(`${paths.dbPath}-wal`)) {
        fs.renameSync(`${paths.dbPath}-wal`, quarantinePath(`${paths.dbPath}-wal`, 'wal'));
    }
    if (fs.existsSync(`${paths.dbPath}-shm`)) {
        fs.renameSync(`${paths.dbPath}-shm`, quarantinePath(`${paths.dbPath}-shm`, 'shm'));
    }
    fs.copyFileSync(paths.snapshotPath, paths.dbPath);
}

export function openOperationalDatabase(paths, options = {}) {
    ensureStorageRoot(paths.storageRoot);

    if (!fs.existsSync(paths.dbPath)) {
        if (fs.existsSync(paths.snapshotPath)) {
            restoreFromSnapshot(paths);
        } else if (hasOperationalStateMarker(paths)) {
            throw createError(503, 'Operational database requires rebuild; both primary and snapshot copies are unavailable.', 'ARCH_REBUILD_REQUIRED');
        }
    }

    let adapter = createAdapter(paths.dbPath);
    try {
        initializeDatabase(adapter, options.now);
        writeOperationalStateMarker(paths, adapter, options.now);
        if (!adapter.verifyIntegrity()) {
            adapter.close();
            restoreFromSnapshot(paths);
            adapter = createAdapter(paths.dbPath);
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
        const hasDbFile = fs.existsSync(paths.dbPath);
        const canAttemptRestore = hasDbFile && String(error?.code || '').includes('SQLITE');
        if (canAttemptRestore) {
            restoreFromSnapshot(paths);
            const restored = createAdapter(paths.dbPath);
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

export function handleError(response, error) {
    const status = Number(error?.status) || 500;
    console.error(`[${PLUGIN_ID}]`, error);
    return response.status(status).send({
        ok: false,
        code: String(error?.code || 'ARCH_INTERNAL_ERROR'),
        error: String(error?.message || 'Internal error'),
    });
}
