/**
 * SUMMARY SHARDER - Memory Shard Summarization Extension
 * Compresses roleplay history into recoverable memory shards.
 */
import { initializeThemes } from './ui/modals/themes-modal.js';
import {
    eventSource,
    event_types,
} from '../../../../script.js';

import {
    extension_settings,
} from '../../../extensions.js';
import { POPUP_RESULT } from '../../../popup.js';
import { showSsConfirm } from './ui/common/modal-base.js';

// Core modules
import { log } from './core/logger.js';
import { getDefaultSettings, saveSettings, getChatRanges, saveChatRanges, migrateSettings, getActiveRagSettings } from './core/settings.js';
import { ensureDefaultPrompt, getActivePrompt, ensureSharderPrompts } from './core/summarization/prompts.js';
import { runSummarization, stopSummarization, setLastSummarizedIndexCallback } from './core/api/summary-api.js';
import { runSharder } from './core/api/single-pass-api.js';
import { cacheCurrentChatState, findDeletedIndex, getCachedLength } from './core/chat/chat-state.js';
import { validateAllRanges } from './core/chat/range-manager.js';
import { shiftRangesOnDelete, shiftRangesOnInsert, buildRangesFromIndices, rangesMatch } from './core/chat/range-operations.js';
import { enforceArchivedPromptExclusion, initArchiveHandler, refreshArchiveDecorations } from './core/chat/archive-manager.js';
import { isArchivedMessage } from './core/chat/archive-policy.js';
import { reconcileCurrentChatMessageIdentity } from './core/summarization/message-identity-runtime.js';
import { refreshCurrentChatShardIntegrity } from './core/summarization/shard-integrity-runtime.js';
import {
    announceLoadProfilingBypass,
    beginLoadTrace,
    finishLoadTrace,
    getLoadProfilerFlags,
    isLoadDebugTracingEnabled,
    installLoadTraceDebugApi,
    isLoadProfilingBypassEnabled,
    profileLoadStage,
} from './core/summarization/load-profiler.js';

// UI modules
import { renderSettingsUI, runManualSummarizeUI } from './ui/ui-manager.js';
import { injectStyles } from './ui/styles.js';
import { initTextareaResizeAssist } from './ui/textarea-resize-assist.js';
import { initFab } from './ui/fab/index.js';
import { applyHideSummarized, applyVisibilitySettings, applyCollapseToHiddenMessages, expandUnhiddenMessages, initCollapseHandler, initEditUnfoldHandler, mergeDetectedHiddenRanges } from './core/chat/visibility-manager.js';
import {
    initCollectionLifecycle,
    rearrangeChat,
    clearRagPromptInjection,
    getChatBinding,
    initBackend,
} from './core/rag/index.js';

const MODULE_NAME = 'SummarySharder';
const GENERATE_INTERCEPTOR_KEY = 'summary_sharder_rearrangeChat';
const defaultSettings = getDefaultSettings();

// Runtime settings
let settings = { ...defaultSettings };

// Track last summarized index per chat
let lastSummarizedIndex = -1;
let isAutoSummarizing = false;

// Track pending visibility changes (debounce rapid changes)
// Using an object reference so visibility-state.js can clear it
const visibilityTimerRef = { timer: null };

// Track observer to prevent duplicates
let visibilityObserver = null;

// Import shared visibility state to check guard flag and set timer reference
import { getApplyingVisibility, setVisibilityTimerRef } from './core/chat/visibility-state.js';

// Set the timer reference so visibility-manager can clear pending timers
setVisibilityTimerRef(visibilityTimerRef);

/**
 * Export settings and functions for other modules
 */
export function getExtensionSettings() {
    return settings;
}

export function getLastSummarizedIndex() {
    return lastSummarizedIndex;
}

export function setLastSummarizedIndex(index) {
    lastSummarizedIndex = index;
}

export { runSummarization, getActivePrompt, applyHideSummarized, applyVisibilitySettings, saveSettings };

