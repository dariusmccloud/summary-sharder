/**
 * Visibility Modal Component for Summary Sharder
 */

import { getChatRanges, saveChatRanges, saveSettings } from '../../../core/settings.js';
import { applyVisibilitySettings } from '../../../core/chat/visibility-manager.js';
import {
    archiveMessagesInRanges,
    getArchivedMessageCount,
    refreshArchiveDecorations,
    restoreAllArchivedMessages,
} from '../../../core/chat/archive-manager.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../../popup.js';
import { getAllMessages } from '../../../core/chat/chat-state.js';
import { chat } from '../../../../../../../script.js';
import { parseRanges, mergeOverlappingRanges } from '../../../core/processing/utils.js';
import { createTagInput, parseCommaTags, tagsToString } from '../../common/index.js';
import { showSsConfirm, showSsInput } from '../../common/modal-base.js';
import { log } from '../../../core/logger.js';

/**
 * Render the list of ranges with controls
 */
function renderRangesList(ranges, container, modalState) {
    container.innerHTML = '';

    if (ranges.length === 0) {
        container.innerHTML = '<p class="ss-ranges-empty">No ranges saved yet. Click "Add Range" to create one.</p>';
        return;
    }

    ranges.forEach((range, index) => {
        const rangeDiv = document.createElement('div');
        rangeDiv.className = 'ss-range-item';

        // Editable range inputs
        const rangeInfo = document.createElement('div');
        rangeInfo.className = 'ss-range-info ss-range-editable';

        const maxIndex = (chat?.length || 1) - 1;

        const startLabel = document.createElement('span');
        startLabel.textContent = 'Start: ';
        startLabel.className = 'ss-range-label';

        const startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'text_pole ss-range-input';
        startInput.min = '0';
        startInput.max = String(maxIndex);
        startInput.value = range.start;

        const separator = document.createElement('span');
        separator.textContent = ' - ';
        separator.className = 'ss-range-separator';

        const endLabel = document.createElement('span');
        endLabel.textContent = 'End: ';
        endLabel.className = 'ss-range-label';

        const endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'text_pole ss-range-input';
        endInput.min = '0';
        endInput.max = String(maxIndex);
        endInput.value = range.end;

        // Validation and update handler
        const handleRangeEdit = () => {
            const newStart = parseInt(startInput.value, 10);
            const newEnd = parseInt(endInput.value, 10);

            // Validate inputs
            if (isNaN(newStart) || isNaN(newEnd)) {
                toastr.error('Range values must be numbers');
                startInput.value = modalState.ranges[index].start;
                endInput.value = modalState.ranges[index].end;
                return;
            }

            if (newStart < 0 || newEnd < 0) {
                toastr.error('Range values must be non-negative');
                startInput.value = modalState.ranges[index].start;
                endInput.value = modalState.ranges[index].end;
                return;
            }

            if (newStart > maxIndex || newEnd > maxIndex) {
                toastr.error(`Range values must not exceed ${maxIndex}`);
                startInput.value = modalState.ranges[index].start;
                endInput.value = modalState.ranges[index].end;
                return;
            }

            if (newStart > newEnd) {
                toastr.error('Start must be less than or equal to End');
                startInput.value = modalState.ranges[index].start;
                endInput.value = modalState.ranges[index].end;
                return;
            }

            // Update the range
            modalState.ranges[index].start = newStart;
            modalState.ranges[index].end = newEnd;

            // Check for overlaps and merge if needed
            const beforeCount = modalState.ranges.length;
            modalState.ranges = mergeOverlappingRanges(modalState.ranges);
            const mergedCount = beforeCount - modalState.ranges.length;

            if (mergedCount > 0) {
                toastr.warning(`Merged ${mergedCount} overlapping range(s). Each message should only appear in one range.`);
                renderRangesList(modalState.ranges, container, modalState);
            }
        };

        startInput.addEventListener('change', handleRangeEdit);
        endInput.addEventListener('change', handleRangeEdit);

        rangeInfo.appendChild(startLabel);
        rangeInfo.appendChild(startInput);
        rangeInfo.appendChild(separator);
        rangeInfo.appendChild(endLabel);
        rangeInfo.appendChild(endInput);

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'ss-range-controls';

        // Ignore names input - use CSS classes instead of inline styles
        const ignoreDiv = document.createElement('div');
        ignoreDiv.className = 'ss-ignore-input-wrapper';

        const ignoreLabel = document.createElement('label');
        ignoreLabel.className = 'ss-ignore-label';
        ignoreLabel.textContent = 'Ignore messages by:';

        const ignoreInput = createTagInput({
            tags: parseCommaTags(range.ignoreNames || ''),
            placeholder: 'Add sender name...',
            onChange: (tags) => {
                modalState.ranges[index].ignoreNames = tagsToString(tags);
            }
        });
        ignoreInput.classList.add('ss-ignore-input');

        ignoreDiv.appendChild(ignoreLabel);
        ignoreDiv.appendChild(ignoreInput);

        // Hide/Show toggle - use CSS classes instead of inline styles
        const hideLabel = document.createElement('label');
        hideLabel.className = 'checkbox_label ss-range-checkbox-label';
        const hideCheckbox = document.createElement('input');
        hideCheckbox.type = 'checkbox';
        hideCheckbox.checked = range.hidden || false;
        hideCheckbox.addEventListener('change', (e) => {
            modalState.ranges[index].hidden = e.target.checked;
        });
        const hideSpan = document.createElement('span');
        hideSpan.textContent = 'Hide';
        hideLabel.appendChild(hideCheckbox);
        hideLabel.appendChild(hideSpan);

        // Ignore Collapse toggle - use CSS classes instead of inline styles
        const ignoreCollapseLabel = document.createElement('label');
        ignoreCollapseLabel.className = 'checkbox_label ss-range-checkbox-label';
        const ignoreCollapseCheckbox = document.createElement('input');
        ignoreCollapseCheckbox.type = 'checkbox';
        ignoreCollapseCheckbox.checked = range.ignoreCollapse || false;
        ignoreCollapseCheckbox.addEventListener('change', (e) => {
            modalState.ranges[index].ignoreCollapse = e.target.checked;
        });
        const ignoreCollapseSpan = document.createElement('span');
        ignoreCollapseSpan.textContent = 'Ignore Collapse';
        ignoreCollapseLabel.appendChild(ignoreCollapseCheckbox);
        ignoreCollapseLabel.appendChild(ignoreCollapseSpan);

        // Delete button - use CSS classes instead of inline styles
        const deleteBtn = document.createElement('input');
        deleteBtn.type = 'button';
        deleteBtn.value = 'Delete';
        deleteBtn.className = 'menu_button ss-delete-btn';
        deleteBtn.addEventListener('click', async () => {
            const confirm = await showSsConfirm('Delete Range', `Are you sure you want to delete range ${range.start}-${range.end}?`);
            if (confirm === POPUP_RESULT.AFFIRMATIVE) {
                modalState.ranges.splice(index, 1);
                renderRangesList(modalState.ranges, container, modalState);
                toastr.success('Range deleted');
            }
        });

        controlsDiv.appendChild(ignoreDiv);
        controlsDiv.appendChild(hideLabel);
        controlsDiv.appendChild(ignoreCollapseLabel);
        controlsDiv.appendChild(deleteBtn);

        rangeDiv.appendChild(rangeInfo);
        rangeDiv.appendChild(controlsDiv);

        container.appendChild(rangeDiv);
    });
}

