/**
 * Retrieval pipeline for Summary Sharder RAG.
 * Registers as generate interceptor via globalThis.summary_sharder_rearrangeChat.
 */

import { setExtensionPrompt } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { getActiveCollectionIds, getWriteTargetCollectionId, getShardCollectionId, getStandardCollectionId } from './collection-manager.js';
import { rerankDocuments } from './reranker-client.js';
import { hybridQuery, listChunks, queryChunks } from './vector-client.js';
import { keywordBoost, runClientHybridFusion, scoreAndRank } from './scoring.js';
import { getActiveRagSettings } from '../settings.js';
import { ragLog } from '../logger.js';
import {
    ANCHORS_SECTION_KEY,
    ANCHORS_SECTION_LABEL,
    buildQueryText,
    collectLatestAnchors,
    collectLatestDevelopments,
    compactAnchorsPinnedChunks,
    compactDevelopmentsPinnedChunks,
    compactRollingPinnedChunks,
    compareChronologically,
    CUMULATIVE_SECTION_ORDER,
    dedupeLatestRolling,
    DEVELOPMENTS_SECTION_KEY,
    DEVELOPMENTS_SECTION_LABEL,
    extractSectionBodyByHeading,
    getAnchorKey,
    getFreshnessEndIndex,
    getRollingKey,
    mergeLatestAnchors,
    mergeLatestDevelopments,
    mergeLatestRolling,
    normalizeText,
    parseSceneCode,
    PINNED_TIER_ORDER,
    ROLLING_SECTION_LABELS,
    ROLLING_SECTION_ORDER,
    splitSectionListItems,
    stripAnchorsFromCumulativeResults,
    stripLeadingSectionHeader,
    stripSectionByHeading,
} from './retrieval-shared.js';

export const EXTENSION_PROMPT_TAG_SS = '5_summary_sharder_rag';

/** @type {Object|null} Last successful RAG injection snapshot. */
let lastInjectionData = null;

/**
 * @typedef {Object} FallbackCacheEntry
 * @property {any} data
 * @property {number} timestamp
 */

/** @type {Map<string, FallbackCacheEntry>} */
const fallbackCache = new Map();
const FALLBACK_CACHE_TTL = 30000; // 30 seconds

function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

function getCurrentRetrievalOrigin(settings) {
    const ctx = SillyTavern.getContext();
    const chatId = normalizeChatId(ctx?.chatId || '');
    const isSharder = settings?.sharderMode === true;
    let ownCollectionId = '';
    try {
        ownCollectionId = chatId
            ? (isSharder ? getShardCollectionId(chatId) : getStandardCollectionId(chatId))
            : '';
    } catch {
        ownCollectionId = '';
    }

    return {
        chatId,
        ownCollectionId,
    };
}

function isSharedWriteTarget(origin, collectionId) {
    const ownCollectionId = String(origin?.ownCollectionId || '').trim();
    const id = String(collectionId || '').trim();
    return !!id && !!ownCollectionId && id !== ownCollectionId;
}

function buildScopedMetadataFilter(origin, base = {}) {
    const filter = { ...(base || {}) };
    if (isSharedWriteTarget(origin, origin?.collectionId) && origin?.chatId) {
        filter.originChatId = origin.chatId;
    }
    return filter;
}

function filterResultsForOrigin(results, origin) {
    const scoped = isSharedWriteTarget(origin, origin?.collectionId);
    const list = Array.isArray(results) ? results : [];
    const withoutArchitectural = list.filter(item => String(item?.metadata?.shardProfile || '').trim() !== 'architectural');
    if (!scoped) return withoutArchitectural;

    return withoutArchitectural.filter(item =>
        String(item?.metadata?.originChatId || '').trim() === String(origin?.chatId || '').trim()
    );
}

/**
 * Invalidate the fallback cache for a specific collection or all collections.
 * @param {string} [collectionId] - If omitted, clears all collections.
 */
export function invalidateFallbackCache(collectionId = null) {
    if (!collectionId) {
        fallbackCache.clear();
        return;
    }

    for (const key of fallbackCache.keys()) {
        if (key.startsWith(`${collectionId}:`)) {
            fallbackCache.delete(key);
        }
    }
}

/**
 * Internal helper to fetch with caching.
 * @param {string} collectionId 
 * @param {Object} rag 
 * @param {string} type 
 * @param {number} limit 
 * @param {Function} fetchFn 
 * @returns {Promise<any>}
 */
async function fetchWithFallbackCache(collectionId, rag, type, limit, fetchFn, cacheScope = '') {
    const key = `${collectionId}:${type}:${limit}:${cacheScope}`;
    const cached = fallbackCache.get(key);
    if (cached && (Date.now() - cached.timestamp < FALLBACK_CACHE_TTL)) {
        return cached.data;
    }

    const data = await fetchFn(collectionId, rag, limit);
    fallbackCache.set(key, { data, timestamp: Date.now() });
    return data;
}

