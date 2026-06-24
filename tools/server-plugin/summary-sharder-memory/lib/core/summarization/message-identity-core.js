import {
    CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
    EVIDENCE_POLICY_INCLUDE,
    IDENTITY_STATUS_VALUES,
    MESSAGE_IDENTITY_SCHEMA_VERSION,
} from './message-identity-schema.js';

export const MESSAGE_IDENTITY_HASH_ALGORITHM = 'SHA-256';
export const MESSAGE_INIT_FINGERPRINT_VERSION = 1;
export const MESSAGE_REVISION_HASH_VERSION = 1;
export const MESSAGE_CORPUS_REVISION_HASH_VERSION = 1;
export const MESSAGE_TOMBSTONE_SCHEMA_VERSION = 1;
export const MESSAGE_ID_PREFIX = 'msg_';

function getCryptoApi(cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle) {
        throw new Error('Web Crypto API is unavailable for message identity hashing.');
    }
    return cryptoApi;
}

function stableStringify(value) {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

function deepEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
}

function normalizeText(value) {
    return String(value || '').replace(/\r\n?/gu, '\n');
}

function normalizeTimestamp(value) {
    return String(value || '').trim();
}

function trimString(value) {
    return String(value || '').trim();
}

function parseForcedAvatarFile(forceAvatar) {
    const raw = trimString(forceAvatar);
    if (!raw) return '';
    const match = raw.match(/[?&]file=([^&]+)/u);
    if (!match) return '';
    try {
        return decodeURIComponent(match[1] || '').trim();
    } catch {
        return String(match[1] || '').trim();
    }
}

function ensureSummarySharderRoot(record) {
    if (!record.extra || typeof record.extra !== 'object') {
        record.extra = {};
    }
    if (!record.extra.summary_sharder || typeof record.extra.summary_sharder !== 'object') {
        record.extra.summary_sharder = {};
    }
    return record.extra.summary_sharder;
}

function ensureSummarySharderChatRoot(chatMetadata) {
    if (!chatMetadata.summary_sharder || typeof chatMetadata.summary_sharder !== 'object') {
        chatMetadata.summary_sharder = {};
    }
    return chatMetadata.summary_sharder;
}

function sanitizeMessageId(value) {
    const raw = trimString(value).toLowerCase();
    return /^msg_[0-9a-f]{32}$/u.test(raw) ? raw : '';
}

