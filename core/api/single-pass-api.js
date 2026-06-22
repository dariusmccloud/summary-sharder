/**
 * Sharder orchestration for Summary Sharder.
 */

import { getAllMessages } from '../chat/chat-state.js';
import { buildChatText } from '../chat/chat-text-builder.js';
import { applyContextCleanup } from '../processing/context-cleanup.js';
import { handleSummaryResult } from '../summarization/output.js';
import {
    addHiddenRange,
    subtractHiddenRange,
    shiftRangesOnInsert,
    recomputeVisibility
} from '../chat/range-operations.js';
import {
    createAbortController,
    clearAbortController,
    throwIfAborted
} from './abort-controller.js';
import { startUiOperation, endUiOperation } from './api-ui-helpers.js';
import { log } from '../logger.js';
import { ARCHITECTURAL_PROFILE, normalizeSharderProfile } from '../summarization/sharder-section-registry.js';

let isSharderRunning = false;

function buildEffectiveCleanupSettings(settings) {
    let effectiveCleanup = {
        stripHiddenMessages: settings.contextCleanup?.stripHiddenMessages !== false,
    };

    if (settings.contextCleanup?.enabled) {
        effectiveCleanup = {
            ...settings.contextCleanup,
            stripHiddenMessages: settings.contextCleanup?.stripHiddenMessages !== false,
            stripEmojis: false,
        };
    }

    return effectiveCleanup;
}

function buildSinglePassChatText(messages, startIndex, endIndex, settings) {
    const effectiveCleanup = buildEffectiveCleanupSettings(settings);

    let chatText = buildChatText(messages, startIndex, endIndex, {
        cleanup: effectiveCleanup,
        indexFormat: 'msg'
    });

    if (effectiveCleanup) {
        chatText = applyContextCleanup(chatText, effectiveCleanup);
    }

    return chatText;
}

async function runPipelineWithAnalysis(chatText, settings, startIndex, endIndex, selectedShards = [], extractKeywords = false) {
    const { runSharderPipeline } = await import('../sharder/single-pass-pipeline.js');
    const result = await runSharderPipeline(chatText, settings, {
        startIndex,
        endIndex,
        extractKeywords,
        existingShards: (selectedShards || []).map((s) => ({
            content: s.content,
            identifier: s.identifier,
            messageRangeStart: s.messageRangeStart,
        })),
    });

    const { analyzeMessageCoverage } = await import('../sharder/message-coverage-analyzer.js');
    const coverageReport = analyzeMessageCoverage(chatText, result.sections, { startIndex, endIndex });

    let shardReport = null;
    if ((selectedShards || []).length > 0
        && normalizeSharderProfile(settings?.sharderProfile) !== ARCHITECTURAL_PROFILE) {
        const { analyzeSinglePassPruning } = await import('../sharder/shard-pruning-analyzer.js');
        shardReport = analyzeSinglePassPruning(selectedShards, result.sections);
    }

    result.llmPruningReport = {
        totalPruned: (shardReport?.totalPruned || 0) + (coverageReport?.totalUncovered || 0),
        sections: [...(shardReport?.sections || [])],
        sectionOverview: [...(shardReport?.sectionOverview || [])],
        uncoveredMessages: coverageReport?.uncoveredMessages || [],
        totalUncovered: coverageReport?.totalUncovered || 0,
    };

    return result;
}

/**
 * Run Sharder pipeline without UI side effects.
 * @param {number} startIndex
 * @param {number} endIndex
 * @param {Object} settings
 * @param {Array<{content:string,type:string,identifier:string,parsedSections:Object,messageRangeStart?:number}>} selectedShards
 * @returns {Promise<{result:Object, chatText:string, extractKeywords:boolean}>}
 */
export async function runSharderHeadless(startIndex, endIndex, settings, selectedShards = []) {
    const messages = getAllMessages();

    if (!messages || messages.length === 0) {
        throw new Error('No messages to process');
    }

    const chatText = buildSinglePassChatText(messages, startIndex, endIndex, settings);

    if (!chatText.trim()) {
        throw new Error('Selected message range is empty');
    }

    const extractKeywords = settings.outputMode === 'lorebook'
        && settings.lorebookEntryOptions?.extractKeywords !== false;

    const result = await runPipelineWithAnalysis(
        chatText,
        settings,
        startIndex,
        endIndex,
        selectedShards,
        extractKeywords
    );
    throwIfAborted('sharder pipeline');

    return {
        result,
        chatText,
        extractKeywords,
    };
}