/**
 * Returns the most recent RAG injection data, or null if none yet.
 * @returns {Object|null}
 */
export function getLastInjectionData() {
    return lastInjectionData;
}

/**
 * Remove DEVELOPMENTS section blocks from cumulative chunks so compact pinned developments
 * can be appended once without duplicating the same section repeatedly.
 * @param {Array<Object>} results
 * @returns {Array<Object>}
 */
function stripDevelopmentsFromCumulativeResults(results) {
    const out = [];

    for (const item of (results || [])) {
        if (item?.metadata?.chunkBehavior !== 'cumulative') {
            out.push(item);
            continue;
        }

        const sectionTypes = Array.isArray(item?.metadata?.sectionTypes)
            ? item.metadata.sectionTypes
            : [];
        const likelyHasDevelopments = sectionTypes.includes(DEVELOPMENTS_SECTION_KEY)
            || /(^|\n)###\s+DEVELOPMENTS\b/i.test(String(item?.text || ''));
        if (!likelyHasDevelopments) {
            out.push(item);
            continue;
        }

        const stripped = stripSectionByHeading(item?.text || '', DEVELOPMENTS_SECTION_LABEL);
        if (!stripped.removed) {
            out.push(item);
            continue;
        }

        if (!stripped.text) continue;
        const nextSectionTypes = sectionTypes.length > 0
            ? sectionTypes.filter(section => section !== DEVELOPMENTS_SECTION_KEY)
            : sectionTypes;

        out.push({
            ...item,
            text: stripped.text,
            metadata: {
                ...(item?.metadata || {}),
                ...(sectionTypes.length > 0 ? { sectionTypes: nextSectionTypes } : {}),
            },
        });
    }

    return out;
}

/**
 * @param {Array<Object>} results
 * @returns {Array<Object>}
 */
function dedupeResults(results) {
    const exactSeen = new Set();
    const exactDeduped = [];

    for (const item of (results || [])) {
        const key = `${item?.hash || ''}|${normalizeText(item?.text || '')}`;
        if (!key || exactSeen.has(key)) continue;
        exactSeen.add(key);
        exactDeduped.push(item);
    }

    let latestSuperseding = null;
    const latestRolling = new Map();
    const passthrough = [];

    for (const item of exactDeduped) {
        const behavior = item?.metadata?.chunkBehavior || null;

        if (behavior === 'superseding') {
            if (!latestSuperseding || getFreshnessEndIndex(item) > getFreshnessEndIndex(latestSuperseding)) {
                latestSuperseding = item;
            }
            continue;
        }

        if (behavior === 'rolling') {
            const rollingKey = getRollingKey(item);
            if (!rollingKey) {
                passthrough.push(item);
                continue;
            }

            const existing = latestRolling.get(rollingKey);
            if (!existing || getFreshnessEndIndex(item) > getFreshnessEndIndex(existing)) {
                latestRolling.set(rollingKey, item);
            }
            continue;
        }

        passthrough.push(item);
    }

    const out = [];
    if (latestSuperseding) out.push(latestSuperseding);
    out.push(...passthrough);
    out.push(...latestRolling.values());
    return out;
}

/**
 * Explicitly fetch the latest superseding chunk from the collection.
 * Used as a fallback to ensure "Current State" is always present.
 * @param {string} collectionId
 * @param {Object} rag
 * @returns {Promise<Object|null>}
 */
export async function fetchLatestSuperseding(collectionId, rag, origin = null) {
    return fetchWithFallbackCache(collectionId, rag, 'superseding', 1, async (id, r) => {
        try {
            const { items } = await listChunks(id, r, {
                limit: 20,
                metadataFilter: buildScopedMetadataFilter({ ...(origin || {}), collectionId: id }, { chunkBehavior: 'superseding' }),
            });
            if (!Array.isArray(items) || items.length === 0) return null;

            items.sort((a, b) => getFreshnessEndIndex(b) - getFreshnessEndIndex(a));
            return items[0];
        } catch (error) {
            ragLog.warn('Fallback superseding fetch failed:', error?.message || error);
            return null;
        }
    }, String(origin?.chatId || ''));
}

/**
 * Explicitly fetch rolling chunks and keep latest per sectionType|entityKey.
 * Used as a fallback to ensure rolling section coverage is not query-score bound.
 * @param {string} collectionId
 * @param {Object} rag
 * @param {number} [limit=50]
 * @returns {Promise<{items: Array<Object>, fetchedCount: number, hasMore: boolean}>}
 */
