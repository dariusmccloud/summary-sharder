export const INTERPRETIVE_REVIEW_CSS = `
/* ==========================================================================
   INTERPRETIVE REVIEW MODAL
   ========================================================================== */

.ss-interpretive-review-modal {
    padding: 14px;
    width: min(1180px, 92vw);
    max-width: 100%;
    box-sizing: border-box;
}

.ss-interpretive-review-toolbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.ss-interpretive-review-toolbar .ss-hint {
    margin: 0;
}

.ss-interpretive-review-filter {
    display: grid;
    gap: 4px;
    min-width: 220px;
}

.ss-interpretive-review-layout {
    display: grid;
    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
    gap: 12px;
    min-height: 540px;
}

.ss-interpretive-review-column {
    min-width: 0;
}

.ss-interpretive-review-queue,
.ss-interpretive-review-detail {
    border: 1px solid var(--ss-border);
    border-radius: 8px;
    background: var(--ss-bg-primary);
    overflow: hidden;
}

.ss-interpretive-review-queue-header,
.ss-interpretive-review-detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--ss-border);
    background: color-mix(in srgb, var(--ss-bg-primary) 86%, black 14%);
}

.ss-interpretive-review-queue-list {
    display: grid;
    gap: 0;
    max-height: 640px;
    overflow: auto;
}

.ss-interpretive-review-queue-empty,
.ss-interpretive-review-detail-empty {
    padding: 14px 12px;
}

.ss-interpretive-review-item {
    display: grid;
    gap: 6px;
    width: 100%;
    padding: 12px;
    border: 0;
    border-bottom: 1px solid var(--ss-border);
    background: transparent;
    color: var(--ss-text-primary);
    text-align: left;
    cursor: pointer;
}

.ss-interpretive-review-item:hover,
.ss-interpretive-review-item:focus-visible {
    background: color-mix(in srgb, var(--ss-primary) 10%, transparent);
    outline: none;
}

.ss-interpretive-review-item.active {
    background: color-mix(in srgb, var(--ss-primary) 16%, transparent);
}

.ss-interpretive-review-item-title,
.ss-interpretive-review-detail-title {
    font-weight: 600;
}

.ss-interpretive-review-item-meta,
.ss-interpretive-review-inline-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.ss-interpretive-review-detail-body {
    padding: 12px;
    display: grid;
    gap: 12px;
    max-height: 640px;
    overflow: auto;
}

.ss-interpretive-review-section {
    display: grid;
    gap: 8px;
}

.ss-interpretive-review-section h4 {
    margin: 0;
    font-size: 14px;
}

.ss-interpretive-review-statement {
    white-space: pre-wrap;
    line-height: 1.45;
}

.ss-interpretive-review-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
}

.ss-interpretive-review-card {
    border: 1px solid var(--ss-border);
    border-radius: 6px;
    padding: 10px;
    background: color-mix(in srgb, var(--ss-bg-primary) 92%, white 8%);
}

.ss-interpretive-review-card strong,
.ss-interpretive-review-list strong {
    display: block;
    margin-bottom: 4px;
}

.ss-interpretive-review-list {
    display: grid;
    gap: 8px;
}

.ss-interpretive-review-pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--monoFontFamily, monospace);
    font-size: 12px;
    line-height: 1.4;
}

.ss-interpretive-review-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--ss-border);
    font-size: 11px;
    line-height: 1.3;
    background: color-mix(in srgb, var(--ss-bg-primary) 90%, white 10%);
}

.ss-interpretive-review-badge.state-pending,
.ss-interpretive-review-badge.state-high,
.ss-interpretive-review-badge.state-blocked,
.ss-interpretive-review-badge.state-contested {
    border-color: rgba(255, 170, 0, 0.55);
    color: #ffbf47;
}

.ss-interpretive-review-badge.state-approved,
.ss-interpretive-review-badge.state-complete,
.ss-interpretive-review-badge.state-active {
    border-color: rgba(60, 190, 90, 0.55);
    color: #7fe08a;
}

.ss-interpretive-review-badge.state-rejected,
.ss-interpretive-review-badge.state-failed,
.ss-interpretive-review-badge.state-revoked {
    border-color: rgba(230, 80, 80, 0.55);
    color: #ff8b8b;
}

@media (max-width: 960px) {
    .ss-interpretive-review-layout {
        grid-template-columns: 1fr;
    }

    .ss-interpretive-review-queue-list,
    .ss-interpretive-review-detail-body {
        max-height: 420px;
    }
}
`;