function getSelectedSwipeIndex(message) {
    const value = Number(message?.swipe_id);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function getSelectedSwipeText(message) {
    const index = getSelectedSwipeIndex(message);
    const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
    if (index !== null && typeof swipes[index] === 'string') {
        return swipes[index];
    }
    return typeof message?.mes === 'string' ? message.mes : '';
}

function getSelectedSwipeTimestamp(message) {
    const index = getSelectedSwipeIndex(message);
    const swipeInfo = Array.isArray(message?.swipe_info) ? message.swipe_info : [];
    const selected = index !== null ? swipeInfo[index] : null;
    return normalizeTimestamp(selected?.send_date || message?.send_date || '');
}

async function sha256Hex(text, cryptoApi = globalThis.crypto) {
    const api = getCryptoApi(cryptoApi);
    const buffer = new TextEncoder().encode(String(text || ''));
    const digest = await api.subtle.digest(MESSAGE_IDENTITY_HASH_ALGORITHM, buffer);
    const hex = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    return `sha256:${hex}`;
}

async function hashSemanticPayload(payload, cryptoApi = globalThis.crypto) {
    return await sha256Hex(stableStringify(payload), cryptoApi);
}

export function resolveMessageSpeakerIdentity(message, options = {}) {
    const context = options.context || {};
    const rawCharacterId = Number(context?.characterId);
    const messageName = trimString(message?.name);
    const originalAvatar = trimString(message?.original_avatar);
    const forcedAvatar = parseForcedAvatarFile(message?.force_avatar);
    const activeCharacter = Number.isInteger(rawCharacterId)
        ? context?.characters?.[rawCharacterId]
        : null;
    const activeCharacterAvatar = trimString(activeCharacter?.avatar);
    const activeCharacterName = trimString(activeCharacter?.name);
    const userName = trimString(context?.name1 || messageName || 'User');

    if (message?.is_user === true) {
        return {
            speakerEntityId: `user:${userName || 'user'}`,
            speakerPathAtInit: userName || 'User',
            displayNameAtInit: messageName || userName || 'User',
            sourceType: 'user',
        };
    }

    if (message?.is_system === true) {
        const systemName = messageName || 'System';
        return {
            speakerEntityId: `system:${systemName.toLowerCase()}`,
            speakerPathAtInit: systemName,
            displayNameAtInit: systemName,
            sourceType: 'system',
        };
    }

    const avatarIdentity = originalAvatar || forcedAvatar || activeCharacterAvatar;
    if (avatarIdentity) {
        return {
            speakerEntityId: `character:${avatarIdentity}`,
            speakerPathAtInit: avatarIdentity,
            displayNameAtInit: messageName || activeCharacterName || avatarIdentity,
            sourceType: 'character',
        };
    }

    const fallbackName = messageName || 'Unknown Speaker';
    return {
        speakerEntityId: `speaker:${fallbackName.toLowerCase()}`,
        speakerPathAtInit: fallbackName,
        displayNameAtInit: fallbackName,
        sourceType: 'unknown',
    };
}

export async function buildMessageInitFingerprint(message, options = {}) {
    const speakerIdentity = options.speakerIdentity || resolveMessageSpeakerIdentity(message, options);
    const payload = {
        version: `initFingerprintV${MESSAGE_INIT_FINGERPRINT_VERSION}`,
        timestamp: normalizeTimestamp(message?.send_date),
        speakerEntityId: trimString(speakerIdentity.speakerEntityId),
        sourceType: trimString(speakerIdentity.sourceType),
        text: normalizeText(message?.mes),
    };
    return await hashSemanticPayload(payload, options.cryptoApi);
}

export async function buildMessageRevisionHash(message, options = {}) {
    const speakerIdentity = options.speakerIdentity || resolveMessageSpeakerIdentity(message, options);
    const payload = {
        version: `revisionHashV${MESSAGE_REVISION_HASH_VERSION}`,
        speakerEntityId: trimString(speakerIdentity.speakerEntityId),
        sourceType: trimString(speakerIdentity.sourceType),
        displayName: trimString(message?.name),
        text: normalizeText(message?.mes),
        selectedSwipeIndex: getSelectedSwipeIndex(message),
        selectedSwipeTimestamp: getSelectedSwipeTimestamp(message),
        selectedSwipeText: normalizeText(getSelectedSwipeText(message)),
        swipeCount: Array.isArray(message?.swipes) ? message.swipes.length : 0,
    };
    return await hashSemanticPayload(payload, options.cryptoApi);
}

export async function buildCorpusRevisionHash(messages, options = {}) {
    const pairs = [];
    for (const message of messages || []) {
        const ss = message?.extra?.summary_sharder;
        const identity = ss?.messageIdentity;
        const messageId = sanitizeMessageId(identity?.messageId);
        const revisionHash = trimString(identity?.revisionHash);
        if (messageId && revisionHash) {
            pairs.push(`${messageId}|${revisionHash}`);
        }
    }

    return await hashSemanticPayload({
        version: `sourceCoverageHashV${MESSAGE_CORPUS_REVISION_HASH_VERSION}`,
        pairs,
    }, options.cryptoApi);
}

function buildChatIdentityStatus(status, identifiedCount, unidentifiedCount, corpusRevisionHash, now, previous = null) {
    const sameSemanticStatus = previous
        && previous.schemaVersion === CHAT_IDENTITY_STATUS_SCHEMA_VERSION
        && previous.status === status
        && previous.identifiedCount === identifiedCount
        && previous.unidentifiedCount === unidentifiedCount
        && previous.corpusRevisionHash === corpusRevisionHash;

    return {
        schemaVersion: CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
        status,
        identifiedCount,
        unidentifiedCount,
        lastReconciledAt: sameSemanticStatus
            ? previous.lastReconciledAt
            : (Number.isFinite(now) ? now : Date.now()),
        corpusRevisionHash,
    };
}

function makeRandomMessageId(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === 'function') {
        return `${MESSAGE_ID_PREFIX}${cryptoApi.randomUUID().replace(/-/gu, '').toLowerCase()}`;
    }
    throw new Error('Web Crypto randomUUID is unavailable for message identity generation.');
}

function pushDiagnostic(diagnostics, diagnostic) {
    diagnostics.push({
        level: diagnostic.level || 'warning',
        ...diagnostic,
    });
}

export function buildMessageIdentitySnapshot(messages, options = {}) {
    return {
        chatId: trimString(options.chatId),
        entries: Array.isArray(messages)
            ? messages.map((message, index) => {
                const identity = message?.extra?.summary_sharder?.messageIdentity || {};
                return {
                    index,
                    name: trimString(message?.name),
                    sendDate: normalizeTimestamp(message?.send_date),
                    messageId: sanitizeMessageId(identity?.messageId),
                    initFingerprint: trimString(identity?.initFingerprint),
                    revisionHash: trimString(identity?.revisionHash),
                };
            })
            : [],
    };
}

export function reconcileMessageDeletionTombstones(previousSnapshot, currentMessages, chatMetadata, options = {}) {
    const ss = ensureSummarySharderChatRoot(chatMetadata);
    if (!Array.isArray(ss.messageTombstones)) {
        ss.messageTombstones = [];
    }

    const nowIso = new Date(Number.isFinite(options.now) ? options.now : Date.now()).toISOString();
    const currentIds = new Set(
        (currentMessages || [])
            .map((message) => sanitizeMessageId(message?.extra?.summary_sharder?.messageIdentity?.messageId))
            .filter(Boolean)
    );
    const existingTombstones = new Set(
        ss.messageTombstones
            .map((entry) => sanitizeMessageId(entry?.messageId))
            .filter(Boolean)
    );

    let changed = false;
    let added = 0;

    for (const entry of previousSnapshot?.entries || []) {
        const messageId = sanitizeMessageId(entry?.messageId);
        if (!messageId || currentIds.has(messageId) || existingTombstones.has(messageId)) {
            continue;
        }

        ss.messageTombstones.push({
            schemaVersion: MESSAGE_TOMBSTONE_SCHEMA_VERSION,
            messageId,
            deletedAt: nowIso,
            lastRevisionHash: trimString(entry?.revisionHash),
            deletionMode: 'source_content_deleted',
        });
        existingTombstones.add(messageId);
        changed = true;
        added += 1;
    }

    return { changed, added };
}