export async function fetchLatestRolling(collectionId, rag, limit = 50, origin = null) {
    return fetchWithFallbackCache(collectionId, rag, 'rolling', limit, async (id, r, l) => {
        try {
            const safeLimit = Math.max(1, Number(l) || 50);
            const { items, hasMore } = await listChunks(id, r, {
                limit: safeLimit,
                metadataFilter: buildScopedMetadataFilter({ ...(origin || {}), collectionId: id }, { chunkBehavior: 'rolling' }),
            });

            const safeItems = Array.isArray(items) ? items : [];
            return {
                items: dedupeLatestRolling(safeItems),
                fetchedCount: safeItems.length,
                hasMore: !!hasMore,
            };
        } catch (error) {
            ragLog.warn('Fallback rolling fetch failed:', error?.message || error);
            return {
                items: [], 
                fetchedCount: 0,
                hasMore: false,
            };
        }
    }, String(origin?.chatId || ''));
}

/**
 * Explicitly fetch cumulative chunks and keep latest anchors by anchor key.
 * @param {string} collectionId
 * @param {Object} rag
 * @param {number} [limit=50]
 * @returns {Promise<{items: Array<{key: string, text: string, freshness: number, score: number}>, fetchedCount: number, hasMore: boolean}>}
 */
export async function fetchLatestAnchors(collectionId, rag, limit = 50, origin = null) {
    return fetchWithFallbackCache(collectionId, rag, 'anchors', limit, async (id, r, l) => {
        try {
            const safeLimit = Math.max(1, Number(l) || 50);
            const { items, hasMore } = await listChunks(id, r, {
                limit: safeLimit,
                metadataFilter: buildScopedMetadataFilter({ ...(origin || {}), collectionId: id }, { chunkBehavior: 'cumulative' }),
            });

            const safeItems = Array.isArray(items) ? items : [];
            return {
                items: collectLatestAnchors(safeItems),
                fetchedCount: safeItems.length,
                hasMore: !!hasMore,
            };
        } catch (error) {
            ragLog.warn('Fallback anchors fetch failed:', error?.message || error);
            return {
                items: [],
                fetchedCount: 0,
                hasMore: false,
            };
        }
    }, String(origin?.chatId || ''));
}

/**
 * Explicitly fetch developments items from cumulative chunks.
 * @param {string} collectionId
 * @param {Object} rag
 * @param {number} [limit=50]
 * @returns {Promise<{items: Array<{text: string, freshness: number, score: number}>, fetchedCount: number, hasMore: boolean}>}
 */
export async function fetchLatestDevelopments(collectionId, rag, limit = 50, origin = null) {
    return fetchWithFallbackCache(collectionId, rag, 'developments', limit, async (id, r, l) => {
        try {
            const safeLimit = Math.max(1, Number(l) || 50);
            const { items, hasMore } = await listChunks(id, r, {
                limit: safeLimit,
                metadataFilter: buildScopedMetadataFilter({ ...(origin || {}), collectionId: id }, { chunkBehavior: 'cumulative' }),
            });

            const safeItems = Array.isArray(items) ? items : [];
            return {
                items: collectLatestDevelopments(safeItems),
                fetchedCount: safeItems.length,
                hasMore: !!hasMore,
            };
        } catch (error) {
            ragLog.warn('Fallback developments fetch failed:', error?.message || error);
            return {
                items: [],
                fetchedCount: 0,
                hasMore: false,
            };
        }
    }, String(origin?.chatId || ''));
}

/**
 * @param {Array<Object>} results
 * @param {Array<Object>} chat
 * @param {number} protectCount
 * @returns {Array<Object>}
 */
function dedupeAgainstRecentContext(results, chat, protectCount) {
    if (!Array.isArray(results) || results.length === 0) return [];
    if (!Array.isArray(chat) || chat.length === 0) return [...results];

    const safeProtect = Math.max(0, Number(protectCount) || 0);
    if (safeProtect <= 0) return [...results];

    const start = Math.max(0, chat.length - safeProtect);
    const inContext = new Set();
    for (let i = start; i < chat.length; i++) {
        const text = String(chat[i]?.mes ?? chat[i]?.text ?? '').trim();
        if (!text) continue;
        inContext.add(normalizeText(text));
    }

    return results.filter(item => {
        const text = normalizeText(item?.text || '');
        return text && !inContext.has(text);
    });
}

/**
 * @param {Array<Object>} results
 * @returns {Array<Object>}
 */
