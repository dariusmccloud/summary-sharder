import fs from 'node:fs';
import path from 'node:path';

import {
    buildDeterministicTableDump,
    hashDeterministicTableDump,
    sha256Text,
    stableStringify,
} from './lib/core/summarization/architectural-rebuild-protocol.js';
import {
    atomicWriteFile,
    createAdapter,
    createError,
    createId,
    getAuthenticatedUserRoot,
    getStoragePaths,
    initializeDatabase,
    openOperationalDatabase,
    readOperationalStateMarker,
    resolveOperationalDbPath,
    writeOperationalStateMarkerDescriptor,
    snapshotOperationalDatabase,
} from './core.js';
import {
    AUTHORITY_SURFACE_HASH_BASIS,
    AUTHORITY_SURFACE_HASH_VERSION,
    AUTHORITY_SURFACE_TABLE_SPECS,
    buildEmptyScopeAuthoritySurfaceState,
    buildScopeAuthoritySurfaceState,
    computePersistedCanonicalCandidateState,
    computeScopedAuthorityState,
    loadCandidateRebuildReport,
    readLiveAuthorityStateReadOnly,
} from './rebuild.js';

const KNOWN_NON_PROMOTABLE_TABLES = new Set([
    'manifest',
    'migration_audit',
    'reconstruction_runs',
    'reconstruction_manifest_files',
    'reconstruction_manifest_artifacts',
    'reconstruction_candidate_issues',
    'reconstruction_candidate_provenance',
    'reconstruction_candidate_provenance_sources',
    'reconstruction_candidate_claims',
    'reconstruction_candidate_claim_links',
    'reconstruction_candidate_conflicts',
    'reconstruction_candidate_review_items',
    'reconstruction_occurrence_groups',
    'reconstruction_occurrence_group_members',
    'reconstruction_version_lifecycle_groups',
    'reconstruction_supersession_components',
]);

const PROMOTABLE_TABLE_NAMES = new Set(AUTHORITY_SURFACE_TABLE_SPECS.map((entry) => entry.name));

function ensurePromotionRoots(paths) {
    fs.mkdirSync(paths.generationsRoot, { recursive: true });
    fs.mkdirSync(paths.promotionsRoot, { recursive: true });
    fs.mkdirSync(paths.promotionAuthorizationsRoot, { recursive: true });
    fs.mkdirSync(paths.locksRoot, { recursive: true });
}

function toRelativeStoragePath(paths, targetPath) {
    return path.relative(paths.storageRoot, targetPath).replace(/\\/g, '/');
}

function authorizationPath(paths, authorizationId) {
    return path.join(paths.promotionAuthorizationsRoot, `${authorizationId}.json`);
}

function appendPromotionJournal(paths, record) {
    ensurePromotionRoots(paths);
    const serialized = `${JSON.stringify(record)}\n`;
    fs.appendFileSync(paths.promotionJournalPath, serialized, 'utf8');
}

