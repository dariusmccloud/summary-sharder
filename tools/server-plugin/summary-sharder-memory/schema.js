export const PLUGIN_ID = 'summary-sharder-memory';
export const SERVICE_VERSION = 'c0';
export const SCHEMA_VERSION = 1;
export const JOURNAL_MODE = 'WAL';

export function schemaStatements() {
    return [
        `CREATE TABLE IF NOT EXISTS manifest (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            service_version TEXT NOT NULL,
            runtime_adapter TEXT NOT NULL,
            journal_mode TEXT NOT NULL,
            migration_state TEXT NOT NULL,
            rebuild_state TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS memory_scopes (
            memory_scope_id TEXT PRIMARY KEY,
            scope_alias TEXT NOT NULL DEFAULT '',
            scope_version INTEGER NOT NULL,
            current_scope_run INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS chat_bindings (
            chat_instance_id TEXT PRIMARY KEY,
            memory_scope_id TEXT NOT NULL,
            chat_locator TEXT NOT NULL,
            scope_alias TEXT NOT NULL DEFAULT '',
            branched_from_chat_instance_id TEXT,
            imported_from_chat_instance_id TEXT,
            bound_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS decision_records (
            memory_scope_id TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            record_version INTEGER NOT NULL,
            canonical_hash TEXT NOT NULL,
            canonical_hash_version INTEGER NOT NULL,
            hash_algorithm TEXT NOT NULL,
            semantic_payload TEXT NOT NULL,
            fields_json TEXT NOT NULL,
            status TEXT NOT NULL,
            prior_version INTEGER,
            source_chat_instance_id TEXT,
            last_updating_chat_instance_id TEXT,
            provenance_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (memory_scope_id, decision_id, record_version)
        )`,
        `CREATE TABLE IF NOT EXISTS current_decisions (
            memory_scope_id TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            current_record_version INTEGER NOT NULL,
            canonical_hash TEXT NOT NULL,
            canonical_hash_version INTEGER NOT NULL,
            hash_algorithm TEXT NOT NULL,
            authority_location TEXT NOT NULL,
            archive_pointer_json TEXT,
            stub_pointer_json TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (memory_scope_id, decision_id)
        )`,
        `CREATE TABLE IF NOT EXISTS decision_stubs (
            memory_scope_id TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (memory_scope_id, decision_id)
        )`,
        `CREATE TABLE IF NOT EXISTS movement_records (
            memory_scope_id TEXT NOT NULL,
            movement_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (memory_scope_id, movement_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reference_index_snapshots (
            memory_scope_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS migration_audit (
            migration_id TEXT PRIMARY KEY,
            migration_kind TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`,
    ];
}
