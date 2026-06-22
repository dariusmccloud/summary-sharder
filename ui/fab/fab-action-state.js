import { escapeHtml } from '../common/ui-utils.js';

export function getFabActionVisibility(sharderMode, ragEnabled, isGenerating) {
    return {
        summarize: !sharderMode,
        singlePass: sharderMode,
        stop: isGenerating,
        vectorize: ragEnabled,
        purgeVectors: ragEnabled,
        browseVectors: ragEnabled,
        ragDebug: ragEnabled,
    };
}

export function renderFabActionButton(action, icon, label, extraClass = '', disabled = false) {
    const classes = ['ss-fab-action', 'menu_button', extraClass].filter(Boolean).join(' ');
    const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
    return `
        <button type="button" class="${classes}" data-action="${escapeHtml(action)}"${disabledAttr}>
            <i class="fa-solid ${escapeHtml(icon)}"></i>
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}
