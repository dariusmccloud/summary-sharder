import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { mergeOverlappingRanges } from '../../core/processing/utils.js';
import { buildDesiredVisibilityState } from '../../core/chat/visibility-policy.js';
import {
    buildManagedShardManifest,
    mergeShardManifests,
    parseManagedOutputWrapper,
    validateShardManifestSet,
} from '../../core/summarization/shard-integrity-core.js';
import {
    buildCorpusRevisionHash,
    buildMessageInitFingerprint,
    buildMessageRevisionHash,
    MESSAGE_ID_PREFIX,
} from '../../core/summarization/message-identity-core.js';
import {
    CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
    IDENTITY_STATUS_VALUES,
    MESSAGE_IDENTITY_SCHEMA_VERSION,
} from '../../core/summarization/message-identity-schema.js';

const cryptoApi = globalThis.crypto || crypto.webcrypto;
const MANAGED_SHARD_BODY_REGEX = /^\[MEMORY SHARD:\s*Messages\s*\d+\s*[-–]\s*\d+\]\s*\n\n([\s\S]*)$/u;

function usage() {
    return [
        'Usage:',
        '  node tools/server-plugin/insert-managed-shard-into-chat.mjs \\',
        '    --chat-file <path> \\',
        '    --start-index <n> \\',
        '    --end-index <n> \\',
        '    --body-file <path> \\',
        '    [--expected-start-message-id <msg_...>] \\',
        '    [--expected-end-message-id <msg_...>] \\',
        '    [--insert-after-index <n>] \\',
        '    [--message-name <name>] \\',
        '    [--prompt-policy replace_source|unknown_legacy] \\',
        '    [--output-uid <iso-timestamp>] \\',
        '    [--report-json <path>] \\',
        '    [--write]',
        '',
        'Notes:',
        '- Defaults to dry-run. Use --write to persist changes.',
        '- If --body-file points at a markdown document, the first fenced code block is used as the shard body.',
    ].join('\n');
}

function trimString(value) {
    return String(value || '').trim();
}

function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            throw new Error(`Unexpected argument: ${token}`);
        }
        const key = token.slice(2);
        if (key === 'write') {
            args.write = true;
            continue;
        }
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
        }
        args[key] = next;
        index += 1;
    }
    return args;
}

function parseInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
        throw new Error(`${name} must be an integer.`);
    }
    return parsed;
}

function parseJsonlRecords(text) {
    const lines = String(text || '').split(/\r?\n/u);
    const records = [];
    for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index].trim();
        if (!raw) continue;
        try {
            records.push(JSON.parse(raw));
        } catch (error) {
            throw new Error(`Invalid JSONL at line ${index + 1}: ${error?.message || error}`);
        }
    }
    return records;
}

