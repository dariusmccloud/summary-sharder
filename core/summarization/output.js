/**
 * Output handling for Summary Sharder
 * Injects summaries as system messages or lorebook entries
 */

import { getSystemMessageByType } from '../../../../../../scripts/system-messages.js';
import {
    world_names,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
} from '../../../../../world-info.js';
import { chat_metadata, characters, this_chid, saveChatConditional, saveMetadata } from '../../../../../../script.js';
import { findIndexByUID } from '../processing/utils.js';
import { parseBannedKeywords, filterBannedKeywords } from '../processing/keyword-filter.js';
import { refreshMultipleLorebooksUI } from '../processing/lorebook-refresh.js';
import { log, ragLog } from '../logger.js';
import {
    resolveShardChunkingMode,
    vectorizeShard,
    vectorizeShardSectionAware,
    vectorizeStandardSummary,
} from '../rag/vectorize.js';
import {
    getQdrantDimensionMismatchToastMessage,
    isQdrantDimensionMismatchError,
} from '../rag/vector-client.js';
import { archiveToWarm, archiveToCold } from '../rag/archive.js';
import { throwIfAborted } from '../api/abort-controller.js';
import { ARCHITECTURAL_PROFILE } from './sharder-section-registry.js';
import { isWarmArchiveEligible } from './architectural-sharder-shell.js';
import { buildArchitecturalShardMetadata } from './saved-shard-identity.js';

// World info metadata key
const METADATA_KEY = 'world_info';

/**
 * Handle the summary result based on output mode
 * @param {Object} settings - Extension settings
 * @param {string} summary - The generated summary text
 * @param {number} startIndex - Start message index
 * @param {number} endIndex - End message index
 * @param {boolean} _isQueueContext - Unused, kept for API compatibility
 * @param {string[]} extractedKeywords - AI-extracted keywords from the summary
 * @param {string|null} insertAfterUID - UID (send_date) of message to insert after
 * @param {{injectToContext?: boolean, archiveWarm?: boolean, archiveCold?: boolean}|null} archiveOptions
 * @param {Object|null} resultMetadata
 * @param {{skipDomMesidUpdate?: boolean}|null} options
 * @returns {Promise<{didInjectToContext: boolean, mode: 'system'|'lorebook', outputUID: string|null, successCount?: number}>}
 */
