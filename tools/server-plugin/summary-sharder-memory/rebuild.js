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
    TIER2_CONFIDENCE_CLASS,
    TIER2_RECONCILIATION_BASIS,
    TIER2_REVIEW_KIND,
    buildDeterministicHashId,
    buildDeterministicTableDump,
    hashDeterministicTableDump,
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
]);

const TERMINAL_REPORT_STATUS = new Set([
    'success',
    'failed',
    'invalid',
    'invalidated_source_mutation',
]);

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
    const fingerprints = {};
    for (const [key, filePath] of Object.entries({
        db: paths.dbPath,
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
                status, source_chat_instance_id, last_updating_chat_instance_id
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
        recordId: `${row.memory_scope_id}:${row.decision_id}:${row.record_version}`,
        canonicalHash: row.canonical_hash,
        canonicalHashVersion: Number(row.canonical_hash_version),
        hashAlgorithm: row.hash_algorithm,
        status: row.status,
        sourceChatInstanceId: row.source_chat_instance_id || null,
        lastUpdatingChatInstanceId: row.last_updating_chat_instance_id || null,
        provenance: provenanceByRecordId.get(`${row.memory_scope_id}:${row.decision_id}:${row.record_version}`) || [],
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
    return {
        ...report,
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
        tier2Claims: [],
        tier2ClaimLinks: [],
        issues: [],
        exclusions: [],
        conflicts: [],
        reviewItems: [],
        unresolvedEvidence: [],
        promotionBlockers: [
            'promotion path intentionally unavailable in C0.5A',
            String(failure?.code || 'ARCH_REBUILD_FAILED'),
        ],
        determinism: {
            attempted: false,
            equivalent: false,
            canonicalCandidateHash: null,
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
    const decisionGroups = new Map();
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
            const occurrence = {
                artifact,
                authorityInput,
                outputMessage,
                coveredSourceMessageIds,
                sourceRevisionHash: normalizedManifest?.sourceRevisionHash || '',
                sourceIdentityHash: normalizedManifest?.sourceIdentityHash || '',
            };
            if (!decisionGroups.has(authorityInput.decisionId)) {
                decisionGroups.set(authorityInput.decisionId, []);
            }
            decisionGroups.get(authorityInput.decisionId).push(occurrence);
        }
    }

    const recordByDecisionId = new Map();
    const decisionTextToRecords = new Map();
    let candidateAuthorityRecordCount = 0;
    let exactCount = 0;
    let corroboratedCount = 0;
    let deltaRecoveredCount = 0;
    let reconstructedCount = 0;
    let conflictedCount = 0;

    function indexRecord(decisionId, recordVersion, authorityInput, fields = authorityInput.fields || {}) {
        const recordId = buildTier2RecordId(manifest.memoryScopeId, decisionId, recordVersion);
        const decisionText = String(fields?.DECISION || '').trim();
        const decisionComparisonText = normalizeTier2ComparisonText(decisionText);
        const indexed = {
            decisionId,
            recordId,
            recordVersion,
            canonicalHash: authorityInput.canonicalHash,
            fields,
            decisionText,
            decisionComparisonText,
        };
        recordByDecisionId.set(decisionId, indexed);
        if (decisionComparisonText) {
            const key = decisionComparisonText;
            const list = decisionTextToRecords.get(key) || [];
            list.push(indexed);
            decisionTextToRecords.set(key, list);
        }
        return indexed;
    }

    for (const [decisionId, occurrences] of [...decisionGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const hashes = [...new Set(occurrences.map((entry) => entry.authorityInput.canonicalHash))];
        if (hashes.length > 1) {
            conflictedCount += 1;
            issues.push({
                issueId: createId('issue'),
                severity: 'error',
                code: 'REBUILD_DECISION_COLLISION',
                message: `Decision ${decisionId} has conflicting canonical hashes across admitted artifacts.`,
                sourceId: occurrences[0]?.artifact?.sourceId || null,
                details: {
                    decisionId,
                    sourceIds: occurrences.map((entry) => entry.artifact.sourceId),
                    canonicalHashes: hashes,
                },
            });
            continue;
        }

        const canonical = occurrences[0].authorityInput;
        const recordVersion = 1;
        const recordId = buildTier2RecordId(manifest.memoryScopeId, decisionId, recordVersion);
        const provenanceEntries = [];

        for (const occurrence of occurrences) {
            const provenanceId = createId('prov');
            provenanceEntries.push({
                provenanceId,
                recordId,
                memoryScopeId: manifest.memoryScopeId,
                speakerEntityId: String(occurrence.outputMessage?.extra?.summary_sharder?.speakerIdentity?.speakerEntityId || ''),
                chatInstanceId: String(occurrence.artifact.corpus?.fileEntry?.chatInstanceId || ''),
                artifactMessageId: String(occurrence.artifact.artifactMessageId || ''),
                sourceManifestId: String(occurrence.artifact.sourceManifestId || ''),
                sourceRevisionHash: occurrence.sourceRevisionHash,
                sourceIdentityHash: occurrence.sourceIdentityHash,
                coveredSourceMessageIds: occurrence.coveredSourceMessageIds,
            });
        }

        const provenanceJson = [];
        for (const occurrence of occurrences) {
            if (occurrence.authorityInput.sourceRef) {
                provenanceJson.push({
                    chatId: occurrence.artifact.corpus?.fileEntry?.chatInstanceId || null,
                    collectionId: null,
                    sourceRef: occurrence.authorityInput.sourceRef,
                });
            }
        }

        adapter.run(
            `INSERT INTO decision_records (
                memory_scope_id, decision_id, record_version, canonical_hash, canonical_hash_version,
                hash_algorithm, semantic_payload, fields_json, status, prior_version,
                source_chat_instance_id, last_updating_chat_instance_id, provenance_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                manifest.memoryScopeId,
                decisionId,
                recordVersion,
                canonical.canonicalHash,
                canonical.canonicalHashVersion,
                canonical.hashAlgorithm,
                canonical.semanticPayload,
                JSON.stringify(canonical.fields || {}),
                canonical.status || '',
                null,
                occurrences[0].artifact.corpus?.fileEntry?.chatInstanceId || null,
                occurrences[0].artifact.corpus?.fileEntry?.chatInstanceId || null,
                JSON.stringify(provenanceJson),
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
                decisionId,
                recordVersion,
                canonical.canonicalHash,
                canonical.canonicalHashVersion,
                canonical.hashAlgorithm,
                'active',
                JSON.stringify(null),
                JSON.stringify(null),
                timestamp,
            ],
        );

        for (const provenance of provenanceEntries) {
            adapter.run(
                `INSERT INTO reconstruction_candidate_provenance (
                    reconstruction_run_id, provenance_id, record_id, memory_scope_id, speaker_entity_id,
                    chat_instance_id, artifact_message_id, source_manifest_id, source_revision_hash, source_identity_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    manifest.reconstructionRunId,
                    provenance.provenanceId,
                    provenance.recordId,
                    provenance.memoryScopeId,
                    provenance.speakerEntityId,
                    provenance.chatInstanceId,
                    provenance.artifactMessageId,
                    provenance.sourceManifestId,
                    provenance.sourceRevisionHash,
                    provenance.sourceIdentityHash,
                ],
            );
            for (const messageId of provenance.coveredSourceMessageIds) {
                adapter.run(
                    `INSERT INTO reconstruction_candidate_provenance_sources (
                        reconstruction_run_id, provenance_id, covered_source_message_id
                    ) VALUES (?, ?, ?)`,
                    [manifest.reconstructionRunId, provenance.provenanceId, messageId],
                );
            }
        }

        indexRecord(decisionId, recordVersion, canonical, canonical.fields || {});
        candidateAuthorityRecordCount += 1;
        exactCount += 1;
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
            const relatedRecord = explicitDecisionId ? recordByDecisionId.get(explicitDecisionId) : null;

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
            const recordId = buildTier2RecordId(manifest.memoryScopeId, effectiveDecisionId, recordVersion);
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
            indexRecord(effectiveDecisionId, recordVersion, authorityInput, authorityInput.fields || {});
            candidateAuthorityRecordCount += 1;
            reconstructedCount += 1;
            continue;
        }

        if (mutableClaim.claimClass === TIER2_CLAIM_CLASS.CORRECTION) {
            const targetDecisionId = String(payload.targetDecisionId || '').trim().toLowerCase() || null;
            if (!targetDecisionId || !recordByDecisionId.has(targetDecisionId)) {
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
            const target = recordByDecisionId.get(targetDecisionId);
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
            if (!recordByDecisionId.has(supersededDecisionId)) {
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
            const supersededRecord = recordByDecisionId.get(supersededDecisionId);
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
    const currentDecisionCount = Number(adapter.scalar('SELECT COUNT(*) FROM current_decisions WHERE memory_scope_id = ?', [manifest.memoryScopeId]) || 0);
    if (decisionRecordCount !== currentDecisionCount) {
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
    return buildDeterministicTableDump(REBUILD_TABLE_SPECS, (tableName) => {
        return adapter.all(`SELECT * FROM ${tableName}`);
    });
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
                        'promotion path intentionally unavailable in C0.5A',
                        'candidate invalidated by source mutation',
                    ],
                    determinism: {
                        attempted: false,
                        equivalent: false,
                        canonicalCandidateHash: null,
                        differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                        unexplainedDifferences: [],
                    },
                    failure: null,
                    createdAt: manifest.createdAt,
                    finishedAt,
                };
                writeReport(candidatePaths, report);
                applyCandidateRetention(userRoot, manifest.memoryScopeId);
                return {
                    ok: false,
                    report: finalizeReport(userRoot, report),
                    summary: summarizeCompactRebuildReport(report),
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
                    'promotion path intentionally unavailable in C0.5A',
                    'candidate invalidated by source mutation',
                ],
                determinism: {
                    attempted: false,
                    equivalent: false,
                    canonicalCandidateHash: null,
                    differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                    unexplainedDifferences: [],
                },
                failure: null,
                createdAt: manifest.createdAt,
                finishedAt,
            };
            writeReport(candidatePaths, report);
            applyCandidateRetention(userRoot, manifest.memoryScopeId);
            return {
                ok: false,
                report: finalizeReport(userRoot, report),
                summary: summarizeCompactRebuildReport(report),
            };
        }

        const preFingerprints = manifest.liveAuthorityFingerprints || {};
        const postFingerprints = getLiveAuthorityFingerprints(userRoot);
        const liveAuthorityChanged = !equalFingerprints(preFingerprints, postFingerprints);

        const comparableDump = dumpComparableState(adapter);
        const canonicalCandidateHash = hashDeterministicTableDump(comparableDump);

        const determinismDbPath = `${candidatePaths.candidateDbPath}.determinism`;
        const determinismAdapter = createAdapter(determinismDbPath);
        let determinismEquivalent = false;
        let unexplainedDifferences = [];
        try {
            initializeDatabase(determinismAdapter, finishedAt);
            for (const statement of candidateAuditSchemaStatements()) {
                determinismAdapter.exec(statement);
            }
            insertManifestRows(determinismAdapter, manifest);
            const determinismFrozenCorpusByFileId = loadFrozenCorpusByFileId(userRoot, manifest);
            await compileCandidate(determinismAdapter, manifest, determinismFrozenCorpusByFileId);
            const determinismHash = hashDeterministicTableDump(dumpComparableState(determinismAdapter));
            determinismEquivalent = determinismHash === canonicalCandidateHash;
            if (!determinismEquivalent) {
                unexplainedDifferences = ['candidate_comparable_state_hash_mismatch'];
            }
        } finally {
            determinismAdapter.close();
            fs.rmSync(determinismDbPath, { force: true });
            fs.rmSync(`${determinismDbPath}-wal`, { force: true });
            fs.rmSync(`${determinismDbPath}-shm`, { force: true });
        }

        const validation = validateCandidateState(adapter, manifest, compileResult, liveAuthorityChanged);
        const succeeded = validation.ok && determinismEquivalent;
        updateCandidateRunStatus(
            adapter,
            reconstructionRunId,
            succeeded ? RECONSTRUCTION_STATUS.SUCCEEDED : RECONSTRUCTION_STATUS.INVALID,
            {
                finishedAt,
                failureReason: succeeded ? null : validation.issues.concat(unexplainedDifferences).join(','),
            },
        );

        const report = {
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
            candidateRecords: buildCandidateRecordReportEntries(adapter, manifest.reconstructionRunId),
            tier2Claims: buildCandidateClaimReportEntries(adapter, manifest.reconstructionRunId),
            tier2ClaimLinks: buildCandidateClaimLinkReportEntries(adapter, manifest.reconstructionRunId),
            issues: buildCandidateIssueReportEntries(adapter, manifest.reconstructionRunId),
            reviewItems: buildCandidateReviewItemReportEntries(adapter, manifest.reconstructionRunId),
            coverage: compileResult.coverage,
            exclusions: compileResult.exclusions,
            conflicts: buildCandidateConflictReportEntries(adapter, manifest.reconstructionRunId),
            unresolvedEvidence: compileResult.unresolvedEvidence,
            promotionBlockers: [
                'promotion path intentionally unavailable in C0.5A',
                ...(validation.issues.length > 0 ? validation.issues : []),
            ],
            determinism: {
                attempted: true,
                equivalent: determinismEquivalent,
                canonicalCandidateHash,
                differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
                unexplainedDifferences,
            },
            failure: null,
            createdAt: manifest.createdAt,
            finishedAt,
        };

        writeReport(candidatePaths, report);
        applyCandidateRetention(userRoot, manifest.memoryScopeId);
        return {
            ok: succeeded,
            report: finalizeReport(userRoot, report),
            summary: summarizeCompactRebuildReport(report),
        };
    } catch (error) {
        try {
            updateCandidateRunStatus(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.FAILED, {
                finishedAt,
                failureReason: String(error?.code || error?.message || 'failed'),
            });
            const liveAuthorityChanged = !equalFingerprints(manifest.liveAuthorityFingerprints || {}, getLiveAuthorityFingerprints(userRoot));
            const failureReport = buildFailureReport(manifest, candidatePaths, finishedAt, error, { liveAuthorityChanged });
            writeReport(candidatePaths, failureReport);
            applyCandidateRetention(userRoot, manifest.memoryScopeId);
        } catch {
            // ignore secondary failure
        }
        throw error;
    } finally {
        adapter.close();
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