function orderWithSceneGrouping(results) {
    if (!Array.isArray(results) || results.length <= 1) return results || [];

    const superseding = [];
    const cumulativeByScene = new Map();
    const cumulativeNoScene = [];
    const pinned = [];
    const legacyNoScene = [];

    // --- Categorize into three tiers ---
    for (const item of results) {
        const behavior = item?.metadata?.chunkBehavior || null;
        const sectionType = item?.metadata?.sectionType || '';
        const sectionTypes = Array.isArray(item?.metadata?.sectionTypes) ? item.metadata.sectionTypes : [];

        if (behavior === 'superseding') {
            superseding.push(item);
            continue;
        }

        if (behavior === 'rolling') {
            pinned.push(item);
            continue;
        }

        // Developments and anchors pinned groups go to pinned tier
        if (item?.metadata?.pinnedGroup && (sectionType === 'developments' || sectionType === 'anchors')) {
            pinned.push(item);
            continue;
        }

        // Regular cumulative
        if (behavior === 'cumulative') {
            const sceneCode = item?.metadata?.sceneCode || null;
            if (sceneCode) {
                if (!cumulativeByScene.has(sceneCode)) {
                    cumulativeByScene.set(sceneCode, []);
                }
                cumulativeByScene.get(sceneCode).push(item);
            } else {
                cumulativeNoScene.push(item);
            }
            continue;
        }

        legacyNoScene.push(item);
    }

    // --- Sort each tier ---
    superseding.sort((a, b) => getFreshnessEndIndex(b) - getFreshnessEndIndex(a));

    // Sort cumulative scene buckets chronologically, and intra-scene items by section order
    const sortedSceneCodes = [...cumulativeByScene.keys()].sort((a, b) => {
        const pA = parseSceneCode(a);
        const pB = parseSceneCode(b);
        if (pA && pB) {
            if (pA.shard !== pB.shard) return pA.shard - pB.shard;
            return pA.scene - pB.scene;
        }
        return 0;
    });

    for (const bucket of cumulativeByScene.values()) {
        bucket.sort((a, b) => {
            const getSectionPriority = (item) => {
                const types = Array.isArray(item?.metadata?.sectionTypes) ? item.metadata.sectionTypes : [];
                let best = CUMULATIVE_SECTION_ORDER.length;
                for (const t of types) {
                    const idx = CUMULATIVE_SECTION_ORDER.indexOf(t);
                    if (idx >= 0 && idx < best) best = idx;
                }
                return best;
            };
            return getSectionPriority(a) - getSectionPriority(b);
        });
    }

    cumulativeNoScene.sort(compareChronologically);

    // Sort pinned by PINNED_TIER_ORDER
    pinned.sort((a, b) => {
        const getOrder = (item) => {
            const st = item?.metadata?.sectionType || '';
            const idx = PINNED_TIER_ORDER.indexOf(st);
            return idx >= 0 ? idx : PINNED_TIER_ORDER.length;
        };
        return getOrder(a) - getOrder(b);
    });

    legacyNoScene.sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));

    // --- Assemble three-tier output ---
    const ordered = [];

    // Tier 1: Superseding
    ordered.push(...superseding);

    // Tier 2: Cumulative (chronological by scene code)
    for (const sceneCode of sortedSceneCodes) {
        const items = cumulativeByScene.get(sceneCode) || [];
        if (items.length > 0) {
            ordered.push(...items);
        }
    }
    ordered.push(...cumulativeNoScene);

    // Tier 3: Pinned (rolling + developments + anchors)
    ordered.push(...pinned);

    // Legacy at the very end
    ordered.push(...legacyNoScene);

    return dedupeResults(ordered);
}

/**
 * @param {Object} settings
 * @param {Array<Object>} shardResults
 * @param {string} primaryCollectionId
 * @returns {Promise<Array<Object>>}
 */
async function expandByScene(settings, shardResults, primaryCollectionId, origin = null) {
    const rag = settings?.rag;
    if (!rag?.sceneExpansion || !Array.isArray(shardResults) || shardResults.length === 0) {
        return [];
    }

    const expandable = shardResults.filter(item => {
        const behavior = item?.metadata?.chunkBehavior || null;
        return behavior === null || behavior === 'cumulative';
    });

    const sceneCodes = [...new Set(expandable
        .map(r => r?.metadata?.sceneCode)
        .filter(Boolean))];

    if (sceneCodes.length === 0) return [];

    // Use the primary collection for scene expansion — scene codes are specific
    // to summaries generated for this chat's own shard collection.
    const collectionId = primaryCollectionId || getShardCollectionId();
    const expanded = [];
    const maxSceneExpansionChunks = Math.max(0, Number(rag.maxSceneExpansionChunks) || 10);

    for (const sceneCode of sceneCodes) {
        if (expanded.length >= maxSceneExpansionChunks) break;

        try {
            const room = Math.max(1, maxSceneExpansionChunks - expanded.length);
            const { items } = await listChunks(collectionId, rag, {
                limit: room,
                metadataFilter: buildScopedMetadataFilter({ ...(origin || {}), collectionId }, { sceneCode }),
            });
            for (const item of filterResultsForOrigin(items || [], { ...(origin || {}), collectionId })) {
                expanded.push(item);
                if (expanded.length >= maxSceneExpansionChunks) break;
            }
        } catch (error) {
            ragLog.warn(`Scene expansion failed for ${sceneCode}:`, error?.message || error);
        }
    }

    return expanded;
}

function applyImportanceBoost(results) {
    if (!Array.isArray(results) || results.length === 0) return [];
    return results.map(item => {
        const base = Number(item?.score) || 0;
        const importance = Number(item?.metadata?.importance);
        if (!Number.isFinite(importance)) {
            return item;
        }

        const boost = (importance - 50) / 200;
        return {
            ...item,
            score: base + boost,
        };
    });
}

