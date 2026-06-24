/**
 * Summary Review Modal
 * Review and edit generated summaries before injection
 * Shows side-by-side comparison of selected events vs generated summary
 * with fuzzy matching indicators and regeneration capability
 */

import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../../popup.js';
import { escapeHtml, truncateText, debounce } from '../../common/ui-utils.js';
import { analyzeEventCoverage } from '../../../core/processing/keyword-analysis.js';
export { analyzeEventCoverage };

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

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

// ============================================================================
// HTML BUILDING
// ============================================================================

/**
 * Get CSS class for coverage status
 */
function getCoverageStatusClass(status) {
    switch (status) {
        case 'covered': return 'ss-coverage-covered';
        case 'partial': return 'ss-coverage-partial';
        case 'missing': return 'ss-coverage-missing';
        default: return '';
    }
}

/**
 * Get emoji indicator for coverage status
 */
function getCoverageEmoji(status) {
    switch (status) {
        case 'covered': return '\u{1F7E2}'; // Green circle
        case 'partial': return '\u{1F7E1}'; // Yellow circle
        case 'missing': return '\u{1F534}'; // Red circle
        default: return '\u26AA';           // White circle
    }
}

/**
 * Build the events list HTML with coverage indicators
 */
function buildEventsListHTML(events, coverageAnalysis) {
    if (events.length === 0) {
        return '<p class="ss-empty">No events selected</p>';
    }

    return events.map((event, index) => {
        const coverage = coverageAnalysis[index];
        const statusClass = getCoverageStatusClass(coverage.status);
        const statusEmoji = getCoverageEmoji(coverage.status);
        const description = event.userDescription || event.originalDescription || 'No description';
        const summary = event.summary || `Event ${index + 1}`;

        return `
            <div class="ss-event-reference-item ${statusClass}">
                <div class="ss-event-coverage-indicator">
                    <span class="ss-coverage-emoji">${statusEmoji}</span>
                    <span class="ss-coverage-percent">${Math.round(coverage.score * 100)}%</span>
                </div>
                <div class="ss-event-content">
                    <div class="ss-event-summary">${escapeHtml(summary)}</div>
                    <div class="ss-event-description">${escapeHtml(truncateText(description, 150))}</div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Build the modal HTML
 */
function buildModalHTML(summary, selectedEvents, coverageAnalysis, tokenCount, isFullMode, ragEnabled) {
    const coveredCount = coverageAnalysis.filter(c => c.status === 'covered').length;
    const partialCount = coverageAnalysis.filter(c => c.status === 'partial').length;
    const missingCount = coverageAnalysis.filter(c => c.status === 'missing').length;

    // Description changes based on mode
    const description = isFullMode
        ? 'Review the generated summary and verify event coverage before injecting.'
        : 'Review and edit the generated summary before injecting.';

    return `
        <div class="ss-summary-review-modal">
            <div class="ss-summary-review-header">
                <div class="ss-header-left">
                    <h3>Summary Review</h3>
                    <p>${description}</p>
                </div>
                <div class="ss-token-display">
                    <span class="ss-token-count">${tokenCount}</span>
                    <span class="ss-token-label">tokens (approx)</span>
                </div>
            </div>

            ${isFullMode ? `
                <div class="ss-coverage-summary">
                    <span class="ss-coverage-stat ss-coverage-covered">\u{1F7E2} ${coveredCount} covered</span>
                    <span class="ss-coverage-stat ss-coverage-partial">\u{1F7E1} ${partialCount} partial</span>
                    <span class="ss-coverage-stat ss-coverage-missing">\u{1F534} ${missingCount} missing</span>
                </div>

                <div class="ss-summary-review-content">
                    <div class="ss-events-panel">
                        <div class="ss-panel-header">
                            <h4>Selected Events</h4>
                            <span class="ss-event-count">(${selectedEvents.length})</span>
                        </div>
                        <div class="ss-events-list-readonly" id="ss-events-reference">
                            ${buildEventsListHTML(selectedEvents, coverageAnalysis)}
                        </div>
                    </div>

                    <div class="ss-summary-panel">
                        <div class="ss-panel-header">
                            <h4>Generated Summary</h4>
                            <button id="ss-toggle-edit" class="menu_button">Edit</button>
                        </div>
                        <div id="ss-summary-preview" class="ss-summary-preview">
                            <pre>${escapeHtml(summary)}</pre>
                        </div>
                        <textarea id="ss-summary-editor" class="ss-summary-editor text_pole" style="display: none;">${escapeHtml(summary)}</textarea>
                    </div>
                </div>
            ` : `
                <div class="ss-summary-review-content-simple">
                    <div class="ss-summary-panel ss-summary-panel-full">
                        <div class="ss-panel-header">
                            <h4>Generated Summary</h4>
                            <button id="ss-toggle-edit" class="menu_button">Edit</button>
                        </div>
                        <div id="ss-summary-preview" class="ss-summary-preview">
                            <pre>${escapeHtml(summary)}</pre>
                        </div>
                        <textarea id="ss-summary-editor" class="ss-summary-editor text_pole" style="display: none;">${escapeHtml(summary)}</textarea>
                    </div>
                </div>
            `}

            <div class="ss-regenerate-section">
                <div class="ss-regenerate-header">
                    <h4>Regenerate with Note</h4>
                    <span class="ss-regenerate-hint">Add instructions to refine the summary</span>
                </div>
                <div class="ss-regenerate-controls">
                    <input type="text" id="ss-regenerate-note"
                           class="text_pole"
                           placeholder="e.g., emphasize the wolf's eye color, add more detail about the battle" />
                    <button id="ss-regenerate-btn" class="menu_button">Regenerate</button>
                </div>
            </div>

            <div class="ss-archive-section">
                <h4>Output Options</h4>
                <div class="ss-archive-options">
                    <label class="ss-archive-option">
                        <input type="checkbox" id="ss-inject-context" checked />
                        <span>Inject to context</span>
                    </label>
                    <label class="ss-archive-option ${ragEnabled ? '' : 'ss-disabled'}" ${ragEnabled ? '' : 'title="Enable RAG to use warm archive"'}>
                        <input type="checkbox" id="ss-archive-warm" ${ragEnabled ? '' : 'disabled'} />
                        <span>Archive to warm storage (RAG-retrievable)</span>
                    </label>
                    <label class="ss-archive-option">
                        <input type="checkbox" id="ss-archive-cold" />
                        <span>Save to local cold archive (history only, not RAG-retrievable)</span>
                    </label>
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Update coverage display after summary edit (only in full mode)
 */
function updateCoverageDisplay(modalState) {
    // Only update coverage if we're in full mode (have events)
    if (!modalState.isFullMode) return;

    const newCoverage = analyzeEventCoverage(modalState.selectedEvents, modalState.editedSummary);
    modalState.coverageAnalysis = newCoverage;

    const container = document.getElementById('ss-events-reference');
    if (container) {
        container.innerHTML = buildEventsListHTML(modalState.selectedEvents, newCoverage);
    }

    // Update coverage summary stats
    const coveredCount = newCoverage.filter(c => c.status === 'covered').length;
    const partialCount = newCoverage.filter(c => c.status === 'partial').length;
    const missingCount = newCoverage.filter(c => c.status === 'missing').length;

    const summaryEl = document.querySelector('.ss-coverage-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="ss-coverage-stat ss-coverage-covered">\u{1F7E2} ${coveredCount} covered</span>
            <span class="ss-coverage-stat ss-coverage-partial">\u{1F7E1} ${partialCount} partial</span>
            <span class="ss-coverage-stat ss-coverage-missing">\u{1F534} ${missingCount} missing</span>
        `;
    }
}

/**
 * Update token count display
 */
function updateTokenDisplay(modalState) {
    modalState.tokenCount = estimateTokenCount(modalState.editedSummary);
    const tokenDisplay = document.querySelector('.ss-token-count');
    if (tokenDisplay) {
        tokenDisplay.textContent = modalState.tokenCount;
    }
}

/**
 * Auto-resize textarea to fit content
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize
 */
function autoResizeTextarea(textarea) {
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Set height to scrollHeight to expand to fit content
    textarea.style.height = textarea.scrollHeight + 'px';
}

/**
 * Setup event handlers for the modal
 */
function setupModalHandlers(modalState, regenerateCallback) {
    // Edit toggle
    const editBtn = document.getElementById('ss-toggle-edit');
    const preview = document.getElementById('ss-summary-preview');
    const editor = document.getElementById('ss-summary-editor');

    if (editBtn && preview && editor) {
        editBtn.addEventListener('click', () => {
            if (modalState.isEditing) {
                // Save and switch to preview
                modalState.editedSummary = editor.value;
                preview.innerHTML = `<pre>${escapeHtml(editor.value)}</pre>`;
                preview.style.display = 'block';
                editor.style.display = 'none';
                editBtn.textContent = 'Edit';
                modalState.isEditing = false;

                // Recalculate coverage with new summary
                updateCoverageDisplay(modalState);
            } else {
                // Switch to editor
                editor.value = modalState.editedSummary;
                preview.style.display = 'none';
                editor.style.display = 'block';
                editBtn.textContent = 'Done';
                modalState.isEditing = true;

                // Auto-resize on initial display
                autoResizeTextarea(editor);
            }
        });

        // Track edits for live token count.
        // Do not auto-resize per keystroke so manual drag-resize remains stable.
        editor.addEventListener('input', (e) => {
            modalState.editedSummary = e.target.value;
        });

        editor.addEventListener('input', debounce(() => {
            updateTokenDisplay(modalState);
        }, 300));
    }

    // Regenerate note input
    const noteInput = document.getElementById('ss-regenerate-note');
    if (noteInput) {
        noteInput.addEventListener('input', (e) => {
            modalState.userNote = e.target.value;
        });
    }

    // Regenerate button
    const regenerateBtn = document.getElementById('ss-regenerate-btn');
    if (regenerateBtn && regenerateCallback) {
        regenerateBtn.addEventListener('click', async () => {
            if (!modalState.userNote.trim()) {
                toastr.warning('Please enter a note for regeneration');
                return;
            }

            // Show loading state
            regenerateBtn.disabled = true;
            regenerateBtn.textContent = 'Regenerating...';

            try {
                const newSummary = await regenerateCallback(modalState.userNote);
                modalState.editedSummary = newSummary;
                modalState.originalSummary = newSummary;

                // Update display
                const preview = document.getElementById('ss-summary-preview');
                const editor = document.getElementById('ss-summary-editor');
                if (preview) preview.innerHTML = `<pre>${escapeHtml(newSummary)}</pre>`;
                if (editor) {
                    editor.value = newSummary;
                    autoResizeTextarea(editor);
                }

                // Ensure we're in preview mode
                if (modalState.isEditing) {
                    const editBtn = document.getElementById('ss-toggle-edit');
                    if (editBtn) editBtn.click();
                }

                // Update coverage and tokens
                updateCoverageDisplay(modalState);
                updateTokenDisplay(modalState);

                // Clear the note
                const noteInput = document.getElementById('ss-regenerate-note');
                if (noteInput) noteInput.value = '';
                modalState.userNote = '';

                toastr.success('Summary regenerated');
            } catch (error) {
                toastr.error(`Regeneration failed: ${error.message}`);
            } finally {
                regenerateBtn.disabled = false;
                regenerateBtn.textContent = 'Regenerate';
            }
        });
    }

    // Archive options
    const injectCheckbox = document.getElementById('ss-inject-context');
    if (injectCheckbox) {
        injectCheckbox.addEventListener('change', (e) => {
            modalState.archiveOptions.injectToContext = e.target.checked;
        });
    }

    const warmCheckbox = document.getElementById('ss-archive-warm');
    if (warmCheckbox) {
        warmCheckbox.addEventListener('change', (e) => {
            modalState.archiveOptions.archiveWarm = e.target.checked;
        });
    }

    const coldCheckbox = document.getElementById('ss-archive-cold');
    if (coldCheckbox) {
        coldCheckbox.addEventListener('change', (e) => {
            modalState.archiveOptions.archiveCold = e.target.checked;
        });
    }
}

// ============================================================================
// MAIN EXPORTS
// ============================================================================

/**
 * Determine if Summary Review Modal should show
 * @param {Object} context - { settings, isFirstSummary, promptChanged, tokenCount }
 * @returns {boolean}
 */
export function shouldShowSummaryReviewModal(context) {
    const { settings } = context;
    const reviewConfig = settings.summaryReview || {};
    const mode = reviewConfig.mode || 'always';

    if (mode === 'always') return true;
    if (mode === 'never') return false;

    return false;
}

/**
 * Open the Summary Review Modal
 * @param {string} generatedSummary - Raw LLM output
 * @param {Array|null} selectedEvents - From events modal (null for simplified mode)
 * @param {Object} settings - Extension settings
 * @param {Function} regenerateCallback - Function to call for regeneration (receives userNote)
 * @returns {Promise<{confirmed, finalSummary, shouldRegenerate, userNote, archiveOptions}>}
 */
export async function openSummaryReviewModal(
    generatedSummary,
    selectedEvents,
    settings,
    regenerateCallback
) {
    // Detect mode: full (with events) or simplified (summary only)
    const isFullMode = selectedEvents && selectedEvents.length > 0;

    // Analyze initial coverage (only in full mode)
    const coverageAnalysis = isFullMode
        ? analyzeEventCoverage(selectedEvents, generatedSummary)
        : [];
    const tokenCount = estimateTokenCount(generatedSummary);

    // Modal state
    const modalState = {
        originalSummary: generatedSummary,
        editedSummary: generatedSummary,
        isEditing: false,
        isFullMode: isFullMode,
        selectedEvents: selectedEvents || [],
        coverageAnalysis: coverageAnalysis,
        tokenCount: tokenCount,
        userNote: '',
        archiveOptions: {
            injectToContext: true,
            archiveWarm: false,
            archiveCold: false
        }
    };

    const modalHtml = buildModalHTML(
        generatedSummary,
        selectedEvents || [],
        coverageAnalysis,
        tokenCount,
        isFullMode,
        settings?.rag?.enabled === true
    );

    const popup = new Popup(
        modalHtml,
        POPUP_TYPE.TEXT,
        null,
        {
            okButton: 'Confirm & Inject',
            cancelButton: 'Cancel',
            wide: true,
            large: true
        }
    );

    const showPromise = popup.show();

    // Setup handlers after DOM renders
    setTimeout(() => {
        setupModalHandlers(modalState, regenerateCallback);
    }, 100);

    const result = await showPromise;

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        return {
            confirmed: true,
            finalSummary: modalState.editedSummary,
            shouldRegenerate: false,
            userNote: modalState.userNote,
            archiveOptions: modalState.archiveOptions
        };
    }

    return {
        confirmed: false,
        finalSummary: '',
        shouldRegenerate: false,
        userNote: '',
        archiveOptions: {}
    };
}