async function syncArchivePresentation() {
    await enforceArchivedPromptExclusion(settings);
    refreshArchiveDecorations(settings);
}

async function reconcileCorpusIntegrity(options = {}) {
    const context = SillyTavern.getContext?.() || null;
    const trace = beginLoadTrace({
        kind: 'corpus-integrity',
        reason: options.reason || 'runtime-sync',
        chatId: context?.chatId || '',
        messageCount: Array.isArray(context?.chat) ? context.chat.length : 0,
        profilingBypassActive: isLoadProfilingBypassEnabled(globalThis),
    });
    let identityResult = null;
    let integrityResult = null;
    let traceError = null;

    try {
        identityResult = await profileLoadStage(trace, 'message-identity-scan', async () => {
            return await reconcileCurrentChatMessageIdentity(options);
        });
        await profileLoadStage(trace, 'archive-presentation-sync', async () => {
            await syncArchivePresentation();
            return { saveKind: 'none' };
        });
        integrityResult = await profileLoadStage(trace, 'shard-integrity-validation', async () => {
            return await refreshCurrentChatShardIntegrity({
                reason: options.reason || 'runtime-sync',
            });
        });
    } catch (error) {
        traceError = {
            message: String(error?.message || error),
            code: String(error?.code || ''),
        };
        throw error;
    } finally {
        finishLoadTrace(trace, {
            identitySaveKind: identityResult?.saveKind || 'none',
            integritySaveKind: integrityResult?.saveKind || 'none',
            manifestsAdded: integrityResult?.manifestsAdded || 0,
            manifestCount: integrityResult?.manifestCount || 0,
            error: traceError,
        });
    }
}

function isProfilingBypassActive() {
    const active = isLoadProfilingBypassEnabled(globalThis);
    if (active) {
        announceLoadProfilingBypass(log, globalThis);
    }
    return active;
}

/**
 * Setup MutationObserver to watch for SillyTavern hide/unhide changes
 * Catches all sources: /hide, /unhide commands, context menu, external tools
 */
function setupVisibilityObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        // Chat not ready, retry later
        setTimeout(setupVisibilityObserver, 1000);
        return;
    }

    // Disconnect existing observer if any
    if (visibilityObserver) {
        visibilityObserver.disconnect();
    }

    visibilityObserver = new MutationObserver((mutations) => {
        // Skip if we're applying visibility ourselves - prevents cascade loop
        if (getApplyingVisibility()) {
            return;
        }

        let hasVisibilityChange = false;

        for (const mutation of mutations) {
            if (mutation.type === 'attributes' &&
                mutation.attributeName === 'is_system') {
                hasVisibilityChange = true;
                break;
            }
        }

        if (hasVisibilityChange) {
            // Debounce: wait for batch of changes to complete
            clearTimeout(visibilityTimerRef.timer);
            visibilityTimerRef.timer = setTimeout(() => {
                // Double-check flag in case visibility started during debounce
                if (!getApplyingVisibility()) {
                    onExternalVisibilityChange();
                }
            }, 300);
        }
    });

    visibilityObserver.observe(chatContainer, {
        attributes: true,
        attributeFilter: ['is_system'],
        subtree: true,
    });

}


/**
 * Called when SillyTavern's /hide or /unhide changes message visibility
 * Synchronizes Summary Sharder ranges with actual message state
 */