/**
 * @param {Array<Object>} results
 * @param {string} queryText
 * @param {Object} rag
 * @returns {Promise<{results: Array<Object>, metadata: Object}>}
 */
async function applyReranker(results, queryText, rag) {
    const safeResults = Array.isArray(results) ? results : [];
    if (safeResults.length === 0 || !rag?.reranker?.enabled) {
        return {
            results: safeResults,
            metadata: { applied: false, skipped: true },
        };
    }

    const documents = safeResults.map(item => String(item?.text || ''));
    const reranked = await rerankDocuments(queryText, documents, rag, { topK: documents.length });
    if (!reranked.success || !Array.isArray(reranked.ranked) || reranked.ranked.length === 0) {
        return {
            results: safeResults,
            metadata: {
                applied: false,
                skipped: false,
                mode: reranked.mode || 'similharity',
                target: reranked.target || '',
                error: reranked.error || 'rerank failed',
            },
        };
    }

    const ordered = [];
    const used = new Set();

    for (const row of reranked.ranked) {
        const idx = Number(row?.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= safeResults.length || used.has(idx)) continue;
        used.add(idx);
        ordered.push({
            ...safeResults[idx],
            _reranked: true,
            ...(Number.isFinite(Number(row?.score)) ? { _rerankScore: Number(row.score) } : {}),
        });
    }

    for (let i = 0; i < safeResults.length; i++) {
        if (used.has(i)) continue;
        ordered.push(safeResults[i]);
    }

    return {
        results: ordered,
        metadata: {
            applied: true,
            mode: reranked.mode || 'similharity',
            target: reranked.target || '',
            error: '',
        },
    };
}

/**
 * Cap the number of results from the same shard (same message range).
 * Prevents a single long summary from crowding out other context.
 * @param {Array<Object>} results
 * @param {number} maxPerShard
 * @returns {Array<Object>}
 */
function capChunksPerShard(results, maxPerShard) {
    if (!Array.isArray(results) || results.length === 0) return [];
    const limit = Math.max(1, Number(maxPerShard) || 2);

    const grouped = new Map();
    for (const item of results) {
        const start = item?.metadata?.startIndex ?? item?.metadata?.startIndex ?? -1;
        const end = item?.metadata?.endIndex ?? item?.metadata?.endIndex ?? -1;
        const key = `${start}-${end}`;

        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(item);
    }

    const out = [];
    for (const group of grouped.values()) {
        // Keep the best scoring ones from this shard
        group.sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));
        out.push(...group.slice(0, limit));
    }

    return out;
}

/**
 * Cap chunks per shard while preserving current order.
 * Used when reranker ordering should remain primary.
 * @param {Array<Object>} results
 * @param {number} maxPerShard
 * @returns {Array<Object>}
 */
function capChunksPerShardPreserveOrder(results, maxPerShard) {
    if (!Array.isArray(results) || results.length === 0) return [];
    const limit = Math.max(1, Number(maxPerShard) || 2);
    const counts = new Map();
    const out = [];

    for (const item of results) {
        const start = item?.metadata?.startIndex ?? item?.metadata?.startIndex ?? -1;
        const end = item?.metadata?.endIndex ?? item?.metadata?.endIndex ?? -1;
        const key = `${start}-${end}`;
        const count = counts.get(key) || 0;
        if (count >= limit) continue;
        counts.set(key, count + 1);
        out.push(item);
    }

    return out;
}

/**
 * Strip machine-only metadata from chunk text before LLM injection.
 * Scene codes and weight emojis have already served their purpose in the
 * RAG pipeline (scene expansion, importance scoring) and are noise for the
 * receiving model.
 * @param {string} text
 * @returns {string}
 */