export async function handleSummaryResult(
    settings,
    summary,
    startIndex,
    endIndex,
    _isQueueContext = false,
    extractedKeywords = [],
    insertAfterUID = null,
    archiveOptions = null,
    resultMetadata = null,
    options = null
) {
    throwIfAborted('summary output');
    const mode = settings?.outputMode === 'lorebook' ? 'lorebook' : 'system';
    let outputUID = null;
    let didInjectToContext = false;
    let successCount;
    const resolvedArchiveOptions = {
        injectToContext: true,
        archiveWarm: false,
        archiveCold: false,
        ...(archiveOptions || {})
    };
    const shouldInjectToContext = resolvedArchiveOptions.injectToContext !== false;
    const architecturalMetadata = settings?.sharderMode === true && settings?.sharderProfile === ARCHITECTURAL_PROFILE
        ? buildArchitecturalShardMetadata(summary)
        : {};

    if (shouldInjectToContext) {
        const isSharder = settings?.sharderMode === true;
        if (mode === 'system') {
            const systemResult = await insertSystemMessage(summary, startIndex, endIndex, insertAfterUID, options, isSharder);
            didInjectToContext = systemResult.didInjectToContext;
            outputUID = systemResult.outputUID;
        } else {
            const lorebookResult = await saveToLorebook(summary, startIndex, endIndex, settings, extractedKeywords);
            successCount = lorebookResult.successCount;
            didInjectToContext = lorebookResult.successCount > 0;
            outputUID = lorebookResult.firstUID;
        }
    }

    throwIfAborted('summary output');
    if (didInjectToContext) {
        if (resultMetadata?.architecturalDecisionCapacityOverride) {
            await persistArchitecturalDecisionCapacityOverride(
                outputUID,
                mode,
                startIndex,
                endIndex,
                resultMetadata.architecturalDecisionCapacityOverride
            );
        }

        if (settings?.sharderMode === true) {
            // Sharder mode: section-aware or standard shard vectorization
            if (settings?.rag?.enabled && settings?.rag?.autoVectorizeNewSummaries !== false) {
                try {
                    if (settings?.sharderProfile === ARCHITECTURAL_PROFILE) {
                        await vectorizeShard(summary, startIndex, endIndex, settings, extractedKeywords);
                    } else {
                        const mode = resolveShardChunkingMode(settings?.rag);
                        if (mode === 'section') {
                            await vectorizeShardSectionAware(summary, startIndex, endIndex, settings, extractedKeywords);
                        } else {
                            await vectorizeShard(summary, startIndex, endIndex, settings, extractedKeywords);
                        }
                    }
                } catch (error) {
                    const backend = String(settings?.rag?.backend || '').toLowerCase();
                    if (backend === 'qdrant' && isQdrantDimensionMismatchError(error) && typeof toastr !== 'undefined') {
                        toastr.error(getQdrantDimensionMismatchToastMessage());
                    }
                    ragLog.warn('Failed to vectorize shard after summary save:', error?.message || error);
                }
            }
        } else {
            // Standard mode: prose vectorization into ss_standard_* collection
            if (settings?.ragStandard?.enabled && settings?.ragStandard?.autoVectorizeNewSummaries !== false) {
                try {
                    await vectorizeStandardSummary(summary, startIndex, endIndex, settings, extractedKeywords);
                } catch (error) {
                    const backend = String(settings?.ragStandard?.backend || '').toLowerCase();
                    if (backend === 'qdrant' && isQdrantDimensionMismatchError(error) && typeof toastr !== 'undefined') {
                        toastr.error(getQdrantDimensionMismatchToastMessage());
                    }
                    ragLog.warn('Failed to vectorize standard summary after save:', error?.message || error);
                }
            }
        }
    }

    throwIfAborted('summary output');
    if (didInjectToContext && resolvedArchiveOptions.archiveWarm) {
        const skipWarmArchive = settings?.sharderMode === true
            && !isWarmArchiveEligible(settings?.sharderProfile, settings?.rag?.enabled === true);
        if (skipWarmArchive) {
            ragLog.info('Warm archive skipped for Architectural Memory; architectural RAG support is deferred.');
        } else {
        const warmResult = await archiveToWarm(
            [{ text: summary, source: 'output-summary' }],
            startIndex,
            endIndex,
            settings,
            { source: 'output-summary', extra: { outputMode: settings?.outputMode || 'system' } }
        );
        if (!warmResult.success && warmResult.reason !== 'rag-disabled') {
            ragLog.warn('Warm archive failed for output summary:', warmResult.error || warmResult.reason);
        }
        }
    }

    throwIfAborted('summary output');
    if (didInjectToContext && resolvedArchiveOptions.archiveCold) {
        const coldResult = await archiveToCold(
            [{ text: summary, source: 'output-summary' }],
            startIndex,
            endIndex,
            null,
            {
                source: 'output-summary',
                extra: {
                    outputMode: settings?.outputMode || 'system',
                    ...architecturalMetadata,
                }
            }
        );
        if (!coldResult.success) {
            ragLog.warn('Cold archive failed for output summary:', coldResult.error || coldResult.reason);
        }
    }

    return {
        didInjectToContext,
        mode,
        outputUID,
        ...(mode === 'lorebook' ? { successCount: successCount || 0 } : {})
    };
}

async function persistArchitecturalDecisionCapacityOverride(outputUID, mode, startIndex, endIndex, overrideMetadata) {
    if (!chat_metadata.summary_sharder) {
        chat_metadata.summary_sharder = {};
    }
    if (!Array.isArray(chat_metadata.summary_sharder.architecturalDecisionCapacityOverrides)) {
        chat_metadata.summary_sharder.architecturalDecisionCapacityOverrides = [];
    }

    chat_metadata.summary_sharder.architecturalDecisionCapacityOverrides.push({
        outputUID: outputUID || null,
        mode,
        startIndex,
        endIndex,
        justification: String(overrideMetadata?.justification || '').trim(),
        decisionMetrics: overrideMetadata?.decisionMetrics || null,
        timestamp: Number.isFinite(overrideMetadata?.timestamp) ? overrideMetadata.timestamp : Date.now(),
    });

    await saveMetadata();
}

/**
 * Insert summary as a system message
 * @param {string} content - The summary content
 * @param {number} startIndex - Original start message index (for labeling)
 * @param {number} endIndex - Original end message index (for labeling and fallback positioning)
 * @param {string|null} insertAfterUID - UID (send_date) of message to insert after
 * @param {{skipDomMesidUpdate?: boolean}|null} options
 * @param {boolean} isSharder - Whether this is a Sharder Mode summary
 * @returns {Promise<{didInjectToContext: boolean, outputUID: string|null}>}
 */
