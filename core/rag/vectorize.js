/**
 * Vectorization orchestration for Summary Sharder RAG.
 * Handles shard indexing, chat synchronization, and stale vector cleanup.
 */

import { extension_settings } from '../../../../../extensions.js';
import { world_names, loadWorldInfo } from '../../../../../world-info.js';

import { parseBannedKeywords, filterBannedKeywords } from '../processing/keyword-filter.js';

import {
    insertChunks,
    listChunks,
    deleteChunks,
} from './vector-client.js';
import {
    getShardCollectionId,
    getStandardCollectionId,
    getWriteTargetCollectionId,
} from './collection-manager.js';
import { resolveEffectiveBindingState } from './collection-bindings.js';
import {
    buildChunkHash,
    chunkShard,
    chunkShardBySection,
    chunkProseSummary,
} from './chunking.js';
import { throwIfAborted } from '../api/abort-controller.js';
import { ragLog } from '../logger.js';
import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
    normalizeSharderProfile,
} from '../summarization/sharder-section-registry.js';
import {
    buildArchitecturalShardMetadata,
    classifySavedShardText,
    isSavedShardCompatibleWithProfile,
} from '../summarization/saved-shard-identity.js';

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'they',
    'them', 'their', 'you', 'your', 'we', 'our', 'i', 'me', 'my', 'he', 'she',
    'his', 'her', 'not', 'so', 'if', 'then', 'than', 'too', 'very', 'can',
    'could', 'would', 'should', 'will', 'just', 'about', 'into', 'over', 'after',
]);

function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

function getCurrentVectorWriteContext(settings) {
    const ctx = SillyTavern.getContext();
    const chatId = normalizeChatId(ctx?.chatId || '');
    const charIdx = ctx?.characterId;
    const avatar = (charIdx !== undefined && charIdx !== null)
        ? String(ctx?.characters?.[charIdx]?.avatar || '').trim()
        : '';
    const isSharder = settings?.sharderMode === true;
    const ownCollectionId = chatId
        ? (isSharder ? getShardCollectionId(chatId) : getStandardCollectionId(chatId))
        : '';
    const state = resolveEffectiveBindingState(chatId, avatar, settings, ownCollectionId);
    const collectionId = getWriteTargetCollectionId(chatId, settings);
    const scope = state.effectiveWriteSource || 'own';
    const scopeLabel = scope === 'chat'
        ? 'Chat collection'
        : (scope === 'character' ? 'Character collection' : 'Own collection');

    return {
        chatId,
        avatar,
        ownCollectionId,
        collectionId,
        scope,
        scopeLabel,
        isOwnCollection: !!collectionId && collectionId === ownCollectionId,
    };
}

function annotateSummaryChunks(chunks, origin) {
    const list = Array.isArray(chunks) ? chunks : [];
    for (const chunk of list) {
        if (!chunk?.metadata) continue;
        chunk.metadata.originChatId = origin.chatId || '';
        chunk.metadata.originCharacterAvatar = origin.avatar || '';
        chunk.metadata.originWriteScope = origin.scope || 'own';
        chunk.metadata.originCollectionId = origin.collectionId || '';
        const originalHash = String(chunk.hash ?? chunk.metadata.hash ?? '');
        const scopedHash = buildChunkHash(`${originalHash}|${origin.chatId}|${origin.collectionId}`);
        chunk.hash = scopedHash;
        chunk.metadata.hash = scopedHash;
        chunk.metadata.text = chunk.text;
    }
    return list;
}

function annotateShardIdentityMetadata(chunks, settings, shardText) {
    const list = Array.isArray(chunks) ? chunks : [];
    if (list.length === 0) {
        return list;
    }

    const activeProfile = normalizeSharderProfile(settings?.sharderProfile || NARRATIVE_PROFILE);
    if (activeProfile !== ARCHITECTURAL_PROFILE) {
        return list;
    }

    const architecturalMetadata = buildArchitecturalShardMetadata(shardText);
    if (!architecturalMetadata.shardProfile) {
        return list;
    }

    for (const chunk of list) {
        if (!chunk?.metadata) continue;
        chunk.metadata.shardProfile = architecturalMetadata.shardProfile;
        chunk.metadata.schemaVersion = architecturalMetadata.schemaVersion;
        if (Array.isArray(architecturalMetadata.sectionKeys) && architecturalMetadata.sectionKeys.length > 0) {
            chunk.metadata.sectionKeys = [...architecturalMetadata.sectionKeys];
        }
        if (Array.isArray(architecturalMetadata.stableDecisionIds) && architecturalMetadata.stableDecisionIds.length > 0) {
            chunk.metadata.stableDecisionIds = [...architecturalMetadata.stableDecisionIds];
        }
    }

    return list;
}