function cleanChunkText(text) {
    let cleaned = text;
    // Strip scene codes: [S31:1] or (S31:1)
    cleaned = cleaned.replace(/[\[(]S\d+:\d+[\])]\s*/g, '');
    // Strip weight emojis used in EVENTS section
    cleaned = cleaned.replace(/[🔴🟠🟡🟢⚪]\s*/g, '');
    // Clean orphaned leading pipe separators and excess whitespace
    cleaned = cleaned.replace(/^\s*\|\s*/gm, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
}

/**
 * @param {string} template
 * @param {Array<Object>} results
 * @returns {string}
 */
function formatInjectionText(template, results) {
    const lines = [];
    let lastSceneCode = null;

    for (const item of (results || [])) {
        const cleaned = cleanChunkText(String(item?.text || ''));
        if (!cleaned) continue;

        // Add scene code group header for cumulative chunks
        const sceneCode = item?.metadata?.sceneCode || null;
        if (sceneCode && item?.metadata?.chunkBehavior === 'cumulative' && sceneCode !== lastSceneCode) {
            lines.push(`Timeline [${sceneCode}]`);
            lastSceneCode = sceneCode;
        }

        lines.push(cleaned);
    }

    if (lines.length === 0) return '';

    const textBlock = lines.join('\n\n');
    const tpl = String(template || 'Recalled memories:\n{{text}}');
    if (tpl.includes('{{text}}')) {
        return tpl.replace(/\{\{text\}\}/g, textBlock);
    }
    return `${tpl}\n${textBlock}`;
}

/**
 * Clear the extension prompt slot unconditionally.
 */
function clearExtensionPrompt() {
    if (typeof setExtensionPrompt === 'function') {
        setExtensionPrompt(EXTENSION_PROMPT_TAG_SS, '', 0, 0);
    }
}

/**
 * Apply RAG injection using the configured mode.
 * - 'extension_prompt': injects at a fixed position/depth via setExtensionPrompt
 * - 'variable': sets a local chat variable so {{getvar::name}} resolves in prompt templates
 * @param {string} text
 * @param {Object} rag
 */
function applyInjection(text, rag) {
    const mode = rag?.injectionMode ?? 'extension_prompt';
    if (mode === 'variable') {
        clearExtensionPrompt();
        const varName = rag?.injectionVariableName || 'ss_rag_memory';
        globalThis.SillyTavern?.getContext()?.variables?.local?.set(varName, text || '');
    } else {
        if (typeof setExtensionPrompt !== 'function') return;
        setExtensionPrompt(EXTENSION_PROMPT_TAG_SS, text || '', Number(rag?.position) || 0, Number(rag?.depth) || 0);
    }
}

/**
 * Clear Summary Sharder RAG prompt injection (both extension prompt and variable).
 * @param {Object} [rag]
 */
export function clearRagPromptInjection(rag) {
    clearExtensionPrompt();
    if (rag?.injectionMode === 'variable') {
        const varName = rag?.injectionVariableName || 'ss_rag_memory';
        globalThis.SillyTavern?.getContext()?.variables?.local?.set(varName, '');
    }
}

/**
 * Generate interceptor entrypoint.
 * @param {Array<Object>} chat
 * @param {number} contextSize
 * @param {AbortSignal|Object|null} abort
 * @param {string} type
 * @returns {Promise<Array<Object>>}
 */
export async function rearrangeChat(chat, contextSize, abort, type) {
    try {
        const settings = extension_settings?.summary_sharder;
        const rag = getActiveRagSettings(settings);
        const isSharder = settings?.sharderMode === true;

        if (type === 'quiet' || !rag?.enabled) {
            clearRagPromptInjection(rag);
            lastInjectionData = null;
            return chat;
        }

        if (abort?.aborted) {
            return chat;
        }

        const queryText = buildQueryText(chat, rag.queryCount);
        if (!queryText) {
            clearRagPromptInjection(rag);
            lastInjectionData = null;
            return chat;
        }

        const wantsHybrid = rag.scoringMethod === 'hybrid';
        const useNativeHybrid = wantsHybrid && (rag.backend === 'qdrant' || rag.backend === 'milvus');
        const useClientHybrid = wantsHybrid && !useNativeHybrid;

        const overfetchMultiplier = Math.max(1, Number(rag.hybridOverfetchMultiplier) || 4);
        const topK = Math.max(1, (Number(rag.insertCount) || 5) * (wantsHybrid ? overfetchMultiplier : 4));
        const threshold = Math.max(0, Math.min(1, Number(rag.scoreThreshold) || 0.25));

        // Multi-collection: query all bound collections in parallel, deduplicate results.
        // writeTargetCollectionId is used for continuity-style fallback fetches
        // (superseding/rolling/anchors/latest), which must stay scoped to this chat.
        const collectionIds = getActiveCollectionIds(null, settings);
        const writeTargetCollectionId = getWriteTargetCollectionId(null, settings);
        const origin = {
            ...getCurrentRetrievalOrigin(settings),
            collectionId: writeTargetCollectionId,
        };

        const queryFn = useNativeHybrid ? hybridQuery : queryChunks;

        const querySettled = await Promise.allSettled(
            collectionIds.map(id => queryFn(id, queryText, topK, threshold, rag))
        );
        const shardResults = querySettled.flatMap(r =>
            r.status === 'fulfilled' && Array.isArray(r.value?.results) ? r.value.results : []
        );

        if (collectionIds.length > 1) {
            ragLog.debug(`Multi-collection retrieval: queried ${collectionIds.length} collections, got ${shardResults.length} raw results`);
        }

        let merged = dedupeResults(shardResults);

        // Fallback: If non-sharder mode, ensure the latest N summaries are included
        // to prevent recent context from being lost if it doesn't match query keywords.
        // Uses primary collection only — "latest" is scoped to this chat's own output.
        if (!isSharder) {
            try {
                const { items: latestItems } = await listChunks(writeTargetCollectionId, rag, {
                    limit: Math.max(1, Number(rag.insertCount) || 5),
                    metadataFilter: buildScopedMetadataFilter(origin),
                });
                if (Array.isArray(latestItems) && latestItems.length > 0) {
                    // Sort by endIndex descending to get truly latest
                    const filteredLatestItems = filterResultsForOrigin(latestItems, origin);
                    filteredLatestItems.sort((a, b) => getFreshnessEndIndex(b) - getFreshnessEndIndex(a));
                    merged = dedupeResults([...merged, ...filteredLatestItems]);
                }
            } catch (error) {
                ragLog.warn('Standard mode latest-fallback fetch failed:', error?.message || error);
            }
        }

        if (useClientHybrid) {
            merged = runClientHybridFusion(merged, queryText, rag);
            merged = keywordBoost(merged, queryText);
        } else if (!wantsHybrid) {
            merged = scoreAndRank(merged, queryText, settings);
        } else {
            merged = keywordBoost(merged, queryText);
        }

        merged = applyImportanceBoost(merged);
        merged = merged.filter(item => (Number(item?.score) || 0) >= threshold);

        // Scene expansion only applies to Sharder Mode (which has [S{n}:{n}] scene codes).
        // Uses the primary collection — scene codes are specific to this chat's own summaries.
        const sceneExpanded = isSharder ? await expandByScene(settings, shardResults, writeTargetCollectionId, origin) : [];

        merged = dedupeResults([...merged, ...sceneExpanded]);

        // Fallback: If no superseding chunk was found by the initial query, fetch the latest one explicitly.
        // This ensures the "Current State" summary is always available if it exists in the collection.
        // Uses primary collection only — superseding chunks are chat-specific.
        if (isSharder && !merged.some(item => item?.metadata?.chunkBehavior === 'superseding')) {
            const latest = await fetchLatestSuperseding(writeTargetCollectionId, rag, origin);
            if (latest) {
                merged.push(latest);
                merged = dedupeResults(merged);
            }
        }

        const queryRolling = isSharder ? dedupeLatestRolling(merged) : [];
        const queryAnchors = isSharder ? collectLatestAnchors(merged) : [];
        const queryDevelopments = isSharder ? collectLatestDevelopments(merged) : [];
        let rollingPinned = [];
        let rollingPinnedCompacted = [];
        let anchorsPinned = [];
        let anchorsPinnedCompacted = [];
        let developmentsPinned = [];
        let developmentsPinnedCompacted = [];
        let rollingFallbackFetched = 0;
        let rollingFallbackHasMore = false;
        let anchorsFallbackFetched = 0;
        let anchorsFallbackHasMore = false;
        let developmentsFallbackFetched = 0;
        let developmentsFallbackHasMore = false;
        if (isSharder) {
            // Fallback fetches use primary collection — rolling/anchors/developments
            // are generated by this chat's own summarization pipeline.
            const [fallbackRolling, fallbackAnchors, fallbackDevelopments] = await Promise.all([
                fetchLatestRolling(writeTargetCollectionId, rag, 50, origin),
                fetchLatestAnchors(writeTargetCollectionId, rag, 50, origin),
                fetchLatestDevelopments(writeTargetCollectionId, rag, 50, origin),
            ]);

            rollingPinned = mergeLatestRolling(queryRolling, fallbackRolling.items);
            rollingPinnedCompacted = compactRollingPinnedChunks(rollingPinned, rag);
            rollingFallbackFetched = fallbackRolling.fetchedCount;
            rollingFallbackHasMore = fallbackRolling.hasMore;

            anchorsPinned = mergeLatestAnchors(queryAnchors, fallbackAnchors.items);
            anchorsPinnedCompacted = compactAnchorsPinnedChunks(anchorsPinned, rag);
            anchorsFallbackFetched = fallbackAnchors.fetchedCount;
            anchorsFallbackHasMore = fallbackAnchors.hasMore;

            developmentsPinned = mergeLatestDevelopments(queryDevelopments, fallbackDevelopments.items);
            developmentsPinnedCompacted = compactDevelopmentsPinnedChunks(developmentsPinned);
            developmentsFallbackFetched = fallbackDevelopments.fetchedCount;
            developmentsFallbackHasMore = fallbackDevelopments.hasMore;
        }

        merged = dedupeAgainstRecentContext(merged, chat, rag.protectCount);

        const rerankMeta = await applyReranker(merged, queryText, rag);
        merged = rerankMeta.results;

        const rerankerApplied = !!rerankMeta.metadata?.applied;

        // Capping per shard (Standard mode only for now, sharder has its own section-based capping)
        if (!isSharder && rag.maxChunksPerShard) {
            merged = rerankerApplied
                ? capChunksPerShardPreserveOrder(merged, rag.maxChunksPerShard)
                : capChunksPerShard(merged, rag.maxChunksPerShard);
        }

        if (!rerankerApplied) {
            merged.sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));
        }

        // Always prioritize the latest superseding chunk to ensure it's not sliced out by the reranker/limit.
        const superseding = merged.filter(item => item?.metadata?.chunkBehavior === 'superseding');
        const others = merged.filter(item => item?.metadata?.chunkBehavior !== 'superseding');
        const insertCount = Math.max(1, Number(rag.insertCount) || 5);

        // Two-tier slicing for Standard mode: Recent + Relevant
        if (!isSharder) {
            const recentCount = Math.min(insertCount, Number(rag.recentSummaryCount) || 0);
            if (recentCount > 0) {
                // Find potential recent summaries (highest endIndex)
                const candidates = [...merged].sort((a, b) => getFreshnessEndIndex(b) - getFreshnessEndIndex(a));
                const recent = candidates.slice(0, recentCount);
                const recentHashes = new Set(recent.map(r => r.hash || r.text));
                
                // Fill remaining slots with the best remaining relevance results
                const remainingCount = insertCount - recent.length;
                const relevant = merged.filter(m => !recentHashes.has(m.hash || m.text)).slice(0, remainingCount);
                
                merged = [...recent, ...relevant];
            } else {
                merged = [...superseding, ...others].slice(0, insertCount);
            }
        } else {
            merged = [...superseding, ...others].slice(0, insertCount);
        }

        // Final sorting: Scene grouping for Sharder, Chronological for Standard
        merged = isSharder ? orderWithSceneGrouping(merged) : merged.sort(compareChronologically);

        if (isSharder && (rollingPinnedCompacted.length > 0 || anchorsPinnedCompacted.length > 0 || developmentsPinnedCompacted.length > 0)) {
            let mergedShaped = merged;
            if (rollingPinnedCompacted.length > 0) {
                mergedShaped = mergedShaped.filter(item => item?.metadata?.chunkBehavior !== 'rolling');
            }
            if (anchorsPinnedCompacted.length > 0) {
                mergedShaped = stripAnchorsFromCumulativeResults(mergedShaped);
            }
            if (developmentsPinnedCompacted.length > 0) {
                mergedShaped = stripDevelopmentsFromCumulativeResults(mergedShaped);
            }
            merged = dedupeResults([...mergedShaped, ...rollingPinnedCompacted, ...anchorsPinnedCompacted, ...developmentsPinnedCompacted]);
        }

        const injection = formatInjectionText(rag.template, merged);
        applyInjection(injection, rag);

        lastInjectionData = {
            timestamp: Date.now(),
            entries: merged.map(item => ({
                text: item?.text || '',
                score: item?.score ?? null,
                metadata: item?.metadata || {},
                hash: item?.hash || '',
            })),
            injectionMode: rag.injectionMode ?? 'extension_prompt',
            position: rag.injectionMode === 'variable' ? null : (Number(rag.position) || 0),
            depth: rag.injectionMode === 'variable' ? null : (Number(rag.depth) || 0),
            variableName: rag.injectionMode === 'variable' ? (rag.injectionVariableName || 'ss_rag_memory') : null,
            template: rag.template || 'Recalled memories:\n{{text}}',
            injectionText: injection,
            scoringMethod: rag.scoringMethod || 'keyword',
            backend: rag.backend,
            rerankerApplied: !!rerankMeta.metadata?.applied,
            rerankerMode: rerankMeta.metadata?.mode || 'none',
            mode: isSharder ? 'sharder' : 'standard',
        };

        ragLog.log(`Retrieval: ${merged.length} results (${shardResults.length} queried across ${collectionIds.length} collection(s), reranker=${!!rerankMeta.metadata?.applied})`);
        ragLog.debug('Retrieval details', {
            mode: isSharder ? 'sharder' : 'standard',
            backend: rag.backend,
            useNativeHybrid,
            useClientHybrid,
            collectionIds,
            writeTargetCollectionId,
            shardResults: shardResults.length,
            sceneExpanded: sceneExpanded.length,
            rollingPinned: rollingPinned.length,
            rollingPinnedCompacted: rollingPinnedCompacted.length,
            rollingFallbackFetched,
            rollingFallbackHasMore,
            anchorsPinned: anchorsPinned.length,
            anchorsPinnedCompacted: anchorsPinnedCompacted.length,
            anchorsFallbackFetched,
            anchorsFallbackHasMore,
            developmentsPinned: developmentsPinned.length,
            developmentsPinnedCompacted: developmentsPinnedCompacted.length,
            developmentsFallbackFetched,
            developmentsFallbackHasMore,
            rerankerApplied: !!rerankMeta.metadata?.applied,
            rerankerMode: rerankMeta.metadata?.mode || 'none',
            finalResults: merged.length,
        });
    } catch (error) {
        ragLog.warn('Retrieval failed:', error?.message || error);
        clearExtensionPrompt();
    }

    return chat;
}