async function insertSystemMessage(content, startIndex, endIndex, insertAfterUID = null, options = null, isSharder = false) {
    const tag = isSharder ? 'MEMORY SHARD' : 'SUMMARY';
    const formattedContent = `[${tag}: Messages ${startIndex}-${endIndex}]

${content}`;

    const context = SillyTavern.getContext();

    if (!context || !context.chat) {
        log.warn('Could not access chat context');
        toastr.warning('Could not insert system message. Summary logged to console.');
        log.log('=== SUMMARY OUTPUT ===\n', formattedContent);
        return { didInjectToContext: false, outputUID: null };
    }

    // Create system message object using SillyTavern's factory
    const systemMessage = getSystemMessageByType('generic', formattedContent);

    // Keep summary message visible - it should not be hidden with the summarized range
    if (systemMessage) {
        systemMessage.is_system = false;
    }

    if (!systemMessage) {
        log.warn('Could not create system message');
        toastr.warning('Could not insert system message. Summary logged to console.');
        log.log('=== SUMMARY OUTPUT ===\n', formattedContent);
        return { didInjectToContext: false, outputUID: null };
    }

    // Resolve actual insertion index
    let insertionIndex;

    if (insertAfterUID) {
        // UID-based: find current position of the target message
        const resolvedIndex = findIndexByUID(context.chat, insertAfterUID);
        if (resolvedIndex === -1) {
            // Message was deleted during processing - fallback to end
            log.warn('Target message not found (deleted?), inserting at end');
            context.chat.push(systemMessage);
            context.addOneMessage(systemMessage);
            await saveChatConditional();
            return { didInjectToContext: true, outputUID: systemMessage.send_date || null };
        }
        insertionIndex = resolvedIndex + 1;
    } else {
        // No UID provided (single summarization) - use original endIndex
        insertionIndex = endIndex + 1;
    }

    // Insert into chat array at resolved position
    context.chat.splice(insertionIndex, 0, systemMessage);

    // Pre-increment mesids BEFORE addOneMessage so that when MESSAGE_INSERTED fires
    // and triggers applyVisibilitySettings, the mesid→index mapping is already correct.
    // Use >= (not >) because the new element doesn't exist yet — all elements at or after
    // insertionIndex need to shift up by 1 to make room.
    // Only update messages that exist in the DOM — don't re-index based on DOM order
    // (SillyTavern may use lazy loading so not all messages are in DOM)
    if (options?.skipDomMesidUpdate !== true) {
        const messageElements = document.querySelectorAll('#chat .mes');
        messageElements.forEach((el) => {
            const currentMesid = parseInt(el.getAttribute('mesid'), 10);
            if (!isNaN(currentMesid) && currentMesid >= insertionIndex) {
                el.setAttribute('mesid', currentMesid + 1);
            }
        });
    }

    // Add to DOM at correct position — MESSAGE_INSERTED event will now see correct mesids
    // Note: Do NOT use forceId as it causes mesid desync with messages after the insertion point
    context.addOneMessage(systemMessage, {
        insertAfter: insertionIndex - 1,
        scroll: false
    });

    // In batch mode we reconcile mesids later; tag the inserted summary element so
    // reconciliation can skip only the true inserted row, not every row sharing mesid.
    if (options?.skipDomMesidUpdate === true) {
        const summaryHeader = `[${isSharder ? 'MEMORY SHARD' : 'SUMMARY'}: Messages ${startIndex}-${endIndex}]`;
        const candidates = document.querySelectorAll(`#chat .mes[mesid="${insertionIndex}"]`);
        for (const el of candidates) {
            const text = el.querySelector('.mes_text')?.textContent || '';
            if (text.includes(summaryHeader)) {
                el.setAttribute('data-ss-batch-summary', '1');
                break;
            }
        }
    }

    // Save the chat to persist the new message
    throwIfAborted('summary output');
    await saveChatConditional();

    log.log(`Inserted system message at position ${insertionIndex} (after message ${insertionIndex - 1})`);

    // Return the UID of the created message
    return {
        didInjectToContext: true,
        outputUID: systemMessage.send_date || null
    };
}

/**
 * Get list of target lorebook names based on settings
 */
