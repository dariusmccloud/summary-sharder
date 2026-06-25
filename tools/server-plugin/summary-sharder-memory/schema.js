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
        `CREATE TABLE IF NOT EXISTS interpretation_revisions (
            interpretation_revision_id TEXT PRIMARY KEY,
            interpretation_id TEXT NOT NULL,
            parent_revision_id TEXT,
            created_from_disposition_id TEXT,
            revision_reason TEXT NOT NULL,
            memory_scope_id TEXT NOT NULL,
            memory_subject_id TEXT NOT NULL,
            interpretation_type TEXT NOT NULL,
            statement_text TEXT NOT NULL,
            assertion_domains_json TEXT NOT NULL,
            shared_relationship_asserted INTEGER NOT NULL,
            personal_meaning_asserted INTEGER NOT NULL,
            material_participant_entity_ids_json TEXT NOT NULL,
            candidate_state TEXT NOT NULL,
            grounding_state TEXT NOT NULL,
            review_state TEXT NOT NULL,
            subject_disposition_state TEXT NOT NULL,
            publication_state TEXT NOT NULL,
            authority_effect TEXT NOT NULL,
            proposal_content_hash TEXT NOT NULL,
            review_envelope_hash TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_grounding_links (
            interpretation_revision_id TEXT NOT NULL,
            grounding_link_id TEXT NOT NULL,
            basis_type TEXT NOT NULL,
            basis_record_id TEXT,
            basis_record_version INTEGER,
            basis_record_hash TEXT,
            chat_instance_id TEXT,
            message_id TEXT,
            message_revision_hash TEXT,
            speaker_entity_id TEXT NOT NULL,
            grounding_role TEXT NOT NULL,
            grounding_assessment TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (interpretation_revision_id, grounding_link_id)
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_grounding_aggregates (
            interpretation_revision_id TEXT PRIMARY KEY,
            grounding_outcome TEXT NOT NULL,
            evaluated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_risk_classifications (
            interpretation_revision_id TEXT PRIMARY KEY,
            risk_class TEXT NOT NULL,
            risk_reasons_json TEXT NOT NULL,
            resolution_input_hash TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_policy_definitions (
            validation_policy_id TEXT NOT NULL,
            policy_version INTEGER NOT NULL,
            policy_hash TEXT NOT NULL,
            required_grounding_outcome TEXT NOT NULL,
            required_reviewers_json TEXT NOT NULL,
            final_disposition_authority TEXT NOT NULL,
            auto_approval_allowed INTEGER NOT NULL,
            on_disagreement TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (validation_policy_id, policy_version)
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_policy_bindings (
            interpretation_revision_id TEXT PRIMARY KEY,
            validation_policy_id TEXT NOT NULL,
            policy_version INTEGER NOT NULL,
            policy_hash TEXT NOT NULL,
            matched_rule_ids_json TEXT NOT NULL,
            resolution_input_hash TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_review_obligations (
            review_obligation_id TEXT PRIMARY KEY,
            interpretation_revision_id TEXT NOT NULL,
            reviewer_role TEXT NOT NULL,
            reviewer_entity_id TEXT,
            obligation_state TEXT NOT NULL,
            blocking_reason TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_review_requests (
            review_request_id TEXT PRIMARY KEY,
            review_obligation_id TEXT NOT NULL,
            interpretation_revision_id TEXT NOT NULL,
            reviewer_role TEXT NOT NULL,
            reviewer_entity_id TEXT NOT NULL,
            status TEXT NOT NULL,
            review_envelope_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_review_dispositions (
            review_disposition_id TEXT PRIMARY KEY,
            review_request_id TEXT NOT NULL,
            interpretation_revision_id TEXT NOT NULL,
            reviewer_role TEXT NOT NULL,
            reviewer_entity_id TEXT NOT NULL,
            disposition TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            commentary TEXT,
            review_envelope_hash TEXT NOT NULL,
            submitted_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interpretation_subject_dispositions (
            interpretation_revision_id TEXT PRIMARY KEY,
            memory_subject_id TEXT NOT NULL,
            state TEXT NOT NULL,
            final_disposition_authority TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            commentary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_claims (
            reconstruction_run_id TEXT NOT NULL,
            claim_id TEXT NOT NULL,
            claim_id_version INTEGER NOT NULL,
            memory_scope_id TEXT NOT NULL,
            claim_class TEXT,
            claim_state TEXT,
            authority_class TEXT NOT NULL,
            authority_basis TEXT NOT NULL,
            claim_zone_class TEXT NOT NULL,
            extraction_mode TEXT NOT NULL,
            extraction_rule_id TEXT NOT NULL,
            extraction_rule_version INTEGER NOT NULL,
            normalization_version INTEGER NOT NULL,
            confidence_class TEXT NOT NULL,
            admission_status TEXT NOT NULL,
            admission_reason TEXT NOT NULL,
            evidence_lineage_id TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            chat_instance_id TEXT NOT NULL,
            source_revision_hash TEXT NOT NULL,
            claim_text_excerpt TEXT NOT NULL,
            normalized_claim_json TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, claim_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_claim_links (
            reconstruction_run_id TEXT NOT NULL,
            claim_id TEXT NOT NULL,
            related_record_id TEXT NOT NULL,
            relationship_type TEXT NOT NULL,
            reconciliation_basis TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, claim_id, related_record_id, relationship_type)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_conflicts (
            reconstruction_run_id TEXT NOT NULL,
            conflict_id TEXT NOT NULL,
            claim_id TEXT NOT NULL,
            conflict_code TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, conflict_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_candidate_review_items (
            reconstruction_run_id TEXT NOT NULL,
            review_item_id TEXT NOT NULL,
            claim_id TEXT,
            review_kind TEXT NOT NULL,
            severity TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, review_item_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_occurrence_groups (
            reconstruction_run_id TEXT NOT NULL,
            collision_evidence_group_id TEXT NOT NULL,
            memory_scope_id TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            record_version INTEGER NOT NULL,
            occurrence_classification TEXT NOT NULL,
            occurrence_rule_id TEXT NOT NULL,
            evidence_independence TEXT NOT NULL,
            independence_basis TEXT NOT NULL,
            canonical_record_id TEXT,
            reconciliation_result TEXT NOT NULL,
            blocking_state TEXT NOT NULL,
            unresolved_reason TEXT,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, collision_evidence_group_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_occurrence_group_members (
            reconstruction_run_id TEXT NOT NULL,
            collision_evidence_group_id TEXT NOT NULL,
            member_evidence_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_manifest_id TEXT NOT NULL,
            artifact_message_id TEXT NOT NULL,
            chat_instance_id TEXT NOT NULL,
            source_revision_hash TEXT NOT NULL,
            source_identity_hash TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            init_fingerprint TEXT NOT NULL,
            canonical_hash TEXT NOT NULL,
            covered_source_message_ids_json TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, collision_evidence_group_id, member_evidence_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_version_lifecycle_groups (
            reconstruction_run_id TEXT NOT NULL,
            version_lifecycle_group_id TEXT NOT NULL,
            memory_scope_id TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            version_lifecycle_classification TEXT NOT NULL,
            version_lifecycle_rule_id TEXT NOT NULL,
            blocking_state TEXT NOT NULL,
            unresolved_reason TEXT,
            canonical_record_ids_json TEXT NOT NULL,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, version_lifecycle_group_id)
        )`,
        `CREATE TABLE IF NOT EXISTS reconstruction_supersession_components (
            reconstruction_run_id TEXT NOT NULL,
            supersession_component_id TEXT NOT NULL,
            memory_scope_id TEXT NOT NULL,
            decision_ids_json TEXT NOT NULL,
            canonical_record_ids_json TEXT NOT NULL,
            supersession_lifecycle_classification TEXT NOT NULL,
            supersession_rule_id TEXT NOT NULL,
            blocking_state TEXT NOT NULL,
            unresolved_reason TEXT,
            details_json TEXT NOT NULL,
            PRIMARY KEY (reconstruction_run_id, supersession_component_id)
        )`,
    ];
}
