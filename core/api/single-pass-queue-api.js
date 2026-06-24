/**
 * Queue orchestration for batch Sharder processing.
 */

import { captureRangeInsertionPoints, findIndexByUID } from '../processing/utils.js';
import { POPUP_RESULT } from '../../../../../popup.js';
import { getFeatureApiSettings } from './feature-api-config.js';
import { showSsConfirm } from '../../ui/common/modal-base.js';
import {
    createAbortController,
    clearAbortController,
    throwIfAborted
} from './abort-controller.js';
import { startUiOperation, updateUiOperation, endUiOperation } from './api-ui-helpers.js';
import { runSharderHeadless } from './single-pass-api.js';
import { handleSummaryResult } from '../summarization/output.js';
import {
    addHiddenRange,
    subtractHiddenRange,
    shiftRangesOnInsert,
    recomputeVisibility
} from '../chat/range-operations.js';
import { SHARD_ARTIFACT_KINDS } from '../summarization/shard-integrity-core.js';
import { refreshCurrentChatShardIntegrity } from '../summarization/shard-integrity-runtime.js';
import { openSharderReviewModal } from '../../ui/modals/summarization/single-pass-review-modal.js';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldReviewResult(reviewMode, pipelineResult) {
    if (reviewMode === 'always') return true;
    if (reviewMode === 'never') return false;

    const diagnostics = Array.isArray(pipelineResult?.diagnostics) ? pipelineResult.diagnostics : [];
    const hasError = diagnostics.some((d) => d?.level === 'error');
    const hasWarning = diagnostics.some((d) => d?.level === 'warning');

    if (reviewMode === 'errors') {
        return hasError;
    }

    if (reviewMode === 'warnings') {
        return hasError || hasWarning;
    }

    return false;
}

function resolveRuntimeRange(range) {
    const context = SillyTavern.getContext();
    const chat = context?.chat || [];

    const resolvedStart = range.startUID ? findIndexByUID(chat, range.startUID) : range.start;
    const resolvedEnd = range.endUID ? findIndexByUID(chat, range.endUID) : range.end;

    if (resolvedStart < 0 || resolvedEnd < 0) {
        throw new Error(`One or more messages in range ${range.start}-${range.end} no longer exist`);
    }

    if (resolvedStart > resolvedEnd) {
        throw new Error(`Resolved range became invalid for ${range.start}-${range.end}`);
    }

    return {
        ...range,
        start: resolvedStart,
        end: resolvedEnd,
    };
}

function assertBatchChatStable(expectedChatId, expectedChatLength) {
    const context = SillyTavern.getContext();
    const chatId = context?.chatId || null;
    const chatLength = context?.chat?.length || 0;

    if (chatId !== expectedChatId) {
        throw new Error('Active chat changed during batch processing. Batch aborted to prevent index corruption.');
    }

    if (chatLength !== expectedChatLength) {
        throw new Error('Chat changed externally during batch processing. Batch aborted to prevent index corruption.');
    }
}