async function onExternalVisibilityChange() {
    const context = SillyTavern.getContext();
    if (!context?.chat) return;

    // Double-check guard flag (should not be true if we get here)
    if (getApplyingVisibility()) {
        return;
    }

    await syncArchivePresentation();

    // Detect current hidden state from chat data
    const actuallyHidden = new Set();
    for (let i = 0; i < context.chat.length; i++) {
        if (context.chat[i]?.is_system === true && !isArchivedMessage(context.chat[i])) {
            actuallyHidden.add(i);
        }
    }

    // Build ranges from detected hidden messages
    const detectedRanges = buildRangesFromIndices(actuallyHidden);

    // Get current Summary Sharder ranges
    const currentRanges = getChatRanges();

    // Check if ranges match
    if (rangesMatch(currentRanges, detectedRanges)) {
        return;
    }

    // Update to match actual visibility
    saveChatRanges(detectedRanges);

    // Apply collapse styling to newly hidden messages (if enabled)
    applyCollapseToHiddenMessages(settings);

    // Expand any messages that were unhidden
    expandUnhiddenMessages();

    // Don't recompute visibility - SillyTavern already did it
    refreshArchiveDecorations(settings);
    await refreshCurrentChatShardIntegrity({
        reason: 'external-visibility-change',
    });
}

/**
 * Handle new message events for auto-summarization
 * @param {number|string|object} messageId - Message index from event payload
 * @param {string} messageType - Message type from event payload
 * @param {string} sourceEventType - Event type that invoked this handler
 */
function shouldQualifyAutoMessage(messageId, messageType, sourceEventType, chat) {
    if (sourceEventType !== event_types.MESSAGE_RECEIVED) {
        return false;
    }

    if (messageType === 'command' || messageType === 'first_message') {
        return false;
    }

    const messageIndex = Number(messageId);
    if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= chat.length) {
        return false;
    }

    const msg = chat[messageIndex];
    if (!msg) {
        return false;
    }

    if (msg.is_user === true) {
        return false;
    }

    if (msg.extra?.api === 'slash command' || msg.extra?.api === 'manual') {
        return false;
    }

    const messageText = typeof msg.mes === 'string' ? msg.mes.trimStart() : '';
    if (messageText.startsWith('[MEMORY SHARD:') || messageText.startsWith('[SUMMARY:')) {
        return false;
    }

    return true;
}

function normalizeReceivedMessageEvent(messageId, messageType) {
    if (messageId && typeof messageId === 'object') {
        const resolvedMessageId = messageId.messageId ?? messageId.id ?? messageId.index;
        const resolvedMessageType = messageType ?? messageId.messageType ?? messageId.type;
        return { messageId: resolvedMessageId, messageType: resolvedMessageType };
    }

    return { messageId, messageType };
}

async function onNewMessage(messageId, messageType, sourceEventType = event_types.MESSAGE_RECEIVED) {
    const normalizedEvent = normalizeReceivedMessageEvent(messageId, messageType);

    // SillyBunny emits MESSAGE_RECEIVED for a loaded historical first message when chat.length === 1.
    // Initial-load / chat-change reconciliation already covers that path, so do not treat it as a new-message save trigger.
    if (normalizedEvent.messageType === 'first_message') {
        cacheCurrentChatState();
        return;
    }

    // Update cache after new message
    cacheCurrentChatState();

    await reconcileCorpusIntegrity({
        reason: 'message-received',
    });

    if (settings.mode !== 'auto') {
        return;
    }

    if (isAutoSummarizing) {
        log.log('Auto summarization already running, skipping');
        return;
    }

    const context = SillyTavern.getContext();
    const chat = context?.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        return;
    }

    if (!shouldQualifyAutoMessage(normalizedEvent.messageId, normalizedEvent.messageType, sourceEventType, chat)) {
        return;
    }

    const currentIndex = Number(normalizedEvent.messageId);
    const boundedLastSummarizedIndex = Math.min(Math.max(lastSummarizedIndex, -1), currentIndex);
    const autoInterval = Math.max(1, Number.parseInt(settings.autoInterval, 10) || 1);
    const messagesSinceLastSummary = currentIndex - boundedLastSummarizedIndex;

    if (messagesSinceLastSummary < autoInterval) {
        return;
    }

    const startIdx = Math.max(0, boundedLastSummarizedIndex + 1);
    if (startIdx > currentIndex) {
        return;
    }

    log.log(`Auto-triggering summarization: messages ${startIdx} to ${currentIndex}`);
    isAutoSummarizing = true;

    try {
        await runSummarization(startIdx, currentIndex, settings);
    } finally {
        isAutoSummarizing = false;
    }
}