function getTargetLorebooks(settings) {
    const targets = [];
    const selection = settings.lorebookSelection || {};

    // Character book
    if (selection.useCharacterBook) {
        // Check for character-bound lorebook
        const charData = characters[this_chid];
        if (charData?.data?.extensions?.world) {
            // Character has a bound world info
            const charWorldName = charData.data.extensions.world;
            if (world_names.includes(charWorldName)) {
                targets.push({ name: charWorldName, type: 'character' });
            }
        }
    }

    // Chat history book
    if (selection.useChatBook) {
        const chatBook = chat_metadata[METADATA_KEY];
        if (chatBook && world_names.includes(chatBook)) {
            // Avoid duplicates
            if (!targets.some(t => t.name === chatBook)) {
                targets.push({ name: chatBook, type: 'chat' });
            }
        }
    }

    // Custom selected books
    if (selection.useCustomBooks && selection.customBookNames?.length > 0) {
        for (const name of selection.customBookNames) {
            if (world_names.includes(name)) {
                // Avoid duplicates
                if (!targets.some(t => t.name === name)) {
                    targets.push({ name, type: 'custom' });
                }
            }
        }
    }

    return targets;
}

/**
 * Format entry name using template
 */
function formatEntryName(template, startIndex, endIndex) {
    const context = SillyTavern.getContext();
    const charName = context?.name2 || 'Character';
    const date = new Date().toISOString().split('T')[0];

    return template
        .replace(/{start}/g, startIndex)
        .replace(/{end}/g, endIndex)
        .replace(/{date}/g, date)
        .replace(/{character}/g, charName);
}

/**
 * Format keywords using AI-extracted keywords, templates, and settings
 * @param {Object} settings - Extension settings
 * @param {number} startIndex - Start message index
 * @param {number} endIndex - End message index
 * @param {string[]} extractedKeywords - AI-extracted keywords from the summary
 * @returns {string[]} Array of keywords for the lorebook entry
 */
function formatKeywords(settings, startIndex, endIndex, extractedKeywords = []) {
    const options = settings.lorebookEntryOptions || {};
    const keywords = [];

    // Primary: AI-extracted keywords (if enabled and available)
    if (options.extractKeywords !== false && extractedKeywords.length > 0) {
        keywords.push(...extractedKeywords);
    }

    // Secondary: Format-based keywords (if enabled and no AI keywords)
    if (keywords.length === 0 && options.keywordsEnabled !== false) {
        const keywordFormat = options.keywordFormat || 'summary_{start}_{end}';
        keywords.push(
            keywordFormat
                .replace(/{start}/g, startIndex)
                .replace(/{end}/g, endIndex)
        );
    }

    // Tertiary: User-defined additional keywords (always added if present)
    if (options.additionalKeywords) {
        const additional = options.additionalKeywords
            .split(',')
            .map(k => k.trim())
            .filter(k => k);
        keywords.push(...additional);
    }

    // Filter banned keywords
    const bannedSet = parseBannedKeywords(options.bannedKeywords);
    const filtered = filterBannedKeywords(keywords, bannedSet);
    keywords.length = 0;
    keywords.push(...filtered);

    // FALLBACK: Always ensure at least one keyword for lorebook entries
    // This prevents entries from being created with empty keywords
    if (keywords.length === 0) {
        const defaultKeyword = `memory_shard_${startIndex}_${endIndex}`;
        keywords.push(defaultKeyword);
    }

    return keywords;
}

/**
 * Get entry configuration based on entry type setting
 */
function getEntryConfig(entryType) {
    switch (entryType) {
        case 'constant':
            return { constant: true, disable: false, vectorized: false };
        case 'vectorized':
            return { constant: false, disable: false, vectorized: true };
        case 'disabled':
            return { constant: false, disable: true, vectorized: false };
        case 'normal':
        default:
            return { constant: false, disable: false, vectorized: false };
    }
}

/**
 * Save summary to a single lorebook
 * @param {string} lorebookName - Name of the lorebook to save to
 * @param {string} summaryText - The summary content
 * @param {string} entryName - Name/comment for the entry
 * @param {string[]} keywords - Keywords for the entry
 * @param {Object} entryConfig - Entry configuration (constant, disable, vectorized)
 * @param {Object} orderConfig - Order configuration { strategy, endIndex, fixedValue }
 */
