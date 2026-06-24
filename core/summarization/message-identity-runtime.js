import {
    chat_metadata,
    saveChatConditional,
    saveMetadata,
} from '../../../../../../script.js';

import { log } from '../logger.js';
import {
    buildMessageIdentitySnapshot,
    reconcileMessageDeletionTombstones,
    reconcileMessageIdentityState,
} from './message-identity-core.js';

let reconcileInFlight = false;
let cachedSnapshot = { chatId: '', entries: [] };

function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

function getLiveContext(context = null) {
    return context || globalThis.SillyTavern?.getContext?.() || null;
}

function setCachedSnapshot(context) {
    const live = getLiveContext(context);
    cachedSnapshot = buildMessageIdentitySnapshot(live?.chat || [], {
        chatId: normalizeChatId(live?.chatId),
    });
    return cachedSnapshot;
}

function sameChatAsSnapshot(context) {
    const live = getLiveContext(context);
    return normalizeChatId(live?.chatId) === normalizeChatId(cachedSnapshot?.chatId);
}

export function cacheCurrentMessageIdentityState(context = null) {
    return setCachedSnapshot(context);
}

export function clearCurrentMessageIdentityState() {
    cachedSnapshot = { chatId: '', entries: [] };
}

export async function reconcileCurrentChatMessageIdentity(options = {}) {
    if (reconcileInFlight) {
        return { skipped: true, reason: 'reconcile-in-flight' };
    }

    const context = getLiveContext(options.context);
    const chat = Array.isArray(context?.chat) ? context.chat : null;
    if (!chat) {
        clearCurrentMessageIdentityState();
        return { skipped: true, reason: 'no-chat' };
    }

    reconcileInFlight = true;
    try {
        let tombstoneResult = { changed: false, added: 0 };
        if (options.recordDeletion && sameChatAsSnapshot(context)) {
            tombstoneResult = reconcileMessageDeletionTombstones(
                cachedSnapshot,
                chat,
                chat_metadata,
                { now: options.now },
            );
        }

        const reconcileResult = await reconcileMessageIdentityState(chat, {
            chatMetadata: chat_metadata,
            context,
            now: options.now,
        });

        const needsMessageSave = reconcileResult.messagesChanged;
        const needsMetadataSave = reconcileResult.metadataChanged || tombstoneResult.changed;

        if (needsMessageSave) {
            await saveChatConditional();
        } else if (needsMetadataSave) {
            await saveMetadata();
        }

        const snapshot = setCachedSnapshot(context);
        return {
            ...reconcileResult,
            tombstonesAdded: tombstoneResult.added,
            cachedSnapshot: snapshot,
        };
    } catch (error) {
        log.warn('Message identity reconciliation failed:', error?.message || error);
        throw error;
    } finally {
        reconcileInFlight = false;
    }
}
