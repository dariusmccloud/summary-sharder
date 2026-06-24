import { isArchivedMessage } from '../chat/archive-policy.js';
import { buildCorpusRevisionHash } from './message-identity-core.js';

export const SHARD_MANIFEST_SCHEMA_VERSION = 2;
export const SHARD_INTEGRITY_REPORT_SCHEMA_VERSION = 2;
export const SHARD_PROMPT_WARNING_TOKENS = 1500;

export const SHARD_ARTIFACT_KINDS = Object.freeze({
    SYSTEM_SHARD: 'system-shard',
    SYSTEM_SUMMARY: 'system-summary',
    LOREBOOK_SUMMARY: 'lorebook-summary',
});

export const SHARD_CONTENT_HEALTH_VALUES = Object.freeze({
    INTACT: 'INTACT',
    STALE: 'STALE',
    DEGRADED: 'DEGRADED',
    ORPHANED: 'ORPHANED',
    CONFLICTED: 'CONFLICTED',
});

export const SHARD_EXPOSURE_HEALTH_VALUES = Object.freeze({
    EXPOSURE_OK: 'EXPOSURE_OK',
    SOURCE_AND_ARTIFACT_VISIBLE: 'SOURCE_AND_ARTIFACT_VISIBLE',
    SOURCE_VISIBLE_ARTIFACT_HIDDEN: 'SOURCE_VISIBLE_ARTIFACT_HIDDEN',
    SOURCE_HIDDEN_ARTIFACT_HIDDEN: 'SOURCE_HIDDEN_ARTIFACT_HIDDEN',
    VISIBILITY_POLICY_UNKNOWN: 'VISIBILITY_POLICY_UNKNOWN',
});

export const SHARD_PROMPT_POLICY_VALUES = Object.freeze({
    REPLACE_SOURCE: 'replace_source',
    SUPPLEMENT_SOURCE: 'supplement_source',
    DISPLAY_ONLY: 'display_only',
    UNKNOWN_LEGACY: 'unknown_legacy',
});

export const SHARD_SOURCE_SELECTOR_MODES = Object.freeze({
    CONTIGUOUS_INTERVAL: 'contiguous_interval',
    MESSAGE_ID_LIST: 'message_id_list',
});

const MANAGED_OUTPUT_WRAPPER_REGEX = /^\[(MEMORY SHARD|SUMMARY):\s*Messages\s*(\d+)\s*[-–]\s*(\d+)\]\s*\n\n/iu;
const MESSAGE_ID_REGEX = /^msg_[0-9a-f]{32}$/u;

function trimString(value) {
    return String(value || '').trim();
}

function normalizeText(value) {
    return String(value || '').replace(/\r\n?/gu, '\n');
}

function stableStringify(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function deepEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
}

function sanitizeMessageId(value) {
    const raw = trimString(value).toLowerCase();
    return MESSAGE_ID_REGEX.test(raw) ? raw : '';
}

function sanitizePromptPolicy(value, fallback = SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY) {
    const normalized = trimString(value).toLowerCase();
    return Object.values(SHARD_PROMPT_POLICY_VALUES).includes(normalized) ? normalized : fallback;
}

function estimateTokenCount(text) {
    const words = trimString(text).split(/\s+/u).filter(Boolean).length;
    return words > 0 ? Math.round(words * 1.3) : 0;
}

function getMessageIdentity(message) {
    return message?.extra?.summary_sharder?.messageIdentity || null;
}

function isPromptVisible(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }
    return message?.is_system !== true && !isArchivedMessage(message);
}

function pushDiagnostic(diagnostics, diagnostic) {
    diagnostics.push({
        level: diagnostic.level || 'warning',
        ...diagnostic,
    });
}

function buildManifestId(outputUID, artifactKind, startIndex, endIndex) {
    const outputKey = trimString(outputUID);
    if (outputKey) {
        return `manifest:${artifactKind}:${outputKey}`;
    }
    return `manifest:${artifactKind}:${startIndex}-${endIndex}`;
}

function resolveArtifactKind(tag) {
    return String(tag || '').toUpperCase() === 'MEMORY SHARD'
        ? SHARD_ARTIFACT_KINDS.SYSTEM_SHARD
        : SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY;
}

function getSourceSlice(messages, startIndex, endIndex) {
    if (!Array.isArray(messages) || startIndex < 0 || endIndex < startIndex || startIndex >= messages.length) {
        return [];
    }
    return messages.slice(startIndex, Math.min(endIndex + 1, messages.length));
}