async function saveToSingleLorebook(lorebookName, summaryText, entryName, keywords, entryConfig, orderConfig) {
    try {
        throwIfAborted('summary output');
        // Load the lorebook data
        const data = await loadWorldInfo(lorebookName);
        if (!data || !data.entries) {
            throw new Error(`Could not load lorebook: ${lorebookName}`);
        }

        // Create new entry
        const newEntry = createWorldInfoEntry(lorebookName, data);
        if (!newEntry) {
            throw new Error(`Could not create entry in: ${lorebookName}`);
        }

        // Configure the entry
        newEntry.key = keywords;
        newEntry.content = summaryText;
        newEntry.comment = entryName;
        newEntry.constant = entryConfig.constant;
        newEntry.disable = entryConfig.disable;
        newEntry.vectorized = entryConfig.vectorized;
        newEntry.selective = !entryConfig.constant; // Non-constant entries should be selective

        // Set order based on strategy
        if (orderConfig.strategy === 'recency') {
            // Higher order for more recent summaries (capped at 999)
            newEntry.order = Math.min(orderConfig.endIndex, 999);
        } else if (orderConfig.strategy === 'fixed') {
            newEntry.order = orderConfig.fixedValue || 100;
        }
        // Default order (100) is already set by createWorldInfoEntry

        // Save the lorebook
        throwIfAborted('summary output');
        await saveWorldInfo(lorebookName, data, true);

        // Return the UID of the created entry
        return newEntry.uid || newEntry.id || true;
    } catch (error) {
        log.error(`Failed to save to ${lorebookName}:`, error);
        return false;
    }
}

/**
 * Save summary to all selected lorebooks
 * @param {string} summaryText - The summary content
 * @param {number} startIndex - Start message index
 * @param {number} endIndex - End message index
 * @param {Object} settings - Extension settings
 * @param {string[]} extractedKeywords - AI-extracted keywords from the summary
 * @returns {Promise<{successCount: number, firstUID: string|null}>}
 */
async function saveToLorebook(summaryText, startIndex, endIndex, settings, extractedKeywords = []) {
    const targets = getTargetLorebooks(settings);

    if (targets.length === 0) {
        // Fallback: try to use chat's world info or first available lorebook
        const chatWorldInfo = chat_metadata[METADATA_KEY];
        if (chatWorldInfo && world_names.includes(chatWorldInfo)) {
            targets.push({ name: chatWorldInfo, type: 'fallback-chat' });
        } else if (world_names.length > 0) {
            // Use first available lorebook as last resort
            targets.push({ name: world_names[0], type: 'fallback-first' });
        }

        if (targets.length === 0) {
            log.warn('No lorebooks available');
            toastr.warning('No target lorebooks configured or available. Please select at least one lorebook.');
            log.log('=== LOREBOOK ENTRY ===\n', summaryText);
            return { successCount: 0, firstUID: null };
        }

        log.log(`No lorebooks selected, using fallback: ${targets[0].name}`);
    }

    // Get entry configuration from settings
    const options = settings.lorebookEntryOptions || {};
    const defaultNameFormat = settings?.sharderMode === true ? 'Memory Shard {start}-{end}' : 'Summary {start}-{end}';
    const entryName = formatEntryName(
        options.nameFormat || defaultNameFormat,
        startIndex,
        endIndex
    );
    const keywords = formatKeywords(settings, startIndex, endIndex, extractedKeywords);
    const entryConfig = getEntryConfig(options.entryType || 'constant');
    const orderConfig = {
        strategy: options.orderStrategy || 'recency',
        endIndex: endIndex,
        fixedValue: options.fixedOrderValue || 100
    };

    // Save to all targets
    const results = [];
    let firstUID = null;
    for (const target of targets) {
        const result = await saveToSingleLorebook(
            target.name,
            summaryText,
            entryName,
            keywords,
            entryConfig,
            orderConfig
        );
        const success = result !== false;
        if (success && !firstUID && typeof result === 'string') {
            firstUID = result; // Capture UID from first successful save
        }
        results.push({ ...target, success });
    }

    // Report results
    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    // Refresh UI for all successfully saved lorebooks
    if (succeeded.length > 0) {
        const successfulBookNames = succeeded.map(r => r.name);
        refreshMultipleLorebooksUI(successfulBookNames);
    }

    if (failed.length === 0) {
        if (succeeded.length === 1) {
            toastr.success(`Summary saved to ${succeeded[0].name}`);
        } else {
            toastr.success(`Summary saved to ${succeeded.length} lorebook(s)`);
        }
        log.log(`Saved to: ${succeeded.map(r => r.name).join(', ')}`);
    } else if (succeeded.length === 0) {
        toastr.error('Failed to save to any lorebook');
        log.error('All saves failed:', failed.map(r => r.name));
        log.log('=== LOREBOOK ENTRY ===\n', `Name: ${entryName}\n`, `Keywords: ${keywords.join(', ')}\n`, `Content:\n${summaryText}`);
    } else {
        toastr.warning(`Saved to ${succeeded.length}/${results.length} lorebooks`);
        log.warn('Partial success. Failed:', failed.map(r => r.name));
    }

    return { successCount: succeeded.length, firstUID };
}
