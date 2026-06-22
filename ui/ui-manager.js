/**
 * UI management for Summary Sharder
 */

import { saveSettings } from '../core/settings.js';
import { getAllMessages } from '../core/chat/chat-state.js';
import { runSummarization, stopSummarization } from '../core/api/summary-api.js';
import { runSummarizationQueue } from '../core/api/queue-api.js';
import { runSharder } from '../core/api/single-pass-api.js';
import { runSharderQueue } from '../core/api/single-pass-queue-api.js';
import { openVisibilityModal } from './modals/management/visibility-modal.js';
import { openPromptsModal, updateActivePromptDisplay } from './modals/configuration/prompts-modal.js';
import { openCleanContextModal } from './modals/configuration/clean-context-modal.js';
import { openThemesModal } from './modals/themes-modal.js';
import { openRagSettingsModal } from './modals/configuration/rag-settings-modal.js';
import { updateFabVisibility } from './fab/fab.js';
import { parseRanges } from '../core/processing/utils.js';
import { LorebookDropdown } from './dropdowns/lorebook-dropdown.js';
import { openLorebookOptionsModal } from './modals/management/lorebook-modal.js';
import { openChatManagerModal } from './modals/management/chat-manager-modal.js';
import { openBatchConfigModal } from './modals/summarization/batch-config-modal.js';
import { showSsInput } from './common/modal-base.js';
import { openApiConfigModal } from './modals/configuration/api-config-modal.js';
import { openDebugExportModal } from './modals/configuration/debug-export-modal.js';
import { updateApiStatusDisplays } from './common/api-status-state.js';
import { log } from '../core/logger.js';
import {
    ARCHITECTURAL_DISPLAY_NAME,
    ARCHITECTURAL_PROFILE,
    NARRATIVE_DISPLAY_NAME,
    NARRATIVE_PROFILE,
    normalizeSharderProfile,
} from '../core/summarization/sharder-section-registry.js';
import {
    createSegmentedToggle,
    createTagInput,
    createRangeSliderPair,
    parseCommaTags,
    tagsToString,
    infoHintHtml,
    mountInfoHints,
} from './common/index.js';
export { updateApiStatusDisplays };

const activeUiOps = new Map();
let uiOpListenerAttached = false;

function applyUiOperationState(event) {
    const detail = event?.detail || {};
    const {
        phase,
        primaryButton,
        disabled,
        label,
        lockButtons,
        showStop,
        opId,
    } = detail;

    if (!phase) return;

    // Stop-button-only updates (for legacy stop visibility toggles).
    if (!primaryButton) {
        if (typeof showStop === 'boolean') {
            const stopBtn = document.getElementById('ss-stop-summarize');
            stopBtn?.classList.toggle('ss-hidden', !showStop);
        }
        return;
    }

    if (phase === 'start') {
        if (!opId) return;
        activeUiOps.set(primaryButton, opId);
    } else {
        const activeOpId = activeUiOps.get(primaryButton);
        if (!opId || activeOpId !== opId) {
            return;
        }
        if (phase === 'end') {
            activeUiOps.delete(primaryButton);
        }
    }

    const primaryBtn = document.getElementById(primaryButton);
    if (primaryBtn) {
        if (typeof disabled === 'boolean') {
            primaryBtn.disabled = disabled;
        }
        if (typeof label === 'string') {
            primaryBtn.value = label;
        }
    }

    const lockIds = Array.isArray(lockButtons) ? lockButtons : [];
    for (const id of lockIds) {
        const lockBtn = document.getElementById(id);
        if (!lockBtn) continue;
        if (typeof disabled === 'boolean') {
            lockBtn.disabled = phase === 'end' ? false : disabled;
        }
    }

    if (typeof showStop === 'boolean') {
        const stopBtn = document.getElementById('ss-stop-summarize');
        stopBtn?.classList.toggle('ss-hidden', !showStop);
    }
}

function ensureUiOperationListener() {
    if (uiOpListenerAttached) return;
    window.addEventListener('ss-ui-operation-state', applyUiOperationState);
    uiOpListenerAttached = true;
}

/**
 * Toggle visibility of Sharder controls and action buttons based on mode settings.
 */