async function sha256Hex(text, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle) {
        throw new Error('Web Crypto API is unavailable for shard integrity hashing.');
    }
    const buffer = new TextEncoder().encode(String(text || ''));
    const digest = await cryptoApi.subtle.digest('SHA-256', buffer);
    const hex = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    return `sha256:${hex}`;
}

async function buildSourceIdentityHashFromIds(messageIds, options = {}) {
    return await sha256Hex(stableStringify({
        version: 'sourceIdentityHashV1',
        messageIds: Array.isArray(messageIds) ? messageIds : [],
    }), options.cryptoApi);
}

function getResolvedMessageId(message) {
    return sanitizeMessageId(getMessageIdentity(message)?.messageId);
}

function buildContiguousSelector(messageIds) {
    return {
        mode: SHARD_SOURCE_SELECTOR_MODES.CONTIGUOUS_INTERVAL,
        startMessageId: messageIds[0],
        endMessageId: messageIds[messageIds.length - 1],
        sourceCount: messageIds.length,
    };
}

function buildListSelector(messageIds) {
    return {
        mode: SHARD_SOURCE_SELECTOR_MODES.MESSAGE_ID_LIST,
        sourceMessageIds: messageIds,
        sourceCount: messageIds.length,
    };
}

function normalizeSourceSelector(manifest) {
    const selector = manifest?.sourceSelector;
    if (selector && typeof selector === 'object') {
        const mode = trimString(selector.mode).toLowerCase();
        if (mode === SHARD_SOURCE_SELECTOR_MODES.CONTIGUOUS_INTERVAL) {
            const startMessageId = sanitizeMessageId(selector.startMessageId);
            const endMessageId = sanitizeMessageId(selector.endMessageId);
            const sourceCount = Number.parseInt(selector.sourceCount, 10);
            if (startMessageId && endMessageId && Number.isInteger(sourceCount) && sourceCount > 0) {
                return {
                    mode,
                    startMessageId,
                    endMessageId,
                    sourceCount,
                };
            }
        }

        if (mode === SHARD_SOURCE_SELECTOR_MODES.MESSAGE_ID_LIST) {
            const sourceMessageIds = Array.isArray(selector.sourceMessageIds)
                ? selector.sourceMessageIds.map((value) => sanitizeMessageId(value)).filter(Boolean)
                : [];
            const sourceCount = Number.parseInt(selector.sourceCount, 10);
            if (sourceMessageIds.length > 0 && Number.isInteger(sourceCount) && sourceCount === sourceMessageIds.length) {
                return {
                    mode,
                    sourceMessageIds,
                    sourceCount,
                };
            }
        }
    }

    const legacyIds = Array.isArray(manifest?.sourceMessageIds)
        ? manifest.sourceMessageIds.map((value) => sanitizeMessageId(value)).filter(Boolean)
        : [];
    if (legacyIds.length === 0) {
        return null;
    }

    const sourceStart = Number.parseInt(manifest?.sourceStartPositionAtCreation, 10);
    const sourceEnd = Number.parseInt(manifest?.sourceEndPositionAtCreation, 10);
    const isContiguousRange = Number.isInteger(sourceStart)
        && Number.isInteger(sourceEnd)
        && sourceEnd >= sourceStart
        && ((sourceEnd - sourceStart) + 1) === legacyIds.length;

    return isContiguousRange ? buildContiguousSelector(legacyIds) : buildListSelector(legacyIds);
}