/**
 * Handle adding a new range
 */
async function handleAddRange(modalState, container) {
    const messages = getAllMessages();
    if (!messages || messages.length === 0) {
        toastr.warning('No messages available');
        return;
    }

    const maxIndex = messages.length - 1;

    const rangeStr = await showSsInput(
        'Add Range',
        `Enter range(s) (0 to ${maxIndex}):\nExamples: '5-10' or '1-3, 5-7, 10-15'`,
        '0-' + maxIndex
    );
    if (!rangeStr) return;

    let ranges;
    try {
        ranges = parseRanges(rangeStr, maxIndex);
    } catch (error) {
        toastr.error(error.message);
        return;
    }

    const originalCount = modalState.ranges.length;

    // Add all new ranges
    for (const range of ranges) {
        modalState.ranges.push({
            start: range.start,
            end: range.end,
            hidden: false,
            ignoreCollapse: false,
            ignoreNames: ''
        });
    }

    // Merge all overlapping ranges automatically
    modalState.ranges = mergeOverlappingRanges(modalState.ranges);

    const newCount = modalState.ranges.length;
    const addedRanges = ranges.length;
    const mergedCount = (originalCount + addedRanges) - newCount;

    renderRangesList(modalState.ranges, container, modalState);

    if (mergedCount > 0) {
        toastr.success(`Added ${addedRanges} range(s), merged ${mergedCount} overlapping`);
    } else if (addedRanges === 1) {
        toastr.success(`Range ${ranges[0].start}-${ranges[0].end} added`);
    } else {
        toastr.success(`Added ${addedRanges} ranges`);
    }
}