function toggleSharderControls(settings) {
    const sharderMode = settings.sharderMode || false;

    const sharderControls = document.getElementById('ss-sharder-controls');
    const summarizeBtn = document.getElementById('ss-run-summarize');
    const runSharderBtn = document.getElementById('ss-run-single-pass');
    const batchSharderBtn = document.getElementById('ss-run-single-pass-batch');

    sharderControls?.classList.toggle('ss-hidden', !sharderMode);
    summarizeBtn?.classList.toggle('ss-hidden', sharderMode);
    runSharderBtn?.classList.toggle('ss-hidden', !sharderMode);
    batchSharderBtn?.classList.toggle('ss-hidden', !sharderMode);

    const summaryApiStatus = document.getElementById('ss-summary-api-status');
    summaryApiStatus?.classList.toggle('ss-hidden', sharderMode);

    const advancedBlock = document.getElementById('ss-advanced-control-block');
    const summaryReviewBlock = document.getElementById('ss-summary-review-block');
    const summaryReviewOptions = document.getElementById('ss-summary-review-options');
    const lengthBlock = document.getElementById('ss-length-control-block');
    const lengthSliderSection = document.getElementById('ss-length-slider-section');

    const reviewToggleEnabled = !!document.getElementById('ss-summary-review-toggle')?.checked;
    const lengthControlEnabled = !!document.getElementById('ss-length-control')?.checked;

    advancedBlock?.classList.toggle('ss-hidden', sharderMode);
    summaryReviewBlock?.classList.toggle('ss-hidden', sharderMode);
    summaryReviewOptions?.classList.toggle('ss-hidden', sharderMode || !reviewToggleEnabled);
    lengthBlock?.classList.toggle('ss-hidden', sharderMode);
    lengthSliderSection?.classList.toggle('ss-hidden', sharderMode || !lengthControlEnabled);
}

/**
 * Toggle visibility of Summary Length slider based on summaryLengthControl setting.
 */
function toggleLengthSlider(enabled) {
    const section = document.getElementById('ss-length-slider-section');
    const sharderMode = !!document.getElementById('ss-sharder-mode')?.checked;
    section?.classList.toggle('ss-hidden', !enabled || sharderMode);
}

/**
 * Toggle visibility of Summary Review options based on toggle state.
 */
function toggleSummaryReviewOptions(enabled) {
    const section = document.getElementById('ss-summary-review-options');
    const sharderMode = !!document.getElementById('ss-sharder-mode')?.checked;
    section?.classList.toggle('ss-hidden', !enabled || sharderMode);
}

/**
 * Toggle visibility of lorebook selection section based on output mode.
 */
function toggleLorebookSection(outputMode) {
    const lorebookSection = document.getElementById('ss-lorebook-section');
    lorebookSection?.classList.toggle('ss-hidden', outputMode !== 'lorebook');
}

/**
 * Toggle visibility of Auto Interval setting based on mode.
 */
function toggleAutoInterval(mode) {
    const autoIntervalRow = document.getElementById('ss-auto-interval-row');
    autoIntervalRow?.classList.toggle('ss-hidden', mode !== 'auto');
}

/**
 * Toggle visibility of custom books dropdown.
 */
function toggleCustomBooksDropdown(show) {
    const container = document.getElementById('ss-custom-books-container');
    container?.classList.toggle('ss-hidden', !show);
}

function setupSettingsAccordionHandlers() {
    const settingsRoot = document.getElementById('summary-sharder-settings');
    if (!settingsRoot) return;

    const accordions = Array.from(settingsRoot.querySelectorAll('.ss-settings-accordion'));
    if (accordions.length === 0) return;

    const setExpanded = (accordion, expanded) => {
        const content = accordion.querySelector('.ss-accordion-content');
        const header = accordion.querySelector('.ss-accordion-header');
        if (!content || !header) return;

        accordion.classList.toggle('expanded', expanded);
        content.classList.toggle('ss-hidden', !expanded);
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    const toggleAccordion = (header) => {
        const accordion = header.closest('.ss-settings-accordion');
        if (!accordion) return;

        const shouldExpand = !accordion.classList.contains('expanded');
        if (shouldExpand) {
            for (const otherAccordion of accordions) {
                setExpanded(otherAccordion, otherAccordion === accordion);
            }
            return;
        }

        setExpanded(accordion, false);
    };

    for (const accordion of accordions) {
        const header = accordion.querySelector('.ss-accordion-header');
        if (!header) continue;

        if (!header.hasAttribute('role')) {
            header.setAttribute('role', 'button');
        }
        if (!header.hasAttribute('tabindex')) {
            header.setAttribute('tabindex', '0');
        }

        header.addEventListener('click', (e) => {
            if (e.target?.closest?.('button, input, select, textarea, a, label')) return;
            toggleAccordion(header);
        });

        header.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            toggleAccordion(header);
        });

        setExpanded(accordion, accordion.classList.contains('expanded'));
    }
}

