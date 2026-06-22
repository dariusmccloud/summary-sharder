/**
 * Sharder shard selection modal
 * Lets user optionally select existing extractions/shards to merge into sharder input.
 */

import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../../popup.js';
import { escapeHtml } from '../../common/ui-utils.js';
import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
    findSavedExtractions,
    parseExtractionResponse,
} from '../../../core/summarization/sharder-pipeline.js';
import { parseConsolidatedShard } from '../../../core/summarization/shard-utils.js';
import { isSavedShardCompatibleWithProfile } from '../../../core/summarization/saved-shard-identity.js';
import { log } from '../../../core/logger.js';

function sortByRangeDesc(items) {
    return [...items].sort((a, b) => {
        const av = Number.isFinite(a?.messageRangeStart) ? a.messageRangeStart : -1;
        const bv = Number.isFinite(b?.messageRangeStart) ? b.messageRangeStart : -1;
        return bv - av;
    });
}

function buildRow(item, index) {
    const typeLabel = item.type === 'consolidation' ? 'Shard' : 'Extraction';
    const typeClass = item.type === 'consolidation' ? 'ss-badge-shard' : 'ss-badge-extraction';
    const sourceLabel = item.source === 'lorebook' ? 'Lorebook' : 'System Message';
    const preview = String(item.preview || '').trim();

    return `
        <div class="ss-shard-select-row" data-row-index="${index}">
            <label class="checkbox_label" style="display:flex; align-items:flex-start; gap:10px; width:100%;">
                <input type="checkbox" class="ss-shard-select-checkbox" data-index="${index}" />
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:4px;">
                        <span class="ss-pill ${typeClass}">${escapeHtml(typeLabel)}</span>
                        <strong>${escapeHtml(item.identifier || `Item ${index + 1}`)}</strong>
                        <span class="ss-hint">${escapeHtml(sourceLabel)}</span>
                    </div>
                    <div class="ss-hint" style="font-size:12px; line-height:1.35;">${escapeHtml(preview || '(No preview)')}</div>
                </div>
            </label>
        </div>
    `;
}

function getActiveProfile(settings) {
    return settings?.sharderProfile === ARCHITECTURAL_PROFILE ? ARCHITECTURAL_PROFILE : NARRATIVE_PROFILE;
}

function parseSelectedShards(selectedItems, settings) {
    const parsed = [];
    let skipped = 0;
    const activeProfile = getActiveProfile(settings);

    for (const item of selectedItems) {
        try {
            if (!isSavedShardCompatibleWithProfile(item, activeProfile)) {
                skipped++;
                continue;
            }

            const rawContent = item.parsedBody || item.content || '';
            let parsedSections;

            if (item.shardProfile === ARCHITECTURAL_PROFILE) {
                parsedSections = parseExtractionResponse(rawContent, { profile: ARCHITECTURAL_PROFILE });
            } else if (item.contentFormat === 'legacy-bracket') {
                parsedSections = parseConsolidatedShard(rawContent);
            } else {
                parsedSections = parseExtractionResponse(rawContent, { profile: NARRATIVE_PROFILE });
            }

            if (!parsedSections || typeof parsedSections !== 'object') {
                throw new Error('Parser returned invalid result');
            }

            parsed.push({
                content: item.content,
                type: item.type,
                identifier: item.identifier,
                parsedSections,
                messageRangeStart: item.messageRangeStart,
            });
        } catch (error) {
            skipped++;
            log.warn('Failed to parse selected shard for sharder. Skipping item:', {
                identifier: item?.identifier,
                type: item?.type,
                error,
            });
        }
    }

    if (skipped > 0 && typeof toastr !== 'undefined') {
        toastr.warning(`${skipped} selected shard(s) could not be parsed and were skipped`);
    }

    return parsed;
}

