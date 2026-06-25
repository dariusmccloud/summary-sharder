import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_SCHEMA_VERSION,
    getSharderSectionRegistry,
} from './lib/core/summarization/sharder-section-registry.js';
import { buildArchitecturalDecisionAuthorityInput } from './lib/core/summarization/architectural-authority-store.js';
import {
    ARCHITECTURAL_REBUILD_MANIFEST_SCHEMA_VERSION,
    ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
    ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
    RECONSTRUCTION_STATUS,
    TERMINAL_RECONSTRUCTION_STATUS,
    TIER2_CLAIM_CLASS,
    TIER2_CLAIM_RELATIONSHIP,
    TIER2_CLAIM_STATE,
    TIER2_CLAIM_ZONE_CLASS,
    TIER2_CONFIDENCE_CLASS,
    TIER2_RECONCILIATION_BASIS,
    TIER2_REVIEW_KIND,
    buildDeterministicHashId,
    buildDeterministicTableDump,
    compareCanonicalText,
    hashDeterministicTableDump,
    normalizeCanonicalValue,
    sha256Text,
    stableStringify,
    summarizeCompactRebuildReport,
} from './lib/core/summarization/architectural-rebuild-protocol.js';
import {
    buildTier2ClaimReviewItem,
    extractArchitecturalDialogueClaims,
    isTier2ClaimAdmitted,
} from './lib/core/summarization/architectural-dialogue-claim-extractor.js';
import { parseArchitecturalExtractionResponse } from './lib/core/summarization/architectural-sharder-format.js';
import { buildArchitecturalShardMetadata } from './lib/core/summarization/saved-shard-identity.js';
import {
    SHARD_CONTENT_HEALTH_VALUES,
    normalizeShardManifest,
    validateShardManifest,
} from './lib/core/summarization/shard-integrity-core.js';
import {
    candidateAuditSchemaStatements,
    JOURNAL_MODE,
    SCHEMA_VERSION,
    SERVICE_VERSION,
} from './schema.js';
import {
    atomicWriteFile,
    createAdapter,
    createError,
    createId,
    getAuthenticatedUserRoot,
    getStoragePaths,
    initializeDatabase,
    nowTimestamp,
    parseJsonlRecords,
    readOperationalStateMarker,
    resolveOperationalDbPath,
    sanitizeIdentifier,
} from './core.js';

const REBUILD_TABLE_SPECS = Object.freeze([
    { name: 'memory_scopes', ignoredColumns: ['created_at', 'updated_at'] },
    { name: 'chat_bindings', ignoredColumns: ['bound_at', 'updated_at'] },
    { name: 'decision_records', ignoredColumns: ['created_at', 'updated_at'] },
    { name: 'current_decisions', ignoredColumns: ['updated_at'] },
    { name: 'reconstruction_manifest_files', ignoredColumns: ['reconstruction_run_id', 'corpus_file_id'] },
    { name: 'reconstruction_manifest_artifacts', ignoredColumns: ['reconstruction_run_id', 'source_id', 'corpus_file_id'] },
    { name: 'reconstruction_candidate_issues', ignoredColumns: ['reconstruction_run_id', 'issue_id', 'source_id'] },
    { name: 'reconstruction_candidate_provenance', ignoredColumns: ['reconstruction_run_id', 'provenance_id'] },
    { name: 'reconstruction_candidate_provenance_sources', ignoredColumns: ['reconstruction_run_id', 'provenance_id'] },
    { name: 'reconstruction_candidate_claims', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_candidate_claim_links', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_candidate_conflicts', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_candidate_review_items', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_occurrence_groups', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_occurrence_group_members', ignoredColumns: ['reconstruction_run_id', 'source_id'] },
    { name: 'reconstruction_version_lifecycle_groups', ignoredColumns: ['reconstruction_run_id'] },
    { name: 'reconstruction_supersession_components', ignoredColumns: ['reconstruction_run_id'] },
]);

export const AUTHORITY_SURFACE_TABLE_SPECS = Object.freeze([
    { name: 'memory_scopes', ignoredColumns: ['created_at', 'updated_at'], keyColumns: ['memory_scope_id'], scopeColumn: 'memory_scope_id' },
    { name: 'chat_bindings', ignoredColumns: ['bound_at', 'updated_at'], keyColumns: ['chat_instance_id'], scopeColumn: 'memory_scope_id' },
    { name: 'decision_records', ignoredColumns: ['created_at', 'updated_at'], keyColumns: ['memory_scope_id', 'decision_id', 'record_version'], scopeColumn: 'memory_scope_id' },
    { name: 'current_decisions', ignoredColumns: ['updated_at'], keyColumns: ['memory_scope_id', 'decision_id'], scopeColumn: 'memory_scope_id' },
    { name: 'decision_stubs', ignoredColumns: ['updated_at'], keyColumns: ['memory_scope_id', 'decision_id'], scopeColumn: 'memory_scope_id' },
    { name: 'movement_records', ignoredColumns: ['updated_at'], keyColumns: ['memory_scope_id', 'movement_id'], scopeColumn: 'memory_scope_id' },
    { name: 'reference_index_snapshots', ignoredColumns: ['updated_at'], keyColumns: ['memory_scope_id'], scopeColumn: 'memory_scope_id' },
]);

const TERMINAL_REPORT_STATUS = new Set([
    'success',
    'failed',
    'invalid',
    'invalidated_source_mutation',
]);

export const CANONICAL_CANDIDATE_HASH_VERSION = 1;
export const CANONICAL_CANDIDATE_HASH_BASIS = 'persisted_candidate_db';
export const AUTHORITY_SURFACE_HASH_VERSION = 1;
export const AUTHORITY_SURFACE_HASH_BASIS = 'scope_authority_surface';

function isTerminalCandidateStatus(status) {
    const normalized = String(status || '').trim();
    if (!normalized) {
        return false;
    }
    return TERMINAL_RECONSTRUCTION_STATUS.has(normalized) || TERMINAL_REPORT_STATUS.has(normalized.toLowerCase());
}

function getHostFamily() {
    return typeof process?.versions?.bun === 'string' ? 'sillybunny' : 'sillytavern';
}

function toRelativePath(userRoot, targetPath) {
    return path.relative(userRoot, targetPath).replace(/\\/g, '/');
}

function sha256File(filePath) {
    const buffer = fs.readFileSync(filePath);
    return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function ensureCandidatePaths(userRoot, reconstructionRunId) {
    const storageRoot = getStoragePaths(userRoot).storageRoot;
    const candidatesRoot = path.join(storageRoot, 'candidates');
    fs.mkdirSync(candidatesRoot, { recursive: true });
    const baseName = `architectural-memory.candidate.${reconstructionRunId}`;
    return {
        candidatesRoot,
        candidateDbPath: path.join(candidatesRoot, `${baseName}.db`),
        manifestPath: path.join(candidatesRoot, `${baseName}.manifest.json`),
        reportPath: path.join(candidatesRoot, `${baseName}.report.json`),
        candidateRelativePath: toRelativePath(userRoot, path.join(candidatesRoot, `${baseName}.db`)),
        manifestRelativePath: toRelativePath(userRoot, path.join(candidatesRoot, `${baseName}.manifest.json`)),
        reportRelativePath: toRelativePath(userRoot, path.join(candidatesRoot, `${baseName}.report.json`)),
    };
}

function candidatePathsFromManifestPath(userRoot, manifestPath) {
    const reconstructionRunId = path.basename(manifestPath).replace(/^architectural-memory\.candidate\./i, '').replace(/\.manifest\.json$/i, '');
    return ensureCandidatePaths(userRoot, reconstructionRunId);
}

function getLiveAuthorityFingerprints(userRoot) {
    const paths = getStoragePaths(userRoot);
    const activeDbPath = resolveOperationalDbPath(paths);
    const fingerprints = {};
    for (const [key, filePath] of Object.entries({
        db: activeDbPath,
        snapshot: paths.snapshotPath,
        state: paths.statePath,
    })) {
        fingerprints[key] = fs.existsSync(filePath)
            ? {
                relativePath: toRelativePath(userRoot, filePath),
                hash: sha256File(filePath),
                bytes: fs.statSync(filePath).size,
            }
            : null;
    }
    return fingerprints;
}

function equalFingerprints(left, right) {
    return stableStringify(left) === stableStringify(right);
}

function readScopeRegistry(adapter, memoryScopeId) {
    return adapter.get('SELECT * FROM memory_scopes WHERE memory_scope_id = ?', [memoryScopeId]) || null;
}

function readScopeRows(adapter, spec, memoryScopeId) {
    const parameters = spec.scopeColumn ? [memoryScopeId] : [];
    const sql = spec.scopeColumn
        ? `SELECT * FROM ${spec.name} WHERE ${spec.scopeColumn} = ?`
        : `SELECT * FROM ${spec.name}`;
    return adapter.all(sql, parameters);
}

export function buildScopeAuthoritySurfaceState(adapter, memoryScopeId) {
    const comparableDump = buildDeterministicTableDump(AUTHORITY_SURFACE_TABLE_SPECS, (tableName) => {
        const spec = AUTHORITY_SURFACE_TABLE_SPECS.find((entry) => entry.name === tableName);
        return readScopeRows(adapter, spec, memoryScopeId);
    });
    const canonicalBytes = stableStringify(comparableDump);
    const tableRowCounts = Object.fromEntries(
        AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, Array.isArray(comparableDump[spec.name]) ? comparableDump[spec.name].length : 0]),
    );
    const tableHashes = Object.fromEntries(
        AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, sha256Text(stableStringify(comparableDump[spec.name] || []))]),
    );
    const scopeRow = readScopeRegistry(adapter, memoryScopeId);
    return {
        hashVersion: AUTHORITY_SURFACE_HASH_VERSION,
        basis: AUTHORITY_SURFACE_HASH_BASIS,
        comparableDump,
        canonicalBytes,
        canonicalByteLength: Buffer.byteLength(canonicalBytes, 'utf8'),
        canonicalAuthorityHash: hashDeterministicTableDump(comparableDump),
        tableRowCounts,
        tableHashes,
        scopePresent: Boolean(scopeRow),
        scopeVersion: scopeRow ? Number(scopeRow.scope_version || 0) : 0,
        currentScopeRun: scopeRow ? Number(scopeRow.current_scope_run || 0) : 0,
    };
}

export function buildEmptyScopeAuthoritySurfaceState() {
    const comparableDump = Object.fromEntries(
        AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, []]),
    );
    const canonicalBytes = stableStringify(comparableDump);
    const tableRowCounts = Object.fromEntries(
        AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, 0]),
    );
    const tableHashes = Object.fromEntries(
        AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, sha256Text('[]')]),
    );
    return {
        hashVersion: AUTHORITY_SURFACE_HASH_VERSION,
        basis: AUTHORITY_SURFACE_HASH_BASIS,
        comparableDump,
        canonicalBytes,
        canonicalByteLength: Buffer.byteLength(canonicalBytes, 'utf8'),
        canonicalAuthorityHash: hashDeterministicTableDump(comparableDump),
        tableRowCounts,
        tableHashes,
        scopePresent: false,
        scopeVersion: 0,
        currentScopeRun: 0,
    };
}

function buildRowKey(row, keyColumns) {
    return stableStringify(Object.fromEntries(keyColumns.map((column) => [column, normalizeCanonicalValue(row?.[column])])));
}

function buildChangedFields(leftRow, rightRow) {
    const keys = new Set([...Object.keys(leftRow || {}), ...Object.keys(rightRow || {})]);
    return [...keys]
        .filter((key) => stableStringify(leftRow?.[key]) !== stableStringify(rightRow?.[key]))
        .sort(compareCanonicalText);
}

function summarizeAuthorityDiff(candidateState, liveState) {
    const perTable = {};
    let addedRecordCount = 0;
    let removedRecordCount = 0;
    let changedRecordCount = 0;
    let lifecycleChangeCount = 0;
    let provenanceChangeCount = 0;

    for (const spec of AUTHORITY_SURFACE_TABLE_SPECS) {
        const candidateRows = Array.isArray(candidateState?.comparableDump?.[spec.name]) ? candidateState.comparableDump[spec.name] : [];
        const liveRows = Array.isArray(liveState?.comparableDump?.[spec.name]) ? liveState.comparableDump[spec.name] : [];
        const candidateByKey = new Map(candidateRows.map((row) => [buildRowKey(row, spec.keyColumns), row]));
        const liveByKey = new Map(liveRows.map((row) => [buildRowKey(row, spec.keyColumns), row]));
        const allKeys = [...new Set([...candidateByKey.keys(), ...liveByKey.keys()])].sort(compareCanonicalText);
        const added = [];
        const removed = [];
        const changed = [];

        for (const key of allKeys) {
            const candidateRow = candidateByKey.get(key);
            const liveRow = liveByKey.get(key);
            if (candidateRow && !liveRow) {
                added.push({ key, row: candidateRow });
                continue;
            }
            if (!candidateRow && liveRow) {
                removed.push({ key, row: liveRow });
                continue;
            }
            const changedFields = buildChangedFields(candidateRow, liveRow);
            if (changedFields.length === 0) {
                continue;
            }
            changed.push({
                key,
                changedFields,
                candidateRow,
                liveRow,
            });
            if (spec.name === 'decision_records' && changedFields.some((field) => ['status', 'prior_version'].includes(field))) {
                lifecycleChangeCount += 1;
            }
            if (spec.name === 'current_decisions' && changedFields.includes('current_record_version')) {
                lifecycleChangeCount += 1;
            }
            if (spec.name === 'decision_records' && changedFields.some((field) => ['provenance_json', 'source_chat_instance_id', 'last_updating_chat_instance_id'].includes(field))) {
                provenanceChangeCount += 1;
            }
        }

        addedRecordCount += added.length;
        removedRecordCount += removed.length;
        changedRecordCount += changed.length;
        perTable[spec.name] = {
            added,
            removed,
            changed,
            unchangedCount: Math.max(candidateRows.length, liveRows.length) - added.length - removed.length - changed.length,
        };
    }

    return {
        equal: addedRecordCount === 0 && removedRecordCount === 0 && changedRecordCount === 0,
        addedRecordCount,
        removedRecordCount,
        changedRecordCount,
        lifecycleChangeCount,
        provenanceChangeCount,
        perTable,
    };
}

function buildExclusionSummary(exclusions = []) {
    const byReason = {};
    for (const entry of exclusions) {
        const reason = String(entry?.reason || 'unknown');
        byReason[reason] = Number(byReason[reason] || 0) + 1;
    }
    return {
        count: Array.isArray(exclusions) ? exclusions.length : 0,
        byReason,
    };
}

function classifyIrrecoverableGap(entry) {
    const reason = String(entry?.reason || '').trim();
    const irrecoverableReasons = new Set([
        'artifact_message_missing_at_compile',
        'decision_parse_invalid_at_compile',
    ]);
    return {
        ...entry,
        recoverability: irrecoverableReasons.has(reason) ? 'irrecoverable' : 'review_required',
    };
}

function buildIrrecoverableGapDisclosure(report) {
    const unresolved = Array.isArray(report?.unresolvedEvidence) ? report.unresolvedEvidence.map(classifyIrrecoverableGap) : [];
    const irrecoverable = unresolved.filter((entry) => entry.recoverability === 'irrecoverable');
    return {
        hasAnyGap: unresolved.length > 0,
        hasIrrecoverableGap: irrecoverable.length > 0,
        totalGapCount: unresolved.length,
        irrecoverableGapCount: irrecoverable.length,
        entries: unresolved,
    };
}

function buildRollbackGenerationPlan(liveState) {
    const liveGeneration = Number(liveState?.currentScopeRun || 0);
    return {
        expectedLiveGeneration: liveGeneration,
        expectedLiveGenerationIdentity: liveState?.generationIdentity || null,
        expectedLiveHash: liveState?.canonicalAuthorityHash || null,
        rollbackSource: liveState?.scopePresent ? 'preserve_current_live_generation' : 'no_live_generation_to_preserve',
        verificationPrerequisites: [
            'current live generation hash still matches expected live hash',
            'current live generation identity still matches expected live generation',
            'rollback artifact path is writable',
            'rollback artifact verification succeeds before pointer transition',
        ],
        refusalReasonsIfUnavailable: [
            'expected live generation drifted before promotion',
            'expected live hash drifted before promotion',
            'rollback artifact creation or verification failed',
        ],
    };
}

function buildPromotionQualificationDigest(payload) {
    return sha256Text(stableStringify(payload));
}

export function readLiveAuthorityStateReadOnly(userRoot, memoryScopeId) {
    const paths = getStoragePaths(userRoot);
    const stateMarker = readOperationalStateMarker(paths);
    const activeDbPath = resolveOperationalDbPath(paths, stateMarker);
    const stateMarkerPresent = fs.existsSync(paths.statePath);
    const snapshotPresent = fs.existsSync(paths.snapshotPath);
    if (!fs.existsSync(activeDbPath)) {
        const emptyState = buildEmptyScopeAuthoritySurfaceState();
        return {
            ok: true,
            dbPresent: false,
            stateMarkerPresent,
            snapshotPresent,
            schemaVersion: SCHEMA_VERSION,
            serviceVersion: SERVICE_VERSION,
            runtimeAdapter: null,
            journalMode: null,
            manifestMissing: true,
            ...emptyState,
            generationIdentity: stateMarker?.liveAuthority?.generationId || `live:${memoryScopeId}:run:0`,
            dbRelativePath: stateMarker?.liveAuthority?.dbRelativePath || null,
            issues: [],
        };
    }

    const adapter = createAdapter(activeDbPath);
    try {
        const integrityOk = adapter.verifyIntegrity();
        if (!integrityOk) {
            return {
                ok: false,
                dbPresent: true,
                stateMarkerPresent,
                snapshotPresent,
                issues: ['live_integrity_failed'],
            };
        }
        const manifestRow = adapter.get('SELECT * FROM manifest WHERE id = 1');
        if (!manifestRow) {
            return {
                ok: false,
                dbPresent: true,
                stateMarkerPresent,
                snapshotPresent,
                issues: ['live_manifest_missing'],
            };
        }
        if (Number(manifestRow.schema_version) !== SCHEMA_VERSION) {
            return {
                ok: false,
                dbPresent: true,
                stateMarkerPresent,
                snapshotPresent,
                schemaVersion: Number(manifestRow.schema_version),
                serviceVersion: String(manifestRow.service_version || ''),
                runtimeAdapter: String(manifestRow.runtime_adapter || ''),
                journalMode: String(manifestRow.journal_mode || ''),
                issues: ['live_schema_version_unsupported'],
            };
        }
        const state = buildScopeAuthoritySurfaceState(adapter, memoryScopeId);
        return {
            ok: true,
            dbPresent: true,
            stateMarkerPresent,
            snapshotPresent,
            schemaVersion: Number(manifestRow.schema_version),
            serviceVersion: String(manifestRow.service_version || ''),
            runtimeAdapter: String(manifestRow.runtime_adapter || ''),
            journalMode: String(manifestRow.journal_mode || ''),
            manifestMissing: false,
            ...state,
            generationIdentity: String(stateMarker?.liveAuthority?.generationId || `live:${memoryScopeId}:run:${Number(state.currentScopeRun || 0)}`),
            dbRelativePath: stateMarker?.liveAuthority?.dbRelativePath || null,
            issues: [],
        };
    } finally {
        adapter.close();
    }
}

function buildCandidateAuthorityIdentity(candidatePaths, report) {
    if (!fs.existsSync(candidatePaths.candidateDbPath)) {
        return {
            reconstructionRunId: report.reconstructionRunId,
            candidateArtifactId: report.candidateArtifactId,
            candidateRelativePath: report.candidateRelativePath,
            schemaVersion: report.schemaVersion,
            protocolVersion: report.protocolVersion,
            canonicalCandidateHash: report?.determinism?.canonicalCandidateHash || null,
            canonicalCandidateHashFinal: report?.determinism?.canonicalHashFinal === true,
            authoritySurfaceHash: null,
            authoritySurfaceHashFinal: false,
            hashVersion: AUTHORITY_SURFACE_HASH_VERSION,
            basis: AUTHORITY_SURFACE_HASH_BASIS,
            canonicalByteLength: null,
            tableRowCounts: {},
            tableHashes: {},
            scopePresent: false,
            scopeVersion: null,
            currentScopeRun: null,
            generationIdentity: null,
            comparableDump: null,
        };
    }
    const state = computeScopedAuthorityState(candidatePaths.candidateDbPath, report.memoryScopeId);
    return {
        reconstructionRunId: report.reconstructionRunId,
        candidateArtifactId: report.candidateArtifactId,
        candidateRelativePath: report.candidateRelativePath,
        schemaVersion: report.schemaVersion,
        protocolVersion: report.protocolVersion,
        canonicalCandidateHash: report?.determinism?.canonicalCandidateHash || null,
        canonicalCandidateHashFinal: report?.determinism?.canonicalHashFinal === true,
        authoritySurfaceHash: state.canonicalAuthorityHash,
        authoritySurfaceHashFinal: true,
        hashVersion: state.hashVersion,
        basis: state.basis,
        canonicalByteLength: state.canonicalByteLength,
        tableRowCounts: state.tableRowCounts,
        tableHashes: state.tableHashes,
        scopePresent: state.scopePresent,
        scopeVersion: state.scopeVersion,
        currentScopeRun: state.currentScopeRun,
        generationIdentity: `candidate:${report.memoryScopeId}:run:${Number(state.currentScopeRun || 0)}`,
        comparableDump: state.comparableDump,
    };
}