function resolveSourceEntries(messages, selector) {
    const messageIndexById = new Map();
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        const identity = getMessageIdentity(message);
        const messageId = sanitizeMessageId(identity?.messageId);
        if (messageId && !messageIndexById.has(messageId)) {
            messageIndexById.set(messageId, {
                index,
                message,
                revisionHash: trimString(identity?.revisionHash),
            });
        }
    }

    if (!selector) {
        return {
            entries: [],
            missingMessageIds: [],
            selectorMode: null,
            currentStartPosition: null,
            currentEndPosition: null,
            resolvedSourceCount: 0,
            sequenceMessageIds: [],
        };
    }

    if (selector.mode === SHARD_SOURCE_SELECTOR_MODES.MESSAGE_ID_LIST) {
        const entries = [];
        const missingMessageIds = [];

        for (const messageId of selector.sourceMessageIds) {
            const entry = messageIndexById.get(messageId);
            if (!entry) {
                missingMessageIds.push(messageId);
            } else {
                entries.push(entry);
            }
        }

        const positions = entries.map((entry) => entry.index);
        return {
            entries,
            missingMessageIds,
            selectorMode: selector.mode,
            currentStartPosition: positions.length > 0 ? positions[0] : null,
            currentEndPosition: positions.length > 0 ? positions[positions.length - 1] : null,
            resolvedSourceCount: entries.length,
            sequenceMessageIds: entries.map((entry) => getResolvedMessageId(entry.message)).filter(Boolean),
        };
    }

    const startEntry = messageIndexById.get(selector.startMessageId);
    const endEntry = messageIndexById.get(selector.endMessageId);
    const missingMessageIds = [];
    if (!startEntry) missingMessageIds.push(selector.startMessageId);
    if (!endEntry && selector.endMessageId !== selector.startMessageId) missingMessageIds.push(selector.endMessageId);

    if (!startEntry || !endEntry || endEntry.index < startEntry.index) {
        return {
            entries: [],
            missingMessageIds,
            selectorMode: selector.mode,
            currentStartPosition: startEntry?.index ?? null,
            currentEndPosition: endEntry?.index ?? null,
            resolvedSourceCount: 0,
            sequenceMessageIds: [],
        };
    }

    const entries = [];
    for (let index = startEntry.index; index <= endEntry.index; index++) {
        const message = messages[index];
        const identity = getMessageIdentity(message);
        entries.push({
            index,
            message,
            revisionHash: trimString(identity?.revisionHash),
        });
    }

    return {
        entries,
        missingMessageIds,
        selectorMode: selector.mode,
        currentStartPosition: startEntry.index,
        currentEndPosition: endEntry.index,
        resolvedSourceCount: entries.length,
        sequenceMessageIds: entries.map((entry) => getResolvedMessageId(entry.message)).filter(Boolean),
    };
}

function determineExposureHealth(promptPolicy, outputPromptVisible, sourcePromptVisibleCount) {
    const policy = sanitizePromptPolicy(promptPolicy);
    if (policy === SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY) {
        return SHARD_EXPOSURE_HEALTH_VALUES.VISIBILITY_POLICY_UNKNOWN;
    }

    if (!outputPromptVisible && sourcePromptVisibleCount === 0) {
        return SHARD_EXPOSURE_HEALTH_VALUES.SOURCE_HIDDEN_ARTIFACT_HIDDEN;
    }

    if (!outputPromptVisible && sourcePromptVisibleCount > 0) {
        return SHARD_EXPOSURE_HEALTH_VALUES.SOURCE_VISIBLE_ARTIFACT_HIDDEN;
    }

    if (policy === SHARD_PROMPT_POLICY_VALUES.REPLACE_SOURCE && sourcePromptVisibleCount > 0) {
        return SHARD_EXPOSURE_HEALTH_VALUES.SOURCE_AND_ARTIFACT_VISIBLE;
    }

    return SHARD_EXPOSURE_HEALTH_VALUES.EXPOSURE_OK;
}

function buildValidationDigest(report) {
    return stableStringify({
        contentCounts: report.contentCounts,
        exposureCounts: report.exposureCounts,
        diagnosticCount: report.diagnostics.length,
        entryCount: report.entries.length,
    });
}

export function parseManagedOutputWrapper(text) {
    const match = normalizeText(text).match(MANAGED_OUTPUT_WRAPPER_REGEX);
    if (!match) {
        return null;
    }
    return {
        tag: String(match[1] || '').toUpperCase(),
        artifactKind: resolveArtifactKind(match[1]),
        startIndex: parseInt(match[2], 10),
        endIndex: parseInt(match[3], 10),
    };
}

export async function buildShardCoverageHash(messages, options = {}) {
    return await buildCorpusRevisionHash(messages, options);
}