function filterChunksForOrigin(items, origin) {
    const ownCollectionId = String(origin?.ownCollectionId || '').trim();
    const collectionId = String(origin?.collectionId || '').trim();
    const chatId = String(origin?.chatId || '').trim();
    const allowLegacyOwn = !!collectionId && collectionId === ownCollectionId;

    return (Array.isArray(items) ? items : []).filter(item => {
        const itemOriginChatId = String(item?.metadata?.originChatId || '').trim();
        if (itemOriginChatId) {
            return itemOriginChatId === chatId;
        }
        return allowLegacyOwn;
    });
}

async function listAllChunksForOrigin(collectionId, ragSettings, origin) {
    const all = await listAllChunks(collectionId, ragSettings);
    return filterChunksForOrigin(all, origin);
}

function maybeShowVectorizeToast(chunkCount, origin) {
    if (typeof toastr === 'undefined') return;
    const count = Math.max(1, Number(chunkCount) || 1);
    toastr.info(`Saving ${count} vector chunk${count !== 1 ? 's' : ''} to ${origin.scopeLabel}: ${origin.collectionId}`);
}

/**
 * Resolve effective shard chunking mode from rag settings.
 * Section mode takes precedence over standard mode.
 * @param {Object} ragSettings
 * @returns {'standard'|'section'}
 */
export function resolveShardChunkingMode(ragSettings) {
    if (ragSettings?.sectionAwareChunking === true) return 'section';
    return 'standard';
}

/**
 * List all chunks in a collection via pagination.
 * @param {string} collectionId
 * @param {Object} ragSettings
 * @returns {Promise<Array>}
 */
async function listAllChunks(collectionId, ragSettings) {
    const all = [];
    let offset = 0;
    const limit = 200;

    while (true) {
        throwIfAborted('rag vectorization');
        const { items, hasMore } = await listChunks(collectionId, ragSettings, { offset, limit });
        if (items.length === 0) break;

        all.push(...items);
        if (!hasMore) break;
        offset += items.length;
    }

    return all;
}

/**
 * Parse a saved standard-mode summary ([SUMMARY: Messages X-Y]).
 * @param {string} text
 * @returns {{startIndex: number, endIndex: number, body: string}|null}
 */
function parseStandardSummary(text) {
    const raw = String(text || '');
    const match = raw.match(/^\[SUMMARY:\s*Messages\s*(\d+)\s*[-–]\s*(\d+)\]\s*\n\n([\s\S]*)$/i);
    if (!match) return null;

    return {
        startIndex: parseInt(match[1], 10),
        endIndex: parseInt(match[2], 10),
        body: String(match[3] || '').trim(),
    };
}

/**
 * Try to parse any extension-managed summary message, regardless of mode.
 * Tries [SUMMARY:] first, then [MEMORY SHARD:] for backward compatibility.
 * @param {string} text
 * @returns {{startIndex: number, endIndex: number, body: string}|null}
 */
function parseAnySummaryMessage(text) {
    const shard = classifySavedShardText(text);
    if (shard.wrapperType === 'memory-shard' && shard.startIndex !== null && shard.endIndex !== null) {
        if (shard.profile === ARCHITECTURAL_PROFILE) {
            return null;
        }
        return {
            startIndex: shard.startIndex,
            endIndex: shard.endIndex,
            body: shard.body,
        };
    }
    return parseStandardSummary(text);
}

/**
 * Determine target lorebook names for RAG bulk vectorization.
 * @param {Object} settings
 * @returns {Array<string>}
 */
function getTargetLorebookNames(settings) {
    const ragSettings = settings?.rag || {};
    if (ragSettings.useLorebooksForVectorization !== true) {
        return [];
    }

    const names = new Set();
    const selectedNames = Array.isArray(ragSettings.vectorizationLorebookNames)
        ? ragSettings.vectorizationLorebookNames
        : [];
    for (const rawName of selectedNames) {
        const name = String(rawName || '').trim();
        if (name && world_names.includes(name)) {
            names.add(name);
        }
    }

    return [...names];
}

