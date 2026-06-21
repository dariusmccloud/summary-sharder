/**
 * Analyze LLM-pruned content for sharder by comparing selected input shards
 * against sharder output sections.
 *
 * Follows the same self-contained pattern as the consolidation analyzer:
 * accepts raw text, parses internally, uses fixed section mappings.
 */

import {
    getSharderContentSections,
    parseExtractionResponse,
    isConsolidatedShard,
} from '../summarization/sharder-pipeline.js';
import {
    parseConsolidatedShard,
    fuzzyMatch,
    isEmptyItem,
} from '../summarization/shard-utils.js';
import { log } from '../logger.js';

/**
 * Maps consolidated-shard section keys to extraction-format section keys.
 * Used when an input shard is a consolidation (different header names).
 */
const CONSOLIDATION_TO_EXTRACTION_KEY = {
    tone: 'tone',
    characters: 'characterNotes',
    world: 'worldState',
    timeline: 'sceneBreaks',
    events: 'events',
    states: 'characterStates',
    relationships: 'relationshipShifts',
    developments: 'developments',
    nsfwRegistry: 'nsfwContent',
    dialogueKeys: 'keyDialogue',
    callbacks: 'callbacks',
    looseThreads: 'looseThreads',
    scenesExpanded: 'scenes',
    currentState: 'currentState',
};

/** Section display metadata keyed by extraction key */
const SECTION_META = {};
for (const s of getSharderContentSections()) {
    SECTION_META[s.key] = { key: s.key, name: s.name, emoji: s.emoji };
}

function getSectionMeta(key) {
    return SECTION_META[key] || { key, name: String(key || 'UNKNOWN').toUpperCase(), emoji: '📋' };
}

/**
 * Parse a shard's raw text into sections internally, dispatching to the
 * correct parser based on shard type.  This mirrors `parseInputSections`
 * in the consolidation analyzer — the key difference that eliminates the
 * data-handoff failure point.
 */
function parseShardContent(content, type) {
    if (!content) return {};
    // Detect actual content format rather than relying on header line.
    // sharder saves shards with a MEMORY SHARD header but uses
    // extraction-style ### emoji headers — routing those to parseConsolidatedShard
    // (which expects [BRACKET] headers) returns empty sections.
    const hasExtractionHeaders = /^###\s*\S/m.test(content);
    if (hasExtractionHeaders) {
        return parseExtractionResponse(content);
    }
    if (type === 'consolidation' || isConsolidatedShard(content)) {
        return parseConsolidatedShard(content);
    }
    return parseExtractionResponse(content);
}

/**
 * Extract a human-readable identifier from shard text (fallback to provided identifier).
 */
