import { chat, refreshSwipeButtons, saveChatConditional } from '../../../../../../script.js';

import { log } from '../logger.js';
import {
    ARCHIVE_PROMPT_VISIBILITY_HIDDEN,
    archiveMessage,
    collectArchivedMessageIndices,
    isArchivedMessage,
    restoreArchivedMessage,
} from './archive-policy.js';
import { applyCollapseToHiddenMessages, expandUnhiddenMessages } from './visibility-manager.js';
import { clearPendingVisibilityTimers, setApplyingVisibility } from './visibility-state.js';

function removeFoldArtifacts(el) {
    el.classList.remove('ss-collapsed', 'ss-expanded');
    el.querySelector('.mes_text')?.classList.remove('ss-text-hidden');
    el.querySelector('.ss-fold-btn')?.remove();
}

function ensureArchiveBtn(el, archived) {
    const nameText = el.querySelector('.mes_block .name_text');
    const nameContainer = nameText?.parentElement;
    if (!nameContainer) return;

    let btn = el.querySelector('.ss-archive-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.className = 'ss-archive-btn';
        btn.type = 'button';
        nameContainer.insertBefore(btn, nameText);
    }

    btn.dataset.archived = archived ? 'true' : 'false';
    btn.title = archived ? 'Restore archived message' : 'Archive message';
    btn.setAttribute('aria-label', btn.title);
}

function shouldHideArchivedRow(message, settings = {}) {
    return isArchivedMessage(message) && !settings.showArchivedMessages;
}

export function refreshArchiveDecorations(settings = {}) {
    const messageElements = document.querySelectorAll('#chat .mes');
    if (!messageElements.length) return;

    for (const el of messageElements) {
        const mesid = Number.parseInt(el.getAttribute('mesid'), 10);
        if (!Number.isInteger(mesid) || mesid < 0 || mesid >= chat.length) {
            continue;
        }

        const message = chat[mesid];
        const archived = isArchivedMessage(message);
        if (archived) {
            el.classList.add('ss-archived-message');
            if (shouldHideArchivedRow(message, settings)) {
                el.classList.add('ss-archived-hidden');
                el.classList.remove('ss-archived-visible');
            } else {
                el.classList.add('ss-archived-visible');
                el.classList.remove('ss-archived-hidden');
            }
            removeFoldArtifacts(el);
        } else {
            el.classList.remove('ss-archived-message', 'ss-archived-hidden', 'ss-archived-visible');
        }

        ensureArchiveBtn(el, archived);
    }
}

async function mutateMessages(indices, mutator, settings = {}) {
    clearPendingVisibilityTimers();
    setApplyingVisibility(true);

    try {
        let changed = false;
        for (const index of indices) {
            if (!Number.isInteger(index) || index < 0 || index >= chat.length) {
                continue;
            }
            const message = chat[index];
            if (mutator(message, index)) {
                changed = true;
            }
        }

        if (!changed) {
            refreshArchiveDecorations(settings);
            return { changed: false };
        }

        await saveChatConditional();
        refreshArchiveDecorations(settings);
        applyCollapseToHiddenMessages(settings);
        expandUnhiddenMessages();
        refreshSwipeButtons();
        return { changed: true };
    } finally {
        setApplyingVisibility(false);
    }
}

function collectIndicesFromRanges(ranges = []) {
    const indices = new Set();
    for (const range of ranges) {
        const start = Number.parseInt(range?.start, 10);
        const end = Number.parseInt(range?.end, 10);
        if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
            continue;
        }
        for (let index = start; index <= end && index < chat.length; index++) {
            indices.add(index);
        }
    }
    return [...indices].sort((a, b) => a - b);
}

export function getArchivedMessageCount(messages = chat) {
    return collectArchivedMessageIndices(messages || []).length;
}

export async function archiveMessagesByIndices(indices, settings = {}) {
    const now = Date.now();
    return await mutateMessages(indices, (message) => archiveMessage(message, { now }), settings);
}

export async function restoreMessagesByIndices(indices, settings = {}) {
    return await mutateMessages(indices, (message) => restoreArchivedMessage(message), settings);
}

export async function archiveMessagesInRanges(ranges, settings = {}) {
    return await archiveMessagesByIndices(collectIndicesFromRanges(ranges), settings);
}

export async function restoreAllArchivedMessages(settings = {}) {
    return await restoreMessagesByIndices(collectArchivedMessageIndices(chat), settings);
}

export async function enforceArchivedPromptExclusion(settings = {}) {
    const archivedIndices = [];
    for (let index = 0; index < chat.length; index++) {
        if (isArchivedMessage(chat[index]) && chat[index]?.is_system !== true) {
            archivedIndices.push(index);
        }
    }

    if (archivedIndices.length === 0) {
        refreshArchiveDecorations(settings);
        return { changed: false };
    }

    log.warn(`Repairing ${archivedIndices.length} archived message(s) that lost prompt exclusion.`);
    return await mutateMessages(archivedIndices, (message) => archiveMessage(message, { now: Date.now() }), settings);
}

export function initArchiveHandler(getSettings = () => ({})) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer || chatContainer.dataset.ssArchiveInit) return;
    chatContainer.dataset.ssArchiveInit = 'true';

    chatContainer.addEventListener('click', async (event) => {
        const btn = event.target.closest('.ss-archive-btn');
        if (!btn) return;

        const message = btn.closest('.mes');
        const mesid = Number.parseInt(message?.getAttribute('mesid'), 10);
        if (!Number.isInteger(mesid)) return;

        event.preventDefault();
        event.stopPropagation();

        const liveSettings = getSettings() || {};
        if (btn.dataset.archived === 'true') {
            const result = await restoreMessagesByIndices([mesid], liveSettings);
            if (result.changed && typeof toastr !== 'undefined') {
                toastr.success('Archived message restored');
            }
            return;
        }

        const result = await archiveMessagesByIndices([mesid], liveSettings);
        if (result.changed && typeof toastr !== 'undefined') {
            const priorVisibility = chat[mesid]?.extra?.summary_sharder?.archive?.promptVisibilityBeforeArchive;
            const suffix = priorVisibility === ARCHIVE_PROMPT_VISIBILITY_HIDDEN ? ' (was already prompt-hidden)' : '';
            toastr.success(`Message archived${suffix}`);
        }
    });
}