/**
 * Collect shard-like content from chat and selected lorebooks.
 * @param {Object} settings
 * @returns {Promise<Array<{text: string, startIndex: number, endIndex: number, keywords: string[]}>>}
 */
async function collectExistingShards(settings) {
    const results = [];
    const activeProfile = normalizeSharderProfile(settings?.sharderProfile || NARRATIVE_PROFILE);

    // System-message shards from current chat.
    const chat = SillyTavern.getContext()?.chat || [];
    for (const msg of chat) {
        const shardInfo = classifySavedShardText(msg?.mes);
        if (shardInfo.wrapperType !== 'memory-shard') continue;
        if (!isSavedShardCompatibleWithProfile(shardInfo, activeProfile)) continue;

        results.push({
            text: shardInfo.body,
            startIndex: shardInfo.startIndex,
            endIndex: shardInfo.endIndex,
            keywords: extractKeywordsTfIdf(shardInfo.body),
            profile: shardInfo.profile,
            schemaVersion: shardInfo.schemaVersion,
        });
    }

    // Lorebook shards from selected lorebooks.
    const targetBooks = getTargetLorebookNames(settings);
    for (const book of targetBooks) {
        try {
            const data = await loadWorldInfo(book);
            const entries = data?.entries ? Object.values(data.entries) : [];

            for (const entry of entries) {
                const content = String(entry?.content || entry?.memo || '').trim();
                if (!content) continue;
                const comment = String(entry?.comment || '');
                const rangeMatch = comment.match(/memory\s+shard\s*(\d+)\s*[-–]\s*(\d+)/i);
                const fallbackStartIndex = rangeMatch ? parseInt(rangeMatch[1], 10) : null;
                const fallbackEndIndex = rangeMatch ? parseInt(rangeMatch[2], 10) : null;

                const shardInfo = classifySavedShardText(content);
                if (isSavedShardCompatibleWithProfile(shardInfo, activeProfile)) {
                    const startIndex = shardInfo.startIndex ?? fallbackStartIndex;
                    const endIndex = shardInfo.endIndex ?? fallbackEndIndex;
                    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
                        continue;
                    }

                    results.push({
                        text: shardInfo.body,
                        startIndex,
                        endIndex,
                        keywords: Array.isArray(entry?.key) && entry.key.length > 0
                            ? entry.key
                            : extractKeywordsTfIdf(shardInfo.body),
                        profile: shardInfo.profile,
                        schemaVersion: shardInfo.schemaVersion,
                    });
                    continue;
                }

                // Secondary heuristic: identify entries created by default name format.
                if (rangeMatch) {
                    results.push({
                        text: content,
                        startIndex: fallbackStartIndex,
                        endIndex: fallbackEndIndex,
                        keywords: Array.isArray(entry?.key) && entry.key.length > 0
                            ? entry.key
                            : extractKeywordsTfIdf(content),
                    });
                }
            }
        } catch (error) {
            ragLog.warn(`Failed loading lorebook "${book}" for bulk shard vectorization:`, error?.message || error);
        }
    }

    return results;
}

/**
 * Build a single-message chunk for explicit reinsert flows (edits).
 * @param {Object} message
 * @param {number} messageIndex
 * @returns {{text: string, hash: string, index: number, metadata: Object}|null}
 */
export function buildSingleMessageChunk(message, messageIndex) {
    if (!message || !Number.isInteger(messageIndex) || messageIndex < 0) {
        return null;
    }

    const speaker = message?.name
        || message?.characterName
        || (message?.is_user === true ? 'User' : (message?.is_system === true ? 'System' : 'Assistant'));
    const text = String(message?.mes ?? message?.text ?? '').trim();
    if (!text) return null;

    const chunk = {
        text: `[${messageIndex}] ${speaker}: ${text}`,
        hash: null,
        index: messageIndex,
        metadata: {
        messageIndex,
            speaker,
            characterName: message?.characterName || message?.name || null,
            isSummaryChunk: false,
            sceneCode: null,
            timestamp: Date.now(),
        },
    };

    // Stabilize hash to real index context with backend-safe UUID format.
    const normalizedText = String(chunk.text || '').trim();
    const identity = `${messageIndex}|${normalizedText}`;
    chunk.hash = buildChunkHash(identity);
    chunk.metadata.hash = chunk.hash;
    chunk.metadata.text = normalizedText;

    const kws = extractKeywordsTfIdf(chunk.text);
    chunk.metadata.keywords = kws;

    return chunk;
}