function updateCount(total) {
    const selected = document.querySelectorAll('.ss-shard-select-checkbox:checked').length;
    const countEl = document.getElementById('ss-shard-select-count');
    if (countEl) {
        countEl.textContent = `${selected} of ${total} selected`;
    }
}

/**
 * @param {Object} settings
 * @returns {Promise<{confirmed:boolean, selectedShards:Array}>}
 */
export async function openShardSelectionModal(settings) {
    // In RAG mode, the vector store retrieves and assembles relevant chunks from all
    // shards automatically. Consolidating shards first collapses section-level
    // embeddings into a single blob, losing the granularity the pipeline depends on.
    if (settings?.sharderMode === true && settings?.rag?.enabled === true) {
        return { confirmed: true, selectedShards: [] };
    }

    // Force lorebook scan for sharder shard selection regardless of output mode.
    const activeProfile = getActiveProfile(settings);
    const discoveredItems = sortByRangeDesc(await findSavedExtractions(settings, settings?.lorebookSelection || null));
    const allItems = discoveredItems.filter((item) => isSavedShardCompatibleWithProfile(item, activeProfile));
    const excludedCount = discoveredItems.length - allItems.length;

    if (excludedCount > 0 && typeof toastr !== 'undefined') {
        const label = activeProfile === ARCHITECTURAL_PROFILE ? 'Architectural' : 'Narrative';
        toastr.info(`${excludedCount} incompatible saved shard(s) were excluded from ${label} baseline selection.`);
    }

    if (!allItems.length) {
        return { confirmed: true, selectedShards: [] };
    }

    if (settings?.autoIncludeShards === true) {
        return {
            confirmed: true,
            selectedShards: parseSelectedShards(allItems, settings),
        };
    }

    const listHtml = allItems.map((item, index) => buildRow(item, index)).join('');

    const modalHtml = `
        <div class="ss-consolidation-modal">
            <div class="ss-consolidation-header">
                <h3>Sharder: Optional Existing Shards</h3>
                <p>Select any extractions/shards to merge as baseline context. Leave empty to extract from scratch.</p>
                <p id="ss-shard-select-count">0 of ${allItems.length} selected</p>
            </div>

            <div class="ss-consolidation-controls">
                <input id="ss-shard-select-all" type="button" class="menu_button" value="Select All" />
                <input id="ss-shard-select-none" type="button" class="menu_button" value="Select None" />
            </div>

            <div id="ss-shard-select-list" class="ss-extraction-list">
                ${listHtml}
            </div>
        </div>
    `;

    let capturedIndices = [];

    const popup = new Popup(
        modalHtml,
        POPUP_TYPE.TEXT,
        null,
        {
            okButton: 'Continue Sharder',
            cancelButton: 'Cancel',
            wide: true,
            large: true,
            onClosing: () => {
                capturedIndices = Array.from(document.querySelectorAll('.ss-shard-select-checkbox:checked'))
                    .map((cb) => parseInt(cb.dataset.index, 10))
                    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < allItems.length);
                return true;
            },
        }
    );

    const showPromise = popup.show();

    setTimeout(() => {
        const checkboxes = Array.from(document.querySelectorAll('.ss-shard-select-checkbox'));
        checkboxes.forEach((cb) => {
            cb.addEventListener('change', () => updateCount(allItems.length));
        });

        document.getElementById('ss-shard-select-all')?.addEventListener('click', () => {
            checkboxes.forEach((cb) => { cb.checked = true; });
            updateCount(allItems.length);
        });

        document.getElementById('ss-shard-select-none')?.addEventListener('click', () => {
            checkboxes.forEach((cb) => { cb.checked = false; });
            updateCount(allItems.length);
        });

        updateCount(allItems.length);
    }, 80);

    const result = await showPromise;
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { confirmed: false, selectedShards: [] };
    }

    const selectedItems = capturedIndices.map((idx) => allItems[idx]);

    return {
        confirmed: true,
        selectedShards: parseSelectedShards(selectedItems, settings),
    };
}
