/**
 * API communication for Summary Sharder
 */
import { getActivePrompt } from '../summarization/prompts.js';
import { buildLengthInstruction } from '../summarization/length-utils.js';
import { handleSummaryResult } from '../summarization/output.js';
import { log } from '../logger.js';
import {
    addHiddenRange,
    subtractHiddenRange,
    shiftRangesOnInsert,
    recomputeVisibility
} from '../chat/range-operations.js';
import { SHARD_ARTIFACT_KINDS } from '../summarization/shard-integrity-core.js';
import { refreshCurrentChatShardIntegrity } from '../summarization/shard-integrity-runtime.js';
import { Popup, POPUP_RESULT } from '../../../../../popup.js';
import { extractDraftEvents, generateDraftSummary } from './casing-api.js';

// Import shared API client functions
import { callSillyTavernAPI, callExternalAPI, normalizeApiUrl } from './api-client.js';
import { callConnectionProfileAPI } from './connection-profile-api.js';

// Import abort controller
import {
    createAbortController,
    getAbortSignal,
    clearAbortController,
    abortCurrentOperation,
    throwIfAborted
} from './abort-controller.js';

// Import SillyTavern's getRequestHeaders for API calls
import { getRequestHeaders } from '../../../../../../script.js';

// Import feature API resolver
import { getFeatureApiSettings } from './feature-api-config.js';
import { startUiOperation, endUiOperation } from './api-ui-helpers.js';

// Import from index to update last summarized index
let setLastSummarizedIndexFn = null;

export function setLastSummarizedIndexCallback(fn) {
    setLastSummarizedIndexFn = fn;
}

// Import and re-export getAllMessages from its canonical location
import { getAllMessages } from '../chat/chat-state.js';
export { getAllMessages };

import { buildChatText } from '../chat/chat-text-builder.js';

// Import and re-export applyContextCleanup from its canonical location
import { applyContextCleanup } from '../processing/context-cleanup.js';
export { applyContextCleanup };

/**
 * Call the appropriate API based on settings
 */
async function callSummaryAPI(settings, systemPrompt, userPrompt) {
    // Get effective API settings for summary feature
    const effectiveSettings = await getFeatureApiSettings(settings, 'summary');

    const options = {
        temperature: effectiveSettings.temperature,
        topP: effectiveSettings.topP,
        maxTokens: effectiveSettings.maxTokens,
        signal: getAbortSignal(),
        messageFormat: effectiveSettings.messageFormat,
        removeStopStrings: effectiveSettings.removeStopStrings === true
    };

    if (effectiveSettings.useSillyTavernAPI) {
        return await callSillyTavernAPI(systemPrompt, userPrompt, options);
    } else if (effectiveSettings.useConnectionProfile) {
        return await callConnectionProfileAPI(effectiveSettings.connectionProfileId, systemPrompt, userPrompt, options);
    } else {
        // Pass system and user prompts separately for proper backend routing
        return await callExternalAPI(effectiveSettings, systemPrompt, userPrompt, options);
    }
}

/**
 * Parse summary response to extract keywords
 * Looks for "KEYWORDS:" line at end of response
 * @returns {{ summary: string, keywords: string[] }}
 */
function parseSummaryResponse(response) {
    const trimmed = (response || '').trimEnd();
    const keywordsMatch = trimmed.match(/\nKEYWORDS:\s*(.+)$/i);
    if (keywordsMatch) {
        const keywords = keywordsMatch[1]
            .split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0);
        const summary = trimmed.replace(/\nKEYWORDS:\s*.+$/i, '').trim();
        return { summary, keywords };
    }
    return { summary: response, keywords: [] };
}

/**
 * Run summarization on a message range
 */
/**
 * Fetch models from external API via SillyTavern's backend
 * Uses CUSTOM source so the API key is read server-side (not visible in request body)
 */