/**
 * Synchronize raw chat vectors with current chat state.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, deleted: number, totalCurrent: number}>}
 */
export async function synchronizeChatVectors(settings) {
    return { inserted: 0, deleted: 0, totalCurrent: 0 };
}

/**
 * Vectorize a new summary shard (standard mode).
 * @param {string} shardText
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {Object} settings
 * @param {string[]} keywords
 * @returns {Promise<{inserted: number, hash: string|null}>}
 */
export async function vectorizeShard(shardText, startIdx, endIdx, settings, keywords = []) {
    throwIfAborted('rag vectorization');
    const ragSettings = settings?.rag;
    if (!ragSettings?.enabled) {
        return { inserted: 0, hash: null };
    }

    const effectiveKeywords = Array.isArray(keywords) && keywords.length > 0
        ? keywords
        : extractKeywordsTfIdf(shardText);

    const origin = getCurrentVectorWriteContext(settings);
    const chunk = chunkShard(shardText, startIdx, endIdx, effectiveKeywords);
    annotateSummaryChunks([chunk], origin);
    annotateShardIdentityMetadata([chunk], settings, shardText);
    const collectionId = origin.collectionId;
    maybeShowVectorizeToast(1, origin);
    throwIfAborted('rag vectorization');
    const result = await insertChunks(collectionId, [chunk], ragSettings);

    ragLog.log(`Vectorized shard ${startIdx}-${endIdx} into ${collectionId}`);
    return { inserted: result.inserted || 1, hash: String(chunk.hash) };
}

/**
 * Vectorize a new summary shard with section-aware chunk behavior.
 * @param {string} shardText
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {Object} settings
 * @param {string[]} keywords
 * @returns {Promise<{inserted: number, deleted: number, supersedingReplaced: number, cumulativeAdded: number, rollingUpdated: number, rollingPurged: number, sectionFallbackToStandard: number}>}
 */
