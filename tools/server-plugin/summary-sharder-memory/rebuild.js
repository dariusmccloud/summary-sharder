import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_SCHEMA_VERSION,
    getSharderSectionRegistry,
} from '../../../core/summarization/sharder-section-registry.js';
import { buildArchitecturalDecisionAuthorityInput } from '../../../core/summarization/architectural-authority-store.js';
import {
    ARCHITECTURAL_REBUILD_MANIFEST_SCHEMA_VERSION,
    ARCHITECTURAL_REBUILD_PROTOCOL_VERSION,
    ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION,
    RECONSTRUCTION_STATUS,
    TERMINAL_RECONSTRUCTION_STATUS,
    buildDeterministicTableDump,
    hashDeterministicTableDump,
    sha256Text,
    stableStringify,
    summarizeCompactRebuildReport,
} from '../../../core/summarization/architectural-rebuild-protocol.js';
import { parseArchitecturalExtractionResponse } from '../../../core/summarization/architectural-sharder-format.js';
import { buildArchitecturalShardMetadata } from '../../../core/summarization/saved-shard-identity.js';
import {
    SHARD_CONTENT_HEALTH_VALUES,
    normalizeShardManifest,
    validateShardManifest,
} from '../../../core/summarization/shard-integrity-core.js';
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
]);

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
            entries.push({ manifestPath, manifest, reportPath, report });
        } catch {
            // ignore malformed sidecars during discovery
        }
    }
    return entries;
}

function findExistingActiveRun(candidatesRoot, memoryScopeId, requestKey) {
    const entries = listScopeCandidateArtifacts(candidatesRoot, memoryScopeId);
    for (const entry of entries) {
        const status = entry.report?.status || entry.manifest?.status || null;
        if (status && TERMINAL_RECONSTRUCTION_STATUS.has(status)) {
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
    const issues = [];
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

    let candidateAuthorityRecordCount = 0;
    let exactCount = 0;
    let conflictedCount = 0;

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
        const recordId = `${manifest.memoryScopeId}:${decisionId}:${recordVersion}`;
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

        candidateAuthorityRecordCount += 1;
        exactCount += 1;
    }

    for (const issue of issues) {
        insertCandidateIssue(adapter, manifest.reconstructionRunId, issue);
    }

    return {
        exclusions,
        conflicts: issues.map((issue) => ({
            sourceId: issue.sourceId,
            code: issue.code,
        })),
        unresolvedEvidence,
        candidateAuthorityRecordCount,
        candidateIssueCount: issues.length,
        coverage: {
            exact: { attempted: true, count: exactCount },
            corroborated: { attempted: false, count: null },
            deltaRecovered: { attempted: false, count: null },
            reconstructed: { attempted: false, count: null },
            conflicted: { attempted: true, count: conflictedCount },
            partial: { attempted: true, count: unresolvedEvidence.length || null },
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
    const entries = listScopeCandidateArtifacts(candidatesRoot, memoryScopeId)
        .filter((entry) => entry.report && TERMINAL_RECONSTRUCTION_STATUS.has(entry.report.status))
        .sort((a, b) => Number(b.report?.finishedAt || b.report?.createdAt || 0) - Number(a.report?.finishedAt || a.report?.createdAt || 0));

    const keep = new Set();
    const latestSuccess = entries.find((entry) => entry.report.status === 'success');
    const latestNonSuccess = entries.find((entry) => entry.report.status !== 'success');
    if (latestSuccess) keep.add(latestSuccess.manifest.reconstructionRunId);
    if (latestNonSuccess) keep.add(latestNonSuccess.manifest.reconstructionRunId);

    for (const entry of entries) {
        if (keep.has(entry.manifest.reconstructionRunId)) continue;
        removeArtifactTriplet(ensureCandidatePaths(userRoot, entry.manifest.reconstructionRunId));
    }
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
                    },
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
                    createdAt: manifest.createdAt,
                    finishedAt,
                };
                atomicWriteFile(candidatePaths.reportPath, JSON.stringify(report, null, 2));
                applyCandidateRetention(userRoot, manifest.memoryScopeId);
                return {
                    ok: false,
                    report,
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
                    totalFiles: manifest.corpusFiles.length,
                    totalArtifacts: manifest.artifacts.length,
                    admittedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'admitted').length,
                    excludedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'excluded').length,
                    blockedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'blocked').length,
                },
                outputSummary: {
                    candidateAuthorityRecordCount: compileResult.candidateAuthorityRecordCount,
                    candidateIssueCount: compileResult.candidateIssueCount,
                },
                coverage: compileResult.coverage,
                exclusions: compileResult.exclusions,
                conflicts: compileResult.conflicts,
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
                createdAt: manifest.createdAt,
                finishedAt,
            };
            atomicWriteFile(candidatePaths.reportPath, JSON.stringify(report, null, 2));
            applyCandidateRetention(userRoot, manifest.memoryScopeId);
            return {
                ok: false,
                report,
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
                totalFiles: manifest.corpusFiles.length,
                totalArtifacts: manifest.artifacts.length,
                admittedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'admitted').length,
                excludedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'excluded').length,
                blockedArtifacts: manifest.artifacts.filter((artifact) => artifact.admissionStatus === 'blocked').length,
            },
            outputSummary: {
                candidateAuthorityRecordCount: compileResult.candidateAuthorityRecordCount,
                candidateIssueCount: compileResult.candidateIssueCount,
            },
            coverage: compileResult.coverage,
            exclusions: compileResult.exclusions,
            conflicts: compileResult.conflicts,
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
            createdAt: manifest.createdAt,
            finishedAt,
        };

        atomicWriteFile(candidatePaths.reportPath, JSON.stringify(report, null, 2));
        applyCandidateRetention(userRoot, manifest.memoryScopeId);
        return {
            ok: succeeded,
            report,
            summary: summarizeCompactRebuildReport(report),
        };
    } catch (error) {
        try {
            updateCandidateRunStatus(adapter, reconstructionRunId, RECONSTRUCTION_STATUS.FAILED, {
                finishedAt,
                failureReason: String(error?.code || error?.message || 'failed'),
            });
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
        report,
        summary: summarizeCompactRebuildReport(report),
    };
}