function reconcileDomMesidsAfterBatch(systemInsertionIndices = []) {
    if (!Array.isArray(systemInsertionIndices) || systemInsertionIndices.length === 0) {
        return;
    }

    const originalInsertionPositions = systemInsertionIndices.map((shiftedPos, i) => shiftedPos - i);
    const systemInsertionSet = new Set(systemInsertionIndices);
    const messageElements = document.querySelectorAll('#chat .mes');

    messageElements.forEach((el) => {
        const currentMesid = parseInt(el.getAttribute('mesid'), 10);
        if (isNaN(currentMesid)) {
            return;
        }

        const text = el.querySelector('.mes_text')?.textContent || '';
        const isInsertedSummary = el.getAttribute('data-ss-batch-summary') === '1'
            || (systemInsertionSet.has(currentMesid) && (text.includes('[MEMORY SHARD: Messages ') || text.includes('[SUMMARY: Messages ')));

        // Newly inserted summary rows are already in shifted coordinates.
        if (isInsertedSummary) {
            return;
        }

        let shiftCount = 0;
        for (const originalPos of originalInsertionPositions) {
            if (originalPos <= currentMesid) {
                shiftCount++;
            }
        }

        if (shiftCount > 0) {
            el.setAttribute('mesid', String(currentMesid + shiftCount));
        }
    });

    // Ensure uniqueness for rendered elements. Duplicate mesids cause visibility
    // updates to skip one row because elementMap is keyed by mesid.
    for (let pass = 0; pass < 6; pass++) {
        const buckets = new Map();
        const liveElements = document.querySelectorAll('#chat .mes');

        liveElements.forEach((el) => {
            const mesid = parseInt(el.getAttribute('mesid'), 10);
            if (isNaN(mesid)) return;
            if (!buckets.has(mesid)) buckets.set(mesid, []);
            buckets.get(mesid).push(el);
        });

        let changed = false;
        const duplicateMesids = Array.from(buckets.entries())
            .filter(([, els]) => els.length > 1)
            .map(([mesid]) => mesid)
            .sort((a, b) => a - b);

        if (duplicateMesids.length === 0) {
            break;
        }

        for (const mesid of duplicateMesids) {
            const els = buckets.get(mesid) || [];
            if (els.length <= 1) continue;

            const keepEl = els.find((el) => {
                const text = el.querySelector('.mes_text')?.textContent || '';
                return el.getAttribute('data-ss-batch-summary') === '1'
                    || text.includes('[MEMORY SHARD: Messages ')
                    || text.includes('[SUMMARY: Messages ');
            }) || els[0];

            for (const el of els) {
                if (el === keepEl) continue;
                const currentMesid = parseInt(el.getAttribute('mesid'), 10);
                if (isNaN(currentMesid)) continue;
                el.setAttribute('mesid', String(currentMesid + 1));
                changed = true;
            }
        }

        if (!changed) {
            break;
        }
    }
}

async function saveSinglePassOutput(range, settings, finalOutput, extractedKeywords = [], archiveOptions = null) {
    throwIfAborted('sharder batch save');
    const contextBefore = SillyTavern.getContext();
    const chatBefore = contextBefore?.chat || [];

    const freshStartBeforeSave = range.startUID ? findIndexByUID(chatBefore, range.startUID) : range.start;
    const freshEndBeforeSave = range.endUID ? findIndexByUID(chatBefore, range.endUID) : range.end;
    if (freshStartBeforeSave < 0 || freshEndBeforeSave < 0 || freshStartBeforeSave > freshEndBeforeSave) {
        throw new Error(`One or more messages in range ${range.start}-${range.end} no longer exist`);
    }

    throwIfAborted('sharder batch output');
    const outputResult = await handleSummaryResult(
        settings,
        finalOutput,
        freshStartBeforeSave,
        freshEndBeforeSave,
        true,
        extractedKeywords,
        range.insertAfterUID,
        archiveOptions,
        { skipDomMesidUpdate: true }
    );

    if (!outputResult.didInjectToContext) {
        return {
            didInjectToContext: false,
            didInsertSystemMessage: false,
            insertionIndex: null,
            outputUID: null,
        };
    }

    throwIfAborted('sharder batch output');
    const contextAfter = SillyTavern.getContext();
    const chatAfter = contextAfter?.chat || [];
    const freshStartAfterSave = range.startUID ? findIndexByUID(chatAfter, range.startUID) : freshStartBeforeSave;
    const freshEndAfterSave = range.endUID ? findIndexByUID(chatAfter, range.endUID) : freshEndBeforeSave;
    if (freshStartAfterSave < 0 || freshEndAfterSave < 0 || freshStartAfterSave > freshEndAfterSave) {
        throw new Error(`One or more messages in range ${range.start}-${range.end} no longer exist after save`);
    }

    let insertionIndex = null;
    const didInsertSystemMessage = outputResult.mode === 'system';

    if (outputResult.mode === 'system') {
        const resolvedInsertAfter = range.insertAfterUID ? findIndexByUID(chatAfter, range.insertAfterUID) : -1;
        insertionIndex = resolvedInsertAfter >= 0 ? resolvedInsertAfter + 1 : freshEndAfterSave + 1;

        if (didInsertSystemMessage) {
            await shiftRangesOnInsert(insertionIndex, 1, { skipVisibilityUpdate: true });
        }

        await addHiddenRange(freshStartAfterSave, freshEndAfterSave, {
            hidden: settings.hideAllSummarized || false,
            skipVisibilityUpdate: true
        });

        if (didInsertSystemMessage) {
            await subtractHiddenRange(insertionIndex, insertionIndex, { skipVisibilityUpdate: true });
        }
    } else {
        await addHiddenRange(freshStartAfterSave, freshEndAfterSave, {
            hidden: settings.hideAllSummarized || false,
            skipVisibilityUpdate: true
        });
    }

    await recomputeVisibility();
    await refreshCurrentChatShardIntegrity({
        reason: 'sharder-batch-saved',
        registerOutput: {
            outputUID: outputResult.outputUID,
            artifactKind: outputResult.mode === 'system'
                ? SHARD_ARTIFACT_KINDS.SYSTEM_SHARD
                : SHARD_ARTIFACT_KINDS.LOREBOOK_SUMMARY,
            startIndex: freshStartAfterSave,
            endIndex: freshEndAfterSave,
        },
    });

    return {
        didInjectToContext: outputResult.didInjectToContext,
        didInsertSystemMessage,
        insertionIndex: didInsertSystemMessage ? insertionIndex : null,
        outputUID: typeof outputResult.outputUID === 'string' ? outputResult.outputUID : null,
    };
}