export async function buildManagedShardManifest(messages, options = {}) {
    const startIndex = Number.parseInt(options.startIndex, 10);
    const endIndex = Number.parseInt(options.endIndex, 10);
    const artifactKind = trimString(options.artifactKind) || SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY;
    const sourceMessages = getSourceSlice(messages, startIndex, endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex || sourceMessages.length === 0) {
        return null;
    }

    const sourceMessageIds = [];
    for (const message of sourceMessages) {
        const identity = getMessageIdentity(message);
        const messageId = sanitizeMessageId(identity?.messageId);
        const revisionHash = trimString(identity?.revisionHash);
        if (!messageId || !revisionHash) {
            return null;
        }
        sourceMessageIds.push(messageId);
    }

    return {
        schemaVersion: SHARD_MANIFEST_SCHEMA_VERSION,
        manifestId: buildManifestId(options.outputUID, artifactKind, startIndex, endIndex),
        artifactKind,
        outputUID: trimString(options.outputUID) || null,
        sourceStartPositionAtCreation: startIndex,
        sourceEndPositionAtCreation: endIndex,
        sourceSelector: buildContiguousSelector(sourceMessageIds),
        sourceIdentityHash: await buildSourceIdentityHashFromIds(sourceMessageIds, options),
        sourceRevisionHash: await buildShardCoverageHash(sourceMessages, options),
        promptPolicy: sanitizePromptPolicy(options.promptPolicy, SHARD_PROMPT_POLICY_VALUES.REPLACE_SOURCE),
        createdAt: Number.isFinite(options.now) ? options.now : Date.now(),
    };
}

export async function buildBackfilledManifestFromOutputMessage(messages, outputMessage, options = {}) {
    const wrapper = parseManagedOutputWrapper(outputMessage?.mes);
    if (!wrapper) {
        return null;
    }

    return await buildManagedShardManifest(messages, {
        startIndex: wrapper.startIndex,
        endIndex: wrapper.endIndex,
        artifactKind: wrapper.artifactKind,
        outputUID: outputMessage?.send_date || null,
        promptPolicy: options.promptPolicy || SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY,
        now: options.now,
        cryptoApi: options.cryptoApi,
    });
}

export function normalizeShardManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        return null;
    }

    const sourceStart = Number.parseInt(manifest.sourceStartPositionAtCreation, 10);
    const sourceEnd = Number.parseInt(manifest.sourceEndPositionAtCreation, 10);
    const artifactKind = trimString(manifest.artifactKind);
    const sourceSelector = normalizeSourceSelector(manifest);

    if (!artifactKind || !sourceSelector) {
        return null;
    }

    return {
        schemaVersion: SHARD_MANIFEST_SCHEMA_VERSION,
        manifestId: trimString(manifest.manifestId) || buildManifestId(manifest.outputUID, artifactKind, sourceStart, sourceEnd),
        artifactKind,
        outputUID: trimString(manifest.outputUID) || null,
        sourceStartPositionAtCreation: Number.isInteger(sourceStart) ? sourceStart : null,
        sourceEndPositionAtCreation: Number.isInteger(sourceEnd) ? sourceEnd : null,
        sourceSelector,
        sourceIdentityHash: trimString(manifest.sourceIdentityHash),
        sourceRevisionHash: trimString(manifest.sourceRevisionHash || manifest.sourceCoverageHash),
        promptPolicy: sanitizePromptPolicy(
            manifest.promptPolicy,
            trimString(manifest.promptPolicy)
                ? SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY
                : SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY
        ),
        createdAt: Number.isFinite(manifest.createdAt) ? manifest.createdAt : Date.now(),
    };
}