/**
 * Manual summarization UI.
 */
export async function runManualSummarizeUI(settings) {
    const messages = getAllMessages();

    if (!messages || messages.length === 0) {
        toastr.warning('No messages available to summarize');
        return;
    }

    const maxIndex = messages.length - 1;

    const rangeStr = await showSsInput(
        'Summarize: Select Range',
        `Enter range(s) to summarize (0 to ${maxIndex}):\nExamples: '5-10' or '1-3, 5-7'`,
        `0-${maxIndex}`,
    );
    if (rangeStr === null) return;

    let ranges;
    try {
        ranges = parseRanges(rangeStr, maxIndex);
    } catch (error) {
        toastr.error(error.message);
        return;
    }

    if (ranges.length === 1) {
        runSummarization(ranges[0].start, ranges[0].end, settings);
    } else {
        runSummarizationQueue(ranges, settings);
    }
}

/**
 * Render the settings UI.
 */
export function renderSettingsUI(settings, callbacks) {
    ensureUiOperationListener();

    const settingsHtml = `
    <div id="summary-sharder-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Summary Sharder</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="display: none;">
                <div class="ss-settings-scroll">
                    <div class="ss-bg">
                    <div class="ss-review-accordion ss-settings-accordion expanded" data-settings-section="mode-output">
                        <div class="ss-accordion-header" role="button" tabindex="0" aria-expanded="true">
                            <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                            <span class="ss-accordion-title">Mode & Output</span>
                        </div>
                        <div class="ss-accordion-content">
                            <div class="ss-block">
                                <div class="ss-api-status-group">
                                    <div class="ss-api-feature-status" id="ss-summary-api-status">
                                        <strong>Summary API:</strong>
                                        <span id="ss-summary-api-display" style="margin-left: 10px;">SillyTavern Current</span>
                                    </div>
                                    <div class="ss-api-feature-status ss-hidden" id="ss-single-pass-api-status">
                                        <strong>Sharder API:</strong>
                                        <span id="ss-single-pass-api-display" style="margin-left: 10px;"></span>
                                    </div>
                                    <div class="ss-api-feature-status ss-hidden" id="ss-events-api-status">
                                        <strong>Casing API:</strong>
                                        <span id="ss-events-api-display" style="margin-left: 10px;"></span>
                                    </div>
                                </div>
                                <input id="ss-open-api-config-modal" class="menu_button" type="button" value="Configure APIs..." />
                            </div>

                            <div class="ss-block">
                                <label class="checkbox_label">
                                    <input id="ss-sharder-mode" type="checkbox" />
                                    <span>Sharder Mode ${infoHintHtml('ss-sharder-mode-hint', 'Uses the structured 16-section Memory Shard workflow instead of basic summaries.')}</span>
                                </label>
                            </div>

                            <div class="ss-control-group">
                                <div class="ss-inline-row">
                                    <label for="ss-mode">Mode:</label>
                                    <div id="ss-mode-mount"></div>
                                </div>

                                <div id="ss-auto-interval-row" class="ss-inline-row ss-hidden">
                                    <label for="ss-auto-interval">Automatic:</label>
                                    <div class="ss-inline-with-unit">
                                        <span>every</span>
                                        <input id="ss-auto-interval" type="number" class="text_pole" min="1" />
                                        <span>messages</span>
                                    </div>
                                </div>

                                <div class="ss-inline-row">
                                    <label for="ss-output-mode">Output:</label>
                                    <div id="ss-output-mode-mount"></div>
                                </div>

                                <div id="ss-lorebook-section" class="ss-lorebook-section ss-hidden">
                                    <span class="ss-lorebook-section-label">Target Lorebooks:</span>

                                    <div class="ss-lorebook-toggles">
                                        <label class="checkbox_label ss-lorebook-toggle-item">
                                            <input id="ss-use-char-book" type="checkbox" />
                                            <span>Use Character World Info</span>
                                        </label>
                                        <label class="checkbox_label ss-lorebook-toggle-item">
                                            <input id="ss-use-chat-book" type="checkbox" />
                                            <span>Use Chat History Book</span>
                                        </label>
                                        <label class="checkbox_label ss-lorebook-toggle-item">
                                            <input id="ss-use-custom-books" type="checkbox" />
                                            <span>Custom Select</span>
                                        </label>
                                    </div>

                                    <div id="ss-custom-books-container" class="ss-hidden">
                                        <div id="ss-lorebook-dropdown"></div>
                                    </div>

                                    <div class="ss-lorebook-options-btn">
                                        <input id="ss-lorebook-options-btn" class="menu_button" type="button" value="Lorebook Entry Options..." />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="ss-review-accordion ss-settings-accordion" data-settings-section="summarization">
                        <div class="ss-accordion-header" role="button" tabindex="0" aria-expanded="false">
                            <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                            <span class="ss-accordion-title">Summarization</span>
                        </div>
                        <div class="ss-accordion-content ss-hidden">
                            <div class="ss-control-group">
                                <div id="ss-sharder-controls" class="ss-block ss-sharder-controls ss-hidden">                                                                      
                                    <div class="ss-inline-row">
                                        <label for="ss-sharder-profile">Sharder Profile:</label>
                                        <div id="ss-sharder-profile-mount"></div>
                                    </div>
                                    <label class="checkbox_label">
                                        <input id="ss-single-pass-auto-include-shards" type="checkbox" />
                                        <span>Auto-include all existing shards ${infoHintHtml('ss-auto-include-shards-hint', 'Skips the shard selection modal and includes all shard sections by default.')}</span>
                                    </label>
                                    <p class="ss-hint">Skips selection modal</p>
                                </div>

                                <div id="ss-advanced-control-block" class="ss-block">
                                    <label class="checkbox_label">
                                        <input id="ss-advanced-control" type="checkbox" />
                                        <span>Drafting Mode ${infoHintHtml('ss-pre-edit-events-hint', 'Extracts key events first so you can edit them before the summary is generated.')}</span>
                                    </label>
                                    <p class="ss-hint">Extract and review events before generating summary</p>
                                </div>

                                <div id="ss-summary-review-block" class="ss-block">
                                    <label class="checkbox_label">
                                        <input id="ss-summary-review-toggle" type="checkbox" />
                                        <span>Summary Review ${infoHintHtml('ss-summary-review-hint', 'Shows a review modal so you can edit the summary before it is saved or injected.')}</span>
                                    </label>
                                    <p class="ss-hint">Review generated summaries before injecting</p>
                                </div>

                                <div id="ss-summary-review-options" class="ss-block ss-hidden">
                                    <div class="ss-inline-row">
                                        <label for="ss-summary-review-mode">Review Mode:</label>
                                        <div id="ss-summary-review-mode-mount"></div>
                                    </div>
                                    <p class="ss-hint">When to show the summary review modal</p>
                                </div>

                                <div id="ss-length-control-block" class="ss-block">
                                    <label class="checkbox_label">
                                        <input id="ss-length-control" type="checkbox" />
                                        <span>Summary Length Control</span>
                                    </label>
                                    <p class="ss-hint">Limit summary length as a percentage of input</p>

                                    <div id="ss-length-slider-section" class="ss-hidden">
                                        <label for="ss-length-percent">Target Length:</label>
                                        <div id="ss-length-percent-host"></div>
                                        <p class="ss-hint">Summary will be approximately this percentage of input length (in words)</p>
                                    </div>
                                </div>

                                <div class="ss-block">
                                    <label class="checkbox_label">
                                        <input id="ss-context-cleanup" type="checkbox" />
                                        <span>Clean Context Before Summarization</span>
                                    </label>
                                    <div>
                                        <input id="ss-open-cleanup-btn" class="menu_button" type="button" value="Options..." />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="ss-review-accordion ss-settings-accordion" data-settings-section="filtering">
                        <div class="ss-accordion-header" role="button" tabindex="0" aria-expanded="false">
                            <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                            <span class="ss-accordion-title">Filtering</span>
                        </div>
                        <div class="ss-accordion-content ss-hidden">
                            <div class="ss-block">
                                <label for="ss-banned-keywords">Banned Keywords:</label>
                                <div id="ss-banned-keywords-host"></div>
                                <p class="ss-hint">Comma-separated words excluded from generated keywords (lorebook + RAG)</p>
                            </div>
                        </div>
                    </div>

                    <div class="ss-review-accordion ss-settings-accordion" data-settings-section="configuration">
                        <div class="ss-accordion-header" role="button" tabindex="0" aria-expanded="false">
                            <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                            <span class="ss-accordion-title">Configuration</span>
                        </div>
                        <div class="ss-accordion-content ss-hidden">
                            <div class="ss-block">
                                <div id="ss-active-prompt-display"></div>
                                <input id="ss-open-prompts-btn" class="menu_button" type="button" value="Configure Prompts..." />
                            </div>

                            <div class="ss-block">
                                <label>Advanced:</label>
                                <div class="ss-buttons">
                                    <input id="ss-open-themes-btn" class="menu_button" type="button" value="Themes" />
                                    <input id="ss-open-rag-btn" class="menu_button" type="button" value="RAG Settings" />
                                </div>
                            </div>

                            <div class="ss-block">
                                <label class="checkbox_label">
                                    <input id="ss-fab-enabled" type="checkbox" />
                                    <span>Show Floating Quick Actions</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="ss-review-accordion ss-settings-accordion" data-settings-section="debug">
                        <div class="ss-accordion-header" role="button" tabindex="0" aria-expanded="false">
                            <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                            <span class="ss-accordion-title">Debug</span>
                        </div>
                        <div class="ss-accordion-content ss-hidden">
                            <div class="ss-block">
                                <label class="checkbox_label">
                                    <input id="ss-debug-logging" type="checkbox" />
                                    <span>Enable Debug Logging</span>
                                </label>
                                <p class="ss-hint">Turns on developer-only <code>debug</code> console logs for Summary Sharder subsystems.</p>
                            </div>

                            <div class="ss-block">
                                <input id="ss-export-debug-settings-btn" class="menu_button" type="button" value="Export Debug Settings..." />
                                <p class="ss-hint">Exports a shareable Markdown table of current extension settings and active chat metadata. Secrets stay redacted.</p>
                            </div>

                            <div class="ss-block ss-debug-suggestions">
                                <label>Useful Next Additions:</label>
                                <p class="ss-hint"> Soon.</p>
                            </div>
                        </div>
                    </div>

                    <div class="ss-action-bar">
                        <div class="ss-action-bar-primary">
                            <input id="ss-run-summarize" class="menu_button" type="button" value="Summarize Now" />
                            <input id="ss-run-single-pass" class="menu_button ss-hidden" type="button" value="Run Sharder" />
                            <input id="ss-run-single-pass-batch" class="menu_button ss-hidden" type="button" value="Batch Sharder" />
                            <input id="ss-stop-summarize" class="menu_button ss-hidden" type="button" value="Stop" />
                        </div>
                        <div class="ss-action-bar-secondary">
                            <input id="ss-visibility-button" class="menu_button" type="button" value="Manage Visibility" />
                            <input id="ss-manage-chats-btn" class="menu_button" type="button" value="Manage Chats" />
                        </div>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    const mountSegmentedToggle = (hostId, controlId, options, value) => {
        const host = document.getElementById(hostId);
        if (!host) {
            return null;
        }

        const segmented = createSegmentedToggle({ options, value });
        segmented.id = controlId;
        host.replaceChildren(segmented);
        return segmented;
    };

    const ensureSummaryReviewSettings = () => {
        if (!settings.summaryReview) {
            settings.summaryReview = {
                mode: 'always',
                tokenThreshold: 500,
                promptChangeDetection: true,
            };
        }
        return settings.summaryReview;
    };

    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container) {
        log.error('Could not find extensions settings container');
        return;
    }

    container.insertAdjacentHTML('beforeend', settingsHtml);
    setupSettingsAccordionHandlers();
    // Localize hint mounting to the container so we don't pollute the global document
    // with multiple listeners if settings are re-rendered.
    mountInfoHints(container);

    const modeToggle = mountSegmentedToggle(
        'ss-mode-mount',
        'ss-mode',
        [
            { value: 'auto', label: 'Automatic' },
            { value: 'manual', label: 'Manual' },
        ],
        settings.mode || 'auto',
    );

    const outputModeToggle = mountSegmentedToggle(
        'ss-output-mode-mount',
        'ss-output-mode',
        [
            { value: 'system', label: 'System' },
            { value: 'lorebook', label: 'Lorebook' },
        ],
        settings.outputMode || 'system',
    );

    const summaryReview = ensureSummaryReviewSettings();
    const reviewModeToggle = mountSegmentedToggle(
        'ss-summary-review-mode-mount',
        'ss-summary-review-mode',
        [
            { value: 'always', label: 'Always' },
            { value: 'never', label: 'Never' },
        ],
        summaryReview.mode || 'always',
    );

    const sharderProfileToggle = mountSegmentedToggle(
        'ss-sharder-profile-mount',
        'ss-sharder-profile',
        [
            { value: NARRATIVE_PROFILE, label: NARRATIVE_DISPLAY_NAME },
            { value: ARCHITECTURAL_PROFILE, label: ARCHITECTURAL_DISPLAY_NAME },
        ],
        normalizeSharderProfile(settings.sharderProfile),
    );

    const lengthPairHost = document.getElementById('ss-length-percent-host');
    const lengthPair = createRangeSliderPair({
        id: 'ss-length-percent',
        min: 1,
        max: 30,
        step: 1,
        value: settings.summaryLengthPercent || 10,
        unit: '%',
        onChange: (value) => {
            settings.summaryLengthPercent = value;
            saveSettings(settings);
        },
    });
    lengthPairHost?.replaceChildren(lengthPair);

    const bannedKeywordsHost = document.getElementById('ss-banned-keywords-host');
    const bannedTagInput = createTagInput({
        tags: parseCommaTags(settings.lorebookEntryOptions?.bannedKeywords || ''),
        placeholder: 'Add keyword...',
        onChange: (tags) => {
            if (!settings.lorebookEntryOptions) settings.lorebookEntryOptions = {};
            settings.lorebookEntryOptions.bannedKeywords = tagsToString(tags);
            saveSettings(settings);
        },
    });
    bannedTagInput.id = 'ss-banned-keywords';
    bannedKeywordsHost?.replaceChildren(bannedTagInput);

    document.getElementById('ss-auto-interval').value = settings.autoInterval || 20;

    const sharderModeEl = document.getElementById('ss-sharder-mode');
    if (sharderModeEl) {
        sharderModeEl.checked = settings.sharderMode || false;
    }

    const advancedControlEl = document.getElementById('ss-advanced-control');
    if (advancedControlEl) {
        advancedControlEl.checked = settings.advancedUserControl || false;
    }

    const lengthControlEl = document.getElementById('ss-length-control');
    if (lengthControlEl) {
        lengthControlEl.checked = settings.summaryLengthControl || false;
    }

    const summaryReviewToggle = document.getElementById('ss-summary-review-toggle');
    if (summaryReviewToggle) {
        summaryReviewToggle.checked = summaryReview.mode !== 'never';
    }

    const cleanupEl = document.getElementById('ss-context-cleanup');
    if (cleanupEl) {
        cleanupEl.checked = settings.contextCleanup?.enabled || false;
    }

    const fabEnabledEl = document.getElementById('ss-fab-enabled');
    if (fabEnabledEl) {
        fabEnabledEl.checked = settings.fab?.enabled !== false;
    }

    const debugLoggingEl = document.getElementById('ss-debug-logging');
    if (debugLoggingEl) {
        debugLoggingEl.checked = settings.debugLogging === true;
    }

    const useCharBookEl = document.getElementById('ss-use-char-book');
    const useChatBookEl = document.getElementById('ss-use-chat-book');
    const useCustomBooksEl = document.getElementById('ss-use-custom-books');

    if (useCharBookEl) {
        useCharBookEl.checked = settings.lorebookSelection?.useCharacterBook || false;
    }
    if (useChatBookEl) {
        useChatBookEl.checked = settings.lorebookSelection?.useChatBook || false;
    }
    if (useCustomBooksEl) {
        useCustomBooksEl.checked = settings.lorebookSelection?.useCustomBooks || false;
    }

    const singlePassAutoIncludeEl = document.getElementById('ss-single-pass-auto-include-shards');
    if (singlePassAutoIncludeEl) {
        singlePassAutoIncludeEl.checked = settings.autoIncludeShards === true;
    }

    toggleAutoInterval(settings.mode || 'auto');
    toggleLorebookSection(settings.outputMode || 'system');
    toggleSummaryReviewOptions(summaryReview.mode !== 'never');
    toggleLengthSlider(settings.summaryLengthControl || false);
    toggleCustomBooksDropdown(settings.lorebookSelection?.useCustomBooks || false);
    toggleSharderControls(settings);

    updateApiStatusDisplays(settings);

    const lorebookDropdown = new LorebookDropdown('ss-lorebook-dropdown', {
        initialSelection: settings.lorebookSelection?.customBookNames || [],
        onSelectionChange: (selection) => {
            if (!settings.lorebookSelection) {
                settings.lorebookSelection = {};
            }
            settings.lorebookSelection.customBookNames = selection;
            saveSettings(settings);
        },
    });

    if (settings.lorebookSelection?.useCustomBooks) {
        lorebookDropdown.render();
    }

    document.getElementById('ss-open-api-config-modal')?.addEventListener('click', async () => {
        await openApiConfigModal(settings);
        updateApiStatusDisplays(settings);
    });

    modeToggle?.addEventListener('change', (e) => {
        settings.mode = e.target.value;
        saveSettings(settings);
        toggleAutoInterval(e.target.value);
    });

    document.getElementById('ss-auto-interval')?.addEventListener('input', (e) => {
        settings.autoInterval = Math.max(1, parseInt(e.target.value, 10) || 20);
        saveSettings(settings);
    });

    outputModeToggle?.addEventListener('change', (e) => {
        settings.outputMode = e.target.value;
        saveSettings(settings);
        toggleLorebookSection(e.target.value);
    });

    advancedControlEl?.addEventListener('change', (e) => {
        settings.advancedUserControl = e.target.checked;
        saveSettings(settings);
        updateApiStatusDisplays(settings);
        updateActivePromptDisplay(settings);
    });

    sharderModeEl?.addEventListener('change', (e) => {
        settings.sharderMode = e.target.checked;
        saveSettings(settings);
        toggleSharderControls(settings);
        updateApiStatusDisplays(settings);
        updateActivePromptDisplay(settings);

        if (e.target.checked && settings.advancedUserControl) {
            settings.advancedUserControl = false;
            if (advancedControlEl) {
                advancedControlEl.checked = false;
            }
            toastr.info('Disabled Drafting Mode (use Sharder Mode instead)');
            saveSettings(settings);
            updateApiStatusDisplays(settings);
            updateActivePromptDisplay(settings);
        }
    });

    singlePassAutoIncludeEl?.addEventListener('change', (e) => {
        settings.autoIncludeShards = e.target.checked;
        saveSettings(settings);
    });

    sharderProfileToggle?.addEventListener('change', (e) => {
        settings.sharderProfile = normalizeSharderProfile(e.target.value);
        saveSettings(settings);
        updateActivePromptDisplay(settings);
    });

    summaryReviewToggle?.addEventListener('change', (e) => {
        const currentSummaryReview = ensureSummaryReviewSettings();
        currentSummaryReview.mode = e.target.checked ? 'always' : 'never';
        reviewModeToggle?.setValue(currentSummaryReview.mode);
        saveSettings(settings);
        toggleSummaryReviewOptions(e.target.checked);
    });

    reviewModeToggle?.addEventListener('change', (e) => {
        const currentSummaryReview = ensureSummaryReviewSettings();
        currentSummaryReview.mode = e.target.value;
        saveSettings(settings);
    });

    document.getElementById('ss-run-single-pass')?.addEventListener('click', async () => {
        const messages = getAllMessages();
        if (!messages || messages.length === 0) {
            toastr.warning('No messages available');
            return;
        }

        const maxIndex = messages.length - 1;
        const rangeStr = await showSsInput(
            'Sharder: Select Range',
            `Enter message range for sharder (0 to ${maxIndex}):\nExample: '5-25'`,
            `0-${maxIndex}`
        );

        if (!rangeStr) return;

        const match = rangeStr.trim().match(/^(\d+)\s*-\s*(\d+)$/);
        if (!match) {
            toastr.warning('Invalid range format. Use: start-end (e.g., 0-25)');
            return;
        }

        const startIdx = parseInt(match[1], 10);
        const endIdx = parseInt(match[2], 10);

        if (startIdx > endIdx) {
            toastr.warning('Start index must be less than or equal to end index');
            return;
        }

        if (endIdx > maxIndex) {
            toastr.warning(`End index cannot exceed ${maxIndex}`);
            return;
        }

        runSharder(startIdx, endIdx, settings);
    });

    document.getElementById('ss-run-single-pass-batch')?.addEventListener('click', async () => {
        const messages = getAllMessages();
        if (!messages || messages.length === 0) {
            toastr.warning('No messages available');
            return;
        }

        const maxIndex = messages.length - 1;
        const config = await openBatchConfigModal(messages, maxIndex);
        if (!config?.confirmed) return;

        runSharderQueue(config.ranges || [], settings, config.batchConfig || {});
    });

    lengthControlEl?.addEventListener('change', (e) => {
        settings.summaryLengthControl = e.target.checked;
        saveSettings(settings);
        toggleLengthSlider(e.target.checked);
    });

    document.getElementById('ss-context-cleanup')?.addEventListener('change', (e) => {
        if (!settings.contextCleanup) settings.contextCleanup = {};
        settings.contextCleanup.enabled = e.target.checked;
        saveSettings(settings);
    });

    useCharBookEl?.addEventListener('change', (e) => {
        if (!settings.lorebookSelection) {
            settings.lorebookSelection = {};
        }
        settings.lorebookSelection.useCharacterBook = e.target.checked;
        saveSettings(settings);
    });

    useChatBookEl?.addEventListener('change', (e) => {
        if (!settings.lorebookSelection) {
            settings.lorebookSelection = {};
        }
        settings.lorebookSelection.useChatBook = e.target.checked;
        saveSettings(settings);
    });

    useCustomBooksEl?.addEventListener('change', (e) => {
        if (!settings.lorebookSelection) {
            settings.lorebookSelection = {};
        }
        settings.lorebookSelection.useCustomBooks = e.target.checked;
        saveSettings(settings);
        toggleCustomBooksDropdown(e.target.checked);

        if (e.target.checked) {
            lorebookDropdown.render();
        }
    });

    document.getElementById('ss-lorebook-options-btn')?.addEventListener('click', () => {
        openLorebookOptionsModal(settings);
    });

    document.getElementById('ss-open-prompts-btn')?.addEventListener('click', () => {
        openPromptsModal(settings);
    });

    document.getElementById('ss-open-cleanup-btn')?.addEventListener('click', () => {
        openCleanContextModal(settings);
    });

    document.getElementById('ss-open-themes-btn')?.addEventListener('click', () => {
        openThemesModal(settings, () => saveSettings(settings));
    });

    document.getElementById('ss-open-rag-btn')?.addEventListener('click', () => {
        openRagSettingsModal(settings);
    });

    document.getElementById('ss-fab-enabled')?.addEventListener('change', (e) => {
        if (!settings.fab) settings.fab = {};
        settings.fab.enabled = e.target.checked;
        saveSettings(settings);
        updateFabVisibility();
    });

    debugLoggingEl?.addEventListener('change', (e) => {
        settings.debugLogging = e.target.checked;
        saveSettings(settings);
        try {
            localStorage.setItem('ss_debug', e.target.checked ? 'true' : 'false');
        } catch {
            // Ignore storage failures; settings persistence still controls the logger.
        }
    });

    document.getElementById('ss-export-debug-settings-btn')?.addEventListener('click', async () => {
        await openDebugExportModal(settings);
    });

    document.getElementById('ss-run-summarize')?.addEventListener('click', () => {
        if (callbacks.onManualSummarize) {
            callbacks.onManualSummarize();
        }
    });

    document.getElementById('ss-stop-summarize')?.addEventListener('click', () => {
        stopSummarization();
    });

    document.getElementById('ss-visibility-button')?.addEventListener('click', () => {
        openVisibilityModal(settings);
    });

    document.getElementById('ss-manage-chats-btn')?.addEventListener('click', () => {
        openChatManagerModal(settings);
    });

    updateActivePromptDisplay(settings);
}