export async function vectorizeShardSectionAware(shardText, startIdx, endIdx, settings, keywords = []) {
    throwIfAborted('rag vectorization');
    const ragSettings = settings?.rag;
    if (!ragSettings?.enabled) {
        return {
            inserted: 0,
            deleted: 0,
            supersedingReplaced: 0,
            cumulativeAdded: 0,
            rollingUpdated: 0,
            rollingPurged: 0,
            sectionFallbackToStandard: 0,
        };
    }

    const effectiveKeywords = Array.isArray(keywords) && keywords.length > 0
        ? keywords
        : extractKeywordsTfIdf(shardText);

    const origin = getCurrentVectorWriteContext(settings);
    const { chunks, resolvedEntities } = chunkShardBySection(
        shardText,
        startIdx,
        endIdx,
        effectiveKeywords,
        Date.now(),
    );
    annotateSummaryChunks(chunks, origin);
    annotateShardIdentityMetadata(chunks, settings, shardText);

    if (!Array.isArray(chunks) || chunks.length === 0) {
        const fallbackResult = await vectorizeShard(shardText, startIdx, endIdx, settings, effectiveKeywords);
        return {
            inserted: Number(fallbackResult?.inserted || 0),
            deleted: 0,
            supersedingReplaced: 0,
            cumulativeAdded: 0,
            rollingUpdated: 0,
            rollingPurged: 0,
            sectionFallbackToStandard: 1,
        };
    }

    const collectionId = origin.collectionId;
    const existing = await listAllChunksForOrigin(collectionId, ragSettings, origin);

    const existingSuperseding = [];
    const existingRollingByEntity = new Map();
    const existingHashes = new Set(existing.map(item => String(item?.hash)));

    for (const item of existing) {
        const behavior = item?.metadata?.chunkBehavior;
        if (behavior === 'superseding') {
            existingSuperseding.push(item);
            continue;
        }

        if (behavior === 'rolling') {
            const sectionType = String(item?.metadata?.sectionType || '');
            const entityKey = String(item?.metadata?.entityKey || '');
            if (!sectionType || !entityKey) continue;

            const key = `${sectionType}|${entityKey}`;
            if (!existingRollingByEntity.has(key)) {
                existingRollingByEntity.set(key, []);
            }
            existingRollingByEntity.get(key).push(item);
        }
    }

    const hashesToDelete = new Set();
    let supersedingReplaced = 0;
    let rollingUpdated = 0;
    let rollingPurged = 0;

    const supersedingChunks = chunks.filter(chunk => chunk?.metadata?.chunkBehavior === 'superseding');
    if (supersedingChunks.length > 0) {
        for (const item of existingSuperseding) {
            const hash = String(item?.hash || '');
            if (!hash) continue;
            hashesToDelete.add(hash);
        }
        supersedingReplaced = existingSuperseding.length;
    }

    const rollingChunks = chunks.filter(chunk => chunk?.metadata?.chunkBehavior === 'rolling');
    for (const chunk of rollingChunks) {
        const sectionType = String(chunk?.metadata?.sectionType || '');
        const entityKey = String(chunk?.metadata?.entityKey || '');
        if (!sectionType || !entityKey) continue;

        const key = `${sectionType}|${entityKey}`;
        const matches = existingRollingByEntity.get(key) || [];
        for (const item of matches) {
            const hash = String(item?.hash || '');
            if (!hash) continue;
            if (!hashesToDelete.has(hash)) {
                rollingUpdated += 1;
                hashesToDelete.add(hash);
            }
        }
    }

    for (const entity of (resolvedEntities || [])) {
        const sectionType = String(entity?.sectionType || '');
        const entityKey = String(entity?.entityKey || '');
        if (!sectionType || !entityKey) continue;

        const key = `${sectionType}|${entityKey}`;
        const matches = existingRollingByEntity.get(key) || [];
        for (const item of matches) {
            const hash = String(item?.hash || '');
            if (!hash) continue;
            if (!hashesToDelete.has(hash)) {
                rollingPurged += 1;
                hashesToDelete.add(hash);
            }
        }
    }

    const cumulativeChunks = chunks.filter(chunk => chunk?.metadata?.chunkBehavior === 'cumulative');
    const nonCumulativeChunks = chunks.filter(chunk => chunk?.metadata?.chunkBehavior !== 'cumulative');
    const cumulativeToInsert = cumulativeChunks.filter(chunk => !existingHashes.has(String(chunk?.hash)));
    const toInsert = [...nonCumulativeChunks, ...cumulativeToInsert];

    const deleteList = [...hashesToDelete];
    if (deleteList.length > 0) {
        throwIfAborted('rag vectorization');
        await deleteChunks(collectionId, deleteList, ragSettings);
    }

    let inserted = 0;
    if (toInsert.length > 0) {
        maybeShowVectorizeToast(toInsert.length, origin);
        throwIfAborted('rag vectorization');
        const result = await insertChunks(collectionId, toInsert, ragSettings);
        inserted = result.inserted || toInsert.length;
    }

    ragLog.log(`Section-aware vectorization ${startIdx}-${endIdx}: +${inserted}, -${deleteList.length}`);

    return {
        inserted,
        deleted: deleteList.length,
        supersedingReplaced,
        cumulativeAdded: cumulativeToInsert.length,
        rollingUpdated,
        rollingPurged,
        sectionFallbackToStandard: 0,
    };
}

/**
 * Bulk vectorize all existing shard content.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, total: number}>}
 */
async function vectorizeAllShardsStandard(settings) {
    throwIfAborted('rag vectorization');
    const ragSettings = settings?.rag;
    if (!ragSettings?.enabled) {
        return { inserted: 0, total: 0 };
    }

    const origin = getCurrentVectorWriteContext(settings);
    const collectionId = origin.collectionId;
    const shardItems = await collectExistingShards(settings);
    if (shardItems.length === 0) {
        return { inserted: 0, total: 0 };
    }

    const chunks = shardItems.map(item => chunkShard(item.text, item.startIndex, item.endIndex, item.keywords));
    annotateSummaryChunks(chunks, origin);
    const existing = await listAllChunksForOrigin(collectionId, ragSettings, origin);
    const existingHashes = new Set(existing.map(item => String(item.hash)));
    const toInsert = chunks.filter(chunk => !existingHashes.has(String(chunk.hash)));

    if (toInsert.length === 0) {
        return { inserted: 0, total: chunks.length };
    }

    maybeShowVectorizeToast(toInsert.length, origin);
    throwIfAborted('rag vectorization');
    const result = await insertChunks(collectionId, toInsert, ragSettings);
    ragLog.log(`Bulk vectorized shard collection ${collectionId}: +${result.inserted || toInsert.length}`);

    return {
        inserted: result.inserted || toInsert.length,
        total: chunks.length,
    };
}

/**
 * Remove a specific stale vector hash from a collection.
 * @param {string} collectionId
 * @param {string|number|null} oldHash
 * @param {Object} settings
 * @returns {Promise<{deleted: number}>}
 */