export async function validateShardManifest(manifest, messages = [], options = {}) {
    const normalized = normalizeShardManifest(manifest);
    if (!normalized) {
        return {
            manifestId: trimString(manifest?.manifestId) || '',
            artifactKind: trimString(manifest?.artifactKind) || '',
            outputUID: trimString(manifest?.outputUID) || null,
            contentHealth: SHARD_CONTENT_HEALTH_VALUES.CONFLICTED,
            exposureHealth: SHARD_EXPOSURE_HEALTH_VALUES.VISIBILITY_POLICY_UNKNOWN,
            promptPolicy: SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY,
            diagnostics: [{
                level: 'error',
                code: 'SHARD_MANIFEST_INVALID',
                message: 'Shard manifest is malformed or incomplete.',
            }],
            promptExposure: {
                outputPromptVisible: false,
                sourcePromptVisibleCount: 0,
                duplicatedPromptTokenEstimate: 0,
                estimateKind: 'word_ratio_estimate',
            },
            sourceSummary: {
                selectorMode: null,
                sourceCount: 0,
                currentStartPosition: null,
                currentEndPosition: null,
                creationStartPosition: null,
                creationEndPosition: null,
            },
        };
    }

    const diagnostics = [];
    const resolved = resolveSourceEntries(messages, normalized.sourceSelector);
    const sourceEntries = resolved.entries;
    const sourceMessages = sourceEntries.map((entry) => entry.message);
    const sourcePromptVisibleCount = sourceEntries.filter((entry) => isPromptVisible(entry.message)).length;

    const outputMessage = normalized.artifactKind === SHARD_ARTIFACT_KINDS.SYSTEM_SHARD
        || normalized.artifactKind === SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY
        ? messages.find((message) => trimString(message?.send_date) === normalized.outputUID)
        : null;

    if ((normalized.artifactKind === SHARD_ARTIFACT_KINDS.SYSTEM_SHARD
            || normalized.artifactKind === SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY)
        && !outputMessage) {
        pushDiagnostic(diagnostics, {
            level: 'error',
            code: 'SHARD_ORPHANED',
            message: 'Managed shard output is missing from the current chat.',
        });
    }

    if (resolved.missingMessageIds.length > 0) {
        pushDiagnostic(diagnostics, {
            level: sourceEntries.length === 0 ? 'error' : 'warning',
            code: 'MESSAGE_SOURCE_MISSING',
            message: sourceEntries.length === 0
                ? 'All recorded shard source messages are missing from the current chat.'
                : `Shard source coverage is missing ${resolved.missingMessageIds.length} recorded boundary or source message(s).`,
            missingMessageIds: resolved.missingMessageIds,
        });
    }

    const outputPromptVisible = isPromptVisible(outputMessage);
    const duplicatedPromptTokenEstimate = outputPromptVisible && sourcePromptVisibleCount > 0
        ? sourceEntries.reduce((sum, entry) => sum + estimateTokenCount(entry.message?.mes), 0) + estimateTokenCount(outputMessage?.mes)
        : 0;

    if (sourceEntries.length > 0) {
        if (normalized.sourceSelector.mode === SHARD_SOURCE_SELECTOR_MODES.CONTIGUOUS_INTERVAL
            && resolved.resolvedSourceCount !== normalized.sourceSelector.sourceCount) {
            pushDiagnostic(diagnostics, {
                code: 'SHARD_POSITIONAL_RANGE_DRIFT',
                message: 'Shard source boundaries still resolve, but the current contiguous interval no longer matches the recorded source count.',
                currentStartPosition: resolved.currentStartPosition,
                currentEndPosition: resolved.currentEndPosition,
                currentSourceCount: resolved.resolvedSourceCount,
                recordedSourceCount: normalized.sourceSelector.sourceCount,
            });
        }

        const currentIdentityHash = await buildSourceIdentityHashFromIds(resolved.sequenceMessageIds, options);
        if (normalized.sourceIdentityHash && currentIdentityHash !== normalized.sourceIdentityHash) {
            pushDiagnostic(diagnostics, {
                code: 'SHARD_SOURCE_IDENTITY_MISMATCH',
                message: 'Shard source identities within the recorded coverage no longer match the original source set.',
                currentHash: currentIdentityHash,
                recordedHash: normalized.sourceIdentityHash,
            });
        }

        const currentRevisionHash = await buildShardCoverageHash(sourceMessages, options);
        if (normalized.sourceRevisionHash && currentRevisionHash !== normalized.sourceRevisionHash) {
            pushDiagnostic(diagnostics, {
                code: 'SHARD_SOURCE_HASH_MISMATCH',
                message: 'Shard source messages still resolve, but their current revision state no longer matches the recorded source revision hash.',
                currentHash: currentRevisionHash,
                recordedHash: normalized.sourceRevisionHash,
            });
        }
    }

    if (outputMessage) {
        const wrapper = parseManagedOutputWrapper(outputMessage?.mes);
        if (wrapper
            && normalized.sourceStartPositionAtCreation !== null
            && normalized.sourceEndPositionAtCreation !== null
            && (wrapper.startIndex !== normalized.sourceStartPositionAtCreation
                || wrapper.endIndex !== normalized.sourceEndPositionAtCreation)) {
            pushDiagnostic(diagnostics, {
                code: 'SHARD_LABEL_RANGE_MISMATCH',
                message: 'Shard output label no longer matches the recorded source range at creation.',
                labelStartPosition: wrapper.startIndex,
                labelEndPosition: wrapper.endIndex,
            });
        }
    }

    const exposureHealth = determineExposureHealth(normalized.promptPolicy, outputPromptVisible, sourcePromptVisibleCount);
    if (normalized.promptPolicy === SHARD_PROMPT_POLICY_VALUES.UNKNOWN_LEGACY) {
        pushDiagnostic(diagnostics, {
            code: 'VISIBILITY_POLICY_UNKNOWN',
            message: 'Legacy shard visibility policy could not be proven from the saved artifact alone.',
        });
    } else if (normalized.promptPolicy === SHARD_PROMPT_POLICY_VALUES.REPLACE_SOURCE
        && outputPromptVisible
        && sourcePromptVisibleCount > 0) {
        pushDiagnostic(diagnostics, {
            code: 'DOUBLE_CONTEXT_INCLUSION',
            message: 'The shard output is marked replace_source, but one or more covered source messages remain prompt-visible.',
            sourcePromptVisibleCount,
        });
    }

    if (duplicatedPromptTokenEstimate >= SHARD_PROMPT_WARNING_TOKENS) {
        pushDiagnostic(diagnostics, {
            code: 'PROMPT_SIZE_ESTIMATED_WARNING',
            message: 'Estimated duplicated prompt load is high. This is a token estimate, not a tokenizer-confirmed hard limit.',
            estimatedTokens: duplicatedPromptTokenEstimate,
            threshold: SHARD_PROMPT_WARNING_TOKENS,
            estimateKind: 'word_ratio_estimate',
        });
    }

    let contentHealth = SHARD_CONTENT_HEALTH_VALUES.INTACT;
    const codes = new Set(diagnostics.map((entry) => entry.code));
    if (codes.has('SHARD_MANIFEST_INVALID')) {
        contentHealth = SHARD_CONTENT_HEALTH_VALUES.CONFLICTED;
    } else if (codes.has('SHARD_ORPHANED')
        || (codes.has('MESSAGE_SOURCE_MISSING')
            && sourceEntries.length === 0
            && resolved.currentStartPosition === null
            && resolved.currentEndPosition === null)) {
        contentHealth = SHARD_CONTENT_HEALTH_VALUES.ORPHANED;
    } else if (codes.has('MESSAGE_SOURCE_MISSING')) {
        contentHealth = SHARD_CONTENT_HEALTH_VALUES.DEGRADED;
    } else if (codes.has('SHARD_SOURCE_HASH_MISMATCH')
        || codes.has('SHARD_SOURCE_IDENTITY_MISMATCH')
        || codes.has('SHARD_POSITIONAL_RANGE_DRIFT')
        || codes.has('SHARD_LABEL_RANGE_MISMATCH')) {
        contentHealth = SHARD_CONTENT_HEALTH_VALUES.STALE;
    }

    return {
        manifestId: normalized.manifestId,
        artifactKind: normalized.artifactKind,
        outputUID: normalized.outputUID,
        contentHealth,
        exposureHealth,
        promptPolicy: normalized.promptPolicy,
        diagnostics,
        sourceSummary: {
            selectorMode: resolved.selectorMode,
            sourceCount: normalized.sourceSelector.sourceCount,
            currentStartPosition: resolved.currentStartPosition,
            currentEndPosition: resolved.currentEndPosition,
            creationStartPosition: normalized.sourceStartPositionAtCreation,
            creationEndPosition: normalized.sourceEndPositionAtCreation,
            resolvedSourceCount: resolved.resolvedSourceCount,
        },
        promptExposure: {
            outputPromptVisible,
            sourcePromptVisibleCount,
            duplicatedPromptTokenEstimate,
            estimateKind: 'word_ratio_estimate',
        },
    };
}