/**
 * Handle message edited events.
 * @param {Object|number|string} eventData - Event payload (shape depends on ST emitter)
 */
async function onMessageEdited(eventData) {
    void eventData;
    await reconcileCorpusIntegrity({
        reason: 'message-edited',
    });
    cacheCurrentChatState();
}

/**
 * Handle message deletion events
 * Adjusts visibility ranges to account for shifted message indices
 * @param {number} newChatLength - The chat length after deletion
 */
async function onMessageDeleted(newChatLength) {
    const cachedLength = getCachedLength();

    // If cache is stale or no deletion occurred, just validate
    if (cachedLength === 0 || newChatLength >= cachedLength) {
        validateAllRanges();
        await reconcileCorpusIntegrity({
            reason: 'message-deleted',
            recordDeletion: true,
        });
        cacheCurrentChatState();
        return;
    }

    const context = SillyTavern.getContext();
    if (!context?.chat) return;

    // Find which message was deleted
    const deletedIndex = findDeletedIndex(context.chat);

    if (deletedIndex >= 0) {
        // Use new range-operations module (handles visibility internally)
        await shiftRangesOnDelete(deletedIndex, deletedIndex);

        // Update lastSummarizedIndex if needed
        if (lastSummarizedIndex >= deletedIndex) {
            lastSummarizedIndex = Math.max(-1, lastSummarizedIndex - 1);
        }
    } else {
        // Could not determine deleted index, validate ranges
        validateAllRanges();
    }

    await reconcileCorpusIntegrity({
        reason: 'message-deleted',
        recordDeletion: true,
    });

    // Update cache for next deletion
    cacheCurrentChatState();
}

/**
 * Handle message insertion events
 * Adjusts visibility ranges to account for shifted message indices
 * @param {number} insertedIndex - The index where a message was inserted
 */
async function onMessageInserted(insertedIndex) {
    // Use new range-operations module (handles visibility internally)
    await shiftRangesOnInsert(insertedIndex, 1);

    // Update lastSummarizedIndex if needed
    if (lastSummarizedIndex >= insertedIndex) {
        lastSummarizedIndex++;
    }

    await reconcileCorpusIntegrity({
        reason: 'message-inserted',
    });

    // Update cache
    cacheCurrentChatState();
}

async function onMessageSwiped(eventData) {
    void eventData;
    await reconcileCorpusIntegrity({
        reason: 'message-swiped',
    });
    cacheCurrentChatState();
}

async function onMessageUpdated(eventData) {
    void eventData;
    await reconcileCorpusIntegrity({
        reason: 'message-updated',
    });
    cacheCurrentChatState();
}

/**
 * Normalize a chat ID by stripping file extensions.
 * @param {string} chatId
 * @returns {string}
 */
function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

/**
 * Handle chat change - reset tracking
 */
