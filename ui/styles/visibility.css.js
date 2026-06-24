export const VISIBILITY_CSS = `
.ss-fold-btn {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 3px;
    color: var(--ss-text-muted);
    font-size: 0.75em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color var(--ss-transition), color var(--ss-transition);
    user-select: none;
    line-height: 1;
}

.ss-fold-btn:hover {
    background: var(--ss-highlight);
    color: var(--ss-text-primary);
}

.ss-archive-btn {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 3px;
    color: var(--ss-text-muted);
    font-size: 0.8em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color var(--ss-transition), color var(--ss-transition);
    user-select: none;
    line-height: 1;
}

.ss-archive-btn:hover {
    background: var(--ss-highlight);
    color: var(--ss-text-primary);
}

.ss-archive-btn::before { content: '🗄'; }
.ss-archive-btn[data-archived='true']::before { content: '↩'; }

.mes.ss-archived-message {
    border-left: 2px solid var(--ss-border);
}

.mes.ss-archived-visible {
    opacity: 0.82;
}

.mes.ss-archived-hidden {
    display: none !important;
}

/* Arrow glyphs via CSS content — no Font Awesome dependency */
.mes.ss-collapsed .ss-fold-btn::before { content: '▶'; }
.mes.ss-expanded  .ss-fold-btn::before { content: '▼'; }

/* Hide text when collapsed */
.mes.ss-collapsed .mes_text { display: none; }
.ss-text-hidden { display: none !important; }

/* ==========================================================================
   SECTION 9: VISIBILITY MODAL
   ========================================================================== */

.ss-visibility-modal {
    max-height: 80vh;
    overflow-y: auto;
    padding: 15px;
}

.ss-visibility-modal h3 {
    margin-top: 0;
    margin-bottom: 15px;
    color: var(--ss-text-primary);
}

.ss-global-toggles {
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid var(--ss-border);
}

.ss-global-heading {
    margin-top: 0;
}

.ss-global-toggle-row {
    margin-bottom: 10px;
}

.ss-global-hint {
    margin: 5px 0 0 0;
    font-size: 12px;
    color: var(--ss-text-hint);
}

.ss-global-hint-indented {
    margin-left: 25px;
}

.ss-global-ignore-group {
    margin-top: 15px;
    margin-bottom: 10px;
}

.ss-global-ignore-label {
    display: block;
    margin-bottom: 5px;
    font-size: 14px;
    color: var(--ss-text-primary);
}

#ss-modal-global-ignore {
    width: 100%;
}

.ss-global-actions-row {
    margin-top: 15px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.ss-ranges-section {
    margin-top: 15px;
}

.ss-range-actions-row {
    margin-bottom: 10px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.ss-ranges-list {
    max-height: 400px;
    overflow-y: auto;
    margin-bottom: 10px;
    padding: 5px;
}

.ss-range-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    margin-bottom: 10px;
    background: var(--ss-bg-secondary);
    border-radius: 5px;
    gap: 10px;
    flex-wrap: wrap;
}

.ss-range-info {
    flex: 1 1 150px;
    font-weight: bold;
    color: var(--ss-text-primary);
}

.ss-range-editable {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
}

.ss-range-label {
    font-size: 12px;
    color: var(--ss-text-primary);
}

.ss-range-input {
    width: 60px !important;
    min-width: 60px !important;
    padding: 4px 6px !important;
    font-size: 12px !important;
    text-align: center;
}

.ss-range-separator {
    font-weight: bold;
    color: var(--ss-text-primary);
}

.ss-range-controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
}

.ss-ignore-input-wrapper {
    margin-bottom: 8px;
    width: 100%;
}

.ss-ignore-label {
    font-size: 12px;
    display: block;
    margin-bottom: 3px;
}

.ss-ignore-input {
    width: 100%;
    font-size: 12px;
}

.ss-ranges-empty {
    text-align: center;
    color: var(--ss-text-muted);
    padding: 20px;
}

.ss-range-checkbox-label {
    margin: 0;
    font-size: 14px;
}

.ss-delete-btn {
    padding: 5px 10px;
    font-size: 14px;
}

.ss-add-range-row {
    margin-top: 15px;
}
`;