/**
 * Process multiple Sharder ranges in a queue.
 * @param {Array<{start: number, end: number}>} ranges
 * @param {Object} settings
 * @param {{reviewMode?: 'never'|'errors'|'warnings'|'always'}} batchConfig
 */
export async function runSharderQueue(ranges, settings, batchConfig = {}) {
    if (!Array.isArray(ranges) || ranges.length === 0) {
        toastr.warning('No ranges to process');
        return;
    }

    const reviewMode = batchConfig.reviewMode || 'always';

    createAbortController();
    const originalText = 'Batch Sharder';
    const lockButtons = ['ss-run-single-pass'];
    const opId = startUiOperation({
        feature: 'sharder-batch',
        primaryButton: 'ss-run-single-pass-batch',
        disabled: true,
        label: null,
        lockButtons,
        showStop: true,
    });

    let progressToast = toastr.info(
        'Starting batch Sharder...',
        `Processing 0/${ranges.length} ranges`,
        { timeOut: 0, extendedTimeOut: 0 }
    );

    const total = ranges.length;
    let completed = 0;
    let skipped = 0;
    const failed = [];
    const systemInsertionIndices = [];

    const context = SillyTavern.getContext();
    const chat = context?.chat || [];
    const expectedChatId = context?.chatId || null;
    let expectedChatLength = chat.length;
    let internalMutationInFlight = false;
    const rangesWithUIDs = captureRangeInsertionPoints(ranges, chat).map((range) => ({
        ...range,
        startUID: chat[range.start]?.send_date || null,
        endUID: chat[range.end]?.send_date || null,
    }));

    try {
        const effectiveSettings = await getFeatureApiSettings(settings, 'sharder');
        const queueDelayMs = Math.max(0, effectiveSettings.queueDelayMs || 0);
        const assertStable = () => {
            if (internalMutationInFlight) {
                return;
            }
            assertBatchChatStable(expectedChatId, expectedChatLength);
        };

        const generateAt = async (index) => {
            throwIfAborted('sharder batch');
            const current = index + 1;
            const baseRange = rangesWithUIDs[index];

            if (queueDelayMs > 0 && index > 0) {
                await sleep(queueDelayMs);
            }

            const runtimeRange = resolveRuntimeRange(baseRange);

            updateUiOperation({
                feature: 'sharder-batch',
                primaryButton: 'ss-run-single-pass-batch',
                disabled: true,
                label: `Generating ${current}/${total} (${runtimeRange.start}-${runtimeRange.end})...`,
                lockButtons,
                showStop: true,
                opId,
            });

            if (progressToast) {
                toastr.clear(progressToast);
            }
            progressToast = toastr.info(
                `Generating shard for messages ${runtimeRange.start}-${runtimeRange.end}...`,
                `Batch Sharder ${current}/${total}`,
                { timeOut: 0, extendedTimeOut: 0 }
            );

            const headless = await runSharderHeadless(runtimeRange.start, runtimeRange.end, settings, []);
            throwIfAborted('sharder batch');
            return {
                index,
                runtimeRange,
                headless,
            };
        };

        if (reviewMode === 'never') {
            for (let i = 0; i < total; i++) {
                try {
                    assertStable();
                    const generated = await generateAt(i);
                    let saveResult = null;
                    try {
                        internalMutationInFlight = true;
                        throwIfAborted('sharder batch save');
                        saveResult = await saveSinglePassOutput(
                            generated.runtimeRange,
                            settings,
                            generated.headless.result.reconstructed,
                            generated.headless.result.extractedKeywords || [],
                            null
                        );
                    } finally {
                        internalMutationInFlight = false;
                    }
                    if (saveResult?.didInsertSystemMessage && Number.isInteger(saveResult.insertionIndex)) {
                        systemInsertionIndices.push(saveResult.insertionIndex);
                        expectedChatLength += 1;
                    }
                    completed++;
                } catch (error) {
                    if (error.name === 'AbortError') {
                        toastr.info('Sharder batch stopped');
                        return;
                    }

                    failed.push({
                        range: `${rangesWithUIDs[i].start}-${rangesWithUIDs[i].end}`,
                        error: error.message,
                    });

                    const continueProcessing = await showSsConfirm(
                        'Sharder Batch Failed',
                        `Range ${rangesWithUIDs[i].start}-${rangesWithUIDs[i].end} failed: ${error.message}\n\nContinue with remaining ranges?`
                    );

                    if (continueProcessing !== POPUP_RESULT.AFFIRMATIVE) {
                        break;
                    }
                }
            }
        } else {
            const pendingResults = new Map();
            const maxPendingResults = 10;
            let stopRequested = false;
            let producerDone = false;

            const producer = (async () => {
                for (let i = 0; i < total && !stopRequested; i++) {
                    while (!stopRequested && pendingResults.size >= maxPendingResults) {
                        await sleep(100);
                    }
                    if (stopRequested) {
                        break;
                    }

                    try {
                        assertStable();
                        const generated = await generateAt(i);
                        pendingResults.set(i, { kind: 'generated', generated });
                    } catch (error) {
                        pendingResults.set(i, { kind: 'error', error });
                    }
                }
                producerDone = true;
            })();

            let index = 0;
            while (index < total) {
                while (!pendingResults.has(index)) {
                    if (producerDone && !pendingResults.has(index)) {
                        break;
                    }
                    await sleep(75);
                }

                if (!pendingResults.has(index)) {
                    break;
                }

                const pendingItem = pendingResults.get(index);
                pendingResults.delete(index);

                if (pendingItem.kind === 'error') {
                    const error = pendingItem.error;
                    if (error?.name === 'AbortError') {
                        stopRequested = true;
                        toastr.info('Sharder batch stopped');
                        await producer;
                        return;
                    }

                    failed.push({
                        range: `${rangesWithUIDs[index].start}-${rangesWithUIDs[index].end}`,
                        error: error?.message || String(error),
                    });

                    const continueProcessing = await showSsConfirm(
                        'Sharder Batch Failed',
                        `Range ${rangesWithUIDs[index].start}-${rangesWithUIDs[index].end} failed: ${error?.message || error}\n\nContinue with remaining ranges?`
                    );

                    if (continueProcessing !== POPUP_RESULT.AFFIRMATIVE) {
                        stopRequested = true;
                        break;
                    }

                    index++;
                    continue;
                }

                const generated = pendingItem.generated;

                try {
                    assertStable();
                    const requiresReview = shouldReviewResult(reviewMode, generated.headless.result);

                    if (!requiresReview) {
                        let saveResult = null;
                        try {
                            internalMutationInFlight = true;
                            throwIfAborted('sharder batch save');
                            saveResult = await saveSinglePassOutput(
                                generated.runtimeRange,
                                settings,
                                generated.headless.result.reconstructed,
                                generated.headless.result.extractedKeywords || [],
                                null
                            );
                        } finally {
                            internalMutationInFlight = false;
                        }
                        if (saveResult?.didInsertSystemMessage && Number.isInteger(saveResult.insertionIndex)) {
                            systemInsertionIndices.push(saveResult.insertionIndex);
                            expectedChatLength += 1;
                        }
                        completed++;
                        index++;
                        continue;
                    }

                    updateUiOperation({
                        feature: 'sharder-batch',
                        primaryButton: 'ss-run-single-pass-batch',
                        disabled: true,
                        label: `Reviewing ${index + 1}/${total} (${generated.runtimeRange.start}-${generated.runtimeRange.end})...`,
                        lockButtons,
                        showStop: true,
                        opId,
                    });

                    const regenFn = async () => {
                        throwIfAborted('sharder batch regenerate');
                        const rerunRange = resolveRuntimeRange(rangesWithUIDs[index]);
                        const rerun = await runSharderHeadless(rerunRange.start, rerunRange.end, settings, []);
                        throwIfAborted('sharder batch regenerate');
                        return rerun.result;
                    };

                    throwIfAborted('sharder batch review');
                    const review = await openSharderReviewModal(generated.headless.result, settings, regenFn);
                    throwIfAborted('sharder batch review');

                    if (!review.confirmed) {
                        skipped++;
                        index++;
                        continue;
                    }

                    let saveResult = null;
                    try {
                        internalMutationInFlight = true;
                        throwIfAborted('sharder batch save');
                        saveResult = await saveSinglePassOutput(
                            generated.runtimeRange,
                            settings,
                            review.finalOutput,
                            generated.headless.result.extractedKeywords || [],
                            review.archiveOptions || null
                        );
                    } finally {
                        internalMutationInFlight = false;
                    }
                    if (saveResult?.didInsertSystemMessage && Number.isInteger(saveResult.insertionIndex)) {
                        systemInsertionIndices.push(saveResult.insertionIndex);
                        expectedChatLength += 1;
                    }

                    completed++;
                    index++;
                } catch (error) {
                    if (error.name === 'AbortError') {
                        stopRequested = true;
                        toastr.info('Sharder batch stopped');
                        await producer;
                        return;
                    }

                    failed.push({
                        range: `${rangesWithUIDs[index].start}-${rangesWithUIDs[index].end}`,
                        error: error.message,
                    });

                    const continueProcessing = await showSsConfirm(
                        'Sharder Batch Failed',
                        `Range ${rangesWithUIDs[index].start}-${rangesWithUIDs[index].end} failed: ${error.message}\n\nContinue with remaining ranges?`
                    );

                    if (continueProcessing !== POPUP_RESULT.AFFIRMATIVE) {
                        stopRequested = true;
                        break;
                    }

                    index++;
                }
            }

            stopRequested = true;
            await producer;
        }

        if (systemInsertionIndices.length > 0) {
            reconcileDomMesidsAfterBatch(systemInsertionIndices);
            await recomputeVisibility();
        }

        if (failed.length === 0 && skipped === 0) {
            toastr.success(`Sharder batch complete: ${completed}/${total}`);
        } else {
            const failedRanges = failed.map((f) => f.range).join(', ');
            const statusParts = [
                `Saved ${completed}/${total}`,
                skipped > 0 ? `Skipped ${skipped}` : null,
                failed.length > 0 ? `Failed ${failed.length}${failedRanges ? ` (${failedRanges})` : ''}` : null,
            ].filter(Boolean);
            toastr.warning(`Sharder batch finished. ${statusParts.join(' | ')}`);
        }
    } finally {
        clearAbortController();
        endUiOperation({
            feature: 'sharder-batch',
            primaryButton: 'ss-run-single-pass-batch',
            disabled: false,
            label: originalText,
            lockButtons,
            showStop: false,
            opId,
        });

        if (progressToast) {
            toastr.clear(progressToast);
        }

    }
}