export async function fetchExternalModels(settings) {
    if (!settings.apiUrl) throw new Error('API URL is not configured');
    if (!settings.apiKey) throw new Error('API Key is not configured');

    // Normalize URL to base (without /models)
    const baseUrl = normalizeApiUrl(settings.apiUrl);

    try {
        // Route through SillyTavern's status endpoint using CUSTOM source
        // API key passed via custom_include_headers to avoid mutating the shared api_key_custom slot
        const requestBody = {
            chat_completion_source: 'custom',
            custom_url: baseUrl
        };

        if (settings.apiKey) {
            requestBody.custom_include_headers = `Authorization: "Bearer ${settings.apiKey}"`;
        }

        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Handle standard OpenAI format: { "object": "list", "data": [...] }
        if (data.data && Array.isArray(data.data)) {
            return data.data;
        }
        // Handle direct array format used by some community proxies
        if (Array.isArray(data)) {
            return data;
        }

        log.warn('Unexpected models response format:', data);
        return [];
    } catch (error) {
        log.error('Error fetching models:', error);
        throw error;
    }
}

// ============================================================================
// SUMMARY REVIEW HELPERS
// ============================================================================

/**
 * Check if this is the first summary for the current chat
 * @returns {boolean}
 */
function isFirstSummaryForChat() {
    const context = SillyTavern.getContext();
    const chat = context?.chat || [];

    // Check if any summary messages exist in current chat
    const hasSummary = chat.some(msg =>
        msg.mes && (msg.mes.includes('[MEMORY SHARD:') || msg.mes.includes('[SUMMARY:'))
    );

    return !hasSummary;
}

/**
 * Check if the active prompt changed since last run
 * Uses chat metadata to track last used prompt
 * @param {Object} settings
 * @returns {boolean}
 */
function hasPromptChangedSinceLastRun(settings) {
    const currentPromptName = settings.activePromptName;
    const context = SillyTavern.getContext();
    const metadata = context?.chat_metadata?.summary_sharder || {};
    const lastPromptName = metadata.lastUsedPromptName;

    // First run or prompt changed
    if (!lastPromptName || lastPromptName !== currentPromptName) {
        return true;
    }
    return false;
}

/**
 * Save the current prompt name to chat metadata for change detection
 * @param {Object} settings
 */
function savePromptNameToMetadata(settings) {
    const context = SillyTavern.getContext();
    if (!context?.chat_metadata) return;

    if (!context.chat_metadata.summary_sharder) {
        context.chat_metadata.summary_sharder = {};
    }
    context.chat_metadata.summary_sharder.lastUsedPromptName = settings.activePromptName;
}

/**
 * Estimate token count using simple word-based heuristic
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).length;
    return Math.round(words * 1.3);
}

function resolveOutputArtifactKind(settings, outputMode) {
    if (outputMode === 'system') {
        return settings?.sharderMode === true
            ? SHARD_ARTIFACT_KINDS.SYSTEM_SHARD
            : SHARD_ARTIFACT_KINDS.SYSTEM_SUMMARY;
    }
    return SHARD_ARTIFACT_KINDS.LOREBOOK_SUMMARY;
}

// ============================================================================
// ADVANCED SUMMARIZATION
// ============================================================================

/**
 * Run advanced summarization with event extraction and user review
 */