export async function cleanStaleVectors(collectionId, oldHash, settings) {
    const ragSettings = settings?.rag || settings;
    if (!ragSettings?.enabled || !oldHash) {
        return { deleted: 0 };
    }

    const result = await deleteChunks(collectionId, [oldHash], ragSettings);
    const deleted = result.deleted || 0;

    return { deleted };
}

/**
 * Check whether embeddings are configured in SillyTavern vectors settings.
 * @returns {{available: boolean, source: string, model: string, reason?: string}}
 */
export function checkEmbeddingAvailability() {
    const vectors = extension_settings?.vectors || {};
    const source = String(vectors.source || '').trim();

    if (!source || source === 'none' || source === 'off') {
        return {
            available: false,
            source: source || '',
            model: '',
            reason: 'No embedding source configured in extension_settings.vectors.source',
        };
    }

    const directModel = typeof vectors.model === 'string' ? vectors.model : '';
    const nestedModel = typeof vectors?.[source]?.model === 'string' ? vectors[source].model : '';
    const model = directModel || nestedModel || '';

    return {
        available: true,
        source,
        model,
    };
}

/**
 * Lightweight TF-IDF style keyword extraction.
 * Treats each sentence as a mini-document for approximate IDF.
 * @param {string} text
 * @param {number} maxKeywords
 * @returns {string[]}
 */