function onChatChanged() {
    const context = SillyTavern.getContext();
    const chatId = context?.chatId;
    log.log(`Chat changed to: ${chatId}`);

    lastSummarizedIndex = -1;

    // Recalculate from THIS chat's stored ranges
    let chatRanges = getChatRanges();
    if (chatRanges.length > 0) {
        const maxEnd = Math.max(...chatRanges.map(r => r.end));
        lastSummarizedIndex = maxEnd;
    }

    // Branch detection: if this chat has main_chat set and no existing RAG bindings,
    // it is a new branch — offer to inherit the parent's collection bindings.
    const chatMeta = context?.chatMetadata;
    const parentChatId = chatMeta?.main_chat ? normalizeChatId(String(chatMeta.main_chat)) : null;
    const normalizedChatId = normalizeChatId(chatId ?? '');
    const charIdx = context?.characterId;
    const charAvatar = (charIdx !== undefined && charIdx !== null)
        ? context?.characters?.[charIdx]?.avatar ?? null
        : null;

    const branchHasChatBinding = normalizedChatId
        ? !!getChatBinding(normalizedChatId, settings)
        : true;

    if (parentChatId && normalizedChatId && parentChatId !== normalizedChatId && !branchHasChatBinding) {
        // Defer slightly so the chat UI finishes loading before the modal appears
        setTimeout(async () => {
            try {
                const { showBranchCollectionPicker } = await import('./ui/modals/management/branch-picker-modal.js');
                await showBranchCollectionPicker(normalizedChatId, parentChatId, charAvatar, settings);
            } catch (error) {
                log.warn('Branch collection picker failed:', error?.message || error);
            }
        }, 600);
    }

    // Auto-detect hidden ranges on chat load
    setTimeout(async () => {
        const loadTrace = beginLoadTrace({
            kind: 'chat-changed-handler',
            reason: 'chat-changed',
            chatId: context?.chatId || '',
            messageCount: Array.isArray(context?.chat) ? context.chat.length : 0,
            deferredByMs: 500,
            ...getLoadProfilerFlags(globalThis),
        });

        // Re-attach observer for new chat DOM
        try {
            await profileLoadStage(loadTrace, 'setup-visibility-observer', async () => {
                setupVisibilityObserver();
                return {
                    observerAttached: Boolean(visibilityObserver),
                };
            });

            if (isProfilingBypassActive()) {
                await profileLoadStage(loadTrace, 'profiling-bypass', async () => {
                    return {
                        skippedStages: [
                            'merge-detected-hidden-ranges',
                            'apply-visibility-settings',
                            'reconcile-corpus-integrity',
                            'cache-chat-state',
                        ],
                    };
                });
                return;
            }

            await profileLoadStage(loadTrace, 'merge-detected-hidden-ranges', async () => {
                mergeDetectedHiddenRanges();
                return {
                    rangeCount: getChatRanges().length,
                };
            });

            // Reapply visibility for THIS chat's ranges (must await to ensure completion before caching)
            await profileLoadStage(loadTrace, 'apply-visibility-settings', async () => {
                await applyVisibilitySettings(settings);
                return {
                    rangeCount: getChatRanges().length,
                };
            });

            await profileLoadStage(loadTrace, 'reconcile-corpus-integrity', async () => {
                await reconcileCorpusIntegrity({
                    reason: 'chat-changed',
                });
                return {
                    completed: true,
                };
            });

            // Cache chat state for deletion tracking (after visibility is fully applied)
            await profileLoadStage(loadTrace, 'cache-chat-state', async () => {
                cacheCurrentChatState();
                return {
                    cachedLength: getCachedLength(),
                };
            });
        } finally {
            finishLoadTrace(loadTrace, {
                bypassActive: isLoadProfilingBypassEnabled(globalThis),
            });
        }
    }, 500);
}

function onChatLoaded(eventData) {
    if (!isLoadDebugTracingEnabled(globalThis)) {
        return;
    }

    const context = SillyTavern.getContext?.() || null;
    const detail = eventData?.detail || {};
    const latestTrace = globalThis.summarySharderLoadProfiler?.getTraces?.()?.[0] || null;

    log.log('[SummarySharder][CHAT_LOADED]', {
        at: new Date().toISOString(),
        chatId: context?.chatId || '',
        detailId: detail?.id ?? null,
        detailCharacterName: detail?.character?.name || '',
        messageCount: Array.isArray(context?.chat) ? context.chat.length : 0,
        profilingBypassActive: isLoadProfilingBypassEnabled(globalThis),
        latestTraceKind: latestTrace?.meta?.kind || null,
        latestTraceReason: latestTrace?.meta?.reason || null,
        latestTraceDurationMs: latestTrace?.durationMs ?? null,
    });
}

/**
 * Build the initBackend config object from a RAG settings backendConfig.
 * @param {string} backend
 * @param {Object} bc - backendConfig
 * @returns {Object}
 */