export function computeScopedAuthorityState(candidateDbPath, memoryScopeId) {
    const adapter = createAdapter(candidateDbPath);
    try {
        return buildScopeAuthoritySurfaceState(adapter, memoryScopeId);
    } finally {
        adapter.close();
    }
}

function buildPromotionQualification(userRoot, candidatePaths, report) {
    const candidate = buildCandidateAuthorityIdentity(candidatePaths, report);
    const live = readLiveAuthorityStateReadOnly(userRoot, report.memoryScopeId);
    const liveComparableState = live.ok
        ? {
            canonicalAuthorityHash: live.canonicalAuthorityHash,
            hashVersion: live.hashVersion,
            basis: live.basis,
            canonicalByteLength: live.canonicalByteLength,
            tableRowCounts: live.tableRowCounts,
            tableHashes: live.tableHashes,
            scopePresent: live.scopePresent,
            scopeVersion: live.scopeVersion,
            currentScopeRun: live.currentScopeRun,
            generationIdentity: live.generationIdentity,
            comparableDump: live.comparableDump,
            dbPresent: live.dbPresent,
            stateMarkerPresent: live.stateMarkerPresent,
            snapshotPresent: live.snapshotPresent,
            schemaVersion: live.schemaVersion,
            serviceVersion: live.serviceVersion,
            runtimeAdapter: live.runtimeAdapter,
            journalMode: live.journalMode,
            issues: live.issues,
        }
        : {
            canonicalAuthorityHash: null,
            hashVersion: AUTHORITY_SURFACE_HASH_VERSION,
            basis: AUTHORITY_SURFACE_HASH_BASIS,
            canonicalByteLength: null,
            tableRowCounts: {},
            tableHashes: {},
            scopePresent: false,
            scopeVersion: null,
            currentScopeRun: null,
            generationIdentity: null,
            comparableDump: null,
            dbPresent: live.dbPresent,
            stateMarkerPresent: live.stateMarkerPresent,
            snapshotPresent: live.snapshotPresent,
            schemaVersion: live.schemaVersion ?? null,
            serviceVersion: live.serviceVersion ?? null,
            runtimeAdapter: live.runtimeAdapter ?? null,
            journalMode: live.journalMode ?? null,
            issues: live.issues,
        };

    const structuralDiff = live.ok
        ? summarizeAuthorityDiff(candidate, live)
        : {
            equal: false,
            addedRecordCount: 0,
            removedRecordCount: 0,
            changedRecordCount: 0,
            lifecycleChangeCount: 0,
            provenanceChangeCount: 0,
            perTable: {},
        };
    const sourceCoverage = {
        inputSummary: report.inputSummary || {},
        coverage: report.coverage || {},
        exclusionSummary: buildExclusionSummary(report.exclusions || []),
        unresolvedEvidenceCount: Array.isArray(report.unresolvedEvidence) ? report.unresolvedEvidence.length : 0,
    };
    const irrecoverableGapDisclosure = buildIrrecoverableGapDisclosure(report);
    const rollbackGenerationPlan = buildRollbackGenerationPlan(liveComparableState);
    const ineligibilityReasons = [];
    if (report?.determinism?.canonicalHashFinal !== true || !candidate.canonicalCandidateHash) {
        ineligibilityReasons.push({
            code: 'CANDIDATE_HASH_NOT_FINAL',
            message: 'Candidate canonical hash is not final and verified.',
        });
    }
    if (report?.status !== 'success') {
        ineligibilityReasons.push({
            code: 'CANDIDATE_RUN_NOT_SUCCESSFUL',
            message: `Candidate run status ${String(report?.status || 'unknown')} is not promotable.`,
        });
    }
    if (report?.candidateValidity?.valid !== true) {
        ineligibilityReasons.push({
            code: 'CANDIDATE_INVALID',
            message: 'Candidate validity is not clean.',
            structuralBlockers: report?.candidateValidity?.structuralBlockers || [],
        });
    }
    if (report?.liveAuthorityChanged === true) {
        ineligibilityReasons.push({
            code: 'LIVE_AUTHORITY_CHANGED_DURING_RUN',
            message: 'Live authority changed while candidate qualification was running.',
        });
    }
    if (!live.ok) {
        ineligibilityReasons.push({
            code: 'LIVE_AUTHORITY_UNREADABLE',
            message: 'Live authority state could not be read without mutation.',
            issues: live.issues || [],
        });
    }
    if (irrecoverableGapDisclosure.hasIrrecoverableGap) {
        ineligibilityReasons.push({
            code: 'IRRECOVERABLE_GAP_PRESENT',
            message: 'Irrecoverable evidence gaps remain in the candidate source set.',
            entries: irrecoverableGapDisclosure.entries.filter((entry) => entry.recoverability === 'irrecoverable'),
        });
    }

    const eligibility = {
        eligible: ineligibilityReasons.length === 0,
        reasons: ineligibilityReasons,
    };
    const authorization = {
        authorized: false,
        promotionAvailable: false,
        reasons: [
            {
                code: 'PROMOTION_PATH_UNAVAILABLE',
                message: 'Promotion remains intentionally unavailable in C0.75-1.',
            },
        ],
    };
    const digestPayload = {
        reconstructionRunId: report.reconstructionRunId,
        memoryScopeId: report.memoryScopeId,
        candidate: {
            candidateArtifactId: candidate.candidateArtifactId,
            canonicalCandidateHash: candidate.canonicalCandidateHash,
            authoritySurfaceHash: candidate.authoritySurfaceHash,
            generationIdentity: candidate.generationIdentity,
        },
        live: {
            canonicalAuthorityHash: liveComparableState.canonicalAuthorityHash,
            generationIdentity: liveComparableState.generationIdentity,
            dbPresent: liveComparableState.dbPresent,
        },
        structuralDiff: {
            equal: structuralDiff.equal,
            addedRecordCount: structuralDiff.addedRecordCount,
            removedRecordCount: structuralDiff.removedRecordCount,
            changedRecordCount: structuralDiff.changedRecordCount,
            lifecycleChangeCount: structuralDiff.lifecycleChangeCount,
            provenanceChangeCount: structuralDiff.provenanceChangeCount,
        },
        candidateValidity: report.candidateValidity || {},
        irrecoverableGapDisclosure,
        eligibility,
        rollbackGenerationPlan,
    };

    return {
        attempted: true,
        completed: true,
        candidate,
        live: liveComparableState,
        structuralDiff,
        sourceCoverage,
        irrecoverableGapDisclosure,
        rollbackGenerationPlan,
        eligibility,
        authorization,
        boundEvidenceDigest: buildPromotionQualificationDigest(digestPayload),
    };
}

