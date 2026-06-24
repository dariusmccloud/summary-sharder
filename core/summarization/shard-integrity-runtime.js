import {
    chat_metadata,
    saveMetadata,
} from '../../../../../../script.js';

import { log } from '../logger.js';
import {
    buildBackfilledManifestFromOutputMessage,
    buildManagedShardManifest,
    buildShardIntegritySummary,
    mergeShardManifests,
    normalizeShardManifest,
    parseManagedOutputWrapper,
    shardIntegrityReportChanged,
    validateShardManifestSet,
} from './shard-integrity-core.js';
import { withSummarySharderSaveDiagnostics } from './save-diagnostics.js';

let lastRuntimeState = {
    chatId: '',
    report: null,
    summary: null,
    validatedAt: 0,
};

function ensureSummarySharderChatRoot(chatMetadataValue) {
    if (!chatMetadataValue.summary_sharder || typeof chatMetadataValue.summary_sharder !== 'object') {
        chatMetadataValue.summary_sharder = {};
    }
    return chatMetadataValue.summary_sharder;
}

function getLiveContext(context = null) {
    return context || globalThis.SillyTavern?.getContext?.() || null;
}

function getNormalizedChatId(context = null) {
    const live = getLiveContext(context);
    return String(live?.chatId || '').trim().replace(/\.jsonl$/iu, '').replace(/\.json$/iu, '').trim();
}

function getStoredManifests() {
    const ss = ensureSummarySharderChatRoot(chat_metadata);
    const manifests = Array.isArray(ss.shardManifests) ? ss.shardManifests : [];
    return manifests
        .map((manifest) => normalizeShardManifest(manifest))
        .filter(Boolean);
}

function setRuntimeState(context, report, now) {
    lastRuntimeState = {
        chatId: getNormalizedChatId(context),
        report,
        summary: report ? buildShardIntegritySummary(report, now) : null,
        validatedAt: Number.isFinite(now) ? now : Date.now(),
    };
    return lastRuntimeState;
}

function clearRuntimeState() {
    lastRuntimeState = {
        chatId: '',
        report: null,
        summary: null,
        validatedAt: 0,
    };
}

export function getCurrentChatShardIntegrityRuntimeState(context = null) {
    const chatId = getNormalizedChatId(context);
    if (!chatId || chatId !== lastRuntimeState.chatId) {
        return {
            chatId,
            report: null,
            summary: null,
            validatedAt: 0,
        };
    }
    return {
        ...lastRuntimeState,
    };
}

async function collectBackfilledManifests(messages, existingManifests, options = {}) {
    const additions = [];
    const existingOutputUIDs = new Set(
        existingManifests
            .map((manifest) => String(manifest?.outputUID || '').trim())
            .filter(Boolean)
    );

    for (const message of messages || []) {
        const outputUID = String(message?.send_date || '').trim();
        if (!outputUID || existingOutputUIDs.has(outputUID)) {
            continue;
        }
        if (!parseManagedOutputWrapper(message?.mes)) {
            continue;
        }

        const manifest = await buildBackfilledManifestFromOutputMessage(messages, message, options);
        if (!manifest) {
            continue;
        }

        additions.push(manifest);
        existingOutputUIDs.add(outputUID);
    }

    return additions;
}

export async function syncCurrentChatShardIntegrity(options = {}) {
    const context = getLiveContext(options.context);
    const messages = Array.isArray(context?.chat) ? context.chat : null;
    if (!messages) {
        clearRuntimeState();
        return { skipped: true, reason: 'no-chat' };
    }

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const ss = ensureSummarySharderChatRoot(chat_metadata);
    const existingManifests = getStoredManifests();
    const additions = [];

    if (options.registerOutput?.outputUID && Number.isInteger(options.registerOutput?.startIndex) && Number.isInteger(options.registerOutput?.endIndex)) {
        const manifest = await buildManagedShardManifest(messages, {
            ...options.registerOutput,
            now,
            cryptoApi: options.cryptoApi,
        });
        if (manifest) {
            additions.push(manifest);
        }
    }

    if (options.mode !== 'check') {
        additions.push(...await collectBackfilledManifests(messages, mergeShardManifests(existingManifests, additions), {
            now,
            cryptoApi: options.cryptoApi,
        }));
    }

    const nextManifests = mergeShardManifests(existingManifests, additions);
    const report = await validateShardManifestSet(nextManifests, messages, {
        cryptoApi: options.cryptoApi,
    });
    const runtimeState = setRuntimeState(context, report, now);

    const manifestsChanged = shardIntegrityReportChanged(ss.shardManifests || [], nextManifests);
    if (manifestsChanged) {
        ss.shardManifests = nextManifests;
        await withSummarySharderSaveDiagnostics({
            subsystem: 'shard-integrity',
            operation: 'sync',
            phase: options.reason || 'runtime-sync',
            saveKind: 'metadata',
            chatId: getNormalizedChatId(context),
        }, async () => {
            await saveMetadata();
        });
    }

    return {
        changed: manifestsChanged,
        manifestsChanged,
        reportChanged: false,
        manifestsAdded: additions.length,
        manifestCount: nextManifests.length,
        report,
        summary: runtimeState.summary,
        persistedSummary: null,
        saveKind: manifestsChanged ? 'metadata' : 'none',
    };
}

export async function refreshCurrentChatShardIntegrity(options = {}) {
    try {
        return await syncCurrentChatShardIntegrity(options);
    } catch (error) {
        log.warn('Shard integrity synchronization failed:', error?.message || error);
        throw error;
    }
}