export async function reconcileMessageIdentityState(messages, options = {}) {
    const chatMetadata = options.chatMetadata || {};
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const cryptoApi = options.cryptoApi || globalThis.crypto;
    const context = options.context || {};
    const diagnostics = [];
    const seenMessageIds = new Map();
    const seenFingerprints = new Map();
    const ssChat = ensureSummarySharderChatRoot(chatMetadata);

    let messagesChanged = false;
    let metadataChanged = false;

    for (let index = 0; index < (messages || []).length; index++) {
        const message = messages[index];
        if (!message || typeof message !== 'object') {
            continue;
        }

        const ss = ensureSummarySharderRoot(message);
        const speakerIdentity = resolveMessageSpeakerIdentity(message, { context });
        if (!deepEqual(ss.speakerIdentity, speakerIdentity)) {
            ss.speakerIdentity = speakerIdentity;
            messagesChanged = true;
        }

        if (ss.evidencePolicy !== EVIDENCE_POLICY_INCLUDE) {
            ss.evidencePolicy = EVIDENCE_POLICY_INCLUDE;
            messagesChanged = true;
        }

        const identity = (ss.messageIdentity && typeof ss.messageIdentity === 'object')
            ? { ...ss.messageIdentity }
            : {};

        identity.schemaVersion = MESSAGE_IDENTITY_SCHEMA_VERSION;

        const existingMessageId = sanitizeMessageId(identity.messageId);
        if (!existingMessageId) {
            identity.messageId = makeRandomMessageId(cryptoApi);
        } else {
            identity.messageId = existingMessageId;
        }

        if (!trimString(identity.initFingerprint)) {
            identity.initFingerprint = await buildMessageInitFingerprint(message, {
                context,
                cryptoApi,
                speakerIdentity,
            });
        }

        identity.revisionHash = await buildMessageRevisionHash(message, {
            context,
            cryptoApi,
            speakerIdentity,
        });

        if (!deepEqual(ss.messageIdentity, identity)) {
            ss.messageIdentity = identity;
            messagesChanged = true;
        }

        const messageId = identity.messageId;
        const fingerprint = trimString(identity.initFingerprint);

        if (seenMessageIds.has(messageId)) {
            pushDiagnostic(diagnostics, {
                code: 'MESSAGE_IDENTITY_DUPLICATE_ID',
                message: `Message identity ${messageId} is duplicated within the same chat.`,
                index,
                previousIndex: seenMessageIds.get(messageId),
            });
        } else {
            seenMessageIds.set(messageId, index);
        }

        if (fingerprint) {
            const prior = seenFingerprints.get(fingerprint);
            if (prior !== undefined && prior !== index) {
                pushDiagnostic(diagnostics, {
                    code: 'MESSAGE_BOOTSTRAP_COLLISION',
                    message: `Initialization fingerprint collision detected between messages ${prior} and ${index}.`,
                    index,
                    previousIndex: prior,
                });
            } else if (prior === undefined) {
                seenFingerprints.set(fingerprint, index);
            }
        }
    }

    const identifiedCount = (messages || []).filter((message) => {
        const identity = message?.extra?.summary_sharder?.messageIdentity;
        return !!sanitizeMessageId(identity?.messageId) && !!trimString(identity?.initFingerprint) && !!trimString(identity?.revisionHash);
    }).length;
    const unidentifiedCount = Math.max(0, (messages?.length || 0) - identifiedCount);
    const status = diagnostics.some((item) => item.code === 'MESSAGE_IDENTITY_DUPLICATE_ID' || item.code === 'MESSAGE_BOOTSTRAP_COLLISION')
        ? IDENTITY_STATUS_VALUES.AMBIGUOUS
        : (unidentifiedCount > 0 ? IDENTITY_STATUS_VALUES.PARTIAL : IDENTITY_STATUS_VALUES.COMPLETE);

    const corpusRevisionHash = await buildCorpusRevisionHash(messages, { cryptoApi });
    const nextStatus = buildChatIdentityStatus(
        status,
        identifiedCount,
        unidentifiedCount,
        corpusRevisionHash,
        now,
        ssChat.messageIdentity,
    );

    if (!deepEqual(ssChat.messageIdentity, nextStatus)) {
        ssChat.messageIdentity = nextStatus;
        metadataChanged = true;
    }

    return {
        changed: messagesChanged || metadataChanged,
        messagesChanged,
        metadataChanged,
        diagnostics,
        identifiedCount,
        unidentifiedCount,
        status,
        corpusRevisionHash,
    };
}