export async function validateShardManifestSet(manifests = [], messages = [], options = {}) {
    const results = [];
    const diagnostics = [];
    const contentCounts = Object.fromEntries(Object.values(SHARD_CONTENT_HEALTH_VALUES).map((value) => [value, 0]));
    const exposureCounts = Object.fromEntries(Object.values(SHARD_EXPOSURE_HEALTH_VALUES).map((value) => [value, 0]));
    const seenManifestIds = new Set();

    for (const manifest of manifests) {
        const normalized = normalizeShardManifest(manifest);
        if (!normalized) {
            const invalid = await validateShardManifest(manifest, messages, options);
            results.push(invalid);
            invalid.diagnostics.forEach((entry) => diagnostics.push({
                ...entry,
                manifestId: invalid.manifestId,
                artifactKind: invalid.artifactKind,
                outputUID: invalid.outputUID,
            }));
            contentCounts[invalid.contentHealth] = (contentCounts[invalid.contentHealth] || 0) + 1;
            exposureCounts[invalid.exposureHealth] = (exposureCounts[invalid.exposureHealth] || 0) + 1;
            continue;
        }

        if (seenManifestIds.has(normalized.manifestId)) {
            const conflict = {
                manifestId: normalized.manifestId,
                artifactKind: normalized.artifactKind,
                outputUID: normalized.outputUID,
                contentHealth: SHARD_CONTENT_HEALTH_VALUES.CONFLICTED,
                exposureHealth: SHARD_EXPOSURE_HEALTH_VALUES.VISIBILITY_POLICY_UNKNOWN,
                promptPolicy: normalized.promptPolicy,
                diagnostics: [{
                    level: 'error',
                    code: 'SHARD_MANIFEST_DUPLICATE',
                    message: 'Two shard manifests share the same manifest identity.',
                }],
                sourceSummary: {
                    selectorMode: normalized.sourceSelector.mode,
                    sourceCount: normalized.sourceSelector.sourceCount,
                    currentStartPosition: null,
                    currentEndPosition: null,
                    creationStartPosition: normalized.sourceStartPositionAtCreation,
                    creationEndPosition: normalized.sourceEndPositionAtCreation,
                    resolvedSourceCount: 0,
                },
                promptExposure: {
                    outputPromptVisible: false,
                    sourcePromptVisibleCount: 0,
                    duplicatedPromptTokenEstimate: 0,
                    estimateKind: 'word_ratio_estimate',
                },
            };
            results.push(conflict);
            conflict.diagnostics.forEach((entry) => diagnostics.push({
                ...entry,
                manifestId: conflict.manifestId,
                artifactKind: conflict.artifactKind,
                outputUID: conflict.outputUID,
            }));
            contentCounts[conflict.contentHealth] = (contentCounts[conflict.contentHealth] || 0) + 1;
            exposureCounts[conflict.exposureHealth] = (exposureCounts[conflict.exposureHealth] || 0) + 1;
            continue;
        }

        seenManifestIds.add(normalized.manifestId);
        const result = await validateShardManifest(normalized, messages, options);
        results.push(result);
        result.diagnostics.forEach((entry) => diagnostics.push({
            ...entry,
            manifestId: result.manifestId,
            artifactKind: result.artifactKind,
            outputUID: result.outputUID,
        }));
        contentCounts[result.contentHealth] = (contentCounts[result.contentHealth] || 0) + 1;
        exposureCounts[result.exposureHealth] = (exposureCounts[result.exposureHealth] || 0) + 1;
    }

    const report = {
        schemaVersion: SHARD_INTEGRITY_REPORT_SCHEMA_VERSION,
        entries: results,
        diagnostics,
        contentCounts,
        exposureCounts,
    };

    return {
        ...report,
        validationDigest: buildValidationDigest(report),
    };
}