// Re-export detectHiddenRanges from its canonical location
export { detectHiddenRanges } from '../../../core/chat/visibility-manager.js';

/**
 * Handle detecting and adding hidden ranges
 */
async function handleDetectHiddenRanges(modalState, container) {
    const detected = detectHiddenRanges();

    if (detected.length === 0) {
        toastr.info('No hidden messages found');
        return;
    }

    // Merge detected ranges with existing ranges, avoiding duplicates
    let addedCount = 0;
    for (const newRange of detected) {
        // Check if this range already exists
        const isDuplicate = modalState.ranges.some(existing =>
            existing.start === newRange.start && existing.end === newRange.end
        );

        if (!isDuplicate) {
            modalState.ranges.push(newRange);
            addedCount++;
        }
    }

    if (addedCount === 0) {
        toastr.info('All detected ranges already exist');
    } else {
        // Sort ranges by start index
        modalState.ranges.sort((a, b) => a.start - b.start);
        renderRangesList(modalState.ranges, container, modalState);
        toastr.success(`Detected ${addedCount} hidden message range(s)`);
    }
}

/**
 * Handle clearing all ranges
 */
async function handleClearAllRanges(modalState, container) {
    if (modalState.ranges.length === 0) {
        toastr.info('No ranges to clear');
        return;
    }

    const confirm = await showSsConfirm(
        'Clear All Ranges',
        `Are you sure you want to delete all ${modalState.ranges.length} range(s)? This cannot be undone.`
    );

    if (confirm === POPUP_RESULT.AFFIRMATIVE) {
        modalState.ranges = [];
        modalState.hideAllSummarized = false;
        modalState.collapseAll = false;

        // Update toggles in modal
        const hideAllCheckbox = document.getElementById('ss-modal-hide-all');
        const collapseAllCheckbox = document.getElementById('ss-modal-collapse-all');
        if (hideAllCheckbox) hideAllCheckbox.checked = false;
        if (collapseAllCheckbox) collapseAllCheckbox.checked = false;

        renderRangesList(modalState.ranges, container, modalState);
        toastr.success('All ranges cleared');
    }
}

/**
 * Open the visibility management modal
 */
