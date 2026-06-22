export const SUMMARIZE_CSS = `
/* ==========================================================================
   SECTION 12: EXPORT MODAL
   ========================================================================== */

.ss-export-modal {
    padding: 15px;
    min-width: 300px;
}

.ss-export-modal h3 {
    margin: 0 0 15px 0;
    color: var(--ss-text-primary);
}

.ss-export-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ss-radio-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--ss-border);
    border-radius: 4px;
    margin-bottom: 5px;
    cursor: pointer;
    color: var(--ss-text-primary);
    transition: all var(--ss-transition);
}

.ss-radio-option:hover {
    border-color: var(--ss-primary);
    background: var(--ss-highlight);
}

.ss-radio-option input[type="radio"] {
    margin: 0;
}

.ss-radio-option input:checked + span {
    color: var(--ss-primary);
    font-weight: 500;
}

/* ==========================================================================
   SECTION 13: SUMMARIZE MODAL
   ========================================================================== */

.ss-summarize-modal {
    padding: 15px;
    min-width: 400px;
}

.ss-summarize-modal h3 {
    margin: 0 0 15px 0;
    color: var(--ss-text-primary);
}

.ss-summarize-section {
    margin-bottom: 15px;
}

.ss-summarize-section > label {
    display: block;
    margin-bottom: 5px;
    font-weight: 500;
    color: var(--ss-text-primary);
}

.ss-range-inputs {
    display: flex;
    align-items: center;
    gap: 10px;
}

.ss-range-inputs input {
    width: 80px;
}

.ss-range-inputs span {
    color: var(--ss-text-primary);
}

.ss-destination-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ss-custom-position-wrapper {
    margin-top: 5px;
}

/* ==========================================================================
   SECTION 14: EVENTS MODAL
   ========================================================================== */

.ss-events-modal {
    padding: 15px;
}

.ss-events-header h3 {
    margin-top: 0;
    margin-bottom: 5px;
    color: var(--ss-text-primary);
}

.ss-events-header p {
    color: var(--ss-text-secondary);
    font-size: 13px;
    margin: 0 0 15px 0;
}

.ss-events-controls-top {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
}

.ss-events-list {
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid var(--ss-border);
    border-radius: 4px;
    padding: 10px;
    background: var(--ss-bg-secondary);
}

.ss-event-row {
    padding: 12px;
    margin-bottom: 10px;
    background: var(--ss-bg-tertiary);
    border-radius: 4px;
    border-left: 3px solid var(--ss-success);
    transition: opacity 0.2s ease, border-color 0.2s ease;
}

.ss-event-row:last-child {
    margin-bottom: 0;
}

.ss-event-row.ss-event-excluded {
    opacity: 0.5;
    border-left-color: var(--ss-text-muted);
}

.ss-event-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
}

.ss-event-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
}

.ss-event-summary {
    font-weight: bold;
    color: var(--ss-text-primary);
    flex: 1;
}

.ss-event-messages {
    font-size: 12px;
    color: var(--ss-text-secondary);
    margin-bottom: 8px;
    margin-left: 28px;
}

.ss-event-description {
    width: 100%;
    min-height: 60px;
    resize: vertical;
    font-family: inherit;
    font-size: 13px;
    padding: 8px;
    border: 1px solid var(--ss-border);
    border-radius: 4px;
    background: var(--ss-bg-input);
    color: var(--ss-text-primary);
}

.ss-event-description:focus {
    outline: none;
    border-color: var(--ss-border-focus);
}

.ss-events-loading {
    text-align: center;
    padding: 40px;
    color: var(--ss-text-secondary);
}

.ss-events-loading .spinner {
    width: 30px;
    height: 30px;
    border: 3px solid var(--ss-border);
    border-top-color: var(--ss-primary);
    border-radius: 50%;
    animation: ss-spin 1s linear infinite;
    margin: 0 auto 10px auto;
}

@keyframes ss-spin {
    to { transform: rotate(360deg); }
}

.ss-events-empty {
    text-align: center;
    padding: 30px;
    color: var(--ss-text-secondary);
}

/* Consolidated Output (rebuilt) */
.ss-review-output-section {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--ss-border);
}

.ss-output-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}

.ss-output-preview {
    background: var(--ss-bg-secondary);
    border: 1px solid var(--ss-border);
    border-radius: 6px;
    padding: 10px;
    max-height: 240px;
    overflow: auto;
}

.ss-output-preview pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
}

.ss-output-editor {
    width: 100%;
    margin-top: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    resize: vertical;
    max-width: 100%;
    box-sizing: border-box;
}

/* Editable consolidated-output sections */
.ss-cr-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ss-cr-item-row {
    background: var(--ss-bg-tertiary);
    border: 1px solid var(--ss-border);
    border-radius: 6px;
    padding: 8px;
}

.ss-cr-item-row.is-unselected {
    opacity: 0.6;
}

.ss-cr-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}

.ss-cr-item-select {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ss-text-primary);
}

.ss-cr-item-meta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.ss-cr-item-delete {
    font-size: 11px !important;
    padding: 4px 10px !important;
}

.ss-cr-item-archived {
    background: rgba(46, 204, 113, 0.15) !important;
    border-color: rgba(46, 204, 113, 0.45) !important;
    color: var(--ss-text-primary) !important;
}

.ss-cr-item-editor {
    width: 100%;
    min-height: 44px;
    resize: vertical;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.35;
}

.ss-cr-scene-codes {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
}

.ss-cr-scene-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 10px;
    border: 1px solid var(--ss-border);
    background: rgba(124, 94, 208, 0.15);
    color: var(--ss-text-primary);
}

.ss-cr-scene-badge-empty {
    background: rgba(255, 255, 255, 0.05);
    color: var(--ss-text-muted);
}

.ss-review-header h3 {
    margin-top: 0;
    margin-bottom: 5px;
    color: var(--ss-text-primary);
}

.ss-review-header p {
    color: var(--ss-text-secondary);
    font-size: 13px;
    margin: 0 0 10px 0;
}

.ss-quick-approve-badge {
    display: inline-block;
    padding: 4px 10px;
    background: #2ecc71;
    color: white;
    border-radius: 4px;
    font-size: 12px;
    margin-left: 10px;
}

/* Review Summary Stats */
.ss-review-summary {
    display: flex;
    gap: 20px;
    margin-bottom: 15px;
    padding: 10px;
    background: var(--ss-bg-secondary);
    border-radius: 4px;
    flex-wrap: wrap;
}

.ss-summary-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 60px;
}

.ss-stat-value {
    font-size: 24px;
    font-weight: bold;
    color: var(--ss-primary);
}

.ss-stat-label {
    font-size: 11px;
    color: var(--ss-text-muted);
    text-align: center;
}

/* Review Sections */
.ss-review-sections {
    max-height: 400px;
    overflow-y: auto;
    margin-bottom: 15px;
}

.popup:has(.ss-single-pass-review-modal) {
    display: flex !important;
    flex-direction: column;
    max-height: min(92vh, calc(100vh - 24px));
}

.popup:has(.ss-single-pass-review-modal) .popup-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
}

.popup:has(.ss-single-pass-review-modal) .popup-controls {
    flex: 0 0 auto;
}

.ss-single-pass-review-modal {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 100%;
    overflow: visible;
    padding: 15px;
}

/* Review Accordion */
.ss-review-accordion {
    margin-bottom: 10px;
    border: 1px solid var(--ss-border);
    border-radius: 4px;
    overflow: hidden;
}

.ss-review-accordion.ss-section-warning {
    border-color: var(--ss-warning);
    border-width: 2px;
}

.ss-review-accordion.ss-section-error {
    border-color: var(--ss-error);
    border-width: 2px;
}

.ss-review-accordion.ss-section-info {
    border-color: var(--ss-info);
}

.ss-accordion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--ss-bg-secondary);
    cursor: pointer;
    user-select: none;
}

.ss-accordion-header:hover {
    background: var(--ss-bg-tertiary);
}

.ss-accordion-toggle {
    width: 20px;
    text-align: center;
}

.ss-accordion-toggle i {
    transition: transform var(--ss-transition);
    color: var(--ss-text-primary);
}

.ss-review-accordion.expanded .ss-accordion-toggle i {
    transform: rotate(90deg);
}

.ss-accordion-emoji {
    font-size: 16px;
}

.ss-accordion-title {
    font-weight: bold;
    color: var(--ss-text-primary);
    flex: 1;
}

.ss-accordion-count {
    font-size: 12px;
    color: var(--ss-text-secondary);
}

.ss-accordion-content {
    padding: 10px;
    border-top: 1px solid var(--ss-border);
    max-height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
}

.ss-sp-header,
.ss-sp-summary,
.ss-sp-sections-area,
.ss-sp-panel,
.ss-sp-blocking-note,
.ss-archive-section,
.ss-sp-diagnostics {
    min-width: 0;
}

.ss-sp-global-controls,
.ss-output-header,
.ss-output-actions,
.ss-archive-options {
    flex-wrap: wrap;
}

.ss-sp-diag {
    scroll-margin-top: 12px;
    overflow-wrap: anywhere;
}

.ss-sp-output-editor {
    min-height: 200px;
    max-width: 100%;
    box-sizing: border-box;
}

/* Warning Badges */
.ss-warning-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 500;
}

.ss-warning-badge.ss-info {
    background: var(--ss-info);
    color: white;
}

.ss-warning-badge.ss-warning {
    background: var(--ss-warning);
    color: white;
}

.ss-warning-badge.ss-error {
    background: var(--ss-error);
    color: white;
}

/* Approval/Flag Toggles */
.ss-approve-toggle,
.ss-flag-toggle,
.ss-confirm-toggle,
.ss-override-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    color: var(--ss-text-primary);
}

.ss-approve-toggle:hover,
.ss-confirm-toggle:hover,
.ss-override-toggle:hover {
    background: rgba(46, 204, 113, 0.2);
}

.ss-flag-toggle:hover {
    background: rgba(231, 76, 60, 0.2);
}

.ss-approve-toggle input,
.ss-flag-toggle input,
.ss-confirm-toggle input,
.ss-override-toggle input {
    margin: 0;
}

/* Review Row Styles */
.ss-relationship-row,
.ss-thread-row,
.ss-pruning-item,
.ss-nsfw-item,
.ss-scene-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    margin-bottom: 5px;
    background: var(--ss-bg-tertiary);
    border-radius: 4px;
    flex-wrap: wrap;
}

.ss-relationship-row.ss-discrepancy-warning {
    border-left: 3px solid var(--ss-warning);
}

.ss-thread-row.ss-status-missing {
    border-left: 3px solid var(--ss-error);
}

.ss-relationship-pair,
.ss-thread-name {
    font-weight: 500;
    color: var(--ss-text-primary);
    min-width: 120px;
}

.ss-relationship-deltas {
    flex: 1;
    font-size: 12px;
}

.ss-dim-breakdown {
    display: block;
    color: var(--ss-text-primary);
    margin-bottom: 2px;
}

.ss-relationship-actions,
.ss-thread-actions,
.ss-pruning-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.ss-thread-change {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
}

.ss-status-old {
    color: var(--ss-text-muted);
    font-family: var(--ss-font-muted, inherit);
    font-size: var(--ss-font-size-muted, inherit);
    text-decoration: line-through;
}

.ss-status-arrow {
    color: var(--ss-text-primary);
}

.ss-status-new {
    font-weight: bold;
    color: var(--ss-quote);
}

.ss-status-new.ss-missing {
    color: var(--ss-error);
}

/* Section Overview */
.ss-overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
}

.ss-overview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--ss-bg-tertiary);
    border-radius: 4px;
    border-left: 3px solid transparent;
}

.ss-overview-row.ss-section-has-pruning {
    border-left-color: var(--ss-warning);
}

.ss-overview-emoji {
    font-size: 14px;
}

.ss-overview-name {
    flex: 1;
    font-size: 12px;
    color: var(--ss-text-primary);
}

.ss-overview-counts {
    font-size: 11px;
    color: var(--ss-text-muted);
    display: flex;
    align-items: center;
    gap: 5px;
}

.ss-pruned-badge {
    background: var(--ss-warning);
    color: white;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: bold;
}

.ss-overview-summary {
    margin-top: 10px;
    font-size: 12px;
    color: var(--ss-text-muted);
    text-align: center;
    font-style: italic;
}

/* Callback Section */
.ss-callback-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    margin-bottom: 5px;
    background: var(--ss-bg-tertiary);
    border-radius: 4px;
    flex-wrap: wrap;
}

.ss-callback-row.ss-status-missing {
    border-left: 3px solid var(--ss-error);
}

.ss-callback-name {
    font-weight: 500;
    color: var(--ss-text-primary);
    min-width: 120px;
    flex: 1;
}

.ss-callback-change {
    display: flex;
    align-items: center;
    gap: 5px;
}

.ss-callback-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

/* Pruning Section */
.ss-pruning-group {
    margin-bottom: 15px;
}

/* legacy (pre-accordion) header */
.ss-pruning-group h5 {
    margin: 0;
    color: var(--ss-text-primary);
    font-size: 13px;
}

.ss-pruning-group-title {
    font-weight: 600;
    color: var(--ss-text-primary);
    flex: 1;
}

.ss-pruning-group-count {
    font-size: 12px;
    color: var(--ss-text-secondary);
}

.ss-pruning-group.ss-sub-accordion {
    border: 1px solid var(--ss-border);
    border-radius: 4px;
    overflow: hidden;
}

.ss-pruning-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--ss-bg-secondary);
    cursor: pointer;
    user-select: none;
}

.ss-pruning-group-header:hover {
    background: var(--ss-bg-tertiary);
}

.ss-sub-accordion-toggle {
    width: 16px;
    text-align: center;
}

.ss-sub-accordion-toggle i {
    font-size: 12px;
    transition: transform var(--ss-transition);
    color: var(--ss-text-primary);
}

.ss-pruning-group.expanded .ss-sub-accordion-toggle i {
    transform: rotate(90deg);
}

.ss-sub-accordion-content {
    padding: 8px;
    border-top: 1px solid var(--ss-border);
}

.ss-pruning-content {
    flex: 1;
    font-size: 12px;
    color: var(--ss-text-primary);
}

.ss-pruning-source {
    font-size: 11px;
    color: var(--ss-text-muted);
}

/* NSFW Section */
.ss-nsfw-scene {
    font-family: monospace;
    font-size: 11px;
    padding: 2px 6px;
    background: var(--ss-quote);
    color: white;
    border-radius: 3px;
}

.ss-nsfw-content {
    flex: 1;
    font-size: 12px;
    color: var(--ss-text-primary);
}

/* Scene Section */
.ss-scene-preview {
    flex: 1;
    font-size: 12px;
    color: var(--ss-text-primary);
}

/* Output Preview/Editor */
.ss-review-output-section {
    margin-top: 15px;
    border-top: 1px solid var(--ss-border);
    padding-top: 15px;
}

.ss-output-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    color: var(--ss-text-primary);
    font-weight: 500;
}

.ss-output-actions {
    display: flex;
    align-items: center;
    gap: 6px;
}

.ss-output-preview {
    max-height: 150px;
    overflow-y: auto;
    padding: 10px;
    background: var(--ss-bg-secondary);
    border-radius: 4px;
    font-size: 12px;
}

.ss-output-preview pre {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--ss-text-primary);
    font-family: monospace;
}

.ss-output-editor {
    width: 100%;
    min-height: 200px;
    font-family: monospace;
    font-size: 12px;
}

/* Status Text */
.ss-success {
    color: var(--ss-success);
    font-weight: 500;
}

.ss-warning-text {
    color: var(--ss-warning);
    font-weight: 500;
}

.ss-info-text {
    color: var(--ss-info);
}

.ss-empty {
    color: var(--ss-text-muted);
    font-family: var(--ss-font-muted, inherit);
    font-size: var(--ss-font-size-muted, inherit);
    font-style: italic;
    text-align: center;
    padding: 30px;
}

/* ==========================================================================
   SECTION 18: SUMMARY REVIEW MODAL
   ========================================================================== */

.ss-summary-review-modal {
    padding: 15px;
    max-height: 80vh;
    overflow-y: auto;
}

.ss-summary-review-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 15px;
    gap: 15px;
}

.ss-summary-review-header .ss-header-left {
    flex: 1;
}

.ss-summary-review-header h3 {
    margin: 0 0 5px 0;
    color: var(--ss-text-primary);
}

.ss-summary-review-header p {
    color: var(--ss-text-secondary);
    font-size: 13px;
    margin: 0;
}
`;