export function buildShardIntegritySummary(report, now) {
    const diagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
    const contentCounts = report?.contentCounts || Object.fromEntries(Object.values(SHARD_CONTENT_HEALTH_VALUES).map((value) => [value, 0]));
    const overallStatus = diagnostics.some((entry) => String(entry.level || 'warning').toLowerCase() === 'error')
        ? 'ATTENTION_REQUIRED'
        : (diagnostics.length > 0 ? 'WARNING' : 'OK');

    return {
        schemaVersion: SHARD_INTEGRITY_REPORT_SCHEMA_VERSION,
        checkedAt: Number.isFinite(now) ? now : Date.now(),
        overallStatus,
        contentCounts,
        diagnosticCount: diagnostics.length,
        validationDigest: trimString(report?.validationDigest),
    };
}

export function mergeShardManifests(existing = [], additions = []) {
    const byId = new Map();
    for (const manifest of existing) {
        const normalized = normalizeShardManifest(manifest);
        if (normalized) {
            byId.set(normalized.manifestId, normalized);
        }
    }
    for (const manifest of additions) {
        const normalized = normalizeShardManifest(manifest);
        if (normalized) {
            byId.set(normalized.manifestId, normalized);
        }
    }
    return [...byId.values()];
}

export function shardIntegrityReportChanged(a, b) {
    return !deepEqual(a, b);
}