async function runAdvancedSummarization(messages, startIndex, endIndex, settings, isQueueContext, insertAfterUID) {
    let progressToast = null;

    // Show extraction progress
    progressToast = toastr.info(
        `Extracting events from messages ${startIndex} to ${endIndex}...`,
        'Event Extraction',
        { timeOut: 0, extendedTimeOut: 0 }
    );

    // 1. Extract events
    let events;
    let originalContextWordCount;
    try {
        throwIfAborted('event extraction');
        const extractionResult = await extractDraftEvents(messages, startIndex, endIndex, settings);
        throwIfAborted('event extraction');
        events = extractionResult.events;
        originalContextWordCount = extractionResult.originalContextWordCount;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw error;
        }
        if (progressToast) toastr.clear(progressToast);
        toastr.error(`Event extraction failed: ${error.message}`);
        return;
    }

    if (progressToast) toastr.clear(progressToast);

    if (!events || events.length === 0) {
        toastr.error('No events extracted. Cannot proceed with advanced summary.');
        return;
    }

    toastr.success(`Extracted ${events.length} events`);

    // 2. Show modal for user review
    const { openDraftingModal } = await import('../../ui/modals/summarization/drafting-modal.js');
    throwIfAborted('event review');
    const result = await openDraftingModal(events, messages, startIndex, endIndex, settings, originalContextWordCount);
    throwIfAborted('event review');

    if (!result.confirmed) {
        toastr.info('Summary cancelled');
        return;
    }

    // 3. Filter to selected events only
    const selectedEvents = result.events.filter(e => e.selected);

    if (selectedEvents.length === 0) {
        toastr.warning('No events selected. Summary cancelled.');
        return;
    }

    // 4. Generate summary from selected events
    progressToast = toastr.info(
        `Generating summary from ${selectedEvents.length} selected events...`,
        'Generating Summary',
        { timeOut: 0, extendedTimeOut: 0 }
    );

    // Get the final word count (may have been updated during regeneration in drafting modal)
    const finalWordCount = result.originalContextWordCount ?? originalContextWordCount;

    // Determine if keyword extraction is needed (lorebook mode with extraction enabled)
    const extractKeywords = settings.outputMode === 'lorebook' &&
        settings.lorebookEntryOptions?.extractKeywords !== false;

    try {
        throwIfAborted('summary generation');
        const rawSummaryResult = await generateDraftSummary(selectedEvents, settings, '', finalWordCount, extractKeywords);
        throwIfAborted('summary generation');

        // Parse keywords from the response (stripped before showing in UI)
        const { summary: summaryResult, keywords: extractedKeywords } = parseSummaryResponse(rawSummaryResult);

        if (extractedKeywords.length > 0) {
            log.log(`Extracted keywords (advanced): ${extractedKeywords.join(', ')}`);
        }

        if (progressToast) toastr.clear(progressToast);

        // 5. Summary Review Modal (if enabled)
        const { openSummaryReviewModal, shouldShowSummaryReviewModal } =
            await import('../../ui/modals/summarization/summary-review-modal.js');

        const reviewContext = {
            settings,
            isFirstSummary: isFirstSummaryForChat(),
            promptChanged: hasPromptChangedSinceLastRun(settings),
            tokenCount: estimateTokenCount(summaryResult)
        };

        let finalSummary = summaryResult;
        let archiveOptions = null;

        if (shouldShowSummaryReviewModal(reviewContext)) {
            // Create regenerate callback - uses original context word count for consistent length
            const regenerateCallback = async (userNote) => {
                throwIfAborted('summary regenerate');
                const raw = await generateDraftSummary(selectedEvents, settings, userNote, finalWordCount, extractKeywords);
                throwIfAborted('summary regenerate');
                const { summary } = parseSummaryResponse(raw);
                return summary;
            };

            throwIfAborted('summary review');
            const reviewResult = await openSummaryReviewModal(
                summaryResult,
                selectedEvents,
                settings,
                regenerateCallback
            );
            throwIfAborted('summary review');

            if (!reviewResult.confirmed) {
                toastr.info('Summary cancelled');
                return;
            }

            finalSummary = reviewResult.finalSummary;
            archiveOptions = reviewResult.archiveOptions || null;
        }

        // Save prompt name to metadata for change detection
        savePromptNameToMetadata(settings);

        // 6. Handle result (same as normal flow)
        throwIfAborted('summary output');
        const outputResult = await handleSummaryResult(
            settings,
            finalSummary,
            startIndex,
            endIndex,
            isQueueContext,
            extractedKeywords,
            insertAfterUID,
            archiveOptions
        );

        // Update tracking
        if (setLastSummarizedIndexFn) {
            setLastSummarizedIndexFn(endIndex);
        }

        // Handle range updates only when output is injected.
        if (outputResult.didInjectToContext) {
            if (outputResult.mode === 'system') {
                const insertionIndex = endIndex + 1;
                // Shift existing ranges first (summary message was inserted at endIndex + 1)
                await shiftRangesOnInsert(insertionIndex, 1, { skipVisibilityUpdate: true });
                // Add new hidden range for the summarized messages
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
                // Ensure summary message itself is not hidden
                await subtractHiddenRange(insertionIndex, insertionIndex, { skipVisibilityUpdate: true });
            } else {
                // Lorebook mode - just add range (no insertion happened)
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
            }

            // Final visibility update
            await recomputeVisibility();

            await refreshCurrentChatShardIntegrity({
                reason: 'advanced-summary-saved',
                registerOutput: {
                    outputUID: outputResult.outputUID,
                    artifactKind: resolveOutputArtifactKind(settings, outputResult.mode),
                    startIndex,
                    endIndex,
                },
            });
        }

        toastr.success('Summarization complete!');

    } catch (error) {
        if (error?.name === 'AbortError') {
            if (progressToast) toastr.clear(progressToast);
            throw error;
        }
        if (progressToast) toastr.clear(progressToast);
        log.error('Advanced summarization failed:', error);
        toastr.error(`Summarization failed: ${error.message}`);
    }
}