function buildBackendInitConfig(backend, bc) {
    if (backend === 'qdrant') {
        const address = String(bc.qdrantAddress || 'localhost:6333').trim();
        const match = address.match(/^(.*):(\d+)$/);
        const host = match ? (String(match[1] || 'localhost').trim() || 'localhost') : address;
        const port = match ? Math.max(1, parseInt(match[2], 10) || 6333) : 6333;
        return {
            host,
            port,
            apiKey: bc.qdrantApiKey || '',
            url: bc.qdrantUseCloud ? (bc.qdrantUrl || '') : '',
        };
    }
    return {
        address: bc.milvusAddress || '',
        token: bc.milvusToken || '',
    };
}

/**
 * Auto-initialize remote backends (Qdrant/Milvus) using credentials stored in settings.
 * Checks both rag and ragStandard configs and initialises whichever use a remote backend.
 * Runs silently on startup so the user doesn't need to manually hit "Initialize Backend".
 * @param {Object} currentSettings
 */
async function autoInitRemoteBackend(currentSettings) {
    const configs = [currentSettings?.rag, currentSettings?.ragStandard].filter(Boolean);
    const seen = new Set();

    for (const ragSettings of configs) {
        const backend = ragSettings?.backend;
        if (backend !== 'qdrant' && backend !== 'milvus') continue;

        // Deduplicate: same backend + same address only needs one init call
        const bc = ragSettings?.backendConfig || {};
        const dedupeKey = `${backend}:${bc.qdrantAddress || bc.milvusAddress || ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const cfg = buildBackendInitConfig(backend, bc);
        log.log(`Auto-initializing ${backend} backend...`);
        try {
            const result = await initBackend(backend, cfg);
            if (result.success) {
                log.log(`${backend} backend auto-initialized successfully`);
            } else {
                log.warn(`${backend} auto-init returned: ${result.message || 'no success status'}`);
            }
        } catch (err) {
            log.warn(`${backend} auto-init error:`, err?.message || err);
        }
    }
}

/**
 * Initialize the extension
 */
jQuery(async () => {
    log.log('Initializing...');

    // Load saved settings from extension_settings
    if (!extension_settings.summary_sharder) {
        extension_settings.summary_sharder = { ...defaultSettings };
    }

    // Merge saved settings with defaults
    settings = {
        ...defaultSettings,
        ...extension_settings.summary_sharder,
    };

    // Run migration for any old settings formats
    migrateSettings(settings);
    saveSettings(settings);
    setLastSummarizedIndexCallback(setLastSummarizedIndex);

    // Auto-initialize remote vector backends (Qdrant/Milvus) using stored credentials
    autoInitRemoteBackend(settings);

    // Ensure default prompt exists
    ensureDefaultPrompt(settings);

    // Ensure sharder prompts exist
    ensureSharderPrompts(settings);

    // Initialize themes
    initializeThemes(settings);
    installLoadTraceDebugApi(globalThis);
    announceLoadProfilingBypass(log, globalThis);

    // Inject CSS (includes theme modal CSS)
    injectStyles();
    initTextareaResizeAssist();

    // Initialize delegated collapse click handler
    initCollapseHandler();
    initEditUnfoldHandler();
    initArchiveHandler(() => settings);

    // Render settings UI
    renderSettingsUI(settings, {
        onManualSummarize: () => runManualSummarizeUI(settings)
    });

    // Initialize floating action button
    initFab(settings, {
        onSinglePass: (start, end, selectedShards) => runSharder(start, end, settings, selectedShards),
        onBatchSharder: async (ranges, batchConfig) => {
            const { runSharderQueue } = await import('./core/api/single-pass-queue-api.js');
            await runSharderQueue(ranges, settings, batchConfig);
        },
        onStop: () => stopSummarization(),
        onSummarize: () => runManualSummarizeUI(settings),
        onVectorize: async () => {
            if (!getActiveRagSettings(settings)?.enabled) {
                toastr.warning('RAG is disabled. Enable it in RAG settings first.');
                return;
            }

            try {
                const { vectorizeAllShardsByMode, vectorizeAllStandardSummaries } = await import('./core/rag/index.js');

                if (settings?.sharderMode === true) {
                    const result = await vectorizeAllShardsByMode(settings);
                    if (result.mode === 'section') {
                        const fallbackInfo = (result.sectionFallbackToStandard || 0) > 0
                            ? `, fallback=${result.sectionFallbackToStandard}`
                            : '';
                        toastr.success(`Section-aware vectorization: +${result.inserted}, -${result.deleted}, shards=${result.total}${fallbackInfo}`);
                    } else {
                        toastr.success(`Vectorized shards: +${result.inserted} (total discovered: ${result.total})`);
                    }
                } else {
                    const result = await vectorizeAllStandardSummaries(settings);
                    toastr.success(`Vectorized standard summaries: +${result.inserted} (total discovered: ${result.total})`);
                }
            } catch (error) {
                toastr.error(`Vectorization failed: ${error?.message || error}`);
            }
        },
        onBrowseVectors: async () => {
            if (!getActiveRagSettings(settings)?.enabled) {
                toastr.warning('RAG is disabled. Enable it in RAG settings first.');
                return;
            }

            try {
                const { openRagBrowserModal } = await import('./ui/modals/management/rag-browser-modal.js');
                await openRagBrowserModal(settings);
            } catch (error) {
                toastr.error(`Could not open collection browser: ${error?.message || error}`);
            }
        },
        onPurgeVectors: async () => {
            if (!getActiveRagSettings(settings)?.enabled) {
                toastr.warning('RAG is disabled. Enable it in RAG settings first.');
                return;
            }

            const confirm = await showSsConfirm(
                'Purge All Vectors',
                'Delete all shard and chat vectors for this chat? This cannot be undone.'
            );
            if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;

            try {
                const { purgeAllCollections } = await import('./core/rag/index.js');
                const chatId = SillyTavern.getContext()?.chatId;
                if (!chatId) {
                    toastr.warning('No active chat found.');
                    return;
                }

                await purgeAllCollections(chatId, settings.rag);
                toastr.success('Vectors purged for current chat');
            } catch (error) {
                toastr.error(`Vector purge failed: ${error?.message || error}`);
            }
        },
        onOpenThemes: async () => {
            try {
                const { openThemesModal } = await import('./ui/modals/themes-modal.js');
                await openThemesModal(settings, saveSettings);
            } catch (error) {
                toastr.error(`Could not open themes: ${error?.message || error}`);
            }
        },
        onOpenPrompts: async () => {
            try {
                const { openPromptsModal } = await import('./ui/modals/configuration/prompts-modal.js');
                await openPromptsModal(settings);
            } catch (error) {
                toastr.error(`Could not open prompts: ${error?.message || error}`);
            }
        },
        onOpenApiConfig: async () => {
            try {
                const { openApiConfigModal } = await import('./ui/modals/configuration/api-config-modal.js');
                await openApiConfigModal(settings);
            } catch (error) {
                toastr.error(`Could not open API config: ${error?.message || error}`);
            }
        },
        onOpenRagSettings: async () => {
            try {
                const { openRagSettingsModal } = await import('./ui/modals/configuration/rag-settings-modal.js');
                await openRagSettingsModal(settings);
            } catch (error) {
                toastr.error(`Could not open RAG settings: ${error?.message || error}`);
            }
        },
        onOpenChatManager: async () => {
            try {
                const { openChatManagerModal } = await import('./ui/modals/management/chat-manager-modal.js');
                await openChatManagerModal(settings);
            } catch (error) {
                toastr.error(`Could not open chat manager: ${error?.message || error}`);
            }
        },
        onOpenInterpretiveReview: async () => {
            try {
                const { openInterpretiveReviewModal } = await import('./ui/modals/management/interpretive-review-modal.js');
                await openInterpretiveReviewModal();
            } catch (error) {
                toastr.error(`Could not open interpretive review queue: ${error?.message || error}`);
            }
        },
        onOpenVisibility: async () => {
            try {
                const { openVisibilityModal } = await import('./ui/modals/management/visibility-modal.js');
                await openVisibilityModal(settings);
            } catch (error) {
                toastr.error(`Could not open visibility manager: ${error?.message || error}`);
            }
        },
        onOpenCleanContext: async () => {
            try {
                const { openCleanContextModal } = await import('./ui/modals/configuration/clean-context-modal.js');
                await openCleanContextModal(settings);
            } catch (error) {
                toastr.error(`Could not open context cleanup: ${error?.message || error}`);
            }
        },
        onOpenRagDebug: async () => {
            try {
                if (!getActiveRagSettings(settings)?.enabled) {
                    toastr.warning('RAG is disabled. Enable it in RAG settings first.');
                    return;
                }
                const { openRagDebugModal } = await import('./ui/modals/management/rag-debug-modal.js');
                await openRagDebugModal(getActiveRagSettings(settings));
            } catch (error) {
                toastr.error(`Could not open RAG debug: ${error?.message || error}`);
            }
        },
        onManageCollections: async () => {
            try {
                const { openCollectionManagerModal } = await import('./ui/modals/management/collection-manager-modal.js');
                await openCollectionManagerModal(settings);
            } catch (error) {
                toastr.error(`Could not open collection manager: ${error?.message || error}`);
            }
        },
        onOpenRagHistory: async () => {
            try {
                const { openRagHistoryModal } = await import('./ui/modals/management/rag-history-modal.js');
                await openRagHistoryModal();
            } catch (error) {
                toastr.error(`Could not open RAG history: ${error?.message || error}`);
            }
        },
        getLastSummarizedIndex: () => lastSummarizedIndex,
    });

    // Setup visibility observer to detect /hide /unhide commands
    setupVisibilityObserver();

    // Apply visibility on load (use async to properly await)
    setTimeout(async () => {
        await applyVisibilitySettings(settings);
        await reconcileCorpusIntegrity({
            reason: 'initial-load',
        });
        cacheCurrentChatState();
    }, 1000);

    // Register event handlers
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, messageType) => onNewMessage(messageId, messageType, event_types.MESSAGE_RECEIVED));
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    if (event_types.CHAT_LOADED) {
        eventSource.on(event_types.CHAT_LOADED, onChatLoaded);
    }
    if (event_types.MESSAGE_DELETED) {
        eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    }
    if (event_types.MESSAGE_INSERTED) {
        eventSource.on(event_types.MESSAGE_INSERTED, onMessageInserted);
    }
    if (event_types.MESSAGE_EDITED) {
        eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
    }
    if (event_types.MESSAGE_SENT) {
        eventSource.on(event_types.MESSAGE_SENT, (messageId, messageType) => onNewMessage(messageId, messageType, event_types.MESSAGE_SENT));
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    }
    if (event_types.MESSAGE_UPDATED) {
        eventSource.on(event_types.MESSAGE_UPDATED, onMessageUpdated);
    }

    // Initialize RAG collection lifecycle (cleanup on chat delete)
    initCollectionLifecycle();

    // Register retrieval interceptor for generation pipeline.
    globalThis[GENERATE_INTERCEPTOR_KEY] = rearrangeChat;
    if (typeof globalThis[GENERATE_INTERCEPTOR_KEY] !== 'function') {
        log.warn(
            `Failed to register generation interceptor "${GENERATE_INTERCEPTOR_KEY}". ` +
            `RAG retrieval will not run on send. Ensure manifest.generate_interceptor matches this key.`
        );
    }

    // Ensure stale RAG prompt text is cleared when RAG is disabled.
    const activeRag = getActiveRagSettings(settings);
    if (!activeRag?.enabled) {
        clearRagPromptInjection();
    }

    log.log('Initialized successfully');
});