/**
 * Run Sharder generation on a message range.
 * @param {number} startIndex
 * @param {number} endIndex
 * @param {Object} settings
 * @param {Array<{content:string,type:string,identifier:string,parsedSections:Object,messageRangeStart?:number}>} selectedShards
 */
export async function runSharder(startIndex, endIndex, settings, selectedShards = []) {
    if (isSharderRunning) {
        toastr.warning('Sharder is already running');
        return;
    }

    isSharderRunning = true;

    let progressToast = null;
    const originalText = 'Run Sharder';
    let operationStarted = false;
    let opId = null;

    try {
        const messages = getAllMessages();
        if (!messages || messages.length === 0) {
            toastr.warning('No messages to process');
            return;
        }

        createAbortController();
        opId = startUiOperation({
            feature: 'sharder',
            primaryButton: 'ss-run-single-pass',
            disabled: true,
            label: 'Running Sharder...',
            lockButtons: [],
            showStop: true,
        });
        operationStarted = true;

        progressToast = toastr.info(
            `Sharder processing messages ${startIndex} to ${endIndex}...`,
            'Sharder',
            { timeOut: 0, extendedTimeOut: 0 }
        );

        const headless = await runSharderHeadless(startIndex, endIndex, settings, selectedShards);
        throwIfAborted('sharder generation');

        const { openSharderReviewModal } = await import('../../ui/modals/summarization/single-pass-review-modal.js');

        const regenFn = async () => {
            throwIfAborted('sharder regenerate');
            const result = await runPipelineWithAnalysis(
                headless.chatText,
                settings,
                startIndex,
                endIndex,
                selectedShards,
                headless.extractKeywords
            );
            throwIfAborted('sharder regenerate');
            return result;
        };

        throwIfAborted('sharder review');
        const review = await openSharderReviewModal(headless.result, settings, regenFn);
        throwIfAborted('sharder review');

        if (!review.confirmed) {
            toastr.info('Sharder cancelled');
            return;
        }

        throwIfAborted('sharder output');
        const outputResult = await handleSummaryResult(
            settings,
            review.finalOutput,
            startIndex,
            endIndex,
            false,
            headless.result.extractedKeywords || [],
            null,
            review.archiveOptions || null
        );

        if (outputResult.didInjectToContext) {
            const didInsertSystemMessage = outputResult.mode === 'system';

            if (outputResult.mode === 'system') {
                const insertionIndex = endIndex + 1;
                if (didInsertSystemMessage) {
                    await shiftRangesOnInsert(insertionIndex, 1, { skipVisibilityUpdate: true });
                }
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
                if (didInsertSystemMessage) {
                    await subtractHiddenRange(insertionIndex, insertionIndex, { skipVisibilityUpdate: true });
                }
            } else {
                await addHiddenRange(startIndex, endIndex, {
                    hidden: settings.hideAllSummarized || false,
                    skipVisibilityUpdate: true
                });
            }

            await recomputeVisibility();
        }

        const archivedCount = review.archivedItems?.length || 0;
        toastr.success(archivedCount > 0
            ? `Sharder output saved (${archivedCount} items archived)`
            : 'Sharder output saved');
    } catch (error) {
        if (error.name === 'AbortError') {
            toastr.info('Sharder stopped');
            return;
        }

        if (error.message === 'No messages to process' || error.message === 'Selected message range is empty') {
            toastr.warning(error.message);
            return;
        }

        log.error('Sharder failed:', error);
        toastr.error(`Sharder failed: ${error.message}`);
    } finally {
        if (progressToast) {
            toastr.clear(progressToast);
        }
        if (operationStarted) {
            clearAbortController();
            endUiOperation({
                feature: 'sharder',
                primaryButton: 'ss-run-single-pass',
                disabled: false,
                label: originalText,
                lockButtons: [],
                showStop: false,
                opId,
            });
        }
        isSharderRunning = false;
    }
}