export async function runSummarization(startIndex, endIndex, settings, isQueueContext = false, insertAfterUID = null) {
    const messages = getAllMessages();
    let operationStarted = false;
    let opId = null;
    const originalText = 'Summarize Now';
    let progressToast = null;

    if (!messages || messages.length === 0) {
        toastr.warning('No messages to summarize');
        return;
    }

    // Create abort controller if not in queue context (queue has its own)
    if (!isQueueContext) {
        createAbortController();
        operationStarted = true;
        opId = startUiOperation({
            feature: 'summary',
            primaryButton: 'ss-run-summarize',
            disabled: true,
            label: 'Summarizing...',
            lockButtons: [],
            showStop: true,
        });
    }

    try {
        // Check for advanced user control mode
        if (settings.advancedUserControl) {
            return await runAdvancedSummarization(messages, startIndex, endIndex, settings, isQueueContext, insertAfterUID);
        }

        // Always honor hidden-message filtering even when full cleanup is disabled.
        const cleanupForBuild = settings.contextCleanup?.enabled
            ? settings.contextCleanup
            : { stripHiddenMessages: settings.contextCleanup?.stripHiddenMessages !== false };
        let chatText = buildChatText(messages, startIndex, endIndex, { cleanup: cleanupForBuild });

        // Apply context cleanup if enabled
        if (settings.contextCleanup?.enabled) {
            chatText = applyContextCleanup(chatText, settings.contextCleanup);
        }

        if (!chatText.trim()) {
            toastr.warning('Selected message range is empty');
            return;
        }

        const summaryPrompt = getActivePrompt(settings);

        if (!summaryPrompt) {
            toastr.error('No summary prompt selected');
            return;
        }

        // Prepare system and user prompts separately for SillyTavern API
        const systemPrompt = summaryPrompt;

        // Check if keyword extraction is enabled for lorebook mode
        const extractKeywords = settings.outputMode === 'lorebook' &&
            settings.lorebookEntryOptions?.extractKeywords !== false;

        let userPrompt = `CHAT CONTENT TO PROCESS (Messages ${startIndex} to ${endIndex}):

${chatText}`;

        // Add length control instruction if enabled
        if (settings.summaryLengthControl) {
            userPrompt += buildLengthInstruction(chatText, settings.summaryLengthPercent || 10);
        }

        // Add keyword extraction instruction if enabled
        if (extractKeywords) {
            userPrompt += `

---
After your summary, on a new line, provide exactly 5 keywords that capture the key characters, locations, events, or topics from this content. Format as:
KEYWORDS: keyword1, keyword2, keyword3, keyword4, keyword5`;
        }

        // Show progress notification
        progressToast = toastr.info(
            `Processing messages ${startIndex} to ${endIndex}...`,
            'Generating Summary',
            { timeOut: 0, extendedTimeOut: 0 }
        );

        log.log(`Summarizing messages ${startIndex} to ${endIndex}...`);

        throwIfAborted('summary request');
        const rawResult = await callSummaryAPI(settings, systemPrompt, userPrompt);
        throwIfAborted('summary response');

        // Parse keywords from response if extraction was requested
        const { summary: summaryResult, keywords: extractedKeywords } = parseSummaryResponse(rawResult);

        if (extractedKeywords.length > 0) {
            log.log(`Extracted keywords: ${extractedKeywords.join(', ')}`);
        }

        // Clear progress toast before showing modal
        if (progressToast) {
            toastr.clear(progressToast);
            progressToast = null;
        }

        // Summary Review Modal (simplified mode - no events)
        const { openSummaryReviewModal, shouldShowSummaryReviewModal } =
            await import('../../ui/modals/summarization/summary-review-modal.js');

        const reviewContext = {
            settings,
            isFirstSummary: isFirstSummaryForChat(),
            promptChanged: hasPromptChangedSinceLastRun(settings),
            tokenCount: estimateTokenCount(summaryResult)
        };

        let finalSummary = summaryResult;
        let archiveOptions = null;

        if (shouldShowSummaryReviewModal(reviewContext)) {
            // Create regenerate callback
            const regenerateCallback = async (userNote) => {
                throwIfAborted('summary regenerate');
                const notePrompt = userNote ? `\n\nUSER NOTE: ${userNote}` : '';
                const newUserPrompt = userPrompt + notePrompt;
                const rawResult = await callSummaryAPI(settings, systemPrompt, newUserPrompt);
                throwIfAborted('summary regenerate');
                const { summary } = parseSummaryResponse(rawResult);
                return summary;
            };

            throwIfAborted('summary review');
            const reviewResult = await openSummaryReviewModal(
                summaryResult,
                null,  // No events in standard flow (simplified mode)
                settings,
                regenerateCallback
            );
            throwIfAborted('summary review');

            if (!reviewResult.confirmed) {
                toastr.info('Summary cancelled');
                return;
            }

            finalSummary = reviewResult.finalSummary;
            archiveOptions = reviewResult.archiveOptions || null;
        }

        // Save prompt name for change detection
        savePromptNameToMetadata(settings);

        throwIfAborted('summary output');
        const outputResult = await handleSummaryResult(
            settings,
            finalSummary,
            startIndex,
            endIndex,
            isQueueContext,
            extractedKeywords,
            insertAfterUID,
            archiveOptions
        );

        // Update tracking
        if (setLastSummarizedIndexFn) {
            setLastSummarizedIndexFn(endIndex);
        }

        // Handle range updates only when output is injected.
        if (outputResult.didInjectToContext) {
            if (outputResult.mode === 'system') {
                const insertionIndex = endIndex + 1;
                // Shift existing ranges first (summary message was inserted at endIndex + 1)
                await shiftRangesOnInsert(insertionIndex, 1, { skipVisibilityUpdate: true });
                // Add new hidden range for the summarized messages
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
                // Ensure summary message itself is not hidden
                await subtractHiddenRange(insertionIndex, insertionIndex, { skipVisibilityUpdate: true });
            } else {
                // Lorebook mode - just add range (no insertion happened)
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
            }

            // Final visibility update (applies all changes at once)
            await recomputeVisibility();

            await refreshCurrentChatShardIntegrity({
                reason: 'summary-saved',
                registerOutput: {
                    outputUID: outputResult.outputUID,
                    artifactKind: resolveOutputArtifactKind(settings, outputResult.mode),
                    startIndex,
                    endIndex,
                },
            });
        }

        // Clear progress toast
        if (progressToast) {
            toastr.clear(progressToast);
        }

        log.log('Summarization complete!');
        toastr.success('Summarization complete!');

    } catch (error) {
        // Clear progress toast
        if (progressToast) {
            toastr.clear(progressToast);
        }

        // Handle abort error gracefully
        if (error.name === 'AbortError') {
            log.log('Summarization aborted by user');
            if (!isQueueContext) {
                toastr.info('Summarization stopped');
            }
            if (isQueueContext) {
                throw error;
            }
            return;
        }

        log.error('Summarization failed:', error);
        toastr.error(`Summarization failed: ${error.message}`);
    } finally {
        if (operationStarted) {
            clearAbortController();
            endUiOperation({
                feature: 'summary',
                primaryButton: 'ss-run-summarize',
                disabled: false,
                label: originalText,
                lockButtons: [],
                showStop: false,
                opId,
            });
        }
    }
}

// ============================================================================
// STOP SUMMARIZATION
// ============================================================================

/**
 * Stop any running summarization operation
 * Aborts API calls and clears state
 */
export function stopSummarization() {
    abortCurrentOperation();
    toastr.info('Summarization stopped');
}