export function extractKeywordsTfIdf(text, maxKeywords = 8) {
    const raw = String(text || '').toLowerCase().trim();
    if (!raw) return [];

    const docs = raw
        .split(/[.!?\n]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(sentence => sentence
            .replace(/[^a-z0-9\s'-]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
        )
        .filter(tokens => tokens.length > 0);

    if (docs.length === 0) return [];

    const tf = new Map();
    const df = new Map();

    for (const tokens of docs) {
        const seen = new Set();
        for (const token of tokens) {
            tf.set(token, (tf.get(token) || 0) + 1);
            if (!seen.has(token)) {
                df.set(token, (df.get(token) || 0) + 1);
                seen.add(token);
            }
        }
    }

    const docCount = docs.length;
    const scored = [];

    for (const [token, termFreq] of tf.entries()) {
        const docFreq = df.get(token) || 1;
        const idf = Math.log((1 + docCount) / (1 + docFreq)) + 1;
        const score = termFreq * idf;
        scored.push({ token, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const result = scored.slice(0, Math.max(1, maxKeywords)).map(item => item.token);

    const bannedSet = parseBannedKeywords(
        extension_settings?.summary_sharder?.lorebookEntryOptions?.bannedKeywords
    );
    return filterBannedKeywords(result, bannedSet);
}

/**
 * Insert/update vector entry for a single edited message index.
 * @param {number} messageIndex
 * @param {Object} settings
 * @returns {Promise<{inserted: number, hash: string|null}>}
 */
export async function vectorizeSingleMessageAtIndex(messageIndex, settings) {
    return { inserted: 0, hash: null };
}

/**
 * Bulk vectorize all existing shards with section-aware behavior.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, deleted: number, total: number, supersedingReplaced: number, cumulativeAdded: number, rollingUpdated: number, rollingPurged: number, sectionFallbackToStandard: number}>}
 */
async function vectorizeAllShardsSectionAwareInternal(settings) {
    throwIfAborted('rag vectorization');
    const ragSettings = settings?.rag;
    if (!ragSettings?.enabled) {
        return {
            inserted: 0,
            deleted: 0,
            total: 0,
            supersedingReplaced: 0,
            cumulativeAdded: 0,
            rollingUpdated: 0,
            rollingPurged: 0,
            sectionFallbackToStandard: 0,
        };
    }

    const shardItems = await collectExistingShards(settings);
    if (shardItems.length === 0) {
        return {
            inserted: 0,
            deleted: 0,
            total: 0,
            supersedingReplaced: 0,
            cumulativeAdded: 0,
            rollingUpdated: 0,
            rollingPurged: 0,
            sectionFallbackToStandard: 0,
        };
    }

    let inserted = 0;
    let deleted = 0;
    let supersedingReplaced = 0;
    let cumulativeAdded = 0;
    let rollingUpdated = 0;
    let rollingPurged = 0;
    let sectionFallbackToStandard = 0;

    for (const item of shardItems) {
        throwIfAborted('rag vectorization');
        const result = await vectorizeShardSectionAware(
            item.text,
            item.startIndex,
            item.endIndex,
            settings,
            item.keywords,
        );
        inserted += Number(result?.inserted || 0);
        deleted += Number(result?.deleted || 0);
        supersedingReplaced += Number(result?.supersedingReplaced || 0);
        cumulativeAdded += Number(result?.cumulativeAdded || 0);
        rollingUpdated += Number(result?.rollingUpdated || 0);
        rollingPurged += Number(result?.rollingPurged || 0);
        sectionFallbackToStandard += Number(result?.sectionFallbackToStandard || 0);
    }

    return {
        inserted,
        deleted,
        total: shardItems.length,
        supersedingReplaced,
        cumulativeAdded,
        rollingUpdated,
        rollingPurged,
        sectionFallbackToStandard,
    };
}

/**
 * Bulk vectorize all existing shards using explicit or resolved mode.
 * @param {Object} settings
 * @param {'standard'|'section'} [mode]
 * @returns {Promise<{mode: string, inserted: number, deleted: number, total: number, supersedingReplaced?: number, cumulativeAdded?: number, rollingUpdated?: number, rollingPurged?: number, sectionFallbackToStandard?: number}>}
 */
export async function vectorizeAllShardsByMode(settings, mode = null) {
    const activeProfile = normalizeSharderProfile(settings?.sharderProfile || NARRATIVE_PROFILE);
    const resolvedMode = activeProfile === ARCHITECTURAL_PROFILE
        ? 'standard'
        : (mode || resolveShardChunkingMode(settings?.rag));

    if (resolvedMode === 'section') {
        const result = await vectorizeAllShardsSectionAwareInternal(settings);
        return { mode: 'section', ...result };
    }

    const result = await vectorizeAllShardsStandard(settings);
    return {
        mode: 'standard',
        deleted: 0,
        sectionFallbackToStandard: 0,
        ...result,
    };
}

/**
 * Backward-compatible wrapper for standard bulk shard vectorization.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, total: number}>}
 */
export async function vectorizeAllShards(settings) {
    const result = await vectorizeAllShardsByMode(settings, 'standard');
    return {
        inserted: result.inserted,
        total: result.total,
    };
}

/**
 * Backward-compatible wrapper for section-aware bulk shard vectorization.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, deleted: number, total: number, supersedingReplaced: number, cumulativeAdded: number, rollingUpdated: number, rollingPurged: number}>}
 */
export async function vectorizeAllShardsSectionAware(settings) {
    const result = await vectorizeAllShardsByMode(settings, 'section');
    return {
        inserted: result.inserted,
        deleted: result.deleted,
        total: result.total,
        supersedingReplaced: result.supersedingReplaced || 0,
        cumulativeAdded: result.cumulativeAdded || 0,
        rollingUpdated: result.rollingUpdated || 0,
        rollingPurged: result.rollingPurged || 0,
        sectionFallbackToStandard: result.sectionFallbackToStandard || 0,
    };
}

/**
 * Collect standard-mode summaries from chat and optionally selected lorebooks.
 * Mirrors collectExistingShards but uses ragStandard settings for lorebook config.
 * @param {Object} settings
 * @returns {Promise<Array<{text: string, startIndex: number, endIndex: number, keywords: string[]}>>}
 */
async function collectStandardShards(settings) {
    const ragStd = settings?.ragStandard;
    const results = [];

    // Scan chat system messages for [SUMMARY: ...] or [MEMORY SHARD: ...] prefixes.
    const chat = SillyTavern.getContext()?.chat || [];
    for (const msg of chat) {
        const parsed = parseAnySummaryMessage(msg?.mes);
        if (!parsed) continue;
        results.push({
            text: parsed.body,
            startIndex: parsed.startIndex,
            endIndex: parsed.endIndex,
            keywords: extractKeywordsTfIdf(parsed.body),
        });
    }

    if (ragStd?.useLorebooksForVectorization === true) {
        const selectedNames = Array.isArray(ragStd.vectorizationLorebookNames)
            ? ragStd.vectorizationLorebookNames
                .map(n => String(n || '').trim())
                .filter(n => n && world_names.includes(n))
            : [];

        for (const book of selectedNames) {
            try {
                const data = await loadWorldInfo(book);
                const entries = data?.entries ? Object.values(data.entries) : [];
                for (const entry of entries) {
                    const content = String(entry?.content || entry?.memo || '').trim();
                    if (!content) continue;
                    const shardInfo = classifySavedShardText(content);

                    // Primary: content has an embedded [SUMMARY: ...] or [MEMORY SHARD: ...] header.
                    const parsed = parseAnySummaryMessage(content);
                    if (parsed) {
                        results.push({
                            text: parsed.body,
                            startIndex: parsed.startIndex,
                            endIndex: parsed.endIndex,
                            keywords: Array.isArray(entry?.key) && entry.key.length > 0
                                ? entry.key
                                : extractKeywordsTfIdf(parsed.body),
                        });
                        continue;
                    }

                    // Secondary: identify entries by comment matching "Summary N-N" or
                    // "Memory Shard N-N" (the old default name format).
                    const comment = String(entry?.comment || '');
                    const rangeMatch = comment.match(/(?:summary|memory\s+shard)\s+(\d+)\s*[-–]\s*(\d+)/i);
                    if (rangeMatch && shardInfo.profile !== ARCHITECTURAL_PROFILE) {
                        const startIndex = parseInt(rangeMatch[1], 10);
                        const endIndex = parseInt(rangeMatch[2], 10);
                        results.push({
                            text: content,
                            startIndex,
                            endIndex,
                            keywords: Array.isArray(entry?.key) && entry.key.length > 0
                                ? entry.key
                                : extractKeywordsTfIdf(content),
                        });
                    }
                }
            } catch (error) {
                ragLog.warn(`Failed loading lorebook "${book}" for standard bulk vectorization:`, error?.message || error);
            }
        }
    }

    return results;
}

/**
 * Vectorize a new standard-mode prose summary (Standard Mode).
 * @param {string} text
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {Object} settings
 * @param {string[]} keywords
 * @returns {Promise<{inserted: number, hash: string|null}>}
 */
export async function vectorizeStandardSummary(text, startIdx, endIdx, settings, keywords = []) {
    throwIfAborted('rag vectorization');
    const ragStd = settings?.ragStandard;
    if (!ragStd?.enabled) {
        return { inserted: 0, hash: null };
    }

    const effectiveKeywords = Array.isArray(keywords) && keywords.length > 0
        ? keywords
        : extractKeywordsTfIdf(text);

    const origin = getCurrentVectorWriteContext(settings);
    const chunks = chunkProseSummary(text, startIdx, endIdx, effectiveKeywords, ragStd.proseChunkingMode);
    if (chunks.length === 0) return { inserted: 0, hash: null };
    annotateSummaryChunks(chunks, origin);

    const collectionId = origin.collectionId;
    maybeShowVectorizeToast(chunks.length, origin);
    throwIfAborted('rag vectorization');
    const result = await insertChunks(collectionId, chunks, ragStd);

    ragLog.log(`Vectorized standard summary ${startIdx}-${endIdx} into ${collectionId}`);
    return { inserted: result.inserted || chunks.length, hash: String(chunks[0].hash) };
}

/**
 * Bulk vectorize all existing standard-mode summaries.
 * @param {Object} settings
 * @returns {Promise<{inserted: number, total: number}>}
 */
export async function vectorizeAllStandardSummaries(settings) {
    throwIfAborted('rag vectorization');
    const ragStd = settings?.ragStandard;
    if (!ragStd?.enabled) {
        return { inserted: 0, total: 0 };
    }

    const origin = getCurrentVectorWriteContext(settings);
    const collectionId = origin.collectionId;
    const shardItems = await collectStandardShards(settings);
    if (shardItems.length === 0) {
        return { inserted: 0, total: 0 };
    }

    const allChunks = shardItems.flatMap(item =>
        chunkProseSummary(item.text, item.startIndex, item.endIndex, item.keywords, ragStd.proseChunkingMode)
    );
    annotateSummaryChunks(allChunks, origin);

    const existing = await listAllChunksForOrigin(collectionId, ragStd, origin);
    const existingHashes = new Set(existing.map(item => String(item.hash)));
    const toInsert = allChunks.filter(chunk => !existingHashes.has(String(chunk.hash)));

    if (toInsert.length === 0) {
        return { inserted: 0, total: allChunks.length };
    }

    maybeShowVectorizeToast(toInsert.length, origin);
    throwIfAborted('rag vectorization');
    const result = await insertChunks(collectionId, toInsert, ragStd);
    ragLog.log(`Bulk vectorized standard collection ${collectionId}: +${result.inserted || toInsert.length}`);

    return {
        inserted: result.inserted || toInsert.length,
        total: allChunks.length,
    };
}
