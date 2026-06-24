/**
 * Message visibility management for Summary Sharder
 */

import { getChatRanges, saveChatRanges } from '../settings.js';
import { chat, saveChatConditional, refreshSwipeButtons } from '../../../../../../script.js';
import { log } from '../logger.js';
import { isArchivedMessage } from './archive-policy.js';
import {
    buildDesiredVisibilityState,
    detectHiddenRangesFromMessages,
    parseIgnoreNames,
    shouldIgnoreMessage,
} from './visibility-policy.js';

// Import flag setter and timer control to prevent MutationObserver cascade
import { setApplyingVisibility, clearPendingVisibilityTimers } from './visibility-state.js';

/** Inject the fold button into the name row before .name_text (idempotent). */
function ensureFoldBtn(el) {
    if (el.querySelector('.ss-fold-btn')) return;
    const nameText = el.querySelector('.mes_block .name_text');
    const nameContainer = nameText?.parentElement;
    if (!nameContainer) return;
    const btn = document.createElement('button');
    btn.className = 'ss-fold-btn';
    btn.type = 'button';
    nameContainer.insertBefore(btn, nameText);
}

/** Remove the fold button from a .mes element (idempotent). */
function removeFoldBtn(el) {
    el.querySelector('.ss-fold-btn')?.remove();
}

/**
 * Initialize delegated click handler for collapse toggle.
 * Matches real .ss-fold-btn elements — no layout reads needed.
 */
export function initCollapseHandler() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || chatContainer.dataset.ssCollapseInit) return;
    chatContainer.dataset.ssCollapseInit = 'true';

    chatContainer.addEventListener('click', (event) => {
        const btn = event.target.closest('.ss-fold-btn');
        if (!btn) return;

        const message = btn.closest('.mes');
        if (!message) return;

        event.stopPropagation();
        const messageText = message.querySelector('.mes_text');
        if (!messageText) return;

        if (message.classList.contains('ss-collapsed')) {
            message.classList.replace('ss-collapsed', 'ss-expanded');
            messageText.classList.remove('ss-text-hidden');
        } else {
            message.classList.replace('ss-expanded', 'ss-collapsed');
            messageText.classList.add('ss-text-hidden');
        }
    });
}

/**
 * Initialize delegated click handlers to temporarily unfold collapsed messages during edit.
 * This never changes is_system/hidden state; it only toggles collapse classes.
 */
export function initEditUnfoldHandler() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || chatContainer.dataset.ssEditUnfoldInit) return;
    chatContainer.dataset.ssEditUnfoldInit = 'true';

    chatContainer.addEventListener('click', (event) => {
        const editBtn = event.target.closest('.mes_edit');
        if (editBtn) {
            const message = editBtn.closest('.mes');
            if (!message || !message.classList.contains('ss-collapsed')) return;

            message.classList.replace('ss-collapsed', 'ss-expanded');
            const messageText = message.querySelector('.mes_text');
            if (messageText) messageText.classList.remove('ss-text-hidden');
            message.dataset.ssEditUnfolded = 'true';
            return;
        }

        const doneOrCancelBtn = event.target.closest('.mes_edit_done, .mes_edit_cancel');
        if (!doneOrCancelBtn) return;

        const message = doneOrCancelBtn.closest('.mes');
        if (!message || message.dataset.ssEditUnfolded !== 'true') return;

        message.classList.replace('ss-expanded', 'ss-collapsed');
        const messageText = message.querySelector('.mes_text');
        if (messageText) messageText.classList.add('ss-text-hidden');
        message.removeAttribute('data-ss-edit-unfolded');
    });
}

/**
 * Apply visibility settings to all summarized message ranges
 * Handles both global toggles, individual range states, and name filtering.
 * Uses a 2-phase approach (compute desired state, then apply) to avoid layout thrashing.
 */
export async function applyVisibilitySettings(settings) {
    clearPendingVisibilityTimers();
    setApplyingVisibility(true);

    try {
        const ranges = getChatRanges();
        const messageElements = document.querySelectorAll('#chat .mes');
        if (!messageElements.length) return;

        // Build element map using EXISTING mesid attributes (set by SillyTavern)
        // DO NOT re-index mesids - SillyTavern may use lazy loading so not all messages are in DOM
        const elementMap = new Map();
        messageElements.forEach(el => {
            const mesid = el.getAttribute('mesid');
            if (mesid !== null) elementMap.set(parseInt(mesid, 10), el);
        });

        // --- PHASE 1: Compute desired state (no DOM access) ---
        const desiredState = buildDesiredVisibilityState(chat, ranges, settings);
        for (const range of ranges) {
            if (range.start < 0 || range.end < range.start || range.start >= chat.length) {
                log.warn(`Skipping invalid range ${range.start}-${range.end} (chat length: ${chat.length})`);
            }
        }

        // --- PHASE 2: Apply all changes in a single DOM pass ---
        // Update chat data model
        for (let i = 0; i < desiredState.length; i++) {
            const state = desiredState[i];
            if (chat[i]) chat[i].is_system = state.isSystem;
        }

        // Update DOM elements
        for (const [mesid, el] of elementMap) {
            const state = desiredState[mesid];
            if (!state) continue;

            // Reset classes
            el.classList.remove('ss-hidden', 'ss-summarized');

            // Set is_system attribute
            el.setAttribute('is_system', String(state.isSystem));

            // Handle collapse state
            const messageText = el.querySelector('.mes_text');

            if (state.collapsed) {
                el.classList.add('ss-collapsed');
                if (messageText) messageText.classList.add('ss-text-hidden');
                ensureFoldBtn(el);
            } else {
                el.classList.remove('ss-collapsed', 'ss-expanded');
                if (messageText) messageText.classList.remove('ss-text-hidden');
                removeFoldBtn(el);
            }
        }

        refreshSwipeButtons();
        await saveChatConditional();
    } finally {
        setApplyingVisibility(false);
    }
}