function ensureCandidateDatabase(candidatePaths, reconstructionRunId, memoryScopeId, requestKey, timestamp) {
    const adapter = createAdapter(candidatePaths.candidateDbPath);
    try {
        initializeDatabase(adapter, timestamp);
        for (const statement of candidateAuditSchemaStatements()) {
            adapter.exec(statement);
        }
        adapter.run(
            `INSERT INTO reconstruction_runs (
                reconstruction_run_id, memory_scope_id, protocol_version, status, request_key,
                candidate_artifact_id, candidate_relative_path, started_at, finished_at, failure_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                reconstructionRunId,
                memoryScopeId,
                ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
                RECONSTRUCTION_STATUS.INITIALIZED,
                requestKey,
                `candidate_${reconstructionRunId}`,
                candidatePaths.candidateRelativePath,
                timestamp,
                null,
                null,
            ],
        );
    } finally {
        adapter.close();
    }
}

function updateCandidateRunStatus(adapter, reconstructionRunId, status, options = {}) {
    adapter.run(
        `UPDATE reconstruction_runs
            SET status = ?, finished_at = ?, failure_reason = ?
          WHERE reconstruction_run_id = ?`,
        [
            status,
            options.finishedAt ?? null,
            options.failureReason ?? null,
            reconstructionRunId,
        ],
    );
}

function listJsonlFiles(rootPath) {
    if (!fs.existsSync(rootPath)) {
        return [];
    }
    const output = [];
    const stack = [rootPath];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const resolved = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(resolved);
                continue;
            }
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
                output.push(resolved);
            }
        }
    }
    output.sort((a, b) => a.localeCompare(b));
    return output;
}

function listScopeCandidateArtifacts(candidatesRoot, memoryScopeId) {
    if (!fs.existsSync(candidatesRoot)) {
        return [];
    }
    const manifests = fs.readdirSync(candidatesRoot)
        .filter((name) => name.endsWith('.manifest.json'))
        .map((name) => path.join(candidatesRoot, name));
    const entries = [];
    for (const manifestPath of manifests) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest?.memoryScopeId !== memoryScopeId) continue;
            const reportPath = manifestPath.replace(/\.manifest\.json$/i, '.report.json');
            const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
            const candidateDbPath = manifestPath.replace(/\.manifest\.json$/i, '.db');
            let runRow = null;
            if (fs.existsSync(candidateDbPath)) {
                const adapter = createAdapter(candidateDbPath);
                try {
                    runRow = adapter.get('SELECT * FROM reconstruction_runs WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]);
                } catch {
                    runRow = null;
                } finally {
                    adapter.close();
                }
            }
            entries.push({ manifestPath, manifest, reportPath, report, runRow });
        } catch {
            // ignore malformed sidecars during discovery
        }
    }
    return entries;
}

function isPinnedReport(report) {
    return report?.retention?.pinned === true;
}

function computeRetentionDisposition(entries) {
    const terminalEntries = entries
        .filter((entry) => isTerminalCandidateStatus(entry.report?.status))
        .sort((a, b) => Number(b.report?.finishedAt || b.report?.createdAt || 0) - Number(a.report?.finishedAt || a.report?.createdAt || 0));

    const reasonsByRunId = new Map();
    const keep = new Set();
    const latestSuccess = terminalEntries.find((entry) => entry.report?.status === 'success');
    const latestNonSuccess = terminalEntries.find((entry) => entry.report?.status !== 'success');

    if (latestSuccess) {
        keep.add(latestSuccess.manifest.reconstructionRunId);
        reasonsByRunId.set(latestSuccess.manifest.reconstructionRunId, ['latest_success']);
    }
    if (latestNonSuccess) {
        keep.add(latestNonSuccess.manifest.reconstructionRunId);
        reasonsByRunId.set(
            latestNonSuccess.manifest.reconstructionRunId,
            [...(reasonsByRunId.get(latestNonSuccess.manifest.reconstructionRunId) || []), 'latest_non_success'],
        );
    }

    for (const entry of terminalEntries) {
        if (!isPinnedReport(entry.report)) continue;
        keep.add(entry.manifest.reconstructionRunId);
        reasonsByRunId.set(
            entry.manifest.reconstructionRunId,
            [...(reasonsByRunId.get(entry.manifest.reconstructionRunId) || []), 'pinned'],
        );
    }

    return {
        keep,
        reasonsByRunId,
        removable: terminalEntries.filter((entry) => !keep.has(entry.manifest.reconstructionRunId)),
    };
}

function buildArtifactReportEntries(manifest) {
    const fileById = new Map((manifest.corpusFiles || []).map((entry) => [entry.corpusFileId, entry]));
    return (manifest.artifacts || []).map((artifact) => {
        const fileEntry = fileById.get(artifact.corpusFileId);
        return {
            sourceId: artifact.sourceId,
            corpusFileId: artifact.corpusFileId,
            relativePath: fileEntry?.sourceLocator?.relativePath || null,
            chatInstanceId: fileEntry?.chatInstanceId || null,
            artifactMessageId: artifact.artifactMessageId || null,
            outputUid: artifact.outputUid || null,
            sourceManifestId: artifact.sourceManifestId,
            artifactKind: artifact.artifactKind,
            semanticSourceHash: artifact.semanticSourceHash,
            contentHealth: artifact.contentHealth,
            exposureHealth: artifact.exposureHealth,
            evidencePolicy: artifact.evidencePolicy,
            admissionStatus: artifact.admissionStatus,
            admissionReason: artifact.admissionReason,
            stableDecisionIds: artifact.stableDecisionIds || [],
            sectionKeys: artifact.sectionKeys || [],
        };
    });
}

function buildCandidateRecordReportEntries(adapter, reconstructionRunId) {
    const decisions = adapter.all(
        `SELECT memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version, hash_algorithm,
                status, prior_version, source_chat_instance_id, last_updating_chat_instance_id
           FROM decision_records
          ORDER BY decision_id ASC, record_version ASC`,
    );
    const provenanceRows = adapter.all(
        `SELECT provenance_id, record_id, memory_scope_id, speaker_entity_id, chat_instance_id, artifact_message_id,
                source_manifest_id, source_revision_hash, source_identity_hash
           FROM reconstruction_candidate_provenance
          WHERE reconstruction_run_id = ?
          ORDER BY record_id ASC, provenance_id ASC`,
        [reconstructionRunId],
    );
    const coveredRows = adapter.all(
        `SELECT provenance_id, covered_source_message_id
           FROM reconstruction_candidate_provenance_sources
          WHERE reconstruction_run_id = ?
          ORDER BY provenance_id ASC, covered_source_message_id ASC`,
        [reconstructionRunId],
    );

    const coveredByProvenanceId = new Map();
    for (const row of coveredRows) {
        const list = coveredByProvenanceId.get(row.provenance_id) || [];
        list.push(row.covered_source_message_id);
        coveredByProvenanceId.set(row.provenance_id, list);
    }

    const provenanceByRecordId = new Map();
    for (const row of provenanceRows) {
        const list = provenanceByRecordId.get(row.record_id) || [];
        list.push({
            provenanceId: row.provenance_id,
            memoryScopeId: row.memory_scope_id,
            speakerEntityId: row.speaker_entity_id,
            chatInstanceId: row.chat_instance_id,
            artifactMessageId: row.artifact_message_id,
            sourceManifestId: row.source_manifest_id,
            sourceRevisionHash: row.source_revision_hash,
            sourceIdentityHash: row.source_identity_hash,
            coveredSourceMessageIds: coveredByProvenanceId.get(row.provenance_id) || [],
        });
        provenanceByRecordId.set(row.record_id, list);
    }

    return decisions.map((row) => ({
        memoryScopeId: row.memory_scope_id,
        decisionId: row.decision_id,
        recordVersion: Number(row.record_version),
        recordId: buildCanonicalTier1RecordIdV1(
            row.memory_scope_id,
            row.decision_id,
            Number(row.record_version),
            Number(row.canonical_hash_version),
            row.canonical_hash,
        ),
        canonicalHash: row.canonical_hash,
        canonicalHashVersion: Number(row.canonical_hash_version),
        hashAlgorithm: row.hash_algorithm,
        status: row.status,
        priorVersion: Number.isInteger(Number(row.prior_version)) ? Number(row.prior_version) : null,
        sourceChatInstanceId: row.source_chat_instance_id || null,
        lastUpdatingChatInstanceId: row.last_updating_chat_instance_id || null,
        provenance: provenanceByRecordId.get(buildCanonicalTier1RecordIdV1(
            row.memory_scope_id,
            row.decision_id,
            Number(row.record_version),
            Number(row.canonical_hash_version),
            row.canonical_hash,
        )) || [],
    }));
}

function buildCandidateIssueReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT issue_id, severity, code, message, source_id, details_json
           FROM reconstruction_candidate_issues
          WHERE reconstruction_run_id = ?
          ORDER BY severity DESC, code ASC, issue_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        issueId: row.issue_id,
        severity: row.severity,
        code: row.code,
        message: row.message,
        sourceId: row.source_id || null,
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildCandidateClaimReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT *
           FROM reconstruction_candidate_claims
          WHERE reconstruction_run_id = ?
          ORDER BY claim_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        claimId: row.claim_id,
        claimIdVersion: Number(row.claim_id_version),
        memoryScopeId: row.memory_scope_id,
        claimClass: row.claim_class || null,
        claimState: row.claim_state || null,
        authorityClass: row.authority_class,
        authorityBasis: row.authority_basis,
        claimZoneClass: row.claim_zone_class,
        extractionMode: row.extraction_mode,
        extractionRuleId: row.extraction_rule_id,
        extractionRuleVersion: Number(row.extraction_rule_version),
        normalizationVersion: Number(row.normalization_version),
        confidenceClass: row.confidence_class,
        admissionStatus: row.admission_status,
        admissionReason: row.admission_reason,
        evidenceLineageId: row.evidence_lineage_id,
        sourceMessageId: row.source_message_id,
        chatInstanceId: row.chat_instance_id,
        sourceRevisionHash: row.source_revision_hash,
        claimTextExcerpt: row.claim_text_excerpt,
        normalizedClaim: JSON.parse(row.normalized_claim_json || '{}'),
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildCandidateClaimLinkReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT claim_id, related_record_id, relationship_type, reconciliation_basis
           FROM reconstruction_candidate_claim_links
          WHERE reconstruction_run_id = ?
          ORDER BY claim_id ASC, related_record_id ASC, relationship_type ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        claimId: row.claim_id,
        relatedRecordId: row.related_record_id,
        relationshipType: row.relationship_type,
        reconciliationBasis: row.reconciliation_basis,
    }));
}

function buildCandidateConflictReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT conflict_id, claim_id, conflict_code, details_json
           FROM reconstruction_candidate_conflicts
          WHERE reconstruction_run_id = ?
          ORDER BY conflict_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        conflictId: row.conflict_id,
        claimId: row.claim_id,
        code: row.conflict_code,
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildCandidateReviewItemReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT review_item_id, claim_id, review_kind, severity, details_json
           FROM reconstruction_candidate_review_items
          WHERE reconstruction_run_id = ?
          ORDER BY review_item_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        reviewItemId: row.review_item_id,
        claimId: row.claim_id || null,
        reviewKind: row.review_kind,
        severity: row.severity,
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildOccurrenceGroupReportEntries(adapter, reconstructionRunId) {
    const rows = adapter.all(
        `SELECT *
           FROM reconstruction_occurrence_groups
          WHERE reconstruction_run_id = ?
          ORDER BY decision_id ASC, record_version ASC, collision_evidence_group_id ASC`,
        [reconstructionRunId],
    );
    const memberRows = adapter.all(
        `SELECT *
           FROM reconstruction_occurrence_group_members
          WHERE reconstruction_run_id = ?
          ORDER BY collision_evidence_group_id ASC, member_evidence_id ASC`,
        [reconstructionRunId],
    );
    const membersByGroupId = new Map();
    for (const row of memberRows) {
        const list = membersByGroupId.get(row.collision_evidence_group_id) || [];
        list.push({
            memberEvidenceId: row.member_evidence_id,
            sourceId: row.source_id,
            sourceManifestId: row.source_manifest_id,
            artifactMessageId: row.artifact_message_id,
            chatInstanceId: row.chat_instance_id,
            sourceRevisionHash: row.source_revision_hash,
            sourceIdentityHash: row.source_identity_hash,
            sourceMessageId: row.source_message_id,
            initFingerprint: row.init_fingerprint,
            canonicalHash: row.canonical_hash,
            coveredSourceMessageIds: JSON.parse(row.covered_source_message_ids_json || '[]'),
            details: JSON.parse(row.details_json || '{}'),
        });
        membersByGroupId.set(row.collision_evidence_group_id, list);
    }
    return rows.map((row) => ({
        collisionEvidenceGroupId: row.collision_evidence_group_id,
        memoryScopeId: row.memory_scope_id,
        decisionId: row.decision_id,
        recordVersion: Number(row.record_version),
        occurrenceClassification: row.occurrence_classification,
        occurrenceRuleId: row.occurrence_rule_id,
        evidenceIndependence: row.evidence_independence,
        independenceBasis: row.independence_basis,
        canonicalRecordId: row.canonical_record_id || null,
        reconciliationResult: row.reconciliation_result,
        blocking: row.blocking_state === 'blocking',
        unresolvedReason: row.unresolved_reason || null,
        memberEvidenceIds: (membersByGroupId.get(row.collision_evidence_group_id) || []).map((entry) => entry.memberEvidenceId),
        members: membersByGroupId.get(row.collision_evidence_group_id) || [],
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildVersionLifecycleGroupReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT *
           FROM reconstruction_version_lifecycle_groups
          WHERE reconstruction_run_id = ?
          ORDER BY decision_id ASC, version_lifecycle_group_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        versionLifecycleGroupId: row.version_lifecycle_group_id,
        memoryScopeId: row.memory_scope_id,
        decisionId: row.decision_id,
        canonicalRecordIds: JSON.parse(row.canonical_record_ids_json || '[]'),
        versionLifecycleClassification: row.version_lifecycle_classification,
        versionLifecycleRuleId: row.version_lifecycle_rule_id,
        blocking: row.blocking_state === 'blocking',
        unresolvedReason: row.unresolved_reason || null,
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function buildSupersessionComponentReportEntries(adapter, reconstructionRunId) {
    return adapter.all(
        `SELECT *
           FROM reconstruction_supersession_components
          WHERE reconstruction_run_id = ?
          ORDER BY supersession_component_id ASC`,
        [reconstructionRunId],
    ).map((row) => ({
        supersessionComponentId: row.supersession_component_id,
        memoryScopeId: row.memory_scope_id,
        decisionIds: JSON.parse(row.decision_ids_json || '[]'),
        canonicalRecordIds: JSON.parse(row.canonical_record_ids_json || '[]'),
        supersessionLifecycleClassification: row.supersession_lifecycle_classification,
        supersessionRuleId: row.supersession_rule_id,
        blocking: row.blocking_state === 'blocking',
        unresolvedReason: row.unresolved_reason || null,
        details: JSON.parse(row.details_json || '{}'),
    }));
}

function summarizeIssueCodes(issues = []) {
    const counts = new Map();
    for (const issue of issues) {
        const code = String(issue?.code || '').trim();
        if (!code) continue;
        counts.set(code, Number(counts.get(code) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => left.code.localeCompare(right.code));
}

function deriveTier2SourceClass(claim) {
    switch (String(claim?.claimZoneClass || '')) {
        case TIER2_CLAIM_ZONE_CLASS.MENTION_CODE:
            return 'quoted_or_pasted_spec_material';
        case TIER2_CLAIM_ZONE_CLASS.MENTION_QUOTE:
            return 'quoted_dialogue_or_report';
        case TIER2_CLAIM_ZONE_CLASS.MENTION_LOG:
            return 'log_or_json_payload';
        case TIER2_CLAIM_ZONE_CLASS.MENTION_EXAMPLE:
            return 'example_material';
        case TIER2_CLAIM_ZONE_CLASS.MENTION_REJECTED_ALTERNATIVE:
            return 'rejected_alternative_material';
        case TIER2_CLAIM_ZONE_CLASS.MENTION_ATTRIBUTED:
            return 'attributed_external_material';
        case TIER2_CLAIM_ZONE_CLASS.ASSERTED_BODY:
            return 'asserted_message_body';
        default:
            return 'unknown_source_class';
    }
}

function buildTier2StableSourceIdentity(claim) {
    return stableStringify([
        String(claim?.memoryScopeId || ''),
        String(claim?.chatInstanceId || ''),
        String(claim?.sourceMessageId || ''),
        String(claim?.claimId || ''),
    ]);
}

function compareTier2DetailedRows(left, right) {
    const a = [
        String(left?.memoryScopeId || ''),
        String(left?.sourceClass || ''),
        String(left?.claimZoneClass || ''),
        String(left?.extractionRuleId || ''),
        String(left?.stableSourceIdentity || ''),
    ];
    const b = [
        String(right?.memoryScopeId || ''),
        String(right?.sourceClass || ''),
        String(right?.claimZoneClass || ''),
        String(right?.extractionRuleId || ''),
        String(right?.stableSourceIdentity || ''),
    ];
    return stableStringify(a).localeCompare(stableStringify(b));
}

function compareTier2Buckets(left, right) {
    const a = [
        String(left?.memoryScopeId || ''),
        String(left?.sourceClass || ''),
        String(left?.claimZoneClass || ''),
        String(left?.extractionRuleId || ''),
    ];
    const b = [
        String(right?.memoryScopeId || ''),
        String(right?.sourceClass || ''),
        String(right?.claimZoneClass || ''),
        String(right?.extractionRuleId || ''),
    ];
    return stableStringify(a).localeCompare(stableStringify(b));
}

function buildTier2ReviewSurfaces(tier2Claims = [], issues = [], conflicts = [], status = '') {
    const mentionDetailedRows = tier2Claims
        .filter((claim) => String(claim?.confidenceClass || '') === TIER2_CONFIDENCE_CLASS.NON_ADMITTED_MENTION)
        .map((claim) => ({
            claimId: claim.claimId,
            memoryScopeId: claim.memoryScopeId,
            sourceClass: deriveTier2SourceClass(claim),
            claimZoneClass: claim.claimZoneClass,
            extractionRuleId: claim.extractionRuleId,
            sourceMessageId: claim.sourceMessageId,
            chatInstanceId: claim.chatInstanceId,
            stableSourceIdentity: buildTier2StableSourceIdentity(claim),
            admissionStatus: claim.admissionStatus,
            excerpt: claim.claimTextExcerpt,
        }))
        .sort(compareTier2DetailedRows);

    const bucketMap = new Map();
    for (const row of mentionDetailedRows) {
        const key = stableStringify([
            row.memoryScopeId,
            row.sourceClass,
            row.claimZoneClass,
            row.extractionRuleId,
        ]);
        const existing = bucketMap.get(key) || {
            memoryScopeId: row.memoryScopeId,
            sourceClass: row.sourceClass,
            claimZoneClass: row.claimZoneClass,
            extractionRuleId: row.extractionRuleId,
            count: 0,
        };
        existing.count += 1;
        bucketMap.set(key, existing);
    }
    const mentionBuckets = [...bucketMap.values()].sort(compareTier2Buckets);
    const mentionBucketCount = mentionBuckets.reduce((sum, entry) => sum + Number(entry.count || 0), 0);
    const mentionDetailedCount = mentionDetailedRows.length;

    const structuralBlockers = summarizeIssueCodes(issues);
    const structuralBlockerCount = structuralBlockers.reduce((sum, entry) => sum + Number(entry.count || 0), 0);

    const admittedCount = tier2Claims.filter((claim) => String(claim?.admissionStatus || '') === 'admitted').length;
    const blockedCount = tier2Claims.filter((claim) => String(claim?.admissionStatus || '') === 'blocked').length;
    const ambiguousCount = tier2Claims.filter((claim) => String(claim?.confidenceClass || '') === TIER2_CONFIDENCE_CLASS.AMBIGUOUS).length;
    const contextDependentCount = tier2Claims.filter((claim) => String(claim?.reviewKind || claim?.details?.reviewKind || '') === TIER2_REVIEW_KIND.CONTEXT_DEPENDENT_CANDIDATE).length;

    const compileCompleted = status === 'success' || status === 'invalid' || status === 'invalidated_source_mutation';
    const tier2ExtractionCompleted = status === 'success' || status === 'invalid';
    const candidateValid = status === 'success';

    return {
        executionSummary: {
            compileCompleted,
            tier2ExtractionCompleted,
            reportDerived: true,
            completed: TERMINAL_REPORT_STATUS.has(String(status || '').toLowerCase()),
        },
        candidateValidity: {
            valid: candidateValid,
            invalidatedBySourceMutation: status === 'invalidated_source_mutation',
            structuralBlockerCount,
            structuralBlockers,
            tier2ConflictCount: Array.isArray(conflicts) ? conflicts.length : 0,
            nonBlockingMentionOnlyCount: mentionDetailedCount,
        },
        tier2Summary: {
            admitted: admittedCount,
            blocked: blockedCount,
            ambiguous: ambiguousCount,
            contextDependent: contextDependentCount,
            mentionOnly: mentionDetailedCount,
        },
        reviewSummary: {
            structuralBlockers,
            mentionOnlyByBucket: mentionBuckets,
            reconciliation: {
                mentionOnlySummaryCount: mentionDetailedCount,
                mentionOnlyBucketCount: mentionBucketCount,
                mentionOnlyDetailedRowCount: mentionDetailedCount,
                mentionOnlyCountsMatch: mentionDetailedCount === mentionBucketCount,
            },
        },
        detailedReview: {
            mentionOnlyRows: mentionDetailedRows,
        },
    };
}

function buildDynamicRetentionState(userRoot, report) {
    if (!report?.memoryScopeId || !report?.reconstructionRunId) {
        return {
            pinned: false,
            pinReason: null,
            pinnedAt: null,
            cleanupEligible: false,
            retainedBecause: [],
        };
    }
    const candidatesRoot = path.join(getStoragePaths(userRoot).storageRoot, 'candidates');
    const entries = listScopeCandidateArtifacts(candidatesRoot, report.memoryScopeId);
    const disposition = computeRetentionDisposition(entries);
    const retainedBecause = disposition.reasonsByRunId.get(report.reconstructionRunId) || [];
    return {
        pinned: isPinnedReport(report),
        pinReason: report?.retention?.pinReason || null,
        pinnedAt: report?.retention?.pinnedAt || null,
        cleanupEligible: isTerminalCandidateStatus(report.status) && !disposition.keep.has(report.reconstructionRunId),
        retainedBecause,
    };
}

function buildInputSummary(manifest) {
    return {
        totalFiles: manifest.corpusFiles.length,
        totalArtifacts: manifest.artifacts.length,
        admittedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'admitted').length,
        excludedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'excluded').length,
        blockedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'blocked').length,
        tier2MessagesScanned: 0,
        tier2ClaimsDetected: 0,
        tier2ClaimsAdmitted: 0,
        tier2ClaimsAmbiguous: 0,
        tier2ClaimsBlocked: 0,
        tier2MentionsDetected: 0,
        tier2ContextDependent: 0,
    };
}

function finalizeReport(userRoot, report) {
    const tier2ReviewSurfaces = buildTier2ReviewSurfaces(
        report?.tier2Claims || [],
        report?.issues || [],
        report?.conflicts || [],
        report?.status || '',
    );
    return {
        ...report,
        ...tier2ReviewSurfaces,
        retention: buildDynamicRetentionState(userRoot, report),
    };
}

function writeReport(candidatePaths, report) {
    atomicWriteFile(candidatePaths.reportPath, JSON.stringify(report, null, 2));
}

function buildFailureReport(manifest, candidatePaths, finishedAt, failure, reportOverrides = {}) {
    return {
        schemaVersion: ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
        protocolVersion: ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
        reconstructionRunId: manifest.reconstructionRunId,
        memoryScopeId: manifest.memoryScopeId,
        status: 'failed',
        candidateArtifactId: manifest.candidateArtifactId,
        candidateRelativePath: manifest.candidateRelativePath,
        manifestRelativePath: manifest.manifestRelativePath,
        reportRelativePath: manifest.reportRelativePath,
        liveAuthorityChanged: false,
        promotionAvailable: false,
        inputSummary: buildInputSummary(manifest),
        outputSummary: {
            candidateAuthorityRecordCount: 0,
            candidateIssueCount: 0,
            candidateClaimCount: 0,
            candidateConflictCount: 0,
            candidateReviewItemCount: 0,
        },
        coverage: {
            exact: { attempted: false, count: null },
            corroborated: { attempted: false, count: null },
            deltaRecovered: { attempted: false, count: null },
            reconstructed: { attempted: false, count: null },
            conflicted: { attempted: false, count: null },
            partial: { attempted: false, count: null },
        },
        artifactAdmissions: buildArtifactReportEntries(manifest),
        candidateRecords: [],
        occurrenceGroups: [],
        versionLifecycleGroups: [],
        supersessionComponents: [],
        tier2Claims: [],
        tier2ClaimLinks: [],
        issues: [],
        exclusions: [],
        conflicts: [],
        reviewItems: [],
        unresolvedEvidence: [],
        promotionBlockers: [
            'promotion path intentionally unavailable in C0.75-1',
            String(failure?.code || 'ARCH_REBUILD_FAILED'),
        ],
        determinism: {
            attempted: false,
            equivalent: false,
            hashVersion: CANONICAL_CANDIDATE_HASH_VERSION,
            basis: CANONICAL_CANDIDATE_HASH_BASIS,
            canonicalCandidateHash: null,
            canonicalHashFinal: false,
            canonicalByteLength: null,
            tableRowCounts: {},
            tableHashes: {},
            differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
            unexplainedDifferences: [],
        },
        failure: {
            code: String(failure?.code || 'ARCH_REBUILD_FAILED'),
            message: String(failure?.message || 'Candidate rebuild failed'),
        },
        createdAt: manifest.createdAt,
        finishedAt,
        ...reportOverrides,
    };
}

function findExistingActiveRun(candidatesRoot, memoryScopeId, requestKey) {
    const entries = listScopeCandidateArtifacts(candidatesRoot, memoryScopeId);
    for (const entry of entries) {
        const status = entry.report?.status || entry.runRow?.status || entry.manifest?.status || null;
        if (isTerminalCandidateStatus(status)) {
            continue;
        }
        if (requestKey && entry.manifest?.requestKey === requestKey) {
            return { kind: 'idempotent', entry };
        }
        return { kind: 'active-conflict', entry };
    }
    return null;
}

function insertManifestRows(adapter, manifest) {
    for (const fileEntry of manifest.corpusFiles) {
        adapter.run(
            `INSERT INTO reconstruction_manifest_files (
                reconstruction_run_id, corpus_file_id, relative_path, chat_instance_id, physical_file_hash,
                physical_file_bytes, schema_version, header_version, message_count, identity_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.reconstructionRunId,
                fileEntry.corpusFileId,
                fileEntry.sourceLocator.relativePath,
                fileEntry.chatInstanceId || null,
                fileEntry.physicalFileHash,
                fileEntry.physicalFileBytes,
                Number(fileEntry.schemaVersion || 0),
                Number(fileEntry.headerVersion || 0),
                Number(fileEntry.messageCount || 0),
                String(fileEntry.identityStatus || ''),
            ],
        );
    }

    for (const artifact of manifest.artifacts) {
        adapter.run(
            `INSERT INTO reconstruction_manifest_artifacts (
                reconstruction_run_id, source_id, corpus_file_id, artifact_message_id, output_uid,
                source_manifest_id, artifact_kind, semantic_source_hash, content_health, exposure_health,
                evidence_policy, admission_status, admission_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.reconstructionRunId,
                artifact.sourceId,
                artifact.corpusFileId,
                artifact.artifactMessageId || null,
                artifact.outputUid || null,
                artifact.sourceManifestId,
                artifact.artifactKind,
                artifact.semanticSourceHash,
                artifact.contentHealth,
                artifact.exposureHealth,
                artifact.evidencePolicy,
                artifact.admissionStatus,
                artifact.admissionReason,
            ],
        );
    }
}

function readChatFileForCompilation(userRoot, fileEntry) {
    const absolutePath = path.join(userRoot, fileEntry.sourceLocator.relativePath);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    return readChatTextForCompilation(raw, absolutePath);
}

function readChatTextForCompilation(raw, absolutePath = null) {
    const { records } = parseJsonlRecords(raw);
    const header = records[0]?.chat_metadata && typeof records[0].chat_metadata === 'object' ? records[0] : null;
    const messages = header ? records.slice(1) : records;
    return {
        absolutePath,
        header: header?.chat_metadata || {},
        messages,
    };
}

function loadFrozenCorpusByFileId(userRoot, manifest) {
    const corpusByFileId = new Map();
    for (const fileEntry of manifest.corpusFiles) {
        const absolutePath = path.join(userRoot, fileEntry.sourceLocator.relativePath);
        const raw = fs.readFileSync(absolutePath, 'utf8');
        const hash = `sha256:${crypto.createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex')}`;
        if (hash !== fileEntry.physicalFileHash) {
            throw createError(409, `Corpus file changed after manifest freeze: ${fileEntry.sourceLocator.relativePath}`, 'ARCH_REBUILD_SOURCE_MUTATED');
        }
        const corpus = readChatTextForCompilation(raw, absolutePath);
        corpusByFileId.set(fileEntry.corpusFileId, {
            ...corpus,
            raw,
            fileEntry,
        });
    }
    return corpusByFileId;
}

function detectCorpusMutationSinceFreeze(userRoot, manifest) {
    const mutated = [];
    for (const fileEntry of manifest.corpusFiles) {
        const absolutePath = path.join(userRoot, fileEntry.sourceLocator.relativePath);
        const currentHash = sha256File(absolutePath);
        if (currentHash !== fileEntry.physicalFileHash) {
            mutated.push({
                corpusFileId: fileEntry.corpusFileId,
                relativePath: fileEntry.sourceLocator.relativePath,
                expectedHash: fileEntry.physicalFileHash,
                currentHash,
            });
        }
    }
    return mutated;
}

function buildArtifactSemanticHash(outputMessage, manifest, metadata) {
    return sha256Text(stableStringify({
        outputMessageId: outputMessage?.extra?.summary_sharder?.messageIdentity?.messageId || null,
        outputRevisionHash: outputMessage?.extra?.summary_sharder?.messageIdentity?.revisionHash || null,
        sourceManifestId: manifest?.manifestId || null,
        sourceIdentityHash: manifest?.sourceIdentityHash || null,
        sourceRevisionHash: manifest?.sourceRevisionHash || null,
        stableDecisionIds: metadata?.stableDecisionIds || [],
    }));
}

async function buildFrozenManifest(request, memoryScopeId, reconstructionRunId, requestKey, timestamp, candidatePaths) {
    const userRoot = getAuthenticatedUserRoot(request);
    const chatsRoot = path.join(userRoot, 'chats');
    const groupChatsRoot = path.join(userRoot, 'group chats');
    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const corpusFiles = [];
    const artifacts = [];
    const hostFamily = getHostFamily();
    const relativeUserRoot = path.basename(userRoot);
    const liveAuthorityFingerprints = getLiveAuthorityFingerprints(userRoot);

    const files = [...listJsonlFiles(chatsRoot), ...listJsonlFiles(groupChatsRoot)].sort((a, b) => a.localeCompare(b));

    for (const filePath of files) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const { records, invalidLines } = parseJsonlRecords(raw);
        const headerRecord = records[0]?.chat_metadata && typeof records[0].chat_metadata === 'object' ? records[0] : null;
        const header = headerRecord?.chat_metadata || {};
        const binding = header?.summary_sharder?.architecturalMemoryBinding || null;
        if (!binding || binding.memoryScopeId !== memoryScopeId) {
            continue;
        }

        const messages = headerRecord ? records.slice(1) : records;
        const relativePath = toRelativePath(userRoot, filePath);
        const corpusFileId = createId('file');
        const shardManifests = Array.isArray(header?.summary_sharder?.shardManifests)
            ? header.summary_sharder.shardManifests
            : [];
        const schemaVersion = shardManifests.reduce((max, entry) => Math.max(max, Number(entry?.schemaVersion || 0)), 0);
        corpusFiles.push({
            corpusFileId,
            sourceLocator: {
                hostFamily,
                userRoot: relativeUserRoot,
                relativePath,
            },
            chatInstanceId: binding.chatInstanceId || null,
            physicalFileHash: `sha256:${crypto.createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex')}`,
            physicalFileBytes: Buffer.byteLength(raw, 'utf8'),
            schemaVersion,
            headerVersion: headerRecord ? 1 : 0,
            messageCount: messages.length,
            identityStatus: String(header?.summary_sharder?.messageIdentity?.status || ''),
            frozenAt: timestamp,
            invalidLineCount: invalidLines.length,
        });

        for (const manifestEntry of shardManifests) {
            const normalizedManifest = normalizeShardManifest(manifestEntry);
            const outputUid = String(normalizedManifest?.outputUID || '').trim() || null;
            const outputMessage = outputUid
                ? messages.find((message) => String(message?.send_date || '').trim() === outputUid)
                : null;
            const metadata = buildArchitecturalShardMetadata(outputMessage?.mes || '');
            const validation = await validateShardManifest(manifestEntry, messages, { cryptoApi: globalThis.crypto });
            const sourceId = createId('src');
            const evidencePolicy = outputMessage?.extra?.summary_sharder?.evidencePolicy === 'exclude'
                ? 'exclude'
                : (outputMessage?.extra?.summary_sharder?.evidencePolicy ? String(outputMessage.extra.summary_sharder.evidencePolicy) : 'legacy-default-include');
            const decisionItems = metadata?.shardProfile === 'architectural'
                ? (parseArchitecturalExtractionResponse(outputMessage?.mes || '', registry)?.decisions || [])
                : [];
            let admissionStatus = 'admitted';
            let admissionReason = 'artifact_admitted';

            if (!normalizedManifest) {
                admissionStatus = 'blocked';
                admissionReason = 'manifest_invalid';
            } else if (!outputMessage) {
                admissionStatus = 'blocked';
                admissionReason = 'artifact_message_missing';
            } else if (metadata?.shardProfile !== 'architectural') {
                admissionStatus = 'excluded';
                admissionReason = 'artifact_not_architectural';
            } else if (Number(metadata.schemaVersion || 0) !== ARCHITECTURAL_SCHEMA_VERSION) {
                admissionStatus = 'blocked';
                admissionReason = 'unsupported_schema';
            } else if (!outputMessage?.extra?.summary_sharder?.messageIdentity?.messageId) {
                admissionStatus = 'blocked';
                admissionReason = 'artifact_identity_missing';
            } else if (evidencePolicy === 'exclude') {
                admissionStatus = 'excluded';
                admissionReason = 'evidence_policy_excluded';
            } else if (validation.contentHealth !== SHARD_CONTENT_HEALTH_VALUES.INTACT) {
                admissionStatus = 'blocked';
                admissionReason = `content_health_${String(validation.contentHealth || 'unknown').toLowerCase()}`;
            } else if (decisionItems.length === 0) {
                admissionStatus = 'blocked';
                admissionReason = 'decision_section_empty';
            } else {
                for (const item of decisionItems) {
                    const authorityInput = await buildArchitecturalDecisionAuthorityInput(item);
                    if (!authorityInput.decisionId || authorityInput.parserErrors.length > 0) {
                        admissionStatus = 'blocked';
                        admissionReason = 'decision_parse_invalid';
                        break;
                    }
                }
            }

            artifacts.push({
                sourceId,
                corpusFileId,
                artifactMessageId: outputMessage?.extra?.summary_sharder?.messageIdentity?.messageId || null,
                outputUid,
                sourceManifestId: normalizedManifest?.manifestId || createId('manifest'),
                artifactKind: String(normalizedManifest?.artifactKind || manifestEntry?.artifactKind || ''),
                semanticSourceHash: buildArtifactSemanticHash(outputMessage, normalizedManifest, metadata),
                shardManifestCount: shardManifests.length,
                contentHealth: String(validation.contentHealth || 'CONFLICTED'),
                exposureHealth: String(validation.exposureHealth || 'VISIBILITY_POLICY_UNKNOWN'),
                evidencePolicy,
                admissionStatus,
                admissionReason,
                stableDecisionIds: metadata?.stableDecisionIds || [],
                sectionKeys: metadata?.sectionKeys || [],
            });
        }
    }

    return {
        schemaVersion: ARCHITECTURAL_REBUILD_MANIFEST_SCHEMA_VERSION,
        protocolVersion: ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
        reconstructionRunId,
        requestKey,
        memoryScopeId,
        createdAt: timestamp,
        hostFamily,
        candidateArtifactId: `candidate_${reconstructionRunId}`,
        candidateRelativePath: candidatePaths.candidateRelativePath,
        manifestRelativePath: candidatePaths.manifestRelativePath,
        reportRelativePath: candidatePaths.reportRelativePath,
        status: RECONSTRUCTION_STATUS.MANIFEST_FROZEN,
        liveAuthorityFingerprints,
        corpusFiles,
        artifacts,
    };
}

function loadManifestFromSidecar(userRoot, reconstructionRunId) {
    const candidatePaths = ensureCandidatePaths(userRoot, reconstructionRunId);
    if (!fs.existsSync(candidatePaths.manifestPath)) {
        throw createError(404, `Candidate manifest ${reconstructionRunId} was not found`, 'ARCH_REBUILD_MANIFEST_NOT_FOUND');
    }
    return {
        candidatePaths,
        manifest: JSON.parse(fs.readFileSync(candidatePaths.manifestPath, 'utf8')),
    };
}

function setRunStage(adapter, reconstructionRunId, status) {
    adapter.run('UPDATE reconstruction_runs SET status = ? WHERE reconstruction_run_id = ?', [status, reconstructionRunId]);
}

function insertCandidateIssue(adapter, reconstructionRunId, issue) {
    adapter.run(
        `INSERT INTO reconstruction_candidate_issues (
            reconstruction_run_id, issue_id, severity, code, message, source_id, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            issue.issueId,
            issue.severity,
            issue.code,
            issue.message,
            issue.sourceId || null,
            JSON.stringify(issue.details || {}),
        ],
    );
}

function insertCandidateClaim(adapter, reconstructionRunId, claim) {
    adapter.run(
        `INSERT INTO reconstruction_candidate_claims (
            reconstruction_run_id, claim_id, claim_id_version, memory_scope_id, claim_class, claim_state,
            authority_class, authority_basis, claim_zone_class, extraction_mode, extraction_rule_id,
            extraction_rule_version, normalization_version, confidence_class, admission_status,
            admission_reason, evidence_lineage_id, source_message_id, chat_instance_id, source_revision_hash,
            claim_text_excerpt, normalized_claim_json, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            claim.claimId,
            Number(claim.claimIdVersion || 1),
            claim.memoryScopeId,
            claim.claimClass || null,
            claim.claimState || null,
            claim.authorityClass,
            claim.authorityBasis,
            claim.claimZoneClass,
            claim.extractionMode,
            claim.extractionRuleId,
            Number(claim.extractionRuleVersion || 1),
            Number(claim.normalizationVersion || 1),
            claim.confidenceClass,
            claim.admissionStatus,
            claim.admissionReason,
            claim.evidenceLineageId,
            claim.sourceMessageId,
            claim.chatInstanceId,
            claim.sourceRevisionHash,
            claim.claimTextExcerpt || '',
            JSON.stringify(claim.normalizedClaimPayload || {}),
            JSON.stringify({
                sourceTimestamp: claim.sourceTimestamp || null,
                speakerEntityId: claim.speakerEntityId || null,
                speakerRole: claim.speakerRole || null,
                jurisdictionScope: claim.jurisdictionScope || null,
                claimSpan: claim.claimSpan || null,
                reviewKind: claim.reviewKind || null,
                relatedRecordIds: claim.relatedRecordIds || [],
                sourceOccurrenceId: claim.sourceOccurrenceId || null,
            }),
        ],
    );
}

function insertCandidateClaimLink(adapter, reconstructionRunId, link) {
    adapter.run(
        `INSERT INTO reconstruction_candidate_claim_links (
            reconstruction_run_id, claim_id, related_record_id, relationship_type, reconciliation_basis
        ) VALUES (?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            link.claimId,
            link.relatedRecordId,
            link.relationshipType,
            link.reconciliationBasis,
        ],
    );
}

function insertCandidateConflict(adapter, reconstructionRunId, conflict) {
    adapter.run(
        `INSERT INTO reconstruction_candidate_conflicts (
            reconstruction_run_id, conflict_id, claim_id, conflict_code, details_json
        ) VALUES (?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            conflict.conflictId,
            conflict.claimId,
            conflict.conflictCode,
            JSON.stringify(conflict.details || {}),
        ],
    );
}

function insertCandidateReviewItem(adapter, reconstructionRunId, reviewItem) {
    adapter.run(
        `INSERT INTO reconstruction_candidate_review_items (
            reconstruction_run_id, review_item_id, claim_id, review_kind, severity, details_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            reviewItem.reviewItemId,
            reviewItem.claimId || null,
            reviewItem.reviewKind,
            reviewItem.severity,
            JSON.stringify(reviewItem.details || {}),
        ],
    );
}

function insertOccurrenceGroup(adapter, reconstructionRunId, group) {
    adapter.run(
        `INSERT INTO reconstruction_occurrence_groups (
            reconstruction_run_id, collision_evidence_group_id, memory_scope_id, decision_id, record_version,
            occurrence_classification, occurrence_rule_id, evidence_independence, independence_basis,
            canonical_record_id, reconciliation_result, blocking_state, unresolved_reason, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            group.collisionEvidenceGroupId,
            group.memoryScopeId,
            group.decisionId,
            Number(group.recordVersion || 1),
            group.occurrenceClassification,
            group.occurrenceRuleId,
            group.evidenceIndependence,
            group.independenceBasis,
            group.canonicalRecordId || null,
            group.reconciliationResult,
            group.blocking ? 'blocking' : 'non_blocking',
            group.unresolvedReason || null,
            JSON.stringify(group.details || {}),
        ],
    );
}

function insertOccurrenceGroupMember(adapter, reconstructionRunId, collisionEvidenceGroupId, member) {
    adapter.run(
        `INSERT INTO reconstruction_occurrence_group_members (
            reconstruction_run_id, collision_evidence_group_id, member_evidence_id, source_id, source_manifest_id,
            artifact_message_id, chat_instance_id, source_revision_hash, source_identity_hash, source_message_id,
            init_fingerprint, canonical_hash, covered_source_message_ids_json, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            collisionEvidenceGroupId,
            member.memberEvidenceId,
            member.sourceId,
            member.sourceManifestId,
            member.artifactMessageId,
            member.chatInstanceId,
            member.sourceRevisionHash,
            member.sourceIdentityHash,
            member.sourceMessageId,
            member.initFingerprint,
            member.canonicalHash,
            JSON.stringify(member.coveredSourceMessageIds || []),
            JSON.stringify(member.details || {}),
        ],
    );
}

function insertVersionLifecycleGroup(adapter, reconstructionRunId, group) {
    adapter.run(
        `INSERT INTO reconstruction_version_lifecycle_groups (
            reconstruction_run_id, version_lifecycle_group_id, memory_scope_id, decision_id,
            version_lifecycle_classification, version_lifecycle_rule_id, blocking_state, unresolved_reason,
            canonical_record_ids_json, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            group.versionLifecycleGroupId,
            group.memoryScopeId,
            group.decisionId,
            group.versionLifecycleClassification,
            group.versionLifecycleRuleId,
            group.blocking ? 'blocking' : 'non_blocking',
            group.unresolvedReason || null,
            JSON.stringify(group.canonicalRecordIds || []),
            JSON.stringify(group.details || {}),
        ],
    );
}

function insertSupersessionComponent(adapter, reconstructionRunId, component) {
    adapter.run(
        `INSERT INTO reconstruction_supersession_components (
            reconstruction_run_id, supersession_component_id, memory_scope_id, decision_ids_json,
            canonical_record_ids_json, supersession_lifecycle_classification, supersession_rule_id,
            blocking_state, unresolved_reason, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            reconstructionRunId,
            component.supersessionComponentId,
            component.memoryScopeId,
            JSON.stringify(component.decisionIds || []),
            JSON.stringify(component.canonicalRecordIds || []),
            component.supersessionLifecycleClassification,
            component.supersessionRuleId,
            component.blocking ? 'blocking' : 'non_blocking',
            component.unresolvedReason || null,
            JSON.stringify(component.details || {}),
        ],
    );
}

function aggregateDeterministicArtifacts(manifest, corpusByFileId) {
    return manifest.artifacts
        .filter((artifact) => artifact.admissionStatus === 'admitted')
        .map((artifact) => ({
            ...artifact,
            corpus: corpusByFileId.get(artifact.corpusFileId),
        }))
        .sort((left, right) => {
            const a = stableStringify([left.corpus?.fileEntry?.sourceLocator?.relativePath, left.outputUid, left.sourceManifestId, left.sourceId]);
            const b = stableStringify([right.corpus?.fileEntry?.sourceLocator?.relativePath, right.outputUid, right.sourceManifestId, right.sourceId]);
            return a.localeCompare(b);
        });
}

function buildTier2OccurrenceContext(manifest, corpus, message) {
    return {
        memoryScopeId: manifest.memoryScopeId,
        chatInstanceId: corpus.fileEntry?.chatInstanceId || null,
        sourceRelativePath: corpus.fileEntry?.sourceLocator?.relativePath || null,
        sourceMessageId: String(message?.extra?.summary_sharder?.messageIdentity?.messageId || '').trim(),
        sourceRevisionHash: String(message?.extra?.summary_sharder?.messageIdentity?.revisionHash || '').trim(),
        initFingerprint: String(message?.extra?.summary_sharder?.messageIdentity?.initFingerprint || '').trim(),
        message,
    };
}

function buildTier2DecisionFields(claim, decisionId) {
    const fields = {
        ID: decisionId,
        STATUS: claim.claimState || TIER2_CLAIM_STATE.PROPOSED,
    };
    if (claim.claimClass === TIER2_CLAIM_CLASS.DECISION) {
        fields.DECISION = claim.normalizedClaimPayload?.decisionText || '';
    } else if (claim.claimClass === TIER2_CLAIM_CLASS.CORRECTION) {
        fields.CHANGED = claim.normalizedClaimPayload?.correctionText || '';
    } else if (claim.claimClass === TIER2_CLAIM_CLASS.SUPERSESSION) {
        fields.SUPERSEDES = claim.normalizedClaimPayload?.supersededDecisionId || '';
        fields.DECISION = `Supersession candidate for ${claim.normalizedClaimPayload?.replacementDecisionId || decisionId}`;
    } else if (claim.claimClass === TIER2_CLAIM_CLASS.UNRESOLVED_COMMITMENT) {
        fields.DECISION = claim.normalizedClaimPayload?.commitmentText || '';
    }
    return fields;
}

function buildTier2RecordId(memoryScopeId, decisionId, recordVersion = 1) {
    return `${memoryScopeId}:${decisionId}:${recordVersion}`;
}

const OCCURRENCE_CLASSIFICATION = Object.freeze({
    NONE: 'NONE',
    DUPLICATE_OCCURRENCE: 'DUPLICATE_OCCURRENCE',
    BRANCH_LINEAGE_DUPLICATE: 'BRANCH_LINEAGE_DUPLICATE',
    CORROBORATING_PROVENANCE: 'CORROBORATING_PROVENANCE',
    GENERATED_ID_COLLISION: 'GENERATED_ID_COLLISION',
    UNRESOLVED_SEMANTIC_CONFLICT: 'UNRESOLVED_SEMANTIC_CONFLICT',
    MALFORMED_STRUCTURED_RECORD: 'MALFORMED_STRUCTURED_RECORD',
});

const EVIDENCE_INDEPENDENCE = Object.freeze({
    PROVEN_INDEPENDENT: 'PROVEN_INDEPENDENT',
    SHARED_LINEAGE: 'SHARED_LINEAGE',
    NOT_PROVEN: 'NOT_PROVEN',
    UNKNOWN: 'UNKNOWN',
});

const INDEPENDENCE_BASIS = Object.freeze({
    SHARED_MESSAGE_ANCESTRY: 'SHARED_MESSAGE_ANCESTRY',
    EXPLICIT_BRANCH_COPY: 'EXPLICIT_BRANCH_COPY',
    EXPLICIT_IMPORT_COPY: 'EXPLICIT_IMPORT_COPY',
    DISTINCT_ORIGIN_PROVEN: 'DISTINCT_ORIGIN_PROVEN',
    INDEPENDENCE_NOT_PROVEN: 'INDEPENDENCE_NOT_PROVEN',
    LINEAGE_UNKNOWN: 'LINEAGE_UNKNOWN',
});

const VERSION_LIFECYCLE_CLASSIFICATION = Object.freeze({
    SINGLE_VERSION: 'SINGLE_VERSION',
    VALID_VERSION_CHAIN: 'VALID_VERSION_CHAIN',
    FORKED_VERSION_CHAIN: 'FORKED_VERSION_CHAIN',
    INCOMPLETE_VERSION_CHAIN: 'INCOMPLETE_VERSION_CHAIN',
});

const SUPERSESSION_LIFECYCLE_CLASSIFICATION = Object.freeze({
    NO_SUPERSESSION: 'NO_SUPERSESSION',
    VALID_SUPERSESSION_CHAIN: 'VALID_SUPERSESSION_CHAIN',
    INCOMPLETE_SUPERSESSION_CHAIN: 'INCOMPLETE_SUPERSESSION_CHAIN',
    CYCLIC_SUPERSESSION_CHAIN: 'CYCLIC_SUPERSESSION_CHAIN',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const BLOCKING_CODE = Object.freeze({
    GENERATED_ID_COLLISION: 'REBUILD_GENERATED_ID_COLLISION',
    UNRESOLVED_SEMANTIC_CONFLICT: 'REBUILD_UNRESOLVED_SEMANTIC_CONFLICT',
    MALFORMED_STRUCTURED_RECORD: 'REBUILD_MALFORMED_STRUCTURED_RECORD',
    OCCURRENCE_CLASSIFICATION_FAILED: 'REBUILD_OCCURRENCE_CLASSIFICATION_FAILED',
    FORKED_VERSION_CHAIN: 'REBUILD_FORKED_VERSION_CHAIN',
    INCOMPLETE_VERSION_CHAIN: 'REBUILD_INCOMPLETE_VERSION_CHAIN',
    VERSION_CLASSIFICATION_FAILED: 'REBUILD_VERSION_CLASSIFICATION_FAILED',
    INCOMPLETE_SUPERSESSION_CHAIN: 'REBUILD_INCOMPLETE_SUPERSESSION_CHAIN',
    CYCLIC_SUPERSESSION_CHAIN: 'REBUILD_CYCLIC_SUPERSESSION_CHAIN',
    SUPERSESSION_CLASSIFICATION_FAILED: 'REBUILD_SUPERSESSION_CLASSIFICATION_FAILED',
});

const NON_SEMANTIC_VERSION_FIELDS = new Set(['RECORD-VERSION', 'RECORD_VERSION', 'PRIOR-VERSION', 'PRIOR_VERSION']);

function deleteNonSemanticVersionFields(fields = {}) {
    const normalized = {};
    for (const [key, value] of Object.entries(fields || {})) {
        if (NON_SEMANTIC_VERSION_FIELDS.has(String(key || '').trim().toUpperCase())) {
            continue;
        }
        normalized[key] = value;
    }
    return normalized;
}

function firstFieldValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function parsePositiveIntegerHint(value) {
    const normalized = String(firstFieldValue(value) || '').trim();
    if (!normalized) return { value: null, malformed: false };
    if (!/^\d+$/u.test(normalized)) {
        return { value: null, malformed: true };
    }
    const numeric = Number(normalized);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return { value: null, malformed: true };
    }
    return { value: numeric, malformed: false };
}

function extractTier1VersionMetadata(fields = {}) {
    const recordVersionHint = parsePositiveIntegerHint(fields['RECORD-VERSION'] ?? fields.RECORD_VERSION);
    const priorVersionHint = parsePositiveIntegerHint(fields['PRIOR-VERSION'] ?? fields.PRIOR_VERSION);
    const malformedReasons = [];
    if (recordVersionHint.malformed) malformedReasons.push('invalid_record_version_hint');
    if (priorVersionHint.malformed) malformedReasons.push('invalid_prior_version_hint');
    return {
        recordVersion: recordVersionHint.value ?? 1,
        priorVersion: priorVersionHint.value ?? null,
        malformedReasons,
    };
}

function buildOccurrenceSemanticFields(fields = {}) {
    return deleteNonSemanticVersionFields(fields);
}

function buildTier1CanonicalHash(fields = {}) {
    const semanticFields = buildOccurrenceSemanticFields(fields);
    const semanticPayload = stableStringify(semanticFields);
    return {
        semanticFields,
        semanticPayload,
        canonicalHash: sha256Text(semanticPayload),
    };
}

function buildMemberEvidenceIdV1(payload) {
    return buildDeterministicHashId('evidence', 1, payload);
}

function buildCollisionEvidenceGroupIdV1(memoryScopeId, decisionId, recordVersion, memberEvidenceIds) {
    return sha256Text(stableStringify([
        'collision-evidence-group/v1',
        String(memoryScopeId || ''),
        String(decisionId || ''),
        Number(recordVersion || 1),
        [...memberEvidenceIds].sort(),
    ]));
}

function buildCanonicalTier1RecordIdV1(memoryScopeId, decisionId, recordVersion, canonicalHashVersion, canonicalHash) {
    return sha256Text(stableStringify([
        'canonical-tier1-record/v1',
        String(memoryScopeId || ''),
        String(decisionId || ''),
        Number(recordVersion || 1),
        Number(canonicalHashVersion || 1),
        String(canonicalHash || ''),
    ]));
}

function buildVersionLifecycleGroupIdV1(memoryScopeId, decisionId, canonicalRecordIds) {
    return sha256Text(stableStringify([
        'version-lifecycle-group/v1',
        String(memoryScopeId || ''),
        String(decisionId || ''),
        [...canonicalRecordIds].sort(),
    ]));
}

function buildSupersessionComponentIdV1(memoryScopeId, decisionIds, canonicalRecordIds) {
    return sha256Text(stableStringify([
        'supersession-component/v1',
        String(memoryScopeId || ''),
        [...decisionIds].sort(),
        [...canonicalRecordIds].sort(),
    ]));
}

function createOccurrenceGroupIssue(group, code, message, details = {}) {
    return {
        issueId: buildDeterministicHashId('issue', 1, {
            reconstructionRunId: group.reconstructionRunId,
            collisionEvidenceGroupId: group.collisionEvidenceGroupId,
            code,
        }),
        severity: 'error',
        code,
        message,
        sourceId: group.members?.[0]?.sourceId || null,
        details,
    };
}

function normalizeStructuredFieldList(value) {
    const rawValues = Array.isArray(value) ? value : [value];
    const normalized = [];
    for (const rawValue of rawValues) {
        const text = String(rawValue || '').trim();
        if (!text) continue;
        for (const part of text.split(/[;,]/u)) {
            const candidate = String(part || '').trim().toLowerCase();
            if (candidate) {
                normalized.push(candidate);
            }
        }
    }
    return [...new Set(normalized)].sort();
}

function determineEvidenceIndependence(members) {
    for (let index = 0; index < members.length; index += 1) {
        const left = members[index];
        const leftCovered = new Set(left.coveredSourceMessageIds || []);
        for (let inner = index + 1; inner < members.length; inner += 1) {
            const right = members[inner];
            if (left.sourceMessageId && right.sourceMessageId && left.sourceMessageId === right.sourceMessageId) {
                return { evidenceIndependence: EVIDENCE_INDEPENDENCE.SHARED_LINEAGE, independenceBasis: INDEPENDENCE_BASIS.SHARED_MESSAGE_ANCESTRY };
            }
            if (left.initFingerprint && right.initFingerprint && left.initFingerprint === right.initFingerprint) {
                return { evidenceIndependence: EVIDENCE_INDEPENDENCE.SHARED_LINEAGE, independenceBasis: INDEPENDENCE_BASIS.SHARED_MESSAGE_ANCESTRY };
            }
            for (const messageId of right.coveredSourceMessageIds || []) {
                if (leftCovered.has(messageId)) {
                    return { evidenceIndependence: EVIDENCE_INDEPENDENCE.SHARED_LINEAGE, independenceBasis: INDEPENDENCE_BASIS.SHARED_MESSAGE_ANCESTRY };
                }
            }
            if (
                (left.branchedFromChatInstanceId && left.branchedFromChatInstanceId === right.chatInstanceId)
                || (right.branchedFromChatInstanceId && right.branchedFromChatInstanceId === left.chatInstanceId)
            ) {
                return { evidenceIndependence: EVIDENCE_INDEPENDENCE.SHARED_LINEAGE, independenceBasis: INDEPENDENCE_BASIS.EXPLICIT_BRANCH_COPY };
            }
            if (
                (left.importedFromChatInstanceId && left.importedFromChatInstanceId === right.chatInstanceId)
                || (right.importedFromChatInstanceId && right.importedFromChatInstanceId === left.chatInstanceId)
            ) {
                return { evidenceIndependence: EVIDENCE_INDEPENDENCE.SHARED_LINEAGE, independenceBasis: INDEPENDENCE_BASIS.EXPLICIT_IMPORT_COPY };
            }
        }
    }

    const allMembersHaveCoveredSources = members.every((member) => Array.isArray(member.coveredSourceMessageIds) && member.coveredSourceMessageIds.length > 0);
    if (allMembersHaveCoveredSources) {
        const seen = new Set();
        let disjoint = true;
        for (const member of members) {
            for (const messageId of member.coveredSourceMessageIds) {
                if (seen.has(messageId)) {
                    disjoint = false;
                    break;
                }
                seen.add(messageId);
            }
            if (!disjoint) break;
        }
        if (disjoint) {
            return { evidenceIndependence: EVIDENCE_INDEPENDENCE.PROVEN_INDEPENDENT, independenceBasis: INDEPENDENCE_BASIS.DISTINCT_ORIGIN_PROVEN };
        }
    }

    const hasIdentityGaps = members.some((member) => !member.chatInstanceId || (!member.sourceMessageId && (!Array.isArray(member.coveredSourceMessageIds) || member.coveredSourceMessageIds.length === 0)));
    if (hasIdentityGaps) {
        return { evidenceIndependence: EVIDENCE_INDEPENDENCE.UNKNOWN, independenceBasis: INDEPENDENCE_BASIS.LINEAGE_UNKNOWN };
    }

    return { evidenceIndependence: EVIDENCE_INDEPENDENCE.NOT_PROVEN, independenceBasis: INDEPENDENCE_BASIS.INDEPENDENCE_NOT_PROVEN };
}

function collapseOccurrenceMembers(rawMembers = []) {
    const sortedMembers = [...rawMembers].sort((left, right) =>
        stableStringify([
            left.memberEvidenceId,
            left.sourceId,
            left.sourceManifestId,
            left.artifactMessageId,
            left.chatInstanceId,
        ]).localeCompare(stableStringify([
            right.memberEvidenceId,
            right.sourceId,
            right.sourceManifestId,
            right.artifactMessageId,
            right.chatInstanceId,
        ])));
    const byEvidenceId = new Map();

    for (const member of sortedMembers) {
        const existing = byEvidenceId.get(member.memberEvidenceId);
        if (!existing) {
            byEvidenceId.set(member.memberEvidenceId, {
                ...member,
                coveredSourceMessageIds: [...new Set(member.coveredSourceMessageIds || [])].sort(),
                duplicateCopies: [{
                    sourceManifestId: member.sourceManifestId,
                    artifactMessageId: member.artifactMessageId,
                    chatInstanceId: member.chatInstanceId,
                }],
            });
            continue;
        }

        existing.coveredSourceMessageIds = [...new Set([
            ...(existing.coveredSourceMessageIds || []),
            ...(member.coveredSourceMessageIds || []),
        ])].sort();
        existing.duplicateCopies.push({
            sourceManifestId: member.sourceManifestId,
            artifactMessageId: member.artifactMessageId,
            chatInstanceId: member.chatInstanceId,
        });
    }

    const members = [...byEvidenceId.values()].sort((left, right) => left.memberEvidenceId.localeCompare(right.memberEvidenceId));
    const multiplicity = members.map((member) => ({
        memberEvidenceId: member.memberEvidenceId,
        count: Number(member.duplicateCopies?.length || 1),
    }));

    return {
        members,
        rawMemberCount: rawMembers.length,
        uniqueMemberCount: members.length,
        multiplicity,
    };
}

function classifyOccurrenceGroup(group) {
    const members = group.members || [];
    const uniqueSemanticHashes = [...new Set(members.map((member) => member.canonicalHash))];
    const uniquePriorVersions = [...new Set(members.map((member) => member.priorVersion).filter((value) => value !== null))];
    const malformedMembers = members.filter((member) => Array.isArray(member.malformedReasons) && member.malformedReasons.length > 0);

    if (malformedMembers.length > 0) {
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.MALFORMED_STRUCTURED_RECORD,
            occurrenceRuleId: 'OCC-MALFORMED-001',
            reconciliationResult: 'BLOCKED_MALFORMED',
            blocking: true,
            unresolvedReason: 'malformed_structured_record',
            classificationBasis: {
                malformedMemberEvidenceIds: malformedMembers.map((member) => member.memberEvidenceId),
                malformedReasons: malformedMembers.flatMap((member) => member.malformedReasons),
            },
        };
    }

    if (uniquePriorVersions.length > 1) {
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.GENERATED_ID_COLLISION,
            occurrenceRuleId: 'OCC-GENID-001',
            reconciliationResult: 'BLOCKED_GENERATED_ID_COLLISION',
            blocking: true,
            unresolvedReason: 'generated_identity_collision',
            classificationBasis: {
                priorVersions: uniquePriorVersions,
            },
        };
    }

    if (uniqueSemanticHashes.length > 1) {
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.UNRESOLVED_SEMANTIC_CONFLICT,
            occurrenceRuleId: 'OCC-HASH-001',
            reconciliationResult: 'BLOCKED_UNRESOLVED_SEMANTIC_CONFLICT',
            blocking: true,
            unresolvedReason: 'incompatible_same_version_canonical_hashes',
            classificationBasis: {
                canonicalHashes: uniqueSemanticHashes,
            },
        };
    }

    if (members.length === 1) {
        if (Number(group.rawMemberCount || 0) > Number(group.uniqueMemberCount || members.length)) {
            return {
                occurrenceClassification: OCCURRENCE_CLASSIFICATION.DUPLICATE_OCCURRENCE,
                occurrenceRuleId: 'OCC-DUP-001',
                reconciliationResult: 'MERGED_DUPLICATE',
                blocking: false,
                unresolvedReason: null,
                classificationBasis: {
                    rawMemberCount: Number(group.rawMemberCount || 0),
                    uniqueMemberCount: Number(group.uniqueMemberCount || members.length),
                    duplicateMultiplicity: group.memberMultiplicity || [],
                },
            };
        }
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.NONE,
            occurrenceRuleId: 'OCC-NONE-001',
            reconciliationResult: 'CANONICAL_SINGLE_MEMBER',
            blocking: false,
            unresolvedReason: null,
            classificationBasis: {
                memberEvidenceIds: members.map((member) => member.memberEvidenceId),
            },
        };
    }

    if (group.evidenceIndependence === EVIDENCE_INDEPENDENCE.SHARED_LINEAGE) {
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.BRANCH_LINEAGE_DUPLICATE,
            occurrenceRuleId: 'OCC-BRANCH-001',
            reconciliationResult: 'MERGED_BRANCH_LINEAGE',
            blocking: false,
            unresolvedReason: null,
            classificationBasis: {
                evidenceIndependence: group.evidenceIndependence,
                independenceBasis: group.independenceBasis,
            },
        };
    }

    if (group.evidenceIndependence === EVIDENCE_INDEPENDENCE.PROVEN_INDEPENDENT) {
        return {
            occurrenceClassification: OCCURRENCE_CLASSIFICATION.CORROBORATING_PROVENANCE,
            occurrenceRuleId: 'OCC-CORR-001',
            reconciliationResult: 'MERGED_PROVENANCE',
            blocking: false,
            unresolvedReason: null,
            classificationBasis: {
                evidenceIndependence: group.evidenceIndependence,
                independenceBasis: group.independenceBasis,
            },
        };
    }

    return {
        occurrenceClassification: OCCURRENCE_CLASSIFICATION.DUPLICATE_OCCURRENCE,
        occurrenceRuleId: 'OCC-DUP-001',
        reconciliationResult: 'MERGED_DUPLICATE',
        blocking: false,
        unresolvedReason: null,
        classificationBasis: {
            evidenceIndependence: group.evidenceIndependence,
            independenceBasis: group.independenceBasis,
        },
    };
}

function classifyVersionLifecycle(records) {
    const ordered = [...records].sort((left, right) => left.recordVersion - right.recordVersion || left.recordId.localeCompare(right.recordId));
    if (ordered.length === 1) {
        return {
            versionLifecycleClassification: VERSION_LIFECYCLE_CLASSIFICATION.SINGLE_VERSION,
            versionLifecycleRuleId: 'VERSION-CHAIN-001',
            blocking: false,
            unresolvedReason: null,
            details: {
                versions: ordered.map((record) => record.recordVersion),
            },
        };
    }

    const byVersion = new Map();
    const childCounts = new Map();
    let hasInvalidPrior = false;
    let hasMissingParent = false;

    for (const record of ordered) {
        if (byVersion.has(record.recordVersion)) {
            return {
                versionLifecycleClassification: VERSION_LIFECYCLE_CLASSIFICATION.FORKED_VERSION_CHAIN,
                versionLifecycleRuleId: 'VERSION-CHAIN-003',
                blocking: true,
                unresolvedReason: 'duplicate_version_number',
                details: {
                    versions: ordered.map((entry) => entry.recordVersion),
                },
            };
        }
        byVersion.set(record.recordVersion, record);
    }

    for (const record of ordered) {
        if (record.priorVersion === null) {
            continue;
        }
        if (record.priorVersion >= record.recordVersion) {
            hasInvalidPrior = true;
            continue;
        }
        if (!byVersion.has(record.priorVersion)) {
            hasMissingParent = true;
            continue;
        }
        childCounts.set(record.priorVersion, Number(childCounts.get(record.priorVersion) || 0) + 1);
    }

    if ([...childCounts.values()].some((count) => count > 1)) {
        return {
            versionLifecycleClassification: VERSION_LIFECYCLE_CLASSIFICATION.FORKED_VERSION_CHAIN,
            versionLifecycleRuleId: 'VERSION-CHAIN-003',
            blocking: true,
            unresolvedReason: 'multiple_children_from_same_prior_version',
            details: {
                childCounts: Object.fromEntries(childCounts.entries()),
            },
        };
    }

    const contiguous = ordered.every((record, index) => index === 0 || record.recordVersion === ordered[index - 1].recordVersion + 1);
    const deterministicContinuity = ordered.every((record, index) => {
        if (index === 0) {
            return record.priorVersion === null;
        }
        return record.priorVersion === null || record.priorVersion === ordered[index - 1].recordVersion;
    });

    if (!hasInvalidPrior && !hasMissingParent && contiguous && deterministicContinuity) {
        return {
            versionLifecycleClassification: VERSION_LIFECYCLE_CLASSIFICATION.VALID_VERSION_CHAIN,
            versionLifecycleRuleId: 'VERSION-CHAIN-002',
            blocking: false,
            unresolvedReason: null,
            details: {
                versions: ordered.map((record) => ({ recordVersion: record.recordVersion, priorVersion: record.priorVersion })),
            },
        };
    }

    return {
        versionLifecycleClassification: VERSION_LIFECYCLE_CLASSIFICATION.INCOMPLETE_VERSION_CHAIN,
        versionLifecycleRuleId: 'VERSION-CHAIN-004',
        blocking: true,
        unresolvedReason: hasInvalidPrior ? 'invalid_prior_version_reference' : 'missing_version_continuity',
        details: {
            contiguous,
            deterministicContinuity,
            hasInvalidPrior,
            hasMissingParent,
            versions: ordered.map((record) => ({ recordVersion: record.recordVersion, priorVersion: record.priorVersion })),
        },
    };
}

function classifySupersessionComponent(recordsByDecisionId, componentDecisionIds) {
    const componentRecords = componentDecisionIds.flatMap((decisionId) => recordsByDecisionId.get(decisionId) || []);
    const pairSupport = new Map();
    const missingTargets = new Set();

    for (const record of componentRecords) {
        const supersedesTargets = normalizeStructuredFieldList(record.fields?.SUPERSEDES);
        const supersededByTargets = normalizeStructuredFieldList(record.fields?.['SUPERSEDED-BY']);

        for (const targetDecisionId of supersedesTargets) {
            const pairKey = `${targetDecisionId}\u0000${record.decisionId}`;
            const entry = pairSupport.get(pairKey) || { oldDecisionId: targetDecisionId, newDecisionId: record.decisionId, fromOld: false, fromNew: false };
            entry.fromNew = true;
            pairSupport.set(pairKey, entry);
            if (!recordsByDecisionId.has(targetDecisionId)) {
                missingTargets.add(targetDecisionId);
            }
        }

        for (const targetDecisionId of supersededByTargets) {
            const pairKey = `${record.decisionId}\u0000${targetDecisionId}`;
            const entry = pairSupport.get(pairKey) || { oldDecisionId: record.decisionId, newDecisionId: targetDecisionId, fromOld: false, fromNew: false };
            entry.fromOld = true;
            pairSupport.set(pairKey, entry);
            if (!recordsByDecisionId.has(targetDecisionId)) {
                missingTargets.add(targetDecisionId);
            }
        }
    }

    if (pairSupport.size === 0) {
        return {
            supersessionLifecycleClassification: SUPERSESSION_LIFECYCLE_CLASSIFICATION.NO_SUPERSESSION,
            supersessionRuleId: 'SUPERSESSION-001',
            blocking: false,
            unresolvedReason: null,
            details: {
                decisionIds: componentDecisionIds,
            },
        };
    }

    const incompletePairs = [...pairSupport.values()].filter((entry) => !(entry.fromOld && entry.fromNew));
    const directedEdges = [...pairSupport.values()]
        .filter((entry) => entry.fromOld && entry.fromNew && recordsByDecisionId.has(entry.oldDecisionId) && recordsByDecisionId.has(entry.newDecisionId))
        .map((entry) => [entry.oldDecisionId, entry.newDecisionId]);

    const adjacency = new Map();
    for (const [fromDecisionId, toDecisionId] of directedEdges) {
        const list = adjacency.get(fromDecisionId) || [];
        list.push(toDecisionId);
        adjacency.set(fromDecisionId, list);
    }

    const visitState = new Map();
    let cyclic = false;
    const visit = (decisionId) => {
        if (cyclic) return;
        const currentState = visitState.get(decisionId);
        if (currentState === 'active') {
            cyclic = true;
            return;
        }
        if (currentState === 'done') {
            return;
        }
        visitState.set(decisionId, 'active');
        for (const nextDecisionId of adjacency.get(decisionId) || []) {
            visit(nextDecisionId);
        }
        visitState.set(decisionId, 'done');
    };
    for (const decisionId of componentDecisionIds) {
        visit(decisionId);
    }

    if (cyclic) {
        return {
            supersessionLifecycleClassification: SUPERSESSION_LIFECYCLE_CLASSIFICATION.CYCLIC_SUPERSESSION_CHAIN,
            supersessionRuleId: 'SUPERSESSION-004',
            blocking: true,
            unresolvedReason: 'cyclic_supersession_component',
            details: {
                edges: directedEdges,
            },
        };
    }

    if (missingTargets.size > 0 || incompletePairs.length > 0) {
        return {
            supersessionLifecycleClassification: SUPERSESSION_LIFECYCLE_CLASSIFICATION.INCOMPLETE_SUPERSESSION_CHAIN,
            supersessionRuleId: 'SUPERSESSION-003',
            blocking: true,
            unresolvedReason: 'incomplete_supersession_links',
            details: {
                missingTargets: [...missingTargets].sort(),
                incompletePairs,
            },
        };
    }

    return {
        supersessionLifecycleClassification: SUPERSESSION_LIFECYCLE_CLASSIFICATION.VALID_SUPERSESSION_CHAIN,
        supersessionRuleId: 'SUPERSESSION-002',
        blocking: false,
        unresolvedReason: null,
        details: {
            edges: directedEdges,
        },
    };
}

function normalizeTier2ComparisonText(value) {
    return String(value || '')
        .trim()
        .replace(/[.?!]+$/u, '')
        .trim()
        .replace(/\s+/gu, ' ')
        .toLowerCase();
}

async function buildTier2AuthorityInput(claim, decisionId) {
    const fields = buildTier2DecisionFields(claim, decisionId);
    return await buildArchitecturalDecisionAuthorityInput(`[S1:1] | ${Object.entries(fields)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(' | ')}`);
}

function insertCandidateProvenanceRecord(adapter, manifest, recordId, sourceKind, claimOrOccurrence) {
    const provenanceId = createId('prov');
    const sourceMessageId = claimOrOccurrence.sourceMessageId
        || claimOrOccurrence.artifactMessageId
        || null;
    const sourceIdentityHash = claimOrOccurrence.sourceIdentityHash
        || claimOrOccurrence.evidenceLineageId
        || claimOrOccurrence.sourceMessageId
        || null;
    adapter.run(
        `INSERT INTO reconstruction_candidate_provenance (
            reconstruction_run_id, provenance_id, record_id, memory_scope_id, speaker_entity_id,
            chat_instance_id, artifact_message_id, source_manifest_id, source_revision_hash, source_identity_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            manifest.reconstructionRunId,
            provenanceId,
            recordId,
            manifest.memoryScopeId,
            String(claimOrOccurrence.speakerEntityId || ''),
            String(claimOrOccurrence.chatInstanceId || ''),
            String(sourceMessageId || ''),
            sourceKind,
            String(claimOrOccurrence.sourceRevisionHash || ''),
            String(sourceIdentityHash || ''),
        ],
    );
    const coveredSourceMessageIds = claimOrOccurrence.coveredSourceMessageIds || [];
    for (const messageId of coveredSourceMessageIds) {
        adapter.run(
            `INSERT INTO reconstruction_candidate_provenance_sources (
                reconstruction_run_id, provenance_id, covered_source_message_id
            ) VALUES (?, ?, ?)`,
            [manifest.reconstructionRunId, provenanceId, messageId],
        );
    }
}

function collectTier2Claims(manifest, corpusByFileId, admittedArtifactMessageIds) {
    const claims = [];
    const files = [...manifest.corpusFiles].sort((left, right) =>
        stableStringify([left.sourceLocator?.relativePath, left.chatInstanceId || '', left.corpusFileId])
            .localeCompare(stableStringify([right.sourceLocator?.relativePath, right.chatInstanceId || '', right.corpusFileId])));

    for (const fileEntry of files) {
        const corpus = corpusByFileId.get(fileEntry.corpusFileId);
        if (!corpus) continue;
        for (const message of corpus.messages) {
            const messageId = String(message?.extra?.summary_sharder?.messageIdentity?.messageId || '').trim();
            if (!messageId || admittedArtifactMessageIds.has(messageId)) {
                continue;
            }
            const detections = extractArchitecturalDialogueClaims(buildTier2OccurrenceContext(manifest, corpus, message));
            const evidencePolicy = String(message?.extra?.summary_sharder?.evidencePolicy || '').trim().toLowerCase();
            if (evidencePolicy === 'exclude') {
                for (const detection of detections) {
                    if (detection.admissionStatus === 'admitted') {
                        detection.admissionStatus = 'blocked';
                        detection.admissionReason = 'evidence_policy_excluded';
                        detection.confidenceClass = TIER2_CONFIDENCE_CLASS.OUT_OF_SCOPE;
                    }
                }
            }
            claims.push(...detections);
        }
    }

    claims.sort((left, right) => left.claimId.localeCompare(right.claimId));
    return claims;
}

async function compileCandidate(adapter, manifest, corpusByFileId) {
    const timestamp = nowTimestamp();
    adapter.run(
        'INSERT OR REPLACE INTO memory_scopes (memory_scope_id, scope_alias, scope_version, current_scope_run, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [manifest.memoryScopeId, '', 1, 0, timestamp, timestamp],
    );

    for (const fileEntry of manifest.corpusFiles) {
        const corpus = corpusByFileId.get(fileEntry.corpusFileId);
        if (fileEntry.chatInstanceId) {
            adapter.run(
                `INSERT OR REPLACE INTO chat_bindings (
                    chat_instance_id, memory_scope_id, chat_locator, scope_alias,
                    branched_from_chat_instance_id, imported_from_chat_instance_id, bound_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    fileEntry.chatInstanceId,
                    manifest.memoryScopeId,
                    fileEntry.sourceLocator.relativePath.replace(/^chats\//, '').replace(/\.jsonl$/i, ''),
                    '',
                    corpus.header?.summary_sharder?.architecturalMemoryBinding?.branchedFromChatInstanceId || null,
                    corpus.header?.summary_sharder?.architecturalMemoryBinding?.importedFromChatInstanceId || null,
                    timestamp,
                    timestamp,
                ],
            );
        }
    }

    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const artifacts = aggregateDeterministicArtifacts(manifest, corpusByFileId);
    const occurrenceGroups = new Map();
    const admittedArtifactMessageIds = new Set();
    const issues = [];
    const conflicts = [];
    const reviewItems = [];
    const unresolvedEvidence = [];
    const exclusions = manifest.artifacts
        .filter((artifact) => artifact.admissionStatus !== 'admitted')
        .map((artifact) => ({
            sourceId: artifact.sourceId,
            reason: artifact.admissionReason,
        }));

    for (const artifact of artifacts) {
        const outputMessage = artifact.corpus?.messages.find((message) => String(message?.send_date || '').trim() === String(artifact.outputUid || '').trim());
        if (!outputMessage) {
            unresolvedEvidence.push({ sourceId: artifact.sourceId, reason: 'artifact_message_missing_at_compile' });
            continue;
        }

        const sections = parseArchitecturalExtractionResponse(outputMessage.mes || '', registry);
        const decisionItems = Array.isArray(sections.decisions) ? sections.decisions : [];
        const normalizedManifest = normalizeShardManifest(
            artifact.corpus.header?.summary_sharder?.shardManifests?.find((entry) => String(entry?.manifestId || '') === String(artifact.sourceManifestId || ''))
        );
        let coveredSourceMessageIds = normalizedManifest?.sourceSelector?.sourceMessageIds || [];
        if (coveredSourceMessageIds.length === 0
            && Number.isInteger(normalizedManifest?.sourceStartPositionAtCreation)
            && Number.isInteger(normalizedManifest?.sourceEndPositionAtCreation)) {
            coveredSourceMessageIds = artifact.corpus.messages
                .slice(
                    normalizedManifest.sourceStartPositionAtCreation,
                    normalizedManifest.sourceEndPositionAtCreation + 1,
                )
                .map((message) => String(message?.extra?.summary_sharder?.messageIdentity?.messageId || '').trim())
                .filter(Boolean);
        }

        for (const item of decisionItems) {
            const authorityInput = await buildArchitecturalDecisionAuthorityInput(item);
            if (!authorityInput.decisionId || authorityInput.parserErrors.length > 0) {
                unresolvedEvidence.push({ sourceId: artifact.sourceId, reason: 'decision_parse_invalid_at_compile' });
                continue;
            }

            admittedArtifactMessageIds.add(String(artifact.artifactMessageId || '').trim());
            const versionMetadata = extractTier1VersionMetadata(authorityInput.fields || {});
            const canonical = buildTier1CanonicalHash(authorityInput.fields || {});
            const messageIdentity = outputMessage?.extra?.summary_sharder?.messageIdentity || {};
            const binding = artifact.corpus?.header?.summary_sharder?.architecturalMemoryBinding || {};
            const sourceMessageId = String(coveredSourceMessageIds[0] || artifact.artifactMessageId || '').trim();
            const occurrence = {
                artifact,
                authorityInput,
                outputMessage,
                decisionId: authorityInput.decisionId,
                recordVersion: versionMetadata.recordVersion,
                priorVersion: versionMetadata.priorVersion,
                malformedReasons: versionMetadata.malformedReasons,
                canonicalHash: canonical.canonicalHash,
                canonicalHashVersion: authorityInput.canonicalHashVersion,
                hashAlgorithm: authorityInput.hashAlgorithm,
                semanticPayload: canonical.semanticPayload,
                semanticFields: canonical.semanticFields,
                coveredSourceMessageIds,
                sourceMessageId,
                sourceRevisionHash: normalizedManifest?.sourceRevisionHash || '',
                sourceIdentityHash: normalizedManifest?.sourceIdentityHash || '',
                initFingerprint: String(messageIdentity.initFingerprint || '').trim(),
                chatInstanceId: String(artifact.corpus?.fileEntry?.chatInstanceId || ''),
                branchedFromChatInstanceId: String(binding.branchedFromChatInstanceId || ''),
                importedFromChatInstanceId: String(binding.importedFromChatInstanceId || ''),
                speakerEntityId: String(outputMessage?.extra?.summary_sharder?.speakerIdentity?.speakerEntityId || ''),
                artifactMessageId: String(artifact.artifactMessageId || ''),
                sourceManifestId: String(artifact.sourceManifestId || ''),
                sourceId: String(artifact.sourceId || ''),
                memberEvidenceId: buildMemberEvidenceIdV1({
                    sourceManifestId: artifact.sourceManifestId,
                    artifactMessageId: artifact.artifactMessageId,
                    chatInstanceId: artifact.corpus?.fileEntry?.chatInstanceId || '',
                    sourceMessageId,
                    decisionId: authorityInput.decisionId,
                    recordVersion: versionMetadata.recordVersion,
                    initFingerprint: String(messageIdentity.initFingerprint || '').trim(),
                    sourceRevisionHash: normalizedManifest?.sourceRevisionHash || '',
                    sourceIdentityHash: normalizedManifest?.sourceIdentityHash || '',
                    semanticCanonicalHash: canonical.canonicalHash,
                }),
            };
            const groupKey = stableStringify([manifest.memoryScopeId, authorityInput.decisionId, versionMetadata.recordVersion]);
            if (!occurrenceGroups.has(groupKey)) {
                occurrenceGroups.set(groupKey, {
                    reconstructionRunId: manifest.reconstructionRunId,
                    memoryScopeId: manifest.memoryScopeId,
                    decisionId: authorityInput.decisionId,
                    recordVersion: versionMetadata.recordVersion,
                    members: [],
                });
            }
            occurrenceGroups.get(groupKey).members.push(occurrence);
        }
    }

    const canonicalRecordsByDecisionId = new Map();
    const currentCanonicalRecordByDecisionId = new Map();
    const decisionTextToRecords = new Map();
    let candidateAuthorityRecordCount = 0;
    let exactCount = 0;
    let corroboratedCount = 0;
    let deltaRecoveredCount = 0;
    let reconstructedCount = 0;
    let conflictedCount = 0;
    let occurrenceGroupCount = 0;
    let versionLifecycleGroupCount = 0;
    let supersessionComponentCount = 0;

    function indexCanonicalRecord(record) {
        const list = canonicalRecordsByDecisionId.get(record.decisionId) || [];
        list.push(record);
        list.sort((left, right) => left.recordVersion - right.recordVersion || left.recordId.localeCompare(right.recordId));
        canonicalRecordsByDecisionId.set(record.decisionId, list);
        currentCanonicalRecordByDecisionId.set(record.decisionId, list[list.length - 1]);
        const decisionText = String(record.fields?.DECISION || '').trim();
        const decisionComparisonText = normalizeTier2ComparisonText(decisionText);
        record.decisionText = decisionText;
        record.decisionComparisonText = decisionComparisonText;
        if (decisionComparisonText) {
            const matches = decisionTextToRecords.get(decisionComparisonText) || [];
            matches.push(record);
            matches.sort((left, right) => left.recordId.localeCompare(right.recordId));
            decisionTextToRecords.set(decisionComparisonText, matches);
        }
    }

    for (const group of [...occurrenceGroups.values()].sort((left, right) =>
        stableStringify([left.decisionId, left.recordVersion]).localeCompare(stableStringify([right.decisionId, right.recordVersion])))) {
        const collapsedMembers = collapseOccurrenceMembers(group.members);
        group.rawMemberCount = collapsedMembers.rawMemberCount;
        group.uniqueMemberCount = collapsedMembers.uniqueMemberCount;
        group.memberMultiplicity = collapsedMembers.multiplicity;
        group.members = collapsedMembers.members;
        const independence = determineEvidenceIndependence(group.members);
        group.evidenceIndependence = independence.evidenceIndependence;
        group.independenceBasis = independence.independenceBasis;
        group.collisionEvidenceGroupId = buildCollisionEvidenceGroupIdV1(
            group.memoryScopeId,
            group.decisionId,
            group.recordVersion,
            group.memberMultiplicity.map((entry) => `${entry.memberEvidenceId}:${entry.count}`),
        );

        const classification = classifyOccurrenceGroup(group);
        const firstMember = group.members[0];
        const canonicalRecordId = classification.blocking
            ? null
            : buildCanonicalTier1RecordIdV1(
                group.memoryScopeId,
                group.decisionId,
                group.recordVersion,
                firstMember.canonicalHashVersion,
                firstMember.canonicalHash,
            );
        insertOccurrenceGroup(adapter, manifest.reconstructionRunId, {
            collisionEvidenceGroupId: group.collisionEvidenceGroupId,
            memoryScopeId: group.memoryScopeId,
            decisionId: group.decisionId,
            recordVersion: group.recordVersion,
            occurrenceClassification: classification.occurrenceClassification,
            occurrenceRuleId: classification.occurrenceRuleId,
            evidenceIndependence: group.evidenceIndependence,
            independenceBasis: group.independenceBasis,
            canonicalRecordId,
            reconciliationResult: classification.reconciliationResult,
            blocking: classification.blocking,
            unresolvedReason: classification.unresolvedReason,
            details: {
                classifierVersion: 1,
                classificationBasis: classification.classificationBasis,
                rawMemberCount: group.rawMemberCount,
                uniqueMemberCount: group.uniqueMemberCount,
                duplicateMultiplicity: group.memberMultiplicity,
                memberEvidenceIds: group.members.map((member) => member.memberEvidenceId),
            },
        });
        occurrenceGroupCount += 1;

        for (const member of group.members) {
            insertOccurrenceGroupMember(adapter, manifest.reconstructionRunId, group.collisionEvidenceGroupId, {
                memberEvidenceId: member.memberEvidenceId,
                sourceId: member.sourceId,
                sourceManifestId: member.sourceManifestId,
                artifactMessageId: member.artifactMessageId,
                chatInstanceId: member.chatInstanceId,
                sourceRevisionHash: member.sourceRevisionHash,
                sourceIdentityHash: member.sourceIdentityHash,
                sourceMessageId: member.sourceMessageId,
                initFingerprint: member.initFingerprint,
                canonicalHash: member.canonicalHash,
                coveredSourceMessageIds: member.coveredSourceMessageIds,
                details: {
                    branchedFromChatInstanceId: member.branchedFromChatInstanceId || null,
                    importedFromChatInstanceId: member.importedFromChatInstanceId || null,
                    duplicateSourceCount: Number(member.duplicateCopies?.length || 1),
                    duplicateCopies: member.duplicateCopies || [],
                },
            });
        }

        if (classification.blocking) {
            conflictedCount += 1;
            issues.push(createOccurrenceGroupIssue(
                {
                    reconstructionRunId: manifest.reconstructionRunId,
                    collisionEvidenceGroupId: group.collisionEvidenceGroupId,
                    members: group.members,
                },
                BLOCKING_CODE[classification.occurrenceClassification] || BLOCKING_CODE.OCCURRENCE_CLASSIFICATION_FAILED,
                `Decision ${group.decisionId} version ${group.recordVersion} classified as ${classification.occurrenceClassification}.`,
                {
                    decisionId: group.decisionId,
                    recordVersion: group.recordVersion,
                    occurrenceClassification: classification.occurrenceClassification,
                    occurrenceRuleId: classification.occurrenceRuleId,
                    evidenceIndependence: group.evidenceIndependence,
                    independenceBasis: group.independenceBasis,
                },
            ));
            continue;
        }

        const provenanceJson = group.members
            .filter((member) => member.authorityInput.sourceRef)
            .map((member) => ({
                chatId: member.chatInstanceId || null,
                collectionId: null,
                sourceRef: member.authorityInput.sourceRef,
            }));
        const canonicalRecord = {
            decisionId: group.decisionId,
            recordId: canonicalRecordId,
            recordVersion: group.recordVersion,
            priorVersion: firstMember.priorVersion,
            canonicalHash: firstMember.canonicalHash,
            canonicalHashVersion: firstMember.canonicalHashVersion,
            hashAlgorithm: firstMember.hashAlgorithm,
            semanticPayload: firstMember.semanticPayload,
            fields: firstMember.semanticFields,
            status: firstMember.authorityInput.status || '',
            sourceChatInstanceId: firstMember.chatInstanceId || null,
            lastUpdatingChatInstanceId: firstMember.chatInstanceId || null,
            provenanceJson,
            members: group.members,
        };

        adapter.run(
            `INSERT INTO decision_records (
                memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
                hash_algorithm, semantic_payload, fields_json, status, prior_version,
                source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.memoryScopeId,
                canonicalRecord.decisionId,
                canonicalRecord.recordVersion,
                canonicalRecord.canonicalHash,
                canonicalRecord.canonicalHashVersion,
                canonicalRecord.hashAlgorithm,
                canonicalRecord.semanticPayload,
                JSON.stringify(canonicalRecord.fields || {}),
                canonicalRecord.status,
                canonicalRecord.priorVersion,
                canonicalRecord.sourceChatInstanceId,
                canonicalRecord.lastUpdatingChatInstanceId,
                JSON.stringify(canonicalRecord.provenanceJson || []),
                timestamp,
                timestamp,
            ],
        );

        for (const member of group.members) {
            insertCandidateProvenanceRecord(adapter, manifest, canonicalRecord.recordId, member.sourceManifestId, {
                speakerEntityId: member.speakerEntityId,
                chatInstanceId: member.chatInstanceId,
                artifactMessageId: member.artifactMessageId,
                sourceRevisionHash: member.sourceRevisionHash,
                sourceIdentityHash: member.sourceIdentityHash,
                coveredSourceMessageIds: member.coveredSourceMessageIds,
            });
        }

        indexCanonicalRecord(canonicalRecord);
        candidateAuthorityRecordCount += 1;
        if (classification.occurrenceClassification === OCCURRENCE_CLASSIFICATION.CORROBORATING_PROVENANCE) {
            corroboratedCount += 1;
        } else {
            exactCount += 1;
        }
    }

    const canonicalRecordIndex = [...canonicalRecordsByDecisionId.entries()].sort((left, right) => left[0].localeCompare(right[0]));
    for (const [decisionId, records] of canonicalRecordIndex) {
        const lifecycle = classifyVersionLifecycle(records);
        insertVersionLifecycleGroup(adapter, manifest.reconstructionRunId, {
            versionLifecycleGroupId: buildVersionLifecycleGroupIdV1(manifest.memoryScopeId, decisionId, records.map((record) => record.recordId)),
            memoryScopeId: manifest.memoryScopeId,
            decisionId,
            canonicalRecordIds: records.map((record) => record.recordId),
            versionLifecycleClassification: lifecycle.versionLifecycleClassification,
            versionLifecycleRuleId: lifecycle.versionLifecycleRuleId,
            blocking: lifecycle.blocking,
            unresolvedReason: lifecycle.unresolvedReason,
            details: lifecycle.details,
        });
        versionLifecycleGroupCount += 1;
        if (lifecycle.blocking) {
            issues.push({
                issueId: buildDeterministicHashId('issue', 1, {
                    reconstructionRunId: manifest.reconstructionRunId,
                    decisionId,
                    code: BLOCKING_CODE[lifecycle.versionLifecycleClassification] || BLOCKING_CODE.VERSION_CLASSIFICATION_FAILED,
                }),
                severity: 'error',
                code: BLOCKING_CODE[lifecycle.versionLifecycleClassification] || BLOCKING_CODE.VERSION_CLASSIFICATION_FAILED,
                message: `Decision ${decisionId} version lifecycle classified as ${lifecycle.versionLifecycleClassification}.`,
                sourceId: records[0]?.members?.[0]?.sourceId || null,
                details: {
                    decisionId,
                    versionLifecycleClassification: lifecycle.versionLifecycleClassification,
                    versionLifecycleRuleId: lifecycle.versionLifecycleRuleId,
                },
            });
        }

        const currentRecord = records[records.length - 1];
        adapter.run(
            `INSERT INTO current_decisions (
                memory_scope_id, decision_id, current_record_version, canonical_hash, canonical_hash_version,
                hash_algorithm, authority_location, archive_pointer_json, stub_pointer_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.memoryScopeId,
                decisionId,
                currentRecord.recordVersion,
                currentRecord.canonicalHash,
                currentRecord.canonicalHashVersion,
                currentRecord.hashAlgorithm,
                'active',
                JSON.stringify(null),
                JSON.stringify(null),
                timestamp,
            ],
        );
    }

    const supersessionAdjacency = new Map();
    for (const [decisionId, records] of canonicalRecordIndex) {
        const neighbors = supersessionAdjacency.get(decisionId) || new Set();
        for (const record of records) {
            for (const targetDecisionId of [
                ...normalizeStructuredFieldList(record.fields?.SUPERSEDES),
                ...normalizeStructuredFieldList(record.fields?.['SUPERSEDED-BY']),
            ]) {
                if (canonicalRecordsByDecisionId.has(targetDecisionId)) {
                    neighbors.add(targetDecisionId);
                    const reverse = supersessionAdjacency.get(targetDecisionId) || new Set();
                    reverse.add(decisionId);
                    supersessionAdjacency.set(targetDecisionId, reverse);
                }
            }
        }
        supersessionAdjacency.set(decisionId, neighbors);
    }

    const visitedSupersessionDecisionIds = new Set();
    for (const decisionId of [...canonicalRecordsByDecisionId.keys()].sort()) {
        if (visitedSupersessionDecisionIds.has(decisionId)) {
            continue;
        }
        const queue = [decisionId];
        const componentDecisionIds = [];
        while (queue.length > 0) {
            const nextDecisionId = queue.shift();
            if (!nextDecisionId || visitedSupersessionDecisionIds.has(nextDecisionId)) {
                continue;
            }
            visitedSupersessionDecisionIds.add(nextDecisionId);
            componentDecisionIds.push(nextDecisionId);
            for (const neighbor of supersessionAdjacency.get(nextDecisionId) || []) {
                if (!visitedSupersessionDecisionIds.has(neighbor)) {
                    queue.push(neighbor);
                }
            }
        }

        const sortedComponentDecisionIds = componentDecisionIds.sort();
        const lifecycle = classifySupersessionComponent(canonicalRecordsByDecisionId, sortedComponentDecisionIds);
        const canonicalRecordIds = sortedComponentDecisionIds.flatMap((entryDecisionId) =>
            (canonicalRecordsByDecisionId.get(entryDecisionId) || []).map((record) => record.recordId)).sort();
        const supersessionComponentId = buildSupersessionComponentIdV1(manifest.memoryScopeId, sortedComponentDecisionIds, canonicalRecordIds);
        insertSupersessionComponent(adapter, manifest.reconstructionRunId, {
            supersessionComponentId,
            memoryScopeId: manifest.memoryScopeId,
            decisionIds: sortedComponentDecisionIds,
            canonicalRecordIds,
            supersessionLifecycleClassification: lifecycle.supersessionLifecycleClassification,
            supersessionRuleId: lifecycle.supersessionRuleId,
            blocking: lifecycle.blocking,
            unresolvedReason: lifecycle.unresolvedReason,
            details: lifecycle.details,
        });
        supersessionComponentCount += 1;
        if (lifecycle.blocking) {
            issues.push({
                issueId: buildDeterministicHashId('issue', 1, {
                    reconstructionRunId: manifest.reconstructionRunId,
                    supersessionComponentId,
                    code: BLOCKING_CODE[lifecycle.supersessionLifecycleClassification] || BLOCKING_CODE.SUPERSESSION_CLASSIFICATION_FAILED,
                }),
                severity: 'error',
                code: BLOCKING_CODE[lifecycle.supersessionLifecycleClassification] || BLOCKING_CODE.SUPERSESSION_CLASSIFICATION_FAILED,
                message: `Supersession component ${supersessionComponentId} classified as ${lifecycle.supersessionLifecycleClassification}.`,
                sourceId: null,
                details: {
                    decisionIds: sortedComponentDecisionIds,
                    supersessionLifecycleClassification: lifecycle.supersessionLifecycleClassification,
                    supersessionRuleId: lifecycle.supersessionRuleId,
                },
            });
        }
    }

    const tier2Claims = collectTier2Claims(manifest, corpusByFileId, admittedArtifactMessageIds);
    const corroborationLineages = new Set();

    for (const claim of tier2Claims) {
        const mutableClaim = {
            ...claim,
            relatedRecordIds: [...(claim.relatedRecordIds || [])],
        };

        if (!isTier2ClaimAdmitted(mutableClaim)) {
            insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
            if (mutableClaim.reviewKind) {
                const reviewItem = buildTier2ClaimReviewItem(mutableClaim, mutableClaim.reviewKind, 'warning', {
                    admissionReason: mutableClaim.admissionReason,
                });
                reviewItems.push(reviewItem);
                insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
            }
            continue;
        }

        const payload = mutableClaim.normalizedClaimPayload || {};

        if (mutableClaim.claimClass === TIER2_CLAIM_CLASS.DECISION) {
            const explicitDecisionId = String(payload.explicitDecisionId || '').trim().toLowerCase() || null;
            const decisionText = String(payload.decisionText || '').trim();
            const decisionComparisonText = normalizeTier2ComparisonText(decisionText);
            const relatedRecord = explicitDecisionId ? currentCanonicalRecordByDecisionId.get(explicitDecisionId) : null;

            if (relatedRecord && decisionText) {
                const authorityInput = await buildTier2AuthorityInput(mutableClaim, explicitDecisionId);
                const claimStatus = String(mutableClaim.claimState || '').trim().toUpperCase();
                const relatedStatus = String(relatedRecord.fields?.STATUS || '').trim().toUpperCase();
                if (
                    authorityInput.canonicalHash === relatedRecord.canonicalHash
                    || (
                        decisionComparisonText
                        && decisionComparisonText === relatedRecord.decisionComparisonText
                        && claimStatus === relatedStatus
                    )
                ) {
                    mutableClaim.relatedRecordIds.push(relatedRecord.recordId);
                    insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                    insertCandidateClaimLink(adapter, manifest.reconstructionRunId, {
                        claimId: mutableClaim.claimId,
                        relatedRecordId: relatedRecord.recordId,
                        relationshipType: TIER2_CLAIM_RELATIONSHIP.CORROBORATES,
                        reconciliationBasis: TIER2_RECONCILIATION_BASIS.EXPLICIT_RECORD_ID,
                    });
                    insertCandidateProvenanceRecord(adapter, manifest, relatedRecord.recordId, `claim:${mutableClaim.claimId}`, {
                        speakerEntityId: mutableClaim.speakerEntityId,
                        chatInstanceId: mutableClaim.chatInstanceId,
                        sourceMessageId: mutableClaim.sourceMessageId,
                        sourceRevisionHash: mutableClaim.sourceRevisionHash,
                        evidenceLineageId: mutableClaim.evidenceLineageId,
                        coveredSourceMessageIds: [mutableClaim.sourceMessageId],
                    });
                    const corroborationKey = stableStringify([relatedRecord.recordId, mutableClaim.evidenceLineageId]);
                    if (!corroborationLineages.has(corroborationKey)) {
                        corroborationLineages.add(corroborationKey);
                        corroboratedCount += 1;
                    }
                    continue;
                }

                const conflict = {
                    conflictId: buildDeterministicHashId('conflict', 1, {
                        claimId: mutableClaim.claimId,
                        code: 'TIER2_DECISION_CONTRADICTS_TIER1',
                    }),
                    claimId: mutableClaim.claimId,
                    conflictCode: 'TIER2_DECISION_CONTRADICTS_TIER1',
                    details: {
                        explicitDecisionId,
                        relatedRecordId: relatedRecord.recordId,
                    },
                };
                insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                insertCandidateConflict(adapter, manifest.reconstructionRunId, conflict);
                conflicts.push({ sourceId: mutableClaim.sourceMessageId, code: conflict.conflictCode });
                conflictedCount += 1;
                continue;
            }

            if (!explicitDecisionId && decisionText) {
                const textMatches = decisionTextToRecords.get(decisionComparisonText) || [];
                if (textMatches.length > 0) {
                    mutableClaim.admissionStatus = 'review_only';
                    mutableClaim.admissionReason = 'possible_corroboration_review';
                    mutableClaim.reviewKind = TIER2_REVIEW_KIND.POSSIBLE_CORROBORATION;
                    mutableClaim.confidenceClass = TIER2_CONFIDENCE_CLASS.AMBIGUOUS;
                    insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                    const reviewItem = buildTier2ClaimReviewItem(mutableClaim, TIER2_REVIEW_KIND.POSSIBLE_CORROBORATION, 'warning', {
                        relatedRecordIds: textMatches.map((entry) => entry.recordId),
                        reconciliationBasis: TIER2_RECONCILIATION_BASIS.EXACT_DECISION_TEXT_MATCH,
                    });
                    reviewItems.push(reviewItem);
                    insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
                    continue;
                }
            }

            const effectiveDecisionId = explicitDecisionId || `tier2-occurrence-${mutableClaim.claimId.replace(/^claimv1:sha256:/u, '').slice(0, 24)}`;
            const authorityInput = await buildTier2AuthorityInput(mutableClaim, effectiveDecisionId);
            const recordVersion = 1;
            const recordId = buildCanonicalTier1RecordIdV1(
                manifest.memoryScopeId,
                effectiveDecisionId,
                recordVersion,
                authorityInput.canonicalHashVersion,
                authorityInput.canonicalHash,
            );
            adapter.run(
                `INSERT INTO decision_records (
                    memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
                    hash_algorithm, semantic_payload, fields_json, status, prior_version,
                    source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    manifest.memoryScopeId,
                    effectiveDecisionId,
                    recordVersion,
                    authorityInput.canonicalHash,
                    authorityInput.canonicalHashVersion,
                    authorityInput.hashAlgorithm,
                    authorityInput.semanticPayload,
                    JSON.stringify(authorityInput.fields || {}),
                    authorityInput.status || mutableClaim.claimState || '',
                    null,
                    mutableClaim.chatInstanceId || null,
                    mutableClaim.chatInstanceId || null,
                    JSON.stringify([]),
                    timestamp,
                    timestamp,
                ],
            );
            adapter.run(
                `INSERT INTO current_decisions (
                    memory_scope_id, decision_id, current_record_version, canonical_hash, canonical_hash_version,
                    hash_algorithm, authority_location, archive_pointer_json, stub_pointer_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    manifest.memoryScopeId,
                    effectiveDecisionId,
                    recordVersion,
                    authorityInput.canonicalHash,
                    authorityInput.canonicalHashVersion,
                    authorityInput.hashAlgorithm,
                    'active',
                    JSON.stringify(null),
                    JSON.stringify(null),
                    timestamp,
                ],
            );
            insertCandidateProvenanceRecord(adapter, manifest, recordId, `claim:${mutableClaim.claimId}`, {
                speakerEntityId: mutableClaim.speakerEntityId,
                chatInstanceId: mutableClaim.chatInstanceId,
                sourceMessageId: mutableClaim.sourceMessageId,
                sourceRevisionHash: mutableClaim.sourceRevisionHash,
                evidenceLineageId: mutableClaim.evidenceLineageId,
                coveredSourceMessageIds: [mutableClaim.sourceMessageId],
            });
            mutableClaim.relatedRecordIds.push(recordId);
            insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
            insertCandidateClaimLink(adapter, manifest.reconstructionRunId, {
                claimId: mutableClaim.claimId,
                relatedRecordId: recordId,
                relationshipType: TIER2_CLAIM_RELATIONSHIP.CREATES_RECORD,
                reconciliationBasis: TIER2_RECONCILIATION_BASIS.SELF_CONTAINED_TIER2_DECISION,
            });
            indexCanonicalRecord({
                decisionId: effectiveDecisionId,
                recordId,
                recordVersion,
                priorVersion: null,
                canonicalHash: authorityInput.canonicalHash,
                canonicalHashVersion: authorityInput.canonicalHashVersion,
                hashAlgorithm: authorityInput.hashAlgorithm,
                semanticPayload: authorityInput.semanticPayload,
                fields: authorityInput.fields || {},
                status: authorityInput.status || mutableClaim.claimState || '',
                sourceChatInstanceId: mutableClaim.chatInstanceId || null,
                lastUpdatingChatInstanceId: mutableClaim.chatInstanceId || null,
                provenanceJson: [],
                members: [],
            });
            candidateAuthorityRecordCount += 1;
            reconstructedCount += 1;
            continue;
        }

        if (mutableClaim.claimClass === TIER2_CLAIM_CLASS.CORRECTION) {
            const targetDecisionId = String(payload.targetDecisionId || '').trim().toLowerCase() || null;
            if (!targetDecisionId || !currentCanonicalRecordByDecisionId.has(targetDecisionId)) {
                mutableClaim.admissionStatus = 'review_only';
                mutableClaim.admissionReason = 'target_record_missing';
                mutableClaim.reviewKind = TIER2_REVIEW_KIND.TARGET_RECORD_MISSING;
                mutableClaim.confidenceClass = TIER2_CONFIDENCE_CLASS.AMBIGUOUS;
                insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                const reviewItem = buildTier2ClaimReviewItem(mutableClaim, TIER2_REVIEW_KIND.TARGET_RECORD_MISSING, 'warning', {
                    targetDecisionId,
                });
                reviewItems.push(reviewItem);
                insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
                continue;
            }
            const target = currentCanonicalRecordByDecisionId.get(targetDecisionId);
            mutableClaim.relatedRecordIds.push(target.recordId);
            insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
            insertCandidateClaimLink(adapter, manifest.reconstructionRunId, {
                claimId: mutableClaim.claimId,
                relatedRecordId: target.recordId,
                relationshipType: TIER2_CLAIM_RELATIONSHIP.CORRECTS,
                reconciliationBasis: TIER2_RECONCILIATION_BASIS.EXPLICIT_TARGET_RELATIONSHIP,
            });
            const reviewItem = buildTier2ClaimReviewItem(mutableClaim, TIER2_REVIEW_KIND.DETERMINISTIC_CORRECTION_REVIEW_REQUIRED, 'warning', {
                targetDecisionId,
            });
            reviewItems.push(reviewItem);
            insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
            deltaRecoveredCount += 1;
            continue;
        }

        if (mutableClaim.claimClass === TIER2_CLAIM_CLASS.SUPERSESSION) {
            const replacementDecisionId = String(payload.replacementDecisionId || '').trim().toLowerCase() || null;
            const supersededDecisionId = String(payload.supersededDecisionId || '').trim().toLowerCase() || null;
            if (!replacementDecisionId || !supersededDecisionId) {
                mutableClaim.admissionStatus = 'review_only';
                mutableClaim.admissionReason = 'incomplete_supersession';
                mutableClaim.reviewKind = TIER2_REVIEW_KIND.INCOMPLETE_SUPERSESSION;
                mutableClaim.confidenceClass = TIER2_CONFIDENCE_CLASS.AMBIGUOUS;
                insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                const reviewItem = buildTier2ClaimReviewItem(mutableClaim, TIER2_REVIEW_KIND.INCOMPLETE_SUPERSESSION, 'warning', {});
                reviewItems.push(reviewItem);
                insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
                continue;
            }
            if (!currentCanonicalRecordByDecisionId.has(supersededDecisionId)) {
                mutableClaim.admissionStatus = 'review_only';
                mutableClaim.admissionReason = 'target_record_missing';
                mutableClaim.reviewKind = TIER2_REVIEW_KIND.TARGET_RECORD_MISSING;
                mutableClaim.confidenceClass = TIER2_CONFIDENCE_CLASS.AMBIGUOUS;
                insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
                const reviewItem = buildTier2ClaimReviewItem(mutableClaim, TIER2_REVIEW_KIND.TARGET_RECORD_MISSING, 'warning', {
                    supersededDecisionId,
                    replacementDecisionId,
                });
                reviewItems.push(reviewItem);
                insertCandidateReviewItem(adapter, manifest.reconstructionRunId, reviewItem);
                continue;
            }
            const supersededRecord = currentCanonicalRecordByDecisionId.get(supersededDecisionId);
            mutableClaim.relatedRecordIds.push(supersededRecord.recordId);
            insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
            insertCandidateClaimLink(adapter, manifest.reconstructionRunId, {
                claimId: mutableClaim.claimId,
                relatedRecordId: supersededRecord.recordId,
                relationshipType: TIER2_CLAIM_RELATIONSHIP.SUPERSEDES,
                reconciliationBasis: TIER2_RECONCILIATION_BASIS.EXPLICIT_TARGET_RELATIONSHIP,
            });
            deltaRecoveredCount += 1;
            continue;
        }

        insertCandidateClaim(adapter, manifest.reconstructionRunId, mutableClaim);
    }

    for (const issue of issues) {
        insertCandidateIssue(adapter, manifest.reconstructionRunId, issue);
    }

    return {
        exclusions,
        conflicts,
        reviewItems,
        unresolvedEvidence,
        tier2ClaimsDetected: tier2Claims.length,
        tier2ClaimsAdmitted: tier2Claims.filter((entry) => entry.admissionStatus === 'admitted').length,
        tier2ClaimsAmbiguous: tier2Claims.filter((entry) => entry.confidenceClass === TIER2_CONFIDENCE_CLASS.AMBIGUOUS).length,
        tier2ClaimsBlocked: tier2Claims.filter((entry) => entry.admissionStatus === 'blocked').length,
        tier2MentionsDetected: tier2Claims.filter((entry) => entry.reviewKind === TIER2_REVIEW_KIND.NON_ADMITTED_MENTION).length,
        tier2ContextDependent: tier2Claims.filter((entry) => entry.reviewKind === TIER2_REVIEW_KIND.CONTEXT_DEPENDENT_CANDIDATE).length,
        occurrenceGroupCount,
        versionLifecycleGroupCount,
        supersessionComponentCount,
        candidateClaimCount: tier2Claims.length,
        candidateConflictCount: conflicts.length,
        candidateReviewItemCount: reviewItems.length,
        candidateAuthorityRecordCount,
        candidateIssueCount: issues.length,
        coverage: {
            exact: { attempted: true, count: exactCount },
            corroborated: { attempted: true, count: corroboratedCount },
            deltaRecovered: { attempted: true, count: deltaRecoveredCount },
            reconstructed: { attempted: true, count: reconstructedCount },
            conflicted: { attempted: true, count: conflictedCount },
            partial: { attempted: true, count: unresolvedEvidence.length + reviewItems.length || null },
        },
    };
}

function validateCandidateState(adapter, manifest, compileResult, liveAuthorityChanged) {
    const issues = [];
    if (!adapter.verifyIntegrity()) {
        issues.push('candidate_integrity_failed');
    }
    const scopeCount = Number(adapter.scalar('SELECT COUNT(*) FROM memory_scopes WHERE memory_scope_id = ?', [manifest.memoryScopeId]) || 0);
    if (scopeCount !== 1) {
        issues.push('candidate_scope_consistency_failed');
    }
    const decisionRecordCount = Number(adapter.scalar('SELECT COUNT(*) FROM decision_records WHERE memory_scope_id = ?', [manifest.memoryScopeId]) || 0);
    const distinctDecisionCount = Number(adapter.scalar('SELECT COUNT(DISTINCT decision_id) FROM decision_records WHERE memory_scope_id = ?', [manifest.memoryScopeId]) || 0);
    const currentDecisionCount = Number(adapter.scalar('SELECT COUNT(*) FROM current_decisions WHERE memory_scope_id = ?', [manifest.memoryScopeId]) || 0);
    if (distinctDecisionCount !== currentDecisionCount) {
        issues.push('candidate_pointer_count_mismatch');
    }
    const provenanceRecordCount = Number(adapter.scalar('SELECT COUNT(DISTINCT record_id) FROM reconstruction_candidate_provenance WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]) || 0);
    if (provenanceRecordCount !== decisionRecordCount) {
        issues.push('candidate_provenance_incomplete');
    }
    const claimCount = Number(adapter.scalar('SELECT COUNT(*) FROM reconstruction_candidate_claims WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]) || 0);
    if (claimCount !== Number(compileResult.candidateClaimCount || 0)) {
        issues.push('candidate_claim_count_mismatch');
    }
    const occurrenceGroupCount = Number(adapter.scalar('SELECT COUNT(*) FROM reconstruction_occurrence_groups WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]) || 0);
    if (occurrenceGroupCount !== Number(compileResult.occurrenceGroupCount || 0)) {
        issues.push('candidate_occurrence_group_count_mismatch');
    }
    const versionLifecycleGroupCount = Number(adapter.scalar('SELECT COUNT(*) FROM reconstruction_version_lifecycle_groups WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]) || 0);
    if (versionLifecycleGroupCount !== Number(compileResult.versionLifecycleGroupCount || 0)) {
        issues.push('candidate_version_lifecycle_group_count_mismatch');
    }
    const supersessionComponentCount = Number(adapter.scalar('SELECT COUNT(*) FROM reconstruction_supersession_components WHERE reconstruction_run_id = ?', [manifest.reconstructionRunId]) || 0);
    if (supersessionComponentCount !== Number(compileResult.supersessionComponentCount || 0)) {
        issues.push('candidate_supersession_component_count_mismatch');
    }
    if (Number(compileResult.candidateIssueCount || 0) > 0) {
        issues.push('candidate_issues_present');
    }
    if (liveAuthorityChanged) {
        issues.push('live_authority_changed');
    }
    if (compileResult.conflicts.length > 0) {
        issues.push('candidate_conflicts_present');
    }
    return {
        ok: issues.length === 0,
        issues,
    };
}

function dumpComparableState(adapter) {
    return normalizeComparableDumpForHash(buildDeterministicTableDump(REBUILD_TABLE_SPECS, (tableName) => {
        return adapter.all(`SELECT * FROM ${tableName}`);
    }));
}

export function buildPersistedCanonicalCandidateState(adapter) {
    const comparableDump = dumpComparableState(adapter);
    const canonicalBytes = stableStringify(comparableDump);
    const tableRowCounts = Object.fromEntries(
        REBUILD_TABLE_SPECS.map((spec) => [spec.name, Array.isArray(comparableDump[spec.name]) ? comparableDump[spec.name].length : 0]),
    );
    const tableHashes = Object.fromEntries(
        REBUILD_TABLE_SPECS.map((spec) => [spec.name, sha256Text(stableStringify(comparableDump[spec.name] || []))]),
    );
    return {
        hashVersion: CANONICAL_CANDIDATE_HASH_VERSION,
        basis: CANONICAL_CANDIDATE_HASH_BASIS,
        comparableDump,
        canonicalBytes,
        canonicalByteLength: Buffer.byteLength(canonicalBytes, 'utf8'),
        canonicalCandidateHash: hashDeterministicTableDump(comparableDump),
        tableRowCounts,
        tableHashes,
    };
}

export function computePersistedCanonicalCandidateState(candidateDbPath) {
    const adapter = createAdapter(candidateDbPath);
    try {
        return buildPersistedCanonicalCandidateState(adapter);
    } finally {
        adapter.close();
    }
}

export function normalizeComparableDumpForHash(dump) {
    const clone = JSON.parse(JSON.stringify(dump || {}));
    const memberRows = Array.isArray(clone.reconstruction_occurrence_group_members)
        ? clone.reconstruction_occurrence_group_members
        : [];

    for (const row of memberRows) {
        const rawDetails = String(row?.details_json || '').trim();
        if (!rawDetails) {
            continue;
        }
        try {
            const details = JSON.parse(rawDetails);
            if (Array.isArray(details?.duplicateCopies)) {
                details.duplicateCopies = details.duplicateCopies.map((entry) => {
                    if (!entry || typeof entry !== 'object') {
                        return entry;
                    }
                    const next = { ...entry };
                    delete next.sourceId;
                    return next;
                }).sort((left, right) => compareCanonicalText(stableStringify(left), stableStringify(right)));
            }
            row.details_json = stableStringify(details);
        } catch {
            // Preserve original text when the JSON payload cannot be normalized.
        }
    }

    return clone;
}

function removeArtifactTriplet(candidatePaths) {
    for (const filePath of [
        candidatePaths.candidateDbPath,
        `${candidatePaths.candidateDbPath}-wal`,
        `${candidatePaths.candidateDbPath}-shm`,
        candidatePaths.manifestPath,
        candidatePaths.reportPath,
    ]) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
    }
}

function applyCandidateRetention(userRoot, memoryScopeId) {
    const candidatesRoot = path.join(getStoragePaths(userRoot).storageRoot, 'candidates');
    const entries = listScopeCandidateArtifacts(candidatesRoot, memoryScopeId);
    const disposition = computeRetentionDisposition(entries);
    const removedRunIds = [];
    for (const entry of disposition.removable) {
        removedRunIds.push(entry.manifest.reconstructionRunId);
        removeArtifactTriplet(candidatePathsFromManifestPath(userRoot, entry.manifestPath));
    }
    return {
        keptRunIds: [...disposition.keep],
        removedRunIds,
        reasonsByRunId: Object.fromEntries(
            [...disposition.reasonsByRunId.entries()].map(([runId, reasons]) => [runId, reasons]),
        ),
    };
}

export function listCandidateRebuildRuns(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const memoryScopeId = sanitizeIdentifier(options.memoryScopeId, 'memoryScopeId');
    const candidatesRoot = path.join(getStoragePaths(userRoot).storageRoot, 'candidates');
    const entries = listScopeCandidateArtifacts(candidatesRoot, memoryScopeId);
    const disposition = computeRetentionDisposition(entries);

    const runs = entries
        .map((entry) => {
            const status = entry.report?.status
                || (entry.runRow?.status ? String(entry.runRow.status).toLowerCase() : null)
                || String(entry.manifest?.status || '').toLowerCase();
            const normalizedTerminal = isTerminalCandidateStatus(status);
            const reconstructionRunId = entry.manifest.reconstructionRunId;
            return {
                reconstructionRunId,
                status,
                candidateArtifactId: entry.manifest?.candidateArtifactId || `candidate_${reconstructionRunId}`,
                candidateRelativePath: entry.manifest?.candidateRelativePath || null,
                manifestRelativePath: entry.manifest?.manifestRelativePath || toRelativePath(userRoot, entry.manifestPath),
                reportRelativePath: entry.manifest?.reportRelativePath || (entry.reportPath ? toRelativePath(userRoot, entry.reportPath) : null),
                createdAt: entry.manifest?.createdAt || Number(entry.runRow?.started_at || 0) || null,
                finishedAt: entry.report?.finishedAt || Number(entry.runRow?.finished_at || 0) || null,
                terminal: normalizedTerminal,
                retention: normalizedTerminal
                    ? {
                        pinned: isPinnedReport(entry.report),
                        pinReason: entry.report?.retention?.pinReason || null,
                        pinnedAt: entry.report?.retention?.pinnedAt || null,
                        cleanupEligible: !disposition.keep.has(reconstructionRunId),
                        retainedBecause: disposition.reasonsByRunId.get(reconstructionRunId) || [],
                    }
                    : {
                        pinned: false,
                        pinReason: null,
                        pinnedAt: null,
                        cleanupEligible: false,
                        retainedBecause: [],
                    },
                promotionAvailable: false,
            };
        })
        .sort((a, b) => Number(b.finishedAt || b.createdAt || 0) - Number(a.finishedAt || a.createdAt || 0));

    return {
        ok: true,
        memoryScopeId,
        promotionAvailable: false,
        runs,
    };
}

export function setCandidateRebuildPinned(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const reconstructionRunId = sanitizeIdentifier(options.reconstructionRunId, 'reconstructionRunId');
    const pinned = options.pinned !== false;
    const candidatePaths = ensureCandidatePaths(userRoot, reconstructionRunId);
    if (!fs.existsSync(candidatePaths.reportPath)) {
        throw createError(404, `Candidate report ${reconstructionRunId} was not found`, 'ARCH_REBUILD_REPORT_NOT_FOUND');
    }
    const report = JSON.parse(fs.readFileSync(candidatePaths.reportPath, 'utf8'));
    if (!TERMINAL_REPORT_STATUS.has(String(report?.status || '').toLowerCase())) {
        throw createError(409, `Candidate ${reconstructionRunId} is not terminal and cannot be pinned`, 'ARCH_REBUILD_PIN_INVALID_STATE');
    }
    report.retention = {
        pinned,
        pinReason: pinned ? String(options.pinReason || '').trim() || 'manual_pin' : null,
        pinnedAt: pinned ? nowTimestamp(options.now) : null,
    };
    writeReport(candidatePaths, report);
    return {
        ok: true,
        report: finalizeReport(userRoot, report),
        summary: summarizeCompactRebuildReport(report),
    };
}

export function cleanupCandidateRebuildArtifacts(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const memoryScopeId = sanitizeIdentifier(options.memoryScopeId, 'memoryScopeId');
    const result = applyCandidateRetention(userRoot, memoryScopeId);
    return {
        ok: true,
        memoryScopeId,
        ...result,
        promotionAvailable: false,
    };
}

export async function initCandidateRebuildRun(request, options = {}) {
    const memoryScopeId = sanitizeIdentifier(options.memoryScopeId, 'memoryScopeId');
    const userRoot = getAuthenticatedUserRoot(request);
    const requestKey = String(options.requestKey || `${memoryScopeId}:default`).trim();
    const reconstructionRunId = createId('rebuild');
    const timestamp = nowTimestamp(options.now);
    const candidatePaths = ensureCandidatePaths(userRoot, reconstructionRunId);

    const existing = findExistingActiveRun(candidatePaths.candidatesRoot, memoryScopeId, requestKey);
    if (existing?.kind === 'idempotent') {
        return {
            ok: true,
            idempotent: true,
            manifest: existing.entry.manifest,
        };
    }
    if (existing?.kind === 'active-conflict') {
        throw createError(409, `Candidate rebuild already active for scope ${memoryScopeId}`, 'ARCH_REBUILD_ALREADY_ACTIVE');
    }

    const manifest = await buildFrozenManifest(request, memoryScopeId, reconstructionRunId, requestKey, timestamp, candidatePaths);
    ensureCandidateDatabase(candidatePaths, reconstructionRunId, memoryScopeId, requestKey, timestamp);
    const adapter = createAdapter(candidatePaths.candidateDbPath);
    try {
        insertManifestRows(adapter, manifest);
        setRunStage(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.MANIFEST_FROZEN);
    } finally {
        adapter.close();
    }

    atomicWriteFile(candidatePaths.manifestPath, JSON.stringify(manifest, null, 2));
    return {
        ok: true,
        idempotent: false,
        manifest,
    };
}

export async function runCandidateRebuild(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const reconstructionRunId = sanitizeIdentifier(options.reconstructionRunId, 'reconstructionRunId');
    const { candidatePaths, manifest } = loadManifestFromSidecar(userRoot, reconstructionRunId);
    const adapter = createAdapter(candidatePaths.candidateDbPath);
    let adapterClosed = false;
    const finishedAt = nowTimestamp(options.now);

    try {
        const runRow = adapter.get('SELECT * FROM reconstruction_runs WHERE reconstruction_run_id = ?', [reconstructionRunId]);
        if (!runRow) {
            throw createError(404, `Candidate run ${reconstructionRunId} was not found`, 'ARCH_REBUILD_RUN_NOT_FOUND');
        }
        if (String(runRow.status) !== RECONSTRUCTION_STATUS.MANIFEST_FROZEN) {
            throw createError(409, `Candidate run ${reconstructionRunId} is not ready to compile`, 'ARCH_REBUILD_INVALID_STATE');
        }

        const initialMutations = detectCorpusMutationSinceFreeze(userRoot, manifest);
        if (initialMutations.length > 0) {
                updateCandidateRunStatus(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.INVALIDATED_SOURCE_MUTATION, {
                    finishedAt,
                    failureReason: `corpus_mutation:${initialMutations[0].relativePath}`,
                });
                const report = {
                    schemaVersion: ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
                    protocolVersion: ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
                    reconstructionRunId,
                    memoryScopeId: manifest.memoryScopeId,
                    status: 'invalidated_source_mutation',
                    candidateArtifactId: manifest.candidateArtifactId,
                    candidateRelativePath: manifest.candidateRelativePath,
                    manifestRelativePath: manifest.manifestRelativePath,
                    reportRelativePath: manifest.reportRelativePath,
                    liveAuthorityChanged: false,
                    promotionAvailable: false,
                    inputSummary: {
                        totalFiles: manifest.corpusFiles.length,
                        totalArtifacts: manifest.artifacts.length,
                        admittedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'admitted').length,
                        excludedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'excluded').length,
                        blockedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'blocked').length,
                    },
                    outputSummary: {
                        candidateAuthorityRecordCount: 0,
                        candidateIssueCount: 1,
                        candidateClaimCount: 0,
                        candidateConflictCount: 0,
                        candidateReviewItemCount: 0,
                    },
                    artifactAdmissions: buildArtifactReportEntries(manifest),
                    candidateRecords: [],
                    occurrenceGroups: [],
                    versionLifecycleGroups: [],
                    supersessionComponents: [],
                    tier2Claims: [],
                    tier2ClaimLinks: [],
                    issues: [],
                    reviewItems: [],
                    coverage: {
                        exact: { attempted: false, count: null },
                        corroborated: { attempted: false, count: null },
                        deltaRecovered: { attempted: false, count: null },
                        reconstructed: { attempted: false, count: null },
                        conflicted: { attempted: false, count: null },
                        partial: { attempted: false, count: null },
                    },
                    exclusions: [],
                    conflicts: [],
                    unresolvedEvidence: initialMutations.map((entry) => ({
                        sourceId: entry.corpusFileId,
                        reason: 'source_mutated_after_freeze',
                    })),
                    promotionBlockers: [
                        'promotion path intentionally unavailable in C0.75-1',
                        'candidate invalidated by source mutation',
                    ],
                    determinism: {
                        attempted: false,
                        equivalent: false,
                        hashVersion: CANONICAL_CANDIDATE_HASH_VERSION,
                        basis: CANONICAL_CANDIDATE_HASH_BASIS,
                        canonicalCandidateHash: null,
                        canonicalHashFinal: false,
                        canonicalByteLength: null,
                        tableRowCounts: {},
                        tableHashes: {},
                        differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                        unexplainedDifferences: [],
                    },
                    failure: null,
                    createdAt: manifest.createdAt,
                    finishedAt,
                };
                const finalizedReport = finalizeReport(userRoot, report);
                finalizedReport.promotionQualification = buildPromotionQualification(userRoot, candidatePaths, finalizedReport);
                writeReport(candidatePaths, finalizedReport);
                applyCandidateRetention(userRoot, manifest.memoryScopeId);
                const deliveredReport = finalizeReport(userRoot, finalizedReport);
                return {
                    ok: false,
                    report: deliveredReport,
                    summary: summarizeCompactRebuildReport(deliveredReport),
                };
        }

        const frozenCorpusByFileId = loadFrozenCorpusByFileId(userRoot, manifest);

        setRunStage(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.COMPILING);
        const compileResult = await compileCandidate(adapter, manifest, frozenCorpusByFileId);
        setRunStage(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.VALIDATING);

        const finalMutations = detectCorpusMutationSinceFreeze(userRoot, manifest);
        if (finalMutations.length > 0) {
            const preFingerprints = manifest.liveAuthorityFingerprints || {};
            const postFingerprints = getLiveAuthorityFingerprints(userRoot);
            const liveAuthorityChanged = !equalFingerprints(preFingerprints, postFingerprints);
            updateCandidateRunStatus(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.INVALIDATED_SOURCE_MUTATION, {
                finishedAt,
                failureReason: `corpus_mutation:${finalMutations[0].relativePath}`,
            });
            const report = {
                schemaVersion: ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
                protocolVersion: ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
                reconstructionRunId,
                memoryScopeId: manifest.memoryScopeId,
                status: 'invalidated_source_mutation',
                candidateArtifactId: manifest.candidateArtifactId,
                candidateRelativePath: manifest.candidateRelativePath,
                manifestRelativePath: manifest.manifestRelativePath,
                reportRelativePath: manifest.reportRelativePath,
                liveAuthorityChanged,
                promotionAvailable: false,
                inputSummary: {
                    ...buildInputSummary(manifest),
                    tier2MessagesScanned: manifest.corpusFiles.reduce((sum, entry) => sum + Number(entry.messageCount || 0), 0),
                    tier2ClaimsDetected: compileResult.tier2ClaimsDetected,
                    tier2ClaimsAdmitted: compileResult.tier2ClaimsAdmitted,
                    tier2ClaimsAmbiguous: compileResult.tier2ClaimsAmbiguous,
                    tier2ClaimsBlocked: compileResult.tier2ClaimsBlocked,
                    tier2MentionsDetected: compileResult.tier2MentionsDetected,
                    tier2ContextDependent: compileResult.tier2ContextDependent,
                },
                outputSummary: {
                    candidateAuthorityRecordCount: compileResult.candidateAuthorityRecordCount,
                    candidateIssueCount: compileResult.candidateIssueCount,
                    candidateClaimCount: compileResult.candidateClaimCount,
                    candidateConflictCount: compileResult.candidateConflictCount,
                    candidateReviewItemCount: compileResult.candidateReviewItemCount,
                },
                artifactAdmissions: buildArtifactReportEntries(manifest),
                candidateRecords: buildCandidateRecordReportEntries(adapter, manifest.reconstructionRunId),
                occurrenceGroups: buildOccurrenceGroupReportEntries(adapter, manifest.reconstructionRunId),
                versionLifecycleGroups: buildVersionLifecycleGroupReportEntries(adapter, manifest.reconstructionRunId),
                supersessionComponents: buildSupersessionComponentReportEntries(adapter, manifest.reconstructionRunId),
                tier2Claims: buildCandidateClaimReportEntries(adapter, manifest.reconstructionRunId),
                tier2ClaimLinks: buildCandidateClaimLinkReportEntries(adapter, manifest.reconstructionRunId),
                issues: buildCandidateIssueReportEntries(adapter, manifest.reconstructionRunId),
                reviewItems: buildCandidateReviewItemReportEntries(adapter, manifest.reconstructionRunId),
                coverage: compileResult.coverage,
                exclusions: compileResult.exclusions,
                conflicts: buildCandidateConflictReportEntries(adapter, manifest.reconstructionRunId),
                unresolvedEvidence: finalMutations.map((entry) => ({
                    sourceId: entry.corpusFileId,
                    reason: 'source_mutated_before_validation_finalize',
                })),
                promotionBlockers: [
                    'promotion path intentionally unavailable in C0.75-1',
                    'candidate invalidated by source mutation',
                ],
                determinism: {
                    attempted: false,
                    equivalent: false,
                    hashVersion: CANONICAL_CANDIDATE_HASH_VERSION,
                    basis: CANONICAL_CANDIDATE_HASH_BASIS,
                    canonicalCandidateHash: null,
                    canonicalHashFinal: false,
                    canonicalByteLength: null,
                    tableRowCounts: {},
                    tableHashes: {},
                    differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                    unexplainedDifferences: [],
                },
                failure: null,
                createdAt: manifest.createdAt,
                finishedAt,
            };
            const finalizedReport = finalizeReport(userRoot, report);
            finalizedReport.promotionQualification = buildPromotionQualification(userRoot, candidatePaths, finalizedReport);
            writeReport(candidatePaths, finalizedReport);
            applyCandidateRetention(userRoot, manifest.memoryScopeId);
            const deliveredReport = finalizeReport(userRoot, finalizedReport);
            return {
                ok: false,
                report: deliveredReport,
                summary: summarizeCompactRebuildReport(deliveredReport),
            };
        }

        const preFingerprints = manifest.liveAuthorityFingerprints || {};
        const postFingerprints = getLiveAuthorityFingerprints(userRoot);
        const liveAuthorityChanged = !equalFingerprints(preFingerprints, postFingerprints);

        const determinismDbPath = `${candidatePaths.candidateDbPath}.determinism`;
        const determinismAdapter = createAdapter(determinismDbPath);
        let determinismEquivalent = false;
        let unexplainedDifferences = [];
        let determinismCanonicalState = null;
        try {
            initializeDatabase(determinismAdapter, finishedAt);
            for (const statement of candidateAuditSchemaStatements()) {
                determinismAdapter.exec(statement);
            }
            insertManifestRows(determinismAdapter, manifest);
            const determinismFrozenCorpusByFileId = loadFrozenCorpusByFileId(userRoot, manifest);
            await compileCandidate(determinismAdapter, manifest, determinismFrozenCorpusByFileId);
        } finally {
            determinismAdapter.close();
        }
        try {
            determinismCanonicalState = computePersistedCanonicalCandidateState(determinismDbPath);
        } finally {
            fs.rmSync(determinismDbPath, { force: true });
            fs.rmSync(`${determinismDbPath}-wal`, { force: true });
            fs.rmSync(`${determinismDbPath}-shm`, { force: true });
        }

        const validation = validateCandidateState(adapter, manifest, compileResult, liveAuthorityChanged);
        updateCandidateRunStatus(
            adapter,
            reconstructionRunId,
            RECONSTRUCTION_STATUS.VALIDATING,
            {
                finishedAt,
                failureReason: null,
            },
        );

        adapter.close();
        adapterClosed = true;

        const persistedCanonicalState = computePersistedCanonicalCandidateState(candidatePaths.candidateDbPath);
        determinismEquivalent = determinismCanonicalState.canonicalCandidateHash === persistedCanonicalState.canonicalCandidateHash;
        if (!determinismEquivalent) {
            unexplainedDifferences = ['candidate_comparable_state_hash_mismatch'];
        }
        const succeeded = validation.ok && determinismEquivalent;

        const statusUpdateAdapter = createAdapter(candidatePaths.candidateDbPath);
        try {
            updateCandidateRunStatus(
                statusUpdateAdapter,
                reconstructionRunId,
                succeeded ? RECONSTRUCTION_STATUS.SUCCEEDED : RECONSTRUCTION_STATUS.INVALID,
                {
                    finishedAt,
                    failureReason: succeeded ? null : validation.issues.concat(unexplainedDifferences).join(','),
                },
            );
        } finally {
            statusUpdateAdapter.close();
        }

        const reportAdapter = createAdapter(candidatePaths.candidateDbPath);
        let report;
        try {
            report = {
                schemaVersion: ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
                protocolVersion: ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
                reconstructionRunId,
                memoryScopeId: manifest.memoryScopeId,
                status: succeeded ? 'success' : 'invalid',
                candidateArtifactId: manifest.candidateArtifactId,
                candidateRelativePath: manifest.candidateRelativePath,
                manifestRelativePath: manifest.manifestRelativePath,
                reportRelativePath: manifest.reportRelativePath,
                liveAuthorityChanged,
                promotionAvailable: false,
                inputSummary: {
                    ...buildInputSummary(manifest),
                    tier2MessagesScanned: manifest.corpusFiles.reduce((sum, entry) => sum + Number(entry.messageCount || 0), 0),
                    tier2ClaimsDetected: compileResult.tier2ClaimsDetected,
                    tier2ClaimsAdmitted: compileResult.tier2ClaimsAdmitted,
                    tier2ClaimsAmbiguous: compileResult.tier2ClaimsAmbiguous,
                    tier2ClaimsBlocked: compileResult.tier2ClaimsBlocked,
                    tier2MentionsDetected: compileResult.tier2MentionsDetected,
                    tier2ContextDependent: compileResult.tier2ContextDependent,
                },
                outputSummary: {
                    candidateAuthorityRecordCount: compileResult.candidateAuthorityRecordCount,
                    candidateIssueCount: compileResult.candidateIssueCount,
                    candidateClaimCount: compileResult.candidateClaimCount,
                    candidateConflictCount: compileResult.candidateConflictCount,
                    candidateReviewItemCount: compileResult.candidateReviewItemCount,
                },
                artifactAdmissions: buildArtifactReportEntries(manifest),
                candidateRecords: buildCandidateRecordReportEntries(reportAdapter, manifest.reconstructionRunId),
                occurrenceGroups: buildOccurrenceGroupReportEntries(reportAdapter, manifest.reconstructionRunId),
                versionLifecycleGroups: buildVersionLifecycleGroupReportEntries(reportAdapter, manifest.reconstructionRunId),
                supersessionComponents: buildSupersessionComponentReportEntries(reportAdapter, manifest.reconstructionRunId),
                tier2Claims: buildCandidateClaimReportEntries(reportAdapter, manifest.reconstructionRunId),
                tier2ClaimLinks: buildCandidateClaimLinkReportEntries(reportAdapter, manifest.reconstructionRunId),
                issues: buildCandidateIssueReportEntries(reportAdapter, manifest.reconstructionRunId),
                reviewItems: buildCandidateReviewItemReportEntries(reportAdapter, manifest.reconstructionRunId),
                coverage: compileResult.coverage,
                exclusions: compileResult.exclusions,
                conflicts: buildCandidateConflictReportEntries(reportAdapter, manifest.reconstructionRunId),
                unresolvedEvidence: compileResult.unresolvedEvidence,
                promotionBlockers: [
                    'promotion path intentionally unavailable in C0.75-1',
                    ...(validation.issues.length > 0 ? validation.issues : []),
                ],
                determinism: {
                    attempted: true,
                    equivalent: determinismEquivalent,
                    hashVersion: persistedCanonicalState.hashVersion,
                    basis: persistedCanonicalState.basis,
                    canonicalCandidateHash: persistedCanonicalState.canonicalCandidateHash,
                    canonicalHashFinal: true,
                    canonicalByteLength: persistedCanonicalState.canonicalByteLength,
                    tableRowCounts: persistedCanonicalState.tableRowCounts,
                    tableHashes: persistedCanonicalState.tableHashes,
                    differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                    unexplainedDifferences,
                },
                failure: null,
                createdAt: manifest.createdAt,
                finishedAt,
            };
        } finally {
            reportAdapter.close();
        }

        const finalizedReport = finalizeReport(userRoot, report);
        finalizedReport.promotionQualification = buildPromotionQualification(userRoot, candidatePaths, finalizedReport);
        writeReport(candidatePaths, finalizedReport);
        applyCandidateRetention(userRoot, manifest.memoryScopeId);
        const deliveredReport = finalizeReport(userRoot, finalizedReport);
        return {
            ok: succeeded,
            report: deliveredReport,
            summary: summarizeCompactRebuildReport(deliveredReport),
        };
    } catch (error) {
        try {
            const failureAdapter = adapterClosed ? createAdapter(candidatePaths.candidateDbPath) : adapter;
            try {
                updateCandidateRunStatus(failureAdapter, reconstructionRunId, RECONSTRUCTION_STATUS.FAILED, {
                    finishedAt,
                    failureReason: String(error?.code || error?.message || 'failed'),
                });
            } finally {
                if (adapterClosed) {
                    failureAdapter.close();
                }
            }
            const liveAuthorityChanged = !equalFingerprints(manifest.liveAuthorityFingerprints || {}, getLiveAuthorityFingerprints(userRoot));
            const failureReport = buildFailureReport(manifest, candidatePaths, finishedAt, error, { liveAuthorityChanged });
            const finalizedFailureReport = finalizeReport(userRoot, failureReport);
            finalizedFailureReport.promotionQualification = buildPromotionQualification(userRoot, candidatePaths, finalizedFailureReport);
            writeReport(candidatePaths, finalizedFailureReport);
            applyCandidateRetention(userRoot, manifest.memoryScopeId);
        } catch {
            // ignore secondary failure
        }
        throw error;
    } finally {
        if (!adapterClosed) {
            adapter.close();
        }
    }
}

export function loadCandidateRebuildReport(request, reconstructionRunId) {
    const userRoot = getAuthenticatedUserRoot(request);
    const candidatePaths = ensureCandidatePaths(userRoot, sanitizeIdentifier(reconstructionRunId, 'reconstructionRunId'));
    if (!fs.existsSync(candidatePaths.reportPath)) {
        throw createError(404, `Candidate report ${reconstructionRunId} was not found`, 'ARCH_REBUILD_REPORT_NOT_FOUND');
    }
    const report = JSON.parse(fs.readFileSync(candidatePaths.reportPath, 'utf8'));
    return {
        report: finalizeReport(userRoot, report),
        summary: summarizeCompactRebuildReport(report),
    };
}
