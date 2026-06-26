import { VARIABLES_CSS } from './styles/variables.css.js';
import { SETTINGS_PANEL_CSS } from './styles/settings-panel.css.js';
import { MODAL_BASE_CSS } from './styles/modal-base.css.js';
import { DROPDOWNS_CSS } from './styles/dropdowns.css.js';
import { COMPONENTS_CSS } from './styles/components.css.js';
import { MESSAGES_CSS } from './styles/messages.css.js';
import { CHAT_MANAGER_CSS } from './styles/chat-manager.css.js';
import { SUMMARIZE_CSS } from './styles/summarize.css.js';
import { SHARDER_CSS } from './styles/sharder.css.js';
import { BATCH_CSS } from './styles/batch.css.js';
import { PROMPTS_CSS } from './styles/prompts.css.js';
import { LOREBOOK_CSS } from './styles/lorebook.css.js';
import { API_STATUS_CSS } from './styles/api-status.css.js';
import { SCROLLBARS_CSS } from './styles/scrollbars.css.js';
import { RESPONSIVE_CSS } from './styles/responsive.css.js';
import { VISIBILITY_CSS } from './styles/visibility.css.js';
import { THEMES_CSS } from './styles/themes.css.js';
import { FAB_CSS } from './styles/fab.css.js';
import { FAB_PANELS_CSS } from './styles/fab-panels.css.js';
import { RAG_CSS } from './styles/rag.css.js';
import { RAG_DEBUG_CSS } from './styles/rag-debug.css.js';
import { INTERPRETIVE_REVIEW_CSS } from './styles/interpretive-review.css.js';
import { TEXTAREA_RESIZE_CSS } from './styles/textarea-resize.css.js';

/**
 * Summary Sharder Styles
 * Assembled from modular ui/styles/*.css.js exports.
 */

/**
 * Inject styles into document
 */
export function injectStyles() {
    const styleId = 'summary-sharder-styles';
    const existing = document.getElementById(styleId);
    if (existing) {
        existing.textContent = EXTENSION_STYLES;
        return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = EXTENSION_STYLES;
    document.head.appendChild(style);
}

export const EXTENSION_STYLES = [
    VARIABLES_CSS,
    SETTINGS_PANEL_CSS,
    MODAL_BASE_CSS,
    DROPDOWNS_CSS,
    COMPONENTS_CSS,
    MESSAGES_CSS,
    CHAT_MANAGER_CSS,
    SUMMARIZE_CSS,
    SHARDER_CSS,
    BATCH_CSS,
    PROMPTS_CSS,
    LOREBOOK_CSS,
    API_STATUS_CSS,
    SCROLLBARS_CSS,
    RESPONSIVE_CSS,
    VISIBILITY_CSS,
    THEMES_CSS,
    FAB_CSS,
    FAB_PANELS_CSS,
    RAG_CSS,
    RAG_DEBUG_CSS,
    INTERPRETIVE_REVIEW_CSS,
    TEXTAREA_RESIZE_CSS,
].join('\n\n');
