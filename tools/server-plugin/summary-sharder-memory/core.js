import crypto from 'node:crypto';

export const PLUGIN_ID = 'summary-sharder-memory';
export const PROTOTYPE_VERSION = '1B0';
export const ARTIFACT_KIND = 'architectural-authority-journal';
export const ARTIFACT_SCHEMA_VERSION = 1;
export const RECEIPT_SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'SHA-256';

export function createId(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function stableStringify(value) {
    return JSON.stringify(sortValue(value));
}

function sortValue(value) {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }

    if (value && typeof value === 'object') {
        const output = {};
        for (const key of Object.keys(value).sort()) {
            output[key] = sortValue(value[key]);
        }
        return output;
    }

    return value;
}

export function sha256Text(text) {
    return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

export function computeRevisionHash(text) {
    return sha256Text(String(text ?? ''));
}

export function computeCanonicalHash(record) {
    return sha256Text(stableStringify(record));
}

export function buildPrototypeMetadata(extra = {}) {
    return {
        prototypeVersion: PROTOTYPE_VERSION,
        ...extra,
    };
}

export function buildAnchorArtifactHeader(memoryScopeId, createdAt = Date.now()) {
    const artifact = {
        kind: ARTIFACT_KIND,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        prototypeVersion: PROTOTYPE_VERSION,
        memoryScopeId,
        createdAt,
    };

    return {
        name: 'Summary Sharder System',
        is_user: false,
        is_system: true,
        send_date: new Date(createdAt).toISOString(),
        mes: '',
        extra: {
            summarySharderArtifact: artifact,
            summarySharderPrototype: buildPrototypeMetadata({
                hiddenArtifact: true,
            }),
        },
        chat_metadata: {
            summarySharderPrototype: {
                artifact,
            },
        },
        user_name: 'Summary Sharder',
        character_name: 'Summary Sharder System',
    };
}

export function getAnchorArtifactFromHeader(header) {
    const fromMetadata = header?.chat_metadata?.summarySharderPrototype?.artifact;
    const fromExtra = header?.extra?.summarySharderArtifact;
    return fromMetadata ?? fromExtra ?? null;
}

export function validateAnchorArtifact(artifact, expectedScopeId = null) {
    if (!artifact || typeof artifact !== 'object') {
        return { valid: false, reason: 'missing-artifact-header' };
    }

    if (artifact.kind !== ARTIFACT_KIND) {
        return { valid: false, reason: 'invalid-kind' };
    }

    if (artifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
        return { valid: false, reason: 'invalid-schema-version' };
    }

    if (artifact.prototypeVersion !== PROTOTYPE_VERSION) {
        return { valid: false, reason: 'invalid-prototype-version' };
    }

    if (typeof artifact.memoryScopeId !== 'string' || !artifact.memoryScopeId) {
        return { valid: false, reason: 'missing-memory-scope-id' };
    }

    if (expectedScopeId && artifact.memoryScopeId !== expectedScopeId) {
        return { valid: false, reason: 'memory-scope-mismatch' };
    }

    return { valid: true, reason: null };
}

export function buildAnchorEvent({
    memoryScopeId,
    decisionId,
    expectedHead,
    priorJournalHash,
    canonicalRecord,
    originChatInstanceId,
    originShardId = null,
    sourceRefs = [],
    sequence,
    createdAt = Date.now(),
    eventId = createId('evt'),
}) {
    const canonicalHash = computeCanonicalHash(canonicalRecord);
    const payload = {
        eventId,
        sequence,
        memoryScopeId,
        decisionId,
        expectedHead,
        priorJournalHash,
        canonicalHash,
        canonicalHashVersion: 1,
        hashAlgorithm: HASH_ALGORITHM,
        payload: {
            recordType: 'prototype-decision-event',
            recordVersion: 1,
            canonicalRecord,
        },
        originChatInstanceId,
        originShardId,
        sourceRefs,
        createdAt,
    };
    const eventHash = sha256Text(stableStringify(payload));

    return {
        name: 'Summary Sharder System',
        is_user: false,
        is_system: true,
        send_date: new Date(createdAt).toISOString(),
        mes: '',
        extra: {
            summarySharderEvent: {
                ...payload,
                eventHash,
            },
            summarySharderPrototype: buildPrototypeMetadata({
                hiddenArtifact: true,
            }),
        },
    };
}

export function getAnchorEvent(line) {
    return line?.extra?.summarySharderEvent ?? null;
}

export function buildReceipt({
    event,
    originChatInstanceId,
    originShardId = null,
    createdAt = Date.now(),
}) {
    return {
        receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
        prototypeVersion: PROTOTYPE_VERSION,
        eventId: event.eventId,
        sequence: event.sequence,
        memoryScopeId: event.memoryScopeId,
        decisionId: event.decisionId,
        expectedHead: event.expectedHead,
        canonicalHash: event.canonicalHash,
        canonicalHashVersion: event.canonicalHashVersion,
        hashAlgorithm: event.hashAlgorithm,
        originChatInstanceId,
        originShardId,
        canonicalRecord: event.payload?.canonicalRecord ?? {},
        createdAt,
    };
}

export function buildHiddenReceiptRecord(receipt, createdAt = Date.now()) {
    return {
        name: 'Summary Sharder System',
        is_user: false,
        is_system: true,
        send_date: new Date(createdAt).toISOString(),
        mes: '',
        extra: {
            summarySharderReceipt: receipt,
            summarySharderPrototype: buildPrototypeMetadata({
                hiddenReceipt: true,
            }),
        },
    };
}

export function getHiddenReceiptRecord(message) {
    return message?.extra?.summarySharderReceipt ?? null;
}

export function ensureRuntimeMetadata(chatMetadata, defaults = {}) {
    const next = chatMetadata && typeof chatMetadata === 'object' ? { ...chatMetadata } : {};
    const current = next.summarySharderRuntime && typeof next.summarySharderRuntime === 'object'
        ? { ...next.summarySharderRuntime }
        : {};

    next.summarySharderRuntime = {
        prototypeVersion: PROTOTYPE_VERSION,
        ...defaults,
        ...current,
    };

    return next;
}

export function collectMetadataReceipts(chatMetadata, memoryScopeId = null) {
    const receipts = Array.isArray(chatMetadata?.summarySharderPrototypeReceipts)
        ? chatMetadata.summarySharderPrototypeReceipts
        : [];

    return receipts.filter(receipt => !memoryScopeId || receipt?.memoryScopeId === memoryScopeId);
}

export function appendMetadataReceipt(chatMetadata, receipt) {
    const next = chatMetadata && typeof chatMetadata === 'object' ? { ...chatMetadata } : {};
    const receipts = Array.isArray(next.summarySharderPrototypeReceipts)
        ? [...next.summarySharderPrototypeReceipts]
        : [];

    if (!receipts.some(existing => existing?.eventId === receipt.eventId)) {
        receipts.push(receipt);
    }

    next.summarySharderPrototypeReceipts = receipts;
    return next;
}

export function detectDuplicateChatInstanceIds(entries) {
    const seen = new Map();
    const duplicates = [];

    for (const entry of entries) {
        const chatInstanceId = entry?.chatInstanceId;
        if (!chatInstanceId) {
            continue;
        }

        if (seen.has(chatInstanceId)) {
            duplicates.push({
                chatInstanceId,
                first: seen.get(chatInstanceId),
                second: entry,
            });
            continue;
        }

        seen.set(chatInstanceId, entry);
    }

    return duplicates;
}

export function classifyReplay(anchorEvents, receiptRecords) {
    const sortedAnchor = [...anchorEvents].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const coverage = {
        anchorEventCount: sortedAnchor.length,
        uniqueReceiptEventCount: 0,
        duplicateReceiptCount: 0,
        missingEventIds: [],
        versionGaps: [],
        competingChildren: [],
        unavailableOriginChats: [],
        finalReconstructedHead: null,
        finalReconstructedHash: null,
        classification: 'invalid',
    };

    const receiptsByEventId = new Map();
    const receiptsByExpectedHead = new Map();
    for (const receipt of receiptRecords) {
        const bucket = receiptsByEventId.get(receipt.eventId) ?? [];
        bucket.push(receipt);
        receiptsByEventId.set(receipt.eventId, bucket);

        const headKey = receipt.expectedHead ?? '__root__';
        const headBucket = receiptsByExpectedHead.get(headKey) ?? [];
        headBucket.push(receipt);
        receiptsByExpectedHead.set(headKey, headBucket);
    }

    coverage.uniqueReceiptEventCount = receiptsByEventId.size;
    for (const bucket of receiptsByEventId.values()) {
        if (bucket.length > 1) {
            coverage.duplicateReceiptCount += bucket.length - 1;
        }
    }

    for (const [expectedHead, bucket] of receiptsByExpectedHead.entries()) {
        const childIds = [...new Set(bucket.map(receipt => receipt.eventId))];
        if (childIds.length > 1) {
            coverage.competingChildren.push({
                expectedHead: expectedHead === '__root__' ? null : expectedHead,
                eventIds: childIds,
            });
        }
    }

    if (sortedAnchor.length === 0) {
        coverage.classification = coverage.uniqueReceiptEventCount > 0 ? 'incomplete' : 'invalid';
        return coverage;
    }

    let previousSequence = 0;
    let previousEventHash = null;

    for (const event of sortedAnchor) {
        if (typeof event.sequence !== 'number') {
            coverage.classification = 'invalid';
            return coverage;
        }

        if (event.sequence !== previousSequence + 1) {
            coverage.versionGaps.push({
                expectedSequence: previousSequence + 1,
                actualSequence: event.sequence,
            });
        }

        previousSequence = event.sequence;
        previousEventHash = event.eventHash ?? previousEventHash;

        const matchingReceipts = receiptsByEventId.get(event.eventId) ?? [];
        if (matchingReceipts.length === 0) {
            coverage.missingEventIds.push(event.eventId);
            continue;
        }

        const canonicalHashes = new Set(matchingReceipts.map(receipt => receipt.canonicalHash));
        if (canonicalHashes.size > 1) {
            coverage.competingChildren.push({
                eventId: event.eventId,
                canonicalHashes: [...canonicalHashes],
            });
        }
    }

    coverage.finalReconstructedHead = previousEventHash;
    coverage.finalReconstructedHash = previousEventHash;

    if (coverage.competingChildren.length > 0) {
        coverage.classification = 'conflicted';
        return coverage;
    }

    if (coverage.versionGaps.length > 0 || coverage.missingEventIds.length > 0) {
        coverage.classification = 'incomplete';
        return coverage;
    }

    coverage.classification = 'exact';
    return coverage;
}
