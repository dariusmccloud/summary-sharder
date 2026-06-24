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

export function candidateAuditSchemaStatements() {
    return [
        `CREATE TABLE IF NOT EXISTS reconstruction_runs (
            reconstruction_run_id TEXT PRIMARY KEY,
            memory_scope_id TEXT NOT NULL,
            protocol_version TEXT NOT NULL,
            status TEXT NOT NULL,
            request_key TEXT NOT NULL,
            candidate_artifact_id TEXT NOT NULL,
            candidate_relative_path TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            failure_reason TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_manifest_files (
            reconstruction_run_id TEXT NOT NULL,
            corpus_file_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            chat_instance_id TEXT,
            physical_file_hash TEXT NOT NULL,
            physical_file_bytes INTEGER NOT NULL,
            schema_version INTEGER NOT NULL,
            header_version INTEGER NOT NULL,
            message_count INTEGER NOT NULL,
            identity_status TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, corpus_file_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_manifest_artifacts (
            reconstruction_run_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            corpus_file_id TEXT NOT NULL,
            artifact_message_id TEXT,
            output_uid TEXT,
            source_manifest_id TEXT NOT NULL,
            artifact_kind TEXT NOT NULL,
            semantic_source_hash TEXT NOT NULL,
            content_health TEXT NOT NULL,
            exposure_health TEXT NOT NULL,
            evidence_policy TEXT NOT NULL,
            admission_status TEXT NOT NULL,
            admission_reason TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, source_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_issues (
            reconstruction_run_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            severity TEXT NOT NULL,
            code TEXT NOT NULL,
            message TEXT NOT NULL,
            source_id TEXT,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, issue_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_provenance (
            reconstruction_run_id TEXT NOT NULL,
            provenance_id TEXT NOT NULL,
            record_id TEXT NOT NULL,
            memory_scope_id TEXT NOT NULL,
            speaker_entity_id TEXT NOT NULL,
            chat_instance_id TEXT NOT NULL,
            artifact_message_id TEXT NOT NULL,
            source_manifest_id TEXT NOT NULL,
            source_revision_hash TEXT NOT NULL,
            source_identity_hash TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, provenance_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_provenance_sources (
            reconstruction_run_id TEXT NOT NULL,
            provenance_id TEXT NOT NULL,
            covered_source_message_id TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, provenance_id, covered_source_message_id)
        )`,
    ];
}