/**
 * Apply collapse styling to all currently hidden messages
 * Used after external visibility changes (e.g., /hide command) to sync collapse state
 * @param {Object} settings - Extension settings
 */
export function applyCollapseToHiddenMessages(settings) {
    if (!settings.collapseAll && !settings.makeAllInvisible) {
        return;
    }

    const messageElements = document.querySelectorAll('#chat .mes');
    if (!messageElements.length) return;

    const ignoreNames = parseIgnoreNames(settings.globalIgnoreNames || '');

    for (const el of messageElements) {
        const mesid = el.getAttribute('mesid');
        if (mesid === null) continue;

        const index = parseInt(mesid, 10);
        const message = chat[index];
        if (!message || message.is_system !== true) continue;
        if (isArchivedMessage(message)) {
            el.classList.remove('ss-collapsed', 'ss-expanded');
            el.querySelector('.mes_text')?.classList.remove('ss-text-hidden');
            removeFoldBtn(el);
            continue;
        }
        if (shouldIgnoreMessage(message, ignoreNames)) continue;

        el.classList.add('ss-collapsed');
        const messageText = el.querySelector('.mes_text');
        if (messageText) messageText.classList.add('ss-text-hidden');
        ensureFoldBtn(el);
    }
}

/**
 * Expand all messages that are no longer hidden
 * Used after external visibility changes (e.g., /unhide command) to remove collapse styling
 */
export function expandUnhiddenMessages() {
    const messageElements = document.querySelectorAll('#chat .mes');
    if (!messageElements.length) return;

    for (const el of messageElements) {
        const mesid = el.getAttribute('mesid');
        if (mesid === null) continue;

        const index = parseInt(mesid, 10);
        const message = chat[index];

        if (isArchivedMessage(message)) {
            el.classList.remove('ss-collapsed', 'ss-expanded');
            el.querySelector('.mes_text')?.classList.remove('ss-text-hidden');
            removeFoldBtn(el);
            continue;
        }

        // If message is not hidden but has collapse/expand styling or fold button, clean it up
        if (message && message.is_system !== true &&
            (el.classList.contains('ss-collapsed') || el.classList.contains('ss-expanded') || el.querySelector('.ss-fold-btn'))) {
            el.classList.remove('ss-collapsed', 'ss-expanded');
            const messageText = el.querySelector('.mes_text');
            if (messageText) messageText.classList.remove('ss-text-hidden');
            removeFoldBtn(el);
        }
    }
}

/**
 * Legacy function for backward compatibility
 * Maps old hideSummarized setting to new hideAllSummarized
 */
export async function applyHideSummarized(settings) {
    if (settings.hideSummarized !== undefined && settings.hideAllSummarized === undefined) {
        settings.hideAllSummarized = settings.hideSummarized;
    }

    return applyVisibilitySettings(settings);
}

/**
 * Detect hidden ranges from current chat messages
 * Scans for consecutive messages where is_system === true
 * @returns {Array} Array of range objects representing hidden message ranges
 */
export function detectHiddenRanges() {
    return detectHiddenRangesFromMessages(chat || []);
}

/**
 * Detect and merge hidden ranges from external sources (e.g., /hide command)
 * @returns {boolean} True if new ranges were added
 */
export function mergeDetectedHiddenRanges() {
    const detected = detectHiddenRanges();
    if (detected.length === 0) {
        return false;
    }

    let chatRanges = getChatRanges();
    let addedCount = 0;

    for (const newRange of detected) {
        const isDuplicate = chatRanges.some(existing =>
            existing.start === newRange.start && existing.end === newRange.end
        );
        if (!isDuplicate) {
            chatRanges.push(newRange);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        chatRanges.sort((a, b) => a.start - b.start);
        saveChatRanges(chatRanges);
        log.log(`Auto-detected ${addedCount} hidden range(s) from external source`);
        return true;
    }

    return false;
}