function serializeJsonlRecords(records) {
    return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

async function sha256Hex(text) {
    const buffer = new TextEncoder().encode(String(text || ''));
    const digest = await cryptoApi.subtle.digest('SHA-256', buffer);
    const hex = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    return `sha256:${hex}`;
}

function readShardBody(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fenceMatch = raw.match(/````(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n````/u)
        || raw.match(/```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```/u);
    if (fenceMatch) {
        return trimString(fenceMatch[1]);
    }
    return trimString(raw);
}

function ensureSummarySharderRoot(headerRecord) {
    if (!headerRecord.chat_metadata || typeof headerRecord.chat_metadata !== 'object') {
        headerRecord.chat_metadata = {};
    }
    if (!headerRecord.chat_metadata.summary_sharder || typeof headerRecord.chat_metadata.summary_sharder !== 'object') {
        headerRecord.chat_metadata.summary_sharder = {};
    }
    return headerRecord.chat_metadata.summary_sharder;
}

function extractManagedShardBody(text) {
    const match = String(text || '').match(MANAGED_SHARD_BODY_REGEX);
    return trimString(match?.[1] || '');
}

function normalizeRangesOffline(ranges, chatLength) {
    const validRanges = (Array.isArray(ranges) ? ranges : [])
        .filter((range) => range && Number.isInteger(range.start) && Number.isInteger(range.end))
        .filter((range) => range.start >= 0 && range.end >= range.start && range.start < chatLength)
        .map((range) => ({
            start: range.start,
            end: Math.min(range.end, chatLength - 1),
            hidden: range.hidden !== undefined ? range.hidden : false,
            ignoreCollapse: range.ignoreCollapse || false,
            ignoreNames: range.ignoreNames || '',
        }));

    return mergeOverlappingRanges(validRanges);
}

function shiftRangesOnInsertOffline(ranges, insertionIndex, count = 1) {
    if (!Array.isArray(ranges) || count <= 0) {
        return [];
    }
    return ranges.map((range) => {
        const next = { ...range };
        if (next.start >= insertionIndex) {
            next.start += count;
        }
        if (next.end >= insertionIndex) {
            next.end += count;
        }
        return next;
    });
}

function buildSystemSpeakerIdentity(messageName) {
    const displayName = trimString(messageName) || 'SillyTavern System';
    return {
        speakerEntityId: `system:${displayName.toLowerCase()}`,
        speakerPathAtInit: displayName,
        displayNameAtInit: displayName,
        sourceType: 'system',
    };
}

function generateMessageId() {
    if (typeof cryptoApi?.randomUUID !== 'function') {
        throw new Error('Web Crypto randomUUID is unavailable for message identity generation.');
    }
    return `${MESSAGE_ID_PREFIX}${cryptoApi.randomUUID().replace(/-/gu, '').toLowerCase()}`;
}

async function buildInsertedMessage({
    startIndex,
    endIndex,
    shardBody,
    outputUID,
    messageName,
}) {
    const speakerIdentity = buildSystemSpeakerIdentity(messageName);
    const wrappedBody = `[MEMORY SHARD: Messages ${startIndex}-${endIndex}]\n\n${trimString(shardBody)}`;
    const message = {
        name: trimString(messageName) || 'SillyTavern System',
        is_user: false,
        is_system: false,
        send_date: trimString(outputUID),
        mes: wrappedBody,
        extra: {
            summary_sharder: {
                speakerIdentity,
                evidencePolicy: 'include',
                messageIdentity: {
                    schemaVersion: MESSAGE_IDENTITY_SCHEMA_VERSION,
                    messageId: generateMessageId(),
                    initFingerprint: '',
                    revisionHash: '',
                },
            },
        },
    };

    message.extra.summary_sharder.messageIdentity.initFingerprint = await buildMessageInitFingerprint(message, {
        speakerIdentity,
        cryptoApi,
    });
    message.extra.summary_sharder.messageIdentity.revisionHash = await buildMessageRevisionHash(message, {
        speakerIdentity,
        cryptoApi,
    });

    return message;
}

function summarizeDiagnosticIdentity(entry) {
    return {
        level: trimString(entry?.level || 'warning').toLowerCase(),
        code: trimString(entry?.code),
        manifestId: trimString(entry?.manifestId),
        artifactKind: trimString(entry?.artifactKind),
        outputUID: trimString(entry?.outputUID),
        missingMessageIds: Array.isArray(entry?.missingMessageIds) ? [...entry.missingMessageIds].sort() : [],
        currentStartPosition: Number.isInteger(entry?.currentStartPosition) ? entry.currentStartPosition : null,
        currentEndPosition: Number.isInteger(entry?.currentEndPosition) ? entry.currentEndPosition : null,
        currentSourceCount: Number.isInteger(entry?.currentSourceCount) ? entry.currentSourceCount : null,
        recordedSourceCount: Number.isInteger(entry?.recordedSourceCount) ? entry.recordedSourceCount : null,
        labelStartPosition: Number.isInteger(entry?.labelStartPosition) ? entry.labelStartPosition : null,
        labelEndPosition: Number.isInteger(entry?.labelEndPosition) ? entry.labelEndPosition : null,
        sourcePromptVisibleCount: Number.isInteger(entry?.sourcePromptVisibleCount) ? entry.sourcePromptVisibleCount : null,
        estimatedTokens: Number.isInteger(entry?.estimatedTokens) ? entry.estimatedTokens : null,
        threshold: Number.isInteger(entry?.threshold) ? entry.threshold : null,
        currentHash: trimString(entry?.currentHash),
        recordedHash: trimString(entry?.recordedHash),
    };
}

function collectWarningIdentities(validationReport) {
    const warnings = (validationReport?.diagnostics || [])
        .filter((entry) => String(entry?.level || 'warning').toLowerCase() !== 'error')
        .map((entry) => summarizeDiagnosticIdentity(entry));
    warnings.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    return warnings;
}

function sameWarningIdentitySet(a, b) {
    const left = a.map((entry) => stableStringify(entry));
    const right = b.map((entry) => stableStringify(entry));
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function getMessageId(message) {
    return trimString(message?.extra?.summary_sharder?.messageIdentity?.messageId);
}

async function ensureNoExistingManagedShard(messages, manifests, startIndex, endIndex, options = {}) {
    const expectedOutputUID = trimString(options.outputUID);
    const expectedManifestId = trimString(options.manifestId);
    const wrappedBodyHash = trimString(options.wrappedBodyHash);
    const shardBodyHash = trimString(options.shardBodyHash);

    const duplicateRange = messages.find((message) => {
        const wrapper = parseManagedOutputWrapper(message?.mes);
        return wrapper
            && wrapper.artifactKind === 'system-shard'
            && wrapper.startIndex === startIndex
            && wrapper.endIndex === endIndex;
    });
    if (duplicateRange) {
        const error = new Error(`A managed shard for Messages ${startIndex}-${endIndex} already exists at output UID ${duplicateRange.send_date}.`);
        error.code = 'ALREADY_PRESENT_RANGE';
        throw error;
    }

    if (expectedOutputUID) {
        const duplicateUid = messages.find((message) => trimString(message?.send_date) === expectedOutputUID);
        if (duplicateUid) {
            const error = new Error(`A message with output UID ${expectedOutputUID} already exists in the chat.`);
            error.code = 'ALREADY_PRESENT_OUTPUT_UID';
            throw error;
        }
    }

    if (expectedManifestId) {
        const duplicateManifest = (Array.isArray(manifests) ? manifests : []).find((entry) => trimString(entry?.manifestId) === expectedManifestId);
        if (duplicateManifest) {
            const error = new Error(`A manifest with identity ${expectedManifestId} already exists in the chat metadata.`);
            error.code = 'ALREADY_PRESENT_MANIFEST_ID';
            throw error;
        }
    }

    if (wrappedBodyHash || shardBodyHash) {
        for (const message of messages) {
            const wrapper = parseManagedOutputWrapper(message?.mes);
            if (!wrapper || wrapper.artifactKind !== 'system-shard') continue;
            const existingWrappedHash = await sha256Hex(String(message?.mes || ''));
            const existingBodyHash = await sha256Hex(extractManagedShardBody(message?.mes));
            if (wrappedBodyHash && existingWrappedHash === wrappedBodyHash) {
                const error = new Error(`An equivalent wrapped shard is already present at output UID ${message.send_date}.`);
                error.code = 'ALREADY_PRESENT_WRAPPED_BODY';
                throw error;
            }
            if (shardBodyHash && existingBodyHash === shardBodyHash) {
                const error = new Error(`A managed shard with the same body hash is already present at output UID ${message.send_date}.`);
                error.code = 'ALREADY_PRESENT_BODY_HASH';
                throw error;
            }
        }
    }
}

export async function applyManagedShardInsertion(records, options) {
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Chat JSONL must contain at least a header record.');
    }

    const headerRecord = cloneJson(records[0]);
    const messages = cloneJson(records.slice(1));
    const ss = ensureSummarySharderRoot(headerRecord);

    const startIndex = parseInteger(options.startIndex, 'startIndex');
    const endIndex = parseInteger(options.endIndex, 'endIndex');
    if (startIndex < 0 || endIndex < startIndex || endIndex >= messages.length) {
        throw new Error(`Source range ${startIndex}-${endIndex} is outside the current message window 0-${Math.max(0, messages.length - 1)}.`);
    }

    const preValidationReport = await validateShardManifestSet(ss.shardManifests || [], messages, { cryptoApi });
    const preWarningIdentities = collectWarningIdentities(preValidationReport);

    const expectedStartMessageId = trimString(options.expectedStartMessageId);
    const expectedEndMessageId = trimString(options.expectedEndMessageId);
    if (expectedStartMessageId) {
        const actual = getMessageId(messages[startIndex]);
        if (actual !== expectedStartMessageId) {
            throw new Error(`Start message ID mismatch at ${startIndex}: expected ${expectedStartMessageId}, found ${actual || '(missing)'}.`);
        }
    }
    if (expectedEndMessageId) {
        const actual = getMessageId(messages[endIndex]);
        if (actual !== expectedEndMessageId) {
            throw new Error(`End message ID mismatch at ${endIndex}: expected ${expectedEndMessageId}, found ${actual || '(missing)'}.`);
        }
    }

    const insertionIndex = options.insertAfterIndex !== undefined
        ? parseInteger(options.insertAfterIndex, 'insertAfterIndex') + 1
        : (endIndex + 1);
    if (insertionIndex < 0 || insertionIndex > messages.length) {
        throw new Error(`Insertion index ${insertionIndex} is outside the current chat bounds.`);
    }

    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const outputUID = trimString(options.outputUID) || new Date(nowMs).toISOString();
    const shardBodyHash = await sha256Hex(trimString(options.shardBody));
    const wrappedBodyHash = await sha256Hex(`[MEMORY SHARD: Messages ${startIndex}-${endIndex}]\n\n${trimString(options.shardBody)}`);
    const sourceMessagesBefore = messages.slice(startIndex, endIndex + 1);
    const sourceWindowHashBefore = await buildCorpusRevisionHash(sourceMessagesBefore, { cryptoApi });
    const corpusHashBefore = await buildCorpusRevisionHash(messages, { cryptoApi });
    const expectedManifestId = `manifest:system-shard:${outputUID}`;

    await ensureNoExistingManagedShard(messages, ss.shardManifests || [], startIndex, endIndex, {
        outputUID,
        manifestId: expectedManifestId,
        wrappedBodyHash,
        shardBodyHash,
    });

    const insertedMessage = await buildInsertedMessage({
        startIndex,
        endIndex,
        shardBody: options.shardBody,
        outputUID,
        messageName: options.messageName,
    });

    messages.splice(insertionIndex, 0, insertedMessage);

    const shiftedRanges = shiftRangesOnInsertOffline(ss.summarizedRanges || [], insertionIndex, 1);
    const nextRanges = normalizeRangesOffline([
        ...shiftedRanges,
        {
            start: startIndex,
            end: endIndex,
            hidden: options.hideSource !== false,
            ignoreCollapse: false,
            ignoreNames: '',
        },
    ], messages.length);
    const desiredVisibilityState = buildDesiredVisibilityState(messages, nextRanges, {
        hideAllSummarized: true,
        collapseAll: false,
        makeAllInvisible: false,
        globalIgnoreNames: '',
    });
    for (let index = 0; index < messages.length; index += 1) {
        if (!messages[index] || !desiredVisibilityState[index]) continue;
        messages[index].is_system = desiredVisibilityState[index].isSystem;
    }

    const manifest = await buildManagedShardManifest(messages, {
        startIndex,
        endIndex,
        artifactKind: 'system-shard',
        outputUID,
        promptPolicy: trimString(options.promptPolicy) || 'replace_source',
        now: nowMs,
        cryptoApi,
    });
    if (!manifest) {
        throw new Error('Failed to build a managed shard manifest for the requested source window.');
    }

    ss.summarizedRanges = nextRanges;
    ss.shardManifests = mergeShardManifests(ss.shardManifests || [], [manifest]);
    ss.messageIdentity = {
        schemaVersion: CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
        status: IDENTITY_STATUS_VALUES.COMPLETE,
        identifiedCount: messages.length,
        unidentifiedCount: 0,
        lastReconciledAt: nowMs,
        corpusRevisionHash: await buildCorpusRevisionHash(messages, { cryptoApi }),
    };

    const nextRecords = [headerRecord, ...messages];
    const validationReport = await validateShardManifestSet(ss.shardManifests, messages, { cryptoApi });
    const errorDiagnostics = (validationReport?.diagnostics || []).filter((entry) => String(entry?.level || '').toLowerCase() === 'error');
    const warningDiagnostics = (validationReport?.diagnostics || []).filter((entry) => String(entry?.level || 'warning').toLowerCase() !== 'error');
    const postWarningIdentities = collectWarningIdentities(validationReport);

    return {
        nextRecords,
        insertedMessage,
        manifest,
        validationReport,
        preValidationReport,
        preWarningIdentities,
        postWarningIdentities,
        hasValidationErrors: errorDiagnostics.length > 0,
        summary: {
            startIndex,
            endIndex,
            insertionIndex,
            outputUID,
            expectedManifestId,
            messageCountBefore: records.length - 1,
            messageCountAfter: messages.length,
            shardManifestCountAfter: ss.shardManifests.length,
            summarizedRangeCountAfter: nextRanges.length,
            sourceWindowHashBefore,
            corpusHashBefore,
            shardBodyHash,
            wrappedBodyHash,
            validationDiagnosticCount: Array.isArray(validationReport?.diagnostics) ? validationReport.diagnostics.length : 0,
            validationWarningCount: warningDiagnostics.length,
            validationErrorCount: errorDiagnostics.length,
            warningIdentitiesUnchanged: sameWarningIdentitySet(preWarningIdentities, postWarningIdentities),
        },
    };
}

function writeBackup(originalPath, rawText, nowMs) {
    const stamp = new Date(nowMs).toISOString().replace(/[:.]/gu, '-');
    const backupPath = `${originalPath}.bak-${stamp}`;
    fs.writeFileSync(backupPath, rawText, 'utf8');
    return backupPath;
}

function fsyncFile(filePath) {
    let fd = null;
    try {
        try {
            fd = fs.openSync(filePath, 'r+');
        } catch {
            fd = fs.openSync(filePath, 'r');
        }
        fs.fsyncSync(fd);
    } catch (error) {
        if (String(error?.code || '') === 'EPERM') {
            return;
        }
        throw error;
    } finally {
        if (fd !== null) {
            fs.closeSync(fd);
        }
    }
}

function atomicReplaceText(filePath, text) {
    const directory = path.dirname(filePath);
    const tempPath = path.join(directory, `${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tempPath, text, 'utf8');
    fsyncFile(tempPath);
    fs.renameSync(tempPath, filePath);
    fsyncFile(filePath);
}

function collectArtifactSummary(records, outputUID) {
    const header = records[0]?.chat_metadata?.summary_sharder || {};
    const messages = records.slice(1);
    const insertionIndex = messages.findIndex((message) => trimString(message?.send_date) === trimString(outputUID));
    return {
        messageCount: messages.length,
        shardManifestCount: Array.isArray(header.shardManifests) ? header.shardManifests.length : 0,
        summarizedRanges: Array.isArray(header.summarizedRanges) ? header.summarizedRanges : [],
        insertedIndex: insertionIndex,
        insertedMessage: insertionIndex >= 0 ? messages[insertionIndex] : null,
        chatIdentity: header.messageIdentity || null,
        manifests: Array.isArray(header.shardManifests) ? header.shardManifests : [],
    };
}

async function reopenAndValidate(chatFilePath, expected) {
    const rawText = fs.readFileSync(chatFilePath, 'utf8');
    const records = parseJsonlRecords(rawText);
    const summary = collectArtifactSummary(records, expected.outputUID);
    const validationReport = await validateShardManifestSet(summary.manifests, records.slice(1), { cryptoApi });
    const hardErrors = (validationReport?.diagnostics || []).filter((entry) => String(entry?.level || '').toLowerCase() === 'error');
    const warningIdentities = collectWarningIdentities(validationReport);
    const insertedMessage = summary.insertedMessage;
    const insertedWrapper = parseManagedOutputWrapper(insertedMessage?.mes);
    const insertedBodyHash = await sha256Hex(extractManagedShardBody(insertedMessage?.mes));
    const insertedWrappedBodyHash = await sha256Hex(String(insertedMessage?.mes || ''));
    const corpusHashAfter = await buildCorpusRevisionHash(records.slice(1), { cryptoApi });

    if (summary.messageCount !== expected.messageCountAfter) {
        throw new Error(`Post-write message count mismatch: expected ${expected.messageCountAfter}, found ${summary.messageCount}.`);
    }
    if (summary.shardManifestCount !== expected.shardManifestCountAfter) {
        throw new Error(`Post-write manifest count mismatch: expected ${expected.shardManifestCountAfter}, found ${summary.shardManifestCount}.`);
    }
    if (summary.insertedIndex !== expected.insertionIndex) {
        throw new Error(`Post-write insertion index mismatch: expected ${expected.insertionIndex}, found ${summary.insertedIndex}.`);
    }
    if (!insertedWrapper || insertedWrapper.startIndex !== expected.startIndex || insertedWrapper.endIndex !== expected.endIndex) {
        throw new Error('Post-write inserted message wrapper does not match the expected source window.');
    }
    if (insertedBodyHash !== expected.shardBodyHash) {
        throw new Error('Post-write shard body hash does not match the approved shard body.');
    }
    if (insertedWrappedBodyHash !== expected.wrappedBodyHash) {
        throw new Error('Post-write wrapped shard hash does not match the approved wrapped artifact.');
    }
    if (!sameWarningIdentitySet(expected.preWarningIdentities, warningIdentities)) {
        throw new Error('Post-write warning identities changed from the pre-write validation set.');
    }
    if (hardErrors.length > 0) {
        throw new Error(`Post-write validation produced ${hardErrors.length} hard error(s).`);
    }

    return {
        rawText,
        records,
        validationReport,
        warningIdentities,
        corpusHashAfter,
        summary,
    };
}

function emitHumanSummary(result, writeMode, backupPath = null) {
    const payload = {
        writeMode,
        backupPath,
        ...result.summary,
        manifestId: result.manifest.manifestId,
        sourceIdentityHash: result.manifest.sourceIdentityHash,
        sourceRevisionHash: result.manifest.sourceRevisionHash,
        sourceWindowHashBefore: result.summary.sourceWindowHashBefore,
        corpusHashBefore: result.summary.corpusHashBefore,
        shardBodyHash: result.summary.shardBodyHash,
        wrappedBodyHash: result.summary.wrappedBodyHash,
        validationDigest: result.validationReport?.validationDigest || null,
        validationOverallStatus: result.validationReport?.overallStatus || null,
        warningIdentitiesUnchanged: result.summary.warningIdentitiesUnchanged,
    };
    console.log(JSON.stringify(payload, null, 2));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args['chat-file'] || !args['body-file'] || args['start-index'] === undefined || args['end-index'] === undefined) {
        throw new Error(usage());
    }

    const chatFilePath = path.resolve(args['chat-file']);
    const bodyFilePath = path.resolve(args['body-file']);
    const rawText = fs.readFileSync(chatFilePath, 'utf8');
    const records = parseJsonlRecords(rawText);
    const shardBody = readShardBody(bodyFilePath);

    const nowMs = args['output-uid']
        ? Date.parse(args['output-uid'])
        : Date.now();
    if (!Number.isFinite(nowMs)) {
        throw new Error(`Invalid --output-uid timestamp: ${args['output-uid']}`);
    }

    const result = await applyManagedShardInsertion(records, {
        startIndex: args['start-index'],
        endIndex: args['end-index'],
        expectedStartMessageId: args['expected-start-message-id'],
        expectedEndMessageId: args['expected-end-message-id'],
        insertAfterIndex: args['insert-after-index'],
        shardBody,
        messageName: args['message-name'] || 'SillyTavern System',
        promptPolicy: args['prompt-policy'] || 'replace_source',
        outputUID: args['output-uid'] || null,
        nowMs,
        hideSource: true,
    });

    if (args['report-json']) {
        fs.writeFileSync(path.resolve(args['report-json']), JSON.stringify({
            summary: result.summary,
            manifest: result.manifest,
            preValidationReport: result.preValidationReport,
            validationReport: result.validationReport,
            preWarningIdentities: result.preWarningIdentities,
            postWarningIdentities: result.postWarningIdentities,
        }, null, 2), 'utf8');
    }

    if (args.write) {
        const backupPath = writeBackup(chatFilePath, rawText, nowMs);
        const backupHash = await sha256Hex(rawText);
        try {
            atomicReplaceText(chatFilePath, serializeJsonlRecords(result.nextRecords));
            const persisted = await reopenAndValidate(chatFilePath, {
                ...result.summary,
                outputUID: result.summary.outputUID,
                preWarningIdentities: result.preWarningIdentities,
            });
            emitHumanSummary({
                ...result,
                summary: {
                    ...result.summary,
                    corpusHashAfter: persisted.corpusHashAfter,
                    backupHash,
                },
                validationReport: persisted.validationReport,
            }, 'write', backupPath);
        } catch (error) {
            atomicReplaceText(chatFilePath, rawText);
            throw error;
        }
        return;
    }

    emitHumanSummary(result, 'dry-run');
}

const isDirectRun = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
    main().catch((error) => {
        console.error(error?.message || error);
        process.exitCode = 1;
    });
}