function loadAuthorization(paths, authorizationId) {
    const filePath = authorizationPath(paths, authorizationId);
    if (!fs.existsSync(filePath)) {
        throw createError(404, `Promotion authorization ${authorizationId} was not found`, 'ARCH_PROMOTION_AUTHORIZATION_NOT_FOUND');
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveAuthorization(paths, authorization) {
    atomicWriteFile(authorizationPath(paths, authorization.authorizationId), JSON.stringify(authorization, null, 2));
}

function acquireGlobalPromotionLock(paths, details = {}) {
    ensurePromotionRoots(paths);
    try {
        fs.mkdirSync(paths.authorityTransitionLockPath);
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            throw createError(409, 'Another authority transition is already in progress', 'ARCH_PROMOTION_LOCK_HELD');
        }
        throw error;
    }
    atomicWriteFile(
        path.join(paths.authorityTransitionLockPath, 'lock.json'),
        JSON.stringify({
            acquiredAt: Date.now(),
            ...details,
        }, null, 2),
    );
}

function releaseGlobalPromotionLock(paths) {
    fs.rmSync(paths.authorityTransitionLockPath, { recursive: true, force: true });
}

function readTableNames(adapter) {
    return adapter.all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC`).map((row) => row.name);
}

function readTableColumns(adapter, tableName) {
    return adapter.all(`PRAGMA table_info(${tableName})`).map((row) => String(row.name));
}

function assertNoUnknownScopeBearingTables(adapter, context) {
    const violations = [];
    for (const tableName of readTableNames(adapter)) {
        if (tableName.startsWith('sqlite_')) {
            continue;
        }
        const columns = readTableColumns(adapter, tableName);
        if (!columns.includes('memory_scope_id')) {
            continue;
        }
        if (PROMOTABLE_TABLE_NAMES.has(tableName) || KNOWN_NON_PROMOTABLE_TABLES.has(tableName)) {
            continue;
        }
        violations.push(tableName);
    }
    if (violations.length > 0) {
        throw createError(
            500,
            `Unknown scope-bearing tables detected in ${context}: ${violations.join(', ')}`,
            'ARCH_PROMOTION_SCOPE_TABLE_MANIFEST_INCOMPLETE',
            { tables: violations },
        );
    }
}

function assertNoCandidateAuditTables(adapter) {
    const unexpected = readTableNames(adapter).filter((name) => name.startsWith('reconstruction_'));
    if (unexpected.length > 0) {
        throw createError(
            500,
            `Candidate-only tables entered live authority: ${unexpected.join(', ')}`,
            'ARCH_PROMOTION_CANDIDATE_TABLE_LEAK',
            { tables: unexpected },
        );
    }
}

function computeAggregateAuthorityState(dbPath, memoryScopeId, mode) {
    const adapter = createAdapter(dbPath);
    try {
        const comparableDump = buildDeterministicTableDump(AUTHORITY_SURFACE_TABLE_SPECS, (tableName) => {
            const spec = AUTHORITY_SURFACE_TABLE_SPECS.find((entry) => entry.name === tableName);
            if (!spec) {
                return [];
            }
            if (mode === 'full') {
                return adapter.all(`SELECT * FROM ${spec.name}`);
            }
            if (mode === 'non-target') {
                return adapter.all(`SELECT * FROM ${spec.name} WHERE ${spec.scopeColumn} <> ?`, [memoryScopeId]);
            }
            return adapter.all(`SELECT * FROM ${spec.name} WHERE ${spec.scopeColumn} = ?`, [memoryScopeId]);
        });
        const canonicalBytes = stableStringify(comparableDump);
        const tableRowCounts = Object.fromEntries(
            AUTHORITY_SURFACE_TABLE_SPECS.map((spec) => [spec.name, Array.isArray(comparableDump[spec.name]) ? comparableDump[spec.name].length : 0]),
        );
        return {
            hashVersion: AUTHORITY_SURFACE_HASH_VERSION,
            basis: AUTHORITY_SURFACE_HASH_BASIS,
            canonicalBytes,
            canonicalByteLength: Buffer.byteLength(canonicalBytes, 'utf8'),
            canonicalAuthorityHash: hashDeterministicTableDump(comparableDump),
            tableRowCounts,
        };
    } finally {
        adapter.close();
    }
}

function buildInsertStatement(tableName, columns) {
    const placeholders = columns.map(() => '?').join(', ');
    return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
}

function replaceScopeClosure(stagedAdapter, candidateAdapter, memoryScopeId) {
    for (const spec of AUTHORITY_SURFACE_TABLE_SPECS) {
        stagedAdapter.run(`DELETE FROM ${spec.name} WHERE ${spec.scopeColumn} = ?`, [memoryScopeId]);
        const rows = candidateAdapter.all(`SELECT * FROM ${spec.name} WHERE ${spec.scopeColumn} = ?`, [memoryScopeId]);
        if (rows.length === 0) {
            continue;
        }
        const columns = Object.keys(rows[0]);
        const sql = buildInsertStatement(spec.name, columns);
        for (const row of rows) {
            stagedAdapter.run(sql, columns.map((column) => row[column]));
        }
    }
}

function verifySnapshotDb(filePath) {
    const adapter = createAdapter(filePath);
    try {
        initializeDatabase(adapter);
        if (!adapter.verifyIntegrity()) {
            throw createError(500, `Snapshot verification failed for ${path.basename(filePath)}`, 'ARCH_PROMOTION_SNAPSHOT_VERIFICATION_FAILED');
        }
    } finally {
        adapter.close();
    }
}

function buildGenerationPaths(paths, promotionId) {
    return {
        rollbackDbPath: path.join(paths.generationsRoot, `architectural-memory.rollback.${promotionId}.db`),
        stagedDbPath: path.join(paths.generationsRoot, `architectural-memory.live.${promotionId}.db`),
        manifestPath: path.join(paths.generationsRoot, `architectural-memory.live.${promotionId}.json`),
    };
}

function loadGenerationManifest(paths, promotionId) {
    const manifestPath = buildGenerationPaths(paths, promotionId).manifestPath;
    if (!fs.existsSync(manifestPath)) {
        throw createError(500, `Promotion manifest for ${promotionId} is missing`, 'ARCH_PROMOTION_MANIFEST_MISSING');
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function computeLivePresenceDescriptor(liveState) {
    return {
        presence: liveState?.dbPresent ? 'PRESENT' : 'ABSENT',
        generationId: liveState?.generationIdentity || null,
        authorityHash: liveState?.canonicalAuthorityHash || null,
    };
}

function assertPromotionEligible(report) {
    if (report?.promotionQualification?.eligibility?.eligible !== true) {
        throw createError(409, 'Candidate is not eligible for promotion', 'ARCH_PROMOTION_INELIGIBLE', {
            reasons: report?.promotionQualification?.eligibility?.reasons || [],
        });
    }
    if (report?.determinism?.canonicalHashFinal !== true || !report?.determinism?.canonicalCandidateHash) {
        throw createError(409, 'Candidate canonical hash is not final', 'ARCH_PROMOTION_CANDIDATE_HASH_NOT_FINAL');
    }
    if (report?.candidateValidity?.valid !== true) {
        throw createError(409, 'Candidate validity remains blocked', 'ARCH_PROMOTION_CANDIDATE_INVALID', {
            structuralBlockers: report?.candidateValidity?.structuralBlockers || [],
        });
    }
}

function verifyDatabaseIntegrity(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) {
        return false;
    }
    const adapter = createAdapter(dbPath);
    try {
        initializeDatabase(adapter);
        return adapter.verifyIntegrity();
    } catch {
        return false;
    } finally {
        adapter.close();
    }
}

function buildPendingPromotionState({
    promotionId,
    authorizationId,
    nextGenerationId,
    liveDbRelativePath,
    rollbackDbRelativePath,
    parentLiveAuthority,
    fullAuthorityHash,
    now,
}) {
    return {
        lastPromotionId: promotionId,
        lastState: 'PREPARED',
        authorizationId,
        nextGenerationId,
        liveDbRelativePath,
        rollbackDbRelativePath,
        parentLiveAuthority,
        fullAuthorityHash,
        updatedAt: now,
    };
}

function restoreParentLiveAuthority(paths, promotionState, now) {
    const parent = promotionState?.parentLiveAuthority || null;
    const nextLive = parent?.presence === 'PRESENT'
        ? {
            generationId: parent.generationId,
            dbRelativePath: parent.dbRelativePath,
            authorityHash: parent.authorityHash,
        }
        : null;
    writeOperationalStateMarkerDescriptor(paths, {
        liveAuthority: nextLive,
        promotionJournal: {
            ...promotionState,
            lastState: 'ROLLED_BACK',
            updatedAt: now,
        },
    }, now);
}

export function recoverPromotionState(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    ensurePromotionRoots(paths);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const marker = readOperationalStateMarker(paths);
    const promotionState = marker?.promotionJournal || null;
    const liveAuthority = marker?.liveAuthority || null;

    if (!promotionState?.lastPromotionId || !promotionState?.lastState) {
        return { recovered: false, state: 'NONE' };
    }

    const lastState = String(promotionState.lastState || '').trim().toUpperCase();
    if (!lastState || lastState === 'COMMITTED' || lastState === 'FAILED' || lastState === 'ROLLED_BACK') {
        return { recovered: false, state: lastState || 'NONE' };
    }

    const manifest = loadGenerationManifest(paths, promotionState.lastPromotionId);
    const stagedDbPath = path.join(paths.storageRoot, manifest.liveDbRelativePath);
    const pointerTargetsStaged = liveAuthority?.generationId === manifest.generationId
        && liveAuthority?.dbRelativePath === manifest.liveDbRelativePath;
    const stagedValid = verifyDatabaseIntegrity(stagedDbPath);

    if (lastState === 'PREPARED') {
        if (pointerTargetsStaged) {
            if (!stagedValid) {
                restoreParentLiveAuthority(paths, promotionState, now);
                return { recovered: true, state: 'ROLLED_BACK', reason: 'prepared-pointed-at-invalid-staged-live' };
            }
            writeOperationalStateMarkerDescriptor(paths, {
                promotionJournal: {
                    ...promotionState,
                    lastState: 'COMMITTED',
                    updatedAt: now,
                },
            }, now);
            appendPromotionJournal(paths, {
                type: 'PROMOTION_COMMITTED',
                promotionId: promotionState.lastPromotionId,
                authorizationId: promotionState.authorizationId || manifest.authorizationId || null,
                memoryScopeId: manifest.promotedMemoryScopeId,
                generationId: manifest.generationId,
                parentGenerationId: manifest.parentGenerationId,
                fullAuthorityHash: manifest.fullAuthorityHash,
                committedAt: now,
                recoveryCommit: true,
            });
            return { recovered: true, state: 'COMMITTED', reason: 'prepared-pointer-already-new-and-valid' };
        }
        writeOperationalStateMarkerDescriptor(paths, {
            promotionJournal: {
                ...promotionState,
                lastState: 'FAILED',
                updatedAt: now,
            },
        }, now);
        return { recovered: true, state: 'FAILED', reason: 'prepared-pointer-never-moved' };
    }

    if (lastState === 'VERIFYING' || lastState === 'COMMITTING') {
        if (pointerTargetsStaged && stagedValid) {
            writeOperationalStateMarkerDescriptor(paths, {
                promotionJournal: {
                    ...promotionState,
                    lastState: 'COMMITTED',
                    updatedAt: now,
                },
            }, now);
            appendPromotionJournal(paths, {
                type: 'PROMOTION_COMMITTED',
                promotionId: promotionState.lastPromotionId,
                authorizationId: promotionState.authorizationId || manifest.authorizationId || null,
                memoryScopeId: manifest.promotedMemoryScopeId,
                generationId: manifest.generationId,
                parentGenerationId: manifest.parentGenerationId,
                fullAuthorityHash: manifest.fullAuthorityHash,
                committedAt: now,
                recoveryCommit: true,
            });
            return { recovered: true, state: 'COMMITTED', reason: 'verifying-staged-live-valid' };
        }
        writeOperationalStateMarkerDescriptor(paths, {
            promotionJournal: {
                ...promotionState,
                lastState: 'ROLLING_BACK',
                updatedAt: now,
            },
        }, now);
        restoreParentLiveAuthority(paths, promotionState, now);
        return { recovered: true, state: 'ROLLED_BACK', reason: 'verifying-staged-live-invalid' };
    }

    if (lastState === 'ROLLING_BACK') {
        restoreParentLiveAuthority(paths, promotionState, now);
        return { recovered: true, state: 'ROLLED_BACK', reason: 'completed-rollback-on-restart' };
    }

    throw createError(500, `Unsupported promotion recovery state ${lastState}`, 'ARCH_PROMOTION_RECOVERY_STATE_UNSUPPORTED');
}

export function createPromotionAuthorization(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    ensurePromotionRoots(paths);

    const reconstructionRunId = String(options.reconstructionRunId || '').trim();
    if (!reconstructionRunId) {
        throw createError(400, 'reconstructionRunId is required', 'ARCH_PROMOTION_AUTHORIZATION_INVALID');
    }
    const authorizedBy = String(options.authorizedBy || '').trim();
    if (!authorizedBy) {
        throw createError(400, 'authorizedBy is required', 'ARCH_PROMOTION_AUTHORIZATION_INVALID');
    }
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const expiresAt = Number.isFinite(Number(options.expiresAt)) ? Number(options.expiresAt) : now + (60 * 60 * 1000);
    if (expiresAt <= now) {
        throw createError(400, 'expiresAt must be in the future', 'ARCH_PROMOTION_AUTHORIZATION_INVALID');
    }

    const { report } = loadCandidateRebuildReport(request, reconstructionRunId);
    assertPromotionEligible(report);
    const candidate = report?.promotionQualification?.candidate;
    const live = report?.promotionQualification?.live;
    if (!candidate || !live) {
        throw createError(409, 'Candidate qualification evidence is incomplete', 'ARCH_PROMOTION_QUALIFICATION_MISSING');
    }

    const authorizationId = createId('promoauth');
    const authorization = {
        authorizationId,
        status: 'AUTHORIZED',
        memoryScopeId: report.memoryScopeId,
        reconstructionRunId,
        candidateArtifactId: report.candidateArtifactId,
        candidateHash: candidate.canonicalCandidateHash,
        candidateSchemaVersion: report.schemaVersion,
        candidateGenerationId: candidate.generationIdentity,
        expectedLiveState: computeLivePresenceDescriptor(live),
        promotionEvidenceDigest: report.promotionQualification.boundEvidenceDigest,
        qualificationProtocolVersion: report.protocolVersion,
        eligibilityVerdict: true,
        authorizedBy,
        authorizedAt: now,
        expiresAt,
        oneTimeNonce: createId('nonce'),
        consumedAt: null,
        promotionId: null,
    };
    saveAuthorization(paths, authorization);
    return {
        ok: true,
        authorization,
        promotionAvailable: true,
    };
}

export function executePromotionAuthorization(request, options = {}) {
    const userRoot = getAuthenticatedUserRoot(request);
    const paths = getStoragePaths(userRoot);
    ensurePromotionRoots(paths);

    const authorizationId = String(options.authorizationId || '').trim();
    if (!authorizationId) {
        throw createError(400, 'authorizationId is required', 'ARCH_PROMOTION_AUTHORIZATION_INVALID');
    }
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const authorization = loadAuthorization(paths, authorizationId);
    const promotionId = createId('promotion');

    acquireGlobalPromotionLock(paths, {
        authorizationId,
        promotionId,
        memoryScopeId: authorization.memoryScopeId,
    });

    try {
        if (authorization.status !== 'AUTHORIZED') {
            throw createError(409, 'Promotion authorization has already been consumed', 'ARCH_PROMOTION_NONCE_CONSUMED');
        }
        if (Number(authorization.expiresAt) <= now) {
            throw createError(409, 'Promotion authorization has expired', 'ARCH_PROMOTION_AUTHORIZATION_EXPIRED');
        }

        const { report } = loadCandidateRebuildReport(request, authorization.reconstructionRunId);
        assertPromotionEligible(report);
        if (report.promotionQualification.boundEvidenceDigest !== authorization.promotionEvidenceDigest) {
            throw createError(409, 'Qualification evidence digest changed', 'ARCH_PROMOTION_EVIDENCE_DRIFT');
        }

        const currentCandidateHash = report?.determinism?.canonicalCandidateHash || null;
        if (currentCandidateHash !== authorization.candidateHash) {
            throw createError(409, 'Candidate hash changed since authorization', 'ARCH_PROMOTION_CANDIDATE_HASH_DRIFT');
        }
        const currentCandidateGenerationId = report?.promotionQualification?.candidate?.generationIdentity || null;
        if (currentCandidateGenerationId !== authorization.candidateGenerationId) {
            throw createError(409, 'Candidate generation changed since authorization', 'ARCH_PROMOTION_CANDIDATE_GENERATION_DRIFT');
        }

        const liveState = readLiveAuthorityStateReadOnly(userRoot, authorization.memoryScopeId);
        const liveDescriptor = computeLivePresenceDescriptor(liveState);
        if (stableStringify(liveDescriptor) !== stableStringify(authorization.expectedLiveState)) {
            throw createError(409, 'Live authority drifted since authorization', 'ARCH_PROMOTION_LIVE_STATE_DRIFT', {
                expected: authorization.expectedLiveState,
                current: liveDescriptor,
            });
        }

        const candidateDbPath = path.join(userRoot, report.candidateRelativePath);
        if (!fs.existsSync(candidateDbPath)) {
            throw createError(404, 'Candidate DB is missing', 'ARCH_PROMOTION_CANDIDATE_DB_MISSING');
        }
        const candidateCanonical = computePersistedCanonicalCandidateState(candidateDbPath);
        if (candidateCanonical.canonicalCandidateHash !== authorization.candidateHash) {
            throw createError(409, 'Persisted candidate state no longer matches authorized hash', 'ARCH_PROMOTION_CANDIDATE_HASH_DRIFT');
        }

        const currentStateMarker = readOperationalStateMarker(paths);
        const currentLiveDbPath = resolveOperationalDbPath(paths, currentStateMarker);
        const generationPaths = buildGenerationPaths(paths, promotionId);
        const livePresent = liveDescriptor.presence === 'PRESENT';
        const parentLiveAuthority = livePresent
            ? {
                presence: 'PRESENT',
                generationId: authorization.expectedLiveState.generationId,
                dbRelativePath: currentStateMarker?.liveAuthority?.dbRelativePath || toRelativeStoragePath(paths, currentLiveDbPath),
                authorityHash: authorization.expectedLiveState.authorityHash,
            }
            : {
                presence: 'ABSENT',
                generationId: null,
                dbRelativePath: null,
                authorityHash: authorization.expectedLiveState.authorityHash,
            };

        const parentTargetScopeHash = livePresent
            ? computeScopedAuthorityState(currentLiveDbPath, authorization.memoryScopeId).canonicalAuthorityHash
            : buildEmptyScopeAuthoritySurfaceState().canonicalAuthorityHash;
        const parentNonTargetAggregate = livePresent
            ? computeAggregateAuthorityState(currentLiveDbPath, authorization.memoryScopeId, 'non-target')
            : computeAggregateAuthorityState(candidateDbPath, authorization.memoryScopeId, 'non-target');

        if (livePresent) {
            const liveAdapter = openOperationalDatabase(paths);
            try {
                assertNoUnknownScopeBearingTables(liveAdapter, 'live authority');
                liveAdapter.createManagedSnapshot(generationPaths.rollbackDbPath);
            } finally {
                liveAdapter.close();
            }
            verifySnapshotDb(generationPaths.rollbackDbPath);
            fs.copyFileSync(generationPaths.rollbackDbPath, generationPaths.stagedDbPath);
        } else {
            const stagedInit = createAdapter(generationPaths.stagedDbPath);
            try {
                initializeDatabase(stagedInit, now);
            } finally {
                stagedInit.close();
            }
        }

        const candidateAdapter = createAdapter(candidateDbPath);
        const stagedAdapter = createAdapter(generationPaths.stagedDbPath);
        try {
            assertNoUnknownScopeBearingTables(candidateAdapter, 'candidate authority');
            assertNoUnknownScopeBearingTables(stagedAdapter, 'staged authority');
            stagedAdapter.transaction(() => {
                replaceScopeClosure(stagedAdapter, candidateAdapter, authorization.memoryScopeId);
            });
            if (!stagedAdapter.verifyIntegrity()) {
                throw createError(500, 'Staged generation failed integrity verification', 'ARCH_PROMOTION_STAGED_INTEGRITY_FAILED');
            }
            assertNoCandidateAuditTables(stagedAdapter);
        } finally {
            stagedAdapter.close();
            candidateAdapter.close();
        }

        const stagedTargetScope = computeScopedAuthorityState(generationPaths.stagedDbPath, authorization.memoryScopeId);
        const candidateTargetScope = computeScopedAuthorityState(candidateDbPath, authorization.memoryScopeId);
        if (stagedTargetScope.canonicalAuthorityHash !== candidateTargetScope.canonicalAuthorityHash) {
            throw createError(500, 'Staged target scope hash did not match candidate target scope hash', 'ARCH_PROMOTION_TARGET_SCOPE_HASH_MISMATCH');
        }
        const stagedNonTargetAggregate = computeAggregateAuthorityState(generationPaths.stagedDbPath, authorization.memoryScopeId, 'non-target');
        if (stagedNonTargetAggregate.canonicalAuthorityHash !== parentNonTargetAggregate.canonicalAuthorityHash) {
            throw createError(500, 'Staged non-target aggregate changed during scope-local promotion', 'ARCH_PROMOTION_NON_TARGET_HASH_MISMATCH');
        }
        const fullAuthorityState = computeAggregateAuthorityState(generationPaths.stagedDbPath, authorization.memoryScopeId, 'full');
        const nextGenerationId = createId('livegen');
        const generationManifest = {
            generationId: nextGenerationId,
            parentGenerationId: authorization.expectedLiveState.generationId,
            promotedMemoryScopeId: authorization.memoryScopeId,
            candidateArtifactId: authorization.candidateArtifactId,
            candidateScopeHash: candidateTargetScope.canonicalAuthorityHash,
            parentTargetScopeHash,
            parentNonTargetAggregateHash: parentNonTargetAggregate.canonicalAuthorityHash,
            stagedTargetScopeHash: stagedTargetScope.canonicalAuthorityHash,
            stagedNonTargetAggregateHash: stagedNonTargetAggregate.canonicalAuthorityHash,
            fullAuthorityHash: fullAuthorityState.canonicalAuthorityHash,
            authorizationId,
            promotionEvidenceDigest: authorization.promotionEvidenceDigest,
            createdAt: now,
            liveDbRelativePath: toRelativeStoragePath(paths, generationPaths.stagedDbPath),
            rollbackDbRelativePath: livePresent ? toRelativeStoragePath(paths, generationPaths.rollbackDbPath) : null,
            parentLiveDbRelativePath: parentLiveAuthority.dbRelativePath,
            parentLiveAuthorityHash: parentLiveAuthority.authorityHash,
            parentLivePresence: parentLiveAuthority.presence,
        };
        atomicWriteFile(generationPaths.manifestPath, JSON.stringify(generationManifest, null, 2));

        appendPromotionJournal(paths, {
            type: 'PROMOTION_PREPARED',
            promotionId,
            authorizationId,
            memoryScopeId: authorization.memoryScopeId,
            generationId: nextGenerationId,
            parentGenerationId: authorization.expectedLiveState.generationId,
            candidateHash: authorization.candidateHash,
            candidateGenerationId: authorization.candidateGenerationId,
            candidateArtifactId: authorization.candidateArtifactId,
            stagedTargetScopeHash: stagedTargetScope.canonicalAuthorityHash,
            stagedNonTargetAggregateHash: stagedNonTargetAggregate.canonicalAuthorityHash,
            fullAuthorityHash: fullAuthorityState.canonicalAuthorityHash,
            createdAt: now,
        });

        const pendingPromotionState = buildPendingPromotionState({
            promotionId,
            authorizationId,
            nextGenerationId,
            liveDbRelativePath: toRelativeStoragePath(paths, generationPaths.stagedDbPath),
            rollbackDbRelativePath: livePresent ? toRelativeStoragePath(paths, generationPaths.rollbackDbPath) : null,
            parentLiveAuthority,
            fullAuthorityHash: fullAuthorityState.canonicalAuthorityHash,
            now,
        });

        writeOperationalStateMarkerDescriptor(paths, {
            promotionJournal: pendingPromotionState,
        }, now);

        writeOperationalStateMarkerDescriptor(paths, {
            liveAuthority: {
                generationId: nextGenerationId,
                dbRelativePath: toRelativeStoragePath(paths, generationPaths.stagedDbPath),
                authorityHash: fullAuthorityState.canonicalAuthorityHash,
                parentGenerationId: authorization.expectedLiveState.generationId,
                promotedMemoryScopeId: authorization.memoryScopeId,
                candidateArtifactId: authorization.candidateArtifactId,
                authorizationId,
                createdAt: now,
            },
            promotionJournal: {
                ...pendingPromotionState,
                lastState: 'VERIFYING',
                updatedAt: now,
            },
        }, now);

        const activeAdapter = openOperationalDatabase(paths, { now });
        try {
            snapshotOperationalDatabase(activeAdapter, paths);
        } finally {
            activeAdapter.close();
        }

        const verifiedLive = readLiveAuthorityStateReadOnly(userRoot, authorization.memoryScopeId);
        if (!verifiedLive.ok || verifiedLive.generationIdentity !== nextGenerationId) {
            throw createError(500, 'Post-promotion live verification failed', 'ARCH_PROMOTION_POST_VERIFY_FAILED');
        }
        if (verifiedLive.canonicalAuthorityHash !== stagedTargetScope.canonicalAuthorityHash) {
            throw createError(500, 'Post-promotion target scope hash drifted after pointer flip', 'ARCH_PROMOTION_POST_TARGET_HASH_DRIFT');
        }

        appendPromotionJournal(paths, {
            type: 'PROMOTION_COMMITTED',
            promotionId,
            authorizationId,
            memoryScopeId: authorization.memoryScopeId,
            generationId: nextGenerationId,
            parentGenerationId: authorization.expectedLiveState.generationId,
            fullAuthorityHash: fullAuthorityState.canonicalAuthorityHash,
            committedAt: now,
        });
        writeOperationalStateMarkerDescriptor(paths, {
            promotionJournal: {
                ...pendingPromotionState,
                lastState: 'COMMITTED',
                updatedAt: now,
            },
        }, now);

        authorization.status = 'CONSUMED';
        authorization.consumedAt = now;
        authorization.promotionId = promotionId;
        saveAuthorization(paths, authorization);

        return {
            ok: true,
            promotionAvailable: true,
            authorizationId,
            promotionId,
            generation: generationManifest,
            verification: {
                targetScopeHash: stagedTargetScope.canonicalAuthorityHash,
                candidateScopeHash: candidateTargetScope.canonicalAuthorityHash,
                nonTargetAggregateHash: stagedNonTargetAggregate.canonicalAuthorityHash,
                fullAuthorityHash: fullAuthorityState.canonicalAuthorityHash,
            },
        };
    } finally {
        releaseGlobalPromotionLock(paths);
    }
}