export async function openVisibilityModal(settings) {
    const originalShowArchived = settings.showArchivedMessages || false;

    // Create a deep copy of current state for cancel functionality
    const modalState = {
        ranges: JSON.parse(JSON.stringify(getChatRanges())),
        hideAllSummarized: settings.hideAllSummarized || false,
        collapseAll: settings.collapseAll || settings.makeAllInvisible || false,
        showArchivedMessages: originalShowArchived,
        globalIgnoreNames: settings.globalIgnoreNames || ''
    };

    // Check for and merge any existing overlapping ranges
    const beforeCount = modalState.ranges.length;
    modalState.ranges = mergeOverlappingRanges(modalState.ranges);
    if (modalState.ranges.length < beforeCount) {
        const mergedCount = beforeCount - modalState.ranges.length;
        toastr.warning(`Found and merged ${mergedCount} overlapping range(s). Each message should only appear in one range.`);
    }

    // Build modal HTML
    const modalHtml = `
        <div class="ss-visibility-modal">
            <div class="ss-global-toggles">
                <h3 class="ss-global-heading">Global Settings</h3>
                <div class="ss-global-toggle-row">
                    <label class="checkbox_label">
                        <input id="ss-modal-hide-all" type="checkbox" ${modalState.hideAllSummarized ? 'checked' : ''} />
                        <span>Hide After Summarisation</span>
                    </label>
                </div>
                <div class="ss-global-toggle-row">
                    <label class="checkbox_label">
                        <input id="ss-modal-collapse-all" type="checkbox" ${modalState.collapseAll ? 'checked' : ''} />
                        <span>Collapse hidden messages</span>
                    </label>
                    <p class="ss-global-hint ss-global-hint-indented">
                        Collapses all hidden messages (header remains visible, click to expand)
                    </p>
                </div>
                <div class="ss-global-ignore-group">
                    <label class="ss-global-ignore-label">
                        Ignore messages by (applies to all ranges):
                    </label>
                    <div id="ss-modal-global-ignore"></div>
                    <p class="ss-global-hint">
                        Messages from these senders will remain visible regardless of hide/collapse settings
                    </p>
                </div>
                <div class="ss-global-toggle-row">
                    <label class="checkbox_label">
                        <input id="ss-modal-show-archived" type="checkbox" ${modalState.showArchivedMessages ? 'checked' : ''} />
                        <span>Show archived messages</span>
                    </label>
                    <p class="ss-global-hint ss-global-hint-indented" id="ss-modal-archived-count">
                        ${getArchivedMessageCount(chat)} archived message(s). Archived messages remain prompt-hidden.
                    </p>
                </div>
                <div class="ss-global-actions-row">
                    <input id="ss-modal-detect-ranges" class="menu_button" type="button" value="Detect Hidden Ranges" />
                    <input id="ss-modal-archive-ranges" class="menu_button" type="button" value="Archive Saved Ranges" />
                    <input id="ss-modal-restore-archived" class="menu_button" type="button" value="Restore All Archived" />
                    <input id="ss-modal-clear-all" class="menu_button" type="button" value="Clear All Ranges" />
                </div>
            </div>

            <div class="ss-ranges-section">
                <h3>Saved Ranges</h3>
                <div class="ss-range-actions-row">
                    <input id="ss-modal-toggle-hide" class="menu_button" type="button" value="Toggle Hide All" />
                    <input id="ss-modal-toggle-ignore-collapse" class="menu_button" type="button" value="Toggle Ignore Collapse All" />
                </div>
                <div class="ss-ranges-list" id="ss-modal-ranges-list"></div>
                <div class="ss-add-range-row">
                    <input id="ss-modal-add-range" class="menu_button" type="button" value="Add Range" />
                </div>
            </div>
        </div>
    `;

    // Create popup with custom buttons
    const popup = new Popup(
        modalHtml,
        POPUP_TYPE.TEXT,
        null,
        {
            okButton: 'Save & Exit',
            cancelButton: 'Cancel',
            wide: true,
            large: true
        }
    );

    // Show popup (non-blocking, but we'll wait for the result)
    const showPromise = popup.show();

    // Set up event listeners after popup is shown
    // Use requestAnimationFrame instead of setTimeout to avoid blocking main thread
    requestAnimationFrame(() => {
        const rangesListContainer = document.getElementById('ss-modal-ranges-list');
        const archivedCountEl = document.getElementById('ss-modal-archived-count');
        const updateArchivedCount = () => {
            if (archivedCountEl) {
                archivedCountEl.textContent = `${getArchivedMessageCount(chat)} archived message(s). Archived messages remain prompt-hidden.`;
            }
        };
        if (rangesListContainer) {
            renderRangesList(modalState.ranges, rangesListContainer, modalState);
        }

        // Global toggle listeners
        const hideAllCheckbox = document.getElementById('ss-modal-hide-all');
        if (hideAllCheckbox) {
            hideAllCheckbox.addEventListener('change', (e) => {
                modalState.hideAllSummarized = e.target.checked;
            });
        }

        const collapseAllCheckbox = document.getElementById('ss-modal-collapse-all');
        if (collapseAllCheckbox) {
            collapseAllCheckbox.addEventListener('change', (e) => {
                modalState.collapseAll = e.target.checked;
            });
        }

        const showArchivedCheckbox = document.getElementById('ss-modal-show-archived');
        if (showArchivedCheckbox) {
            showArchivedCheckbox.addEventListener('change', (e) => {
                modalState.showArchivedMessages = e.target.checked;
                refreshArchiveDecorations({ ...settings, showArchivedMessages: modalState.showArchivedMessages });
            });
        }

        const globalIgnoreHost = document.getElementById('ss-modal-global-ignore');
        if (globalIgnoreHost) {
            const globalIgnoreInput = createTagInput({
                tags: parseCommaTags(modalState.globalIgnoreNames || ''),
                placeholder: 'Add sender name...',
                onChange: (tags) => {
                    modalState.globalIgnoreNames = tagsToString(tags);
                }
            });
            globalIgnoreHost.replaceChildren(globalIgnoreInput);
        }

        // Toggle hide all ranges button
        const toggleHideBtn = document.getElementById('ss-modal-toggle-hide');
        if (toggleHideBtn) {
            toggleHideBtn.addEventListener('click', () => {
                if (modalState.ranges.length === 0) {
                    toastr.info('No ranges to toggle');
                    return;
                }

                // If all checked, uncheck all; otherwise check all
                const allChecked = modalState.ranges.every(r => r.hidden);
                const newState = !allChecked;

                modalState.ranges.forEach(range => {
                    range.hidden = newState;
                });

                renderRangesList(modalState.ranges, rangesListContainer, modalState);
                toastr.success(`All ranges ${newState ? 'hidden' : 'visible'}`);
            });
        }

        // Toggle ignore collapse all ranges button
        const toggleIgnoreCollapseBtn = document.getElementById('ss-modal-toggle-ignore-collapse');
        if (toggleIgnoreCollapseBtn) {
            toggleIgnoreCollapseBtn.addEventListener('click', () => {
                if (modalState.ranges.length === 0) {
                    toastr.info('No ranges to toggle');
                    return;
                }

                // If all checked, uncheck all; otherwise check all
                const allChecked = modalState.ranges.every(r => r.ignoreCollapse);
                const newState = !allChecked;

                modalState.ranges.forEach(range => {
                    range.ignoreCollapse = newState;
                });

                renderRangesList(modalState.ranges, rangesListContainer, modalState);
                toastr.success(`All ranges ${newState ? 'ignoring collapse' : 'respecting collapse'}`);
            });
        }

        // Detect hidden ranges button
        const detectRangesBtn = document.getElementById('ss-modal-detect-ranges');
        if (detectRangesBtn) {
            detectRangesBtn.addEventListener('click', () => {
                handleDetectHiddenRanges(modalState, rangesListContainer);
            });
        }

        const archiveRangesBtn = document.getElementById('ss-modal-archive-ranges');
        if (archiveRangesBtn) {
            archiveRangesBtn.addEventListener('click', async () => {
                const archiveableRanges = modalState.ranges.filter(range => range.hidden !== false);
                if (archiveableRanges.length === 0) {
                    toastr.info('No saved hidden ranges to archive');
                    return;
                }

                const result = await archiveMessagesInRanges(archiveableRanges, {
                    ...settings,
                    showArchivedMessages: modalState.showArchivedMessages,
                });
                if (result.changed) {
                    updateArchivedCount();
                    toastr.success('Saved ranges archived');
                } else {
                    toastr.info('No new messages were archived');
                }
            });
        }

        const restoreArchivedBtn = document.getElementById('ss-modal-restore-archived');
        if (restoreArchivedBtn) {
            restoreArchivedBtn.addEventListener('click', async () => {
                const result = await restoreAllArchivedMessages({
                    ...settings,
                    showArchivedMessages: modalState.showArchivedMessages,
                });
                if (result.changed) {
                    updateArchivedCount();
                    toastr.success('Archived messages restored');
                } else {
                    toastr.info('No archived messages to restore');
                }
            });
        }

        // Clear all button
        const clearAllBtn = document.getElementById('ss-modal-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                handleClearAllRanges(modalState, rangesListContainer);
            });
        }

        // Add range button
        const addRangeBtn = document.getElementById('ss-modal-add-range');
        if (addRangeBtn) {
            addRangeBtn.addEventListener('click', () => {
                handleAddRange(modalState, rangesListContainer);
            });
        }
    });

    // Wait for user to close modal
    const result = await showPromise;

    // If user clicked "Save & Exit", persist changes
        if (result === POPUP_RESULT.AFFIRMATIVE) {
        // DEBUG: Log what we're about to save
        log.debug('Visibility modal saving. Ranges:',
            JSON.stringify(modalState.ranges.map(r => ({ start: r.start, end: r.end, hidden: r.hidden }))));

        // Save ranges
        saveChatRanges(modalState.ranges);

        // Save global settings
        settings.hideAllSummarized = modalState.hideAllSummarized;
        settings.collapseAll = modalState.collapseAll;
        settings.showArchivedMessages = modalState.showArchivedMessages;
        settings.globalIgnoreNames = modalState.globalIgnoreNames;
        saveSettings(settings);

        // Apply visibility immediately
        log.debug('Calling applyVisibilitySettings...');
        await applyVisibilitySettings(settings);
        refreshArchiveDecorations(settings);
        log.debug('applyVisibilitySettings completed');

        toastr.success('Visibility settings saved');
    } else {
        // User cancelled, no changes made
        refreshArchiveDecorations({ ...settings, showArchivedMessages: originalShowArchived });
        log.debug('Visibility modal cancelled');
    }
}