function resolveIdentifier(content, fallback) {
    if (fallback !== null && fallback !== undefined) {
        const normalizedFallback = String(fallback).trim();
        if (normalizedFallback) return normalizedFallback;
    }
    const memoryShardMatch = (content || '').match(/# (?:MEMORY SHARD|CONSOLIDATED MEMORY SHARD):\s*([^\n]+)/);
    if (memoryShardMatch) return memoryShardMatch[1].trim();
    const extractionMatch = (content || '').match(/# EXTRACTION:\s*([^\n]+)/);
    if (extractionMatch) return extractionMatch[1].trim();
    return 'Selected Shard';
}

/**
 * Normalize a parsed section key to extraction-format key.
 * Consolidated shards use different header names that need mapping.
 */
function normalizeKey(sectionKey, isConsolidation) {
    if (isConsolidation) {
        return CONSOLIDATION_TO_EXTRACTION_KEY[sectionKey] || null;
    }
    return sectionKey;
}

/**
 * Analyze LLM-pruned content for sharder.
 *
 * @param {Array<{content:string, type:string, identifier:string}>} selectedShards
 *   Raw shard data — `content` is the full text, `type` is 'extraction' or 'consolidation'.
 * @param {Object} outputSections
 *   Parsed sections from the sharder pipeline (extraction format, keyed by narrative registry section keys).
 * @returns {{totalPruned:number, sections:Array, sectionOverview:Array}}
 */
export function analyzeSinglePassPruning(selectedShards, outputSections) {
    const report = {
        totalPruned: 0,
        sections: [],
        sectionOverview: [],
    };

    if (!Array.isArray(selectedShards) || selectedShards.length === 0 || !outputSections) {
        log.debug('sharder pruning: no shards or output to compare');
        return report;
    }

    log.debug(`sharder pruning: analyzing ${selectedShards.length} shard(s)`);

    // --- Phase 1: Parse all input shards internally and bucket items by extraction key ---
    const inputBySection = new Map();

    for (const shard of selectedShards) {
        const rawContent = shard?.content || '';
        const shardType = shard?.type === 'consolidation' ? 'consolidation' : 'extraction';
        const isConsolidation = shardType === 'consolidation';
        const identifier = resolveIdentifier(rawContent, shard?.identifier);

        // Parse internally — the critical difference from the old approach
        const parsed = parseShardContent(rawContent, shardType);

        if (!parsed || typeof parsed !== 'object') {
            log.debug(`sharder pruning: parser returned nothing for "${identifier}"`);
            continue;
        }

        const sectionEntries = Object.entries(parsed);
        let shardItemCount = 0;

        for (const [rawKey, items] of sectionEntries) {
            const outputKey = normalizeKey(rawKey, isConsolidation);
            if (!outputKey || !Array.isArray(items) || items.length === 0) continue;

            if (!inputBySection.has(outputKey)) {
                inputBySection.set(outputKey, []);
            }

            const bucket = inputBySection.get(outputKey);
            for (const item of items) {
                const content = String(item?.content || '').trim();
                if (!content || isEmptyItem(content)) continue;
                bucket.push({
                    content,
                    source: identifier,
                    sceneCodes: Array.isArray(item?.sceneCodes) ? item.sceneCodes : [],
                });
                shardItemCount++;
            }
        }

        log.debug(`sharder pruning: "${identifier}" (${shardType}) ? ${shardItemCount} items`);

    }

    // --- Phase 2: Compare each section's input items against output items ---
    for (const [sectionKey, inputItems] of inputBySection.entries()) {
        if (!Array.isArray(inputItems) || inputItems.length === 0) continue;

        const outputItems = (Array.isArray(outputSections?.[sectionKey]) ? outputSections[sectionKey] : [])
            .map((item) => String(item?.content || '').trim())
            .filter((content) => content && !isEmptyItem(content));

        const meta = getSectionMeta(sectionKey);

        // Always add to section overview
        const overviewEntry = {
            key: sectionKey,
            emoji: meta.emoji,
            displayName: meta.name,
            inputCount: inputItems.length,
            outputCount: outputItems.length,
            prunedCount: 0,
        };
        report.sectionOverview.push(overviewEntry);

        // Find pruned items
        const prunedItems = [];
        for (const inputItem of inputItems) {
            const found = outputItems.some((outputContent) => fuzzyMatch(inputItem.content, outputContent, 0.5));
            if (!found) {
                prunedItems.push({
                    content: inputItem.content,
                    source: inputItem.source,
                    sceneCodes: inputItem.sceneCodes,
                    approved: false,
                    rescued: false,
                });
            }
        }

        overviewEntry.prunedCount = prunedItems.length;

        log.debug(
            `sharder pruning: [${sectionKey}] input=${inputItems.length} output=${outputItems.length} pruned=${prunedItems.length}`
        );

        if (prunedItems.length > 0) {
            report.sections.push({
                key: sectionKey,
                name: meta.name,
                emoji: meta.emoji,
                inputCount: inputItems.length,
                outputCount: outputItems.length,
                prunedCount: prunedItems.length,
                prunedItems,
            });
            report.totalPruned += prunedItems.length;
        }
    }

    log.debug(`sharder pruning: total pruned = ${report.totalPruned}`);

    return report;
}


