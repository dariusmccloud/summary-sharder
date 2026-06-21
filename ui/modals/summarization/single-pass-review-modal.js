/**
 * Sharder Review Modal
 * Consolidation-style sectioned review for sharder output.
 */

import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../../popup.js';
import { escapeHtml } from '../../common/ui-utils.js';
import { archiveToWarm } from '../../../core/rag/archive.js';
import { log } from '../../../core/logger.js';
import {
    getSharderContentSections,
    getSharderSectionRegistry,
    parseExtractionResponse,
    reconstructExtraction,
    parseSceneCodes,
    EVENT_WEIGHTS,
} from '../../../core/summarization/sharder-pipeline.js';

function sectionTitle(section) {
    return section.key === 'currentState' ? 'CURRENT (as of end of extract)' : section.name;
}

function reviewSections(stateOrRegistry = null) {
    const registry = stateOrRegistry?.sectionRegistry || stateOrRegistry;
    return getSharderContentSections(registry);
}

function normalizeSceneCodes(sceneCodes) {
    if (!Array.isArray(sceneCodes)) return [];
    const seen = new Set();
    const out = [];

    for (const raw of sceneCodes) {
        const code = typeof raw === 'string' ? raw : raw?.code;
        const normalized = String(code || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }

    return out;
}

function inferRangeFromSceneCodes(sceneCodes, fallbackStart = 0, fallbackEnd = null) {
    const starts = [];
    const regex = /[\[(]S(\d+):\d+[\])]/;

    for (const code of normalizeSceneCodes(sceneCodes)) {
        const match = regex.exec(code);
        if (!match) continue;
        starts.push(parseInt(match[1], 10));
    }

    if (starts.length === 0) {
        const start = Number.isFinite(fallbackStart) ? fallbackStart : 0;
        const end = Number.isFinite(fallbackEnd) ? fallbackEnd : start;
        return { startIndex: start, endIndex: end };
    }

    starts.sort((a, b) => a - b);
    return {
        startIndex: starts[0],
        endIndex: starts[starts.length - 1]
    };
}

function splitSceneContentToItems(content) {
    const text = String(content || '').trim();
    if (!text) return [];

    const lines = text.split('\n');
    const chunks = [];
    let current = [];

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const isSceneStart = /^\(?\[?S\d+:\d+\]?\)?\s*/i.test(line);

        if (isSceneStart && current.length > 0) {
            chunks.push(current.join('\n').trim());
            current = [line];
            continue;
        }

        if (!line && current.length === 0) continue;
        current.push(line);
    }

    if (current.length > 0) {
        chunks.push(current.join('\n').trim());
    }

    return chunks.filter(Boolean);
}

function normalizeSectionItems(sections, registry = null) {
    const normalized = {};
    reviewSections(registry).forEach((section) => {
        const raw = Array.isArray(sections?.[section.key]) ? sections[section.key] : [];

        const expanded = section.key === 'scenes'
            ? raw.flatMap((item) => {
                const parts = splitSceneContentToItems(item?.content || '');
                if (!parts.length) return [item];
                return parts.map((content) => ({
                    ...item,
                    content,
                }));
            })
            : raw;

        normalized[section.key] = expanded.map((item, idx) => ({
            id: `${section.key}:${idx}:${Math.random().toString(36).slice(2, 8)}`,
            content: item?.content || '',
            sceneCodes: parseSceneCodes(item?.content || ''),
            archived: false,
            selected: true,
            weight: item?.weight ?? 3,
        }));
    });
    return normalized;
}

function sectionCount(items) {
    const selected = items.filter(i => i.selected !== false).length;
    return { selected, total: items.length };
}

function rebuildOutput(state) {
    const sections = {};
    reviewSections(state).forEach((section) => {
        sections[section.key] = (state.editableSections[section.key] || [])
            .map(item => ({
                content: item.content,
                selected: item.selected !== false,
                weight: item.weight,
            }));
    });

    return reconstructExtraction(sections, {
        ...(state.metadata || {}),
        sectionRegistry: state.sectionRegistry,
    });
}

function applyRescues(output, rescuedItems) {
    if (!Array.isArray(rescuedItems) || rescuedItems.length === 0) {
        return output;
    }

    const lines = rescuedItems
        .map((item) => String(item?.content || '').trim())
        .filter(Boolean)
        .map((text) => `- ${text}`);

    if (!lines.length) {
        return output;
    }

    return `${(output || '').trimEnd()}\n\n[RESCUED_ITEMS]\n${lines.join('\n')}`;
}

function diagnosticsHtml(diagnostics) {
    if (!diagnostics?.length) {
        return '<div class="ss-sp-diag-empty">No diagnostics. Output looks structurally clean.</div>';
    }

    return diagnostics.map((d) => `
        <div class="ss-sp-diag ss-level-${escapeHtml(d.level)}">
            <div class="ss-sp-diag-head">
                <span class="ss-sp-diag-level">${escapeHtml((d.level || 'info').toUpperCase())}</span>
                <span class="ss-sp-diag-code">${escapeHtml(d.code || 'UNSPECIFIED')}</span>
            </div>
            <div class="ss-sp-diag-msg">${escapeHtml(d.message || '')}</div>
        </div>
    `).join('');
}

function weightSelectorHtml(item) {
    const buttons = EVENT_WEIGHTS.map(w => `
        <span class="ss-weight-btn ${item.weight === w.value ? 'selected' : ''}"
              data-weight="${w.value}"
              title="${escapeHtml(w.name)}">${w.emoji}</span>
    `).join('');
    return `<div class="ss-sharder-weight-selector" data-item-id="${escapeHtml(item.id)}">${buttons}</div>`;
}

function sectionRows(state, sectionKey, items) {
    if (!items.length) {
        return '<p class="ss-empty">No items in this section.</p>';
    }

    return items.map((item) => {
        const isSelected = item.selected !== false;
        const codes = (item.sceneCodes || [])
            .map((c) => {
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object' && typeof c.code === 'string') return c.code;
                return '';
            })
            .filter(Boolean)
            .map((code) => `<span class="ss-scene-badge">${escapeHtml(code)}</span>`)
            .join(' ');

        const weightHtml = sectionKey === 'events'
            ? `<div class="ss-sp-weight-row">${weightSelectorHtml(item)}</div>`
            : '';

        return `
            <div class="ss-cr-item-row ${isSelected ? 'is-selected' : 'is-unselected'}" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(item.id)}">
                <div class="ss-cr-item-top">
                    <div class="ss-cr-item-select">
                        <input type="checkbox" class="ss-sp-item-checkbox"
                               data-section-key="${escapeHtml(sectionKey)}"
                               data-item-id="${escapeHtml(item.id)}"
                               ${isSelected ? 'checked' : ''} />
                    </div>
                    <div class="ss-cr-item-meta">
                        <div class="ss-cr-scene-codes">${codes || '<span class="ss-hint">No scene tags</span>'}</div>
                        <button class="ss-cr-item-prune menu_button" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(item.id)}">Prune</button>
                        <button class="ss-cr-item-archive menu_button ${item.archived ? 'ss-cr-item-archived' : ''}"
                                data-section-key="${escapeHtml(sectionKey)}"
                                data-item-id="${escapeHtml(item.id)}"
                                ${(!state.ragEnabled || item.archived) ? 'disabled' : ''}
                                ${!state.ragEnabled ? 'title="Enable RAG to use warm archive"' : ''}>
                            ${item.archived ? 'Archived ✓' : 'Archive'}
                        </button>
                    </div>
                </div>
                <textarea class="ss-cr-item-editor text_pole" rows="2" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(item.id)}">${escapeHtml(item.content || '')}</textarea>
                ${weightHtml}
            </div>
        `;
    }).join('');
}

function sectionsHtml(state) {
    return reviewSections(state).map((section) => {
        const items = state.editableSections[section.key] || [];
        const { selected, total } = sectionCount(items);
        return `
            <div class="ss-review-accordion" data-section="sp-${escapeHtml(section.key)}">
                <div class="ss-accordion-header">
                    <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                    <span class="ss-accordion-emoji">${section.emoji}</span>
                    <span class="ss-accordion-title">${escapeHtml(sectionTitle(section))}</span>
                    <span class="ss-accordion-count" data-ss-count-key="${escapeHtml(section.key)}">(${selected}/${total})</span>
                </div>
                <div class="ss-accordion-content" style="display:none;">
                    <div class="ss-sp-section-actions" style="margin-bottom:8px;">
                        <button class="menu_button ss-sp-exclude-all" data-section-key="${escapeHtml(section.key)}">Prune All</button>
                        <button class="menu_button ss-sp-select-all" data-section-key="${escapeHtml(section.key)}">Select All</button>
                        <button class="menu_button ss-sp-deselect-all" data-section-key="${escapeHtml(section.key)}">Deselect All</button>
                    </div>
                    <div class="ss-cr-items" data-section-key="${escapeHtml(section.key)}">
                        ${sectionRows(state, section.key, items)}
                    </div>
                    <button class="menu_button ss-sp-add-item" data-section-key="${escapeHtml(section.key)}" style="margin-top:6px;">+ Add Item</button>
                </div>
            </div>
        `;
    }).join('');
}

function ensurePruningReport(state) {
    if (!state.pruningReport) {
        state.pruningReport = {
            totalPruned: 0,
            sections: [],
        };
    }
}

function getPruneMetaForSectionKey(sectionKey, state = null) {
    const section = reviewSections(state).find((s) => s.key === sectionKey);
    return {
        key: sectionKey,
        name: section?.name || String(sectionKey || 'UNKNOWN').toUpperCase(),
        emoji: section?.emoji || '📋',
    };
}

function buildPruningSection(report) {
    const hasSections = report?.sections?.length > 0;
    const uncoveredMessages = report?.uncoveredMessages || [];
    const hasUncovered = uncoveredMessages.length > 0;
    const hasContent = hasSections || hasUncovered;

    const shardGroups = !hasSections
        ? ''
        : report.sections.map((s) => {
            const groupName = String(s?.name ?? 'UNKNOWN').trim() || 'UNKNOWN';
            const groupEmoji = String(s?.emoji ?? '\u{1F4CB}').trim() || '📋';
            const items = (s.prunedItems || []).map((item, i) => `
                <div class="ss-pruning-item" data-section="${escapeHtml(groupName)}" data-index="${i}">
                    <div class="ss-pruning-content">${escapeHtml((item.content || '').substring(0, 120))}${(item.content || '').length > 120 ? '...' : ''}</div>
                    <div class="ss-pruning-source">From: ${escapeHtml(String(item?.source ?? '').trim())}</div>
                    <div class="ss-pruning-actions">
                        <label class="ss-approve-toggle">
                            <input type="checkbox" class="ss-approve-checkbox"
                                   data-type="pruning"
                                   data-section="${escapeHtml(groupName)}"
                                   data-index="${i}" />
                            <span>Archive</span>
                        </label>
                        <button class="ss-rescue-btn menu_button"
                                data-type="pruning"
                                data-section="${escapeHtml(groupName)}"
                                data-index="${i}"
                                data-content="${escapeHtml(item.content || '')}">
                            Rescue
                        </button>
                    </div>
                </div>
            `).join('');

            return `
                <div class="ss-pruning-group ss-sub-accordion" data-pruning-group="${escapeHtml(groupName)}">
                    <div class="ss-pruning-group-header">
                        <span class="ss-sub-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                        <span class="ss-pruning-group-title">${escapeHtml(groupEmoji)} ${escapeHtml(groupName)}</span>
                        <span class="ss-pruning-group-count">(${s.prunedCount || 0}/${s.inputCount || 0} pruned)</span>
                    </div>
                    <div class="ss-sub-accordion-content" style="display:none;">
                        <div class="ss-pruning-items">${items}</div>
                    </div>
                </div>
            `;
        }).join('');

    const uncoveredGroup = !hasUncovered
        ? ''
        : `
            <div class="ss-pruning-group ss-sub-accordion" data-pruning-group="Uncovered Messages">
                <div class="ss-pruning-group-header">
                    <span class="ss-sub-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                    <span class="ss-pruning-group-title">📭 Uncovered Messages</span>
                    <span class="ss-pruning-group-count">(${uncoveredMessages.length} messages)</span>
                </div>
                <div class="ss-sub-accordion-content" style="display:none;">
                    <div class="ss-pruning-items">
                        ${uncoveredMessages.map((msg, i) => `
                            <div class="ss-pruning-item ss-uncovered-message" data-section="uncovered" data-index="${i}">
                                <div class="ss-pruning-content"><strong>[Msg ${msg.msgIndex}] ${escapeHtml(msg.name)}:</strong> ${escapeHtml(msg.preview || '')}${(msg.preview || '').length >= 150 ? '...' : ''}</div>
                                <div class="ss-pruning-source">Coverage: ${Math.round((msg.coverageRatio || 0) * 100)}%</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

    return `
        <div class="ss-review-accordion" data-section="sp-pruning">
            <div class="ss-accordion-header">
                <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                <span class="ss-accordion-emoji">✂️</span>
                <span class="ss-accordion-title">Pruning Report</span>
                <span class="ss-accordion-count" id="ss-sp-pruning-count">(${report?.totalPruned || 0} items)</span>
            </div>
            <div class="ss-accordion-content" style="display:none;">
                ${hasContent ? shardGroups + uncoveredGroup : '<p class="ss-empty">No content was pruned</p>'}
            </div>
        </div>
    `;
}

function buildModalHtml(state) {
    const errors = state.diagnostics.filter((d) => d.level === 'error').length;
    const warnings = state.diagnostics.filter((d) => d.level === 'warning').length;
    const infos = state.diagnostics.filter((d) => d.level === 'info').length;

    return `
        <div class="ss-single-pass-review-modal">
            <div class="ss-sp-header">
                <h3>Sharder Review</h3>
                <p>Review section content before saving. Error-level diagnostics block save.</p>
                <div class="ss-sp-global-controls">
                    <button id="ss-sp-select-all-global" class="menu_button">Select All</button>
                    <button id="ss-sp-deselect-all-global" class="menu_button">Deselect All</button>
                    <button id="ss-sp-regenerate" class="menu_button">Regenerate</button>
                </div>
            </div>

            <div class="ss-sp-summary">
                <span class="ss-sp-pill ss-level-error">Errors: ${errors}</span>
                <span class="ss-sp-pill ss-level-warning">Warnings: ${warnings}</span>
                <span class="ss-sp-pill ss-level-info">Info: ${infos}</span>
            </div>

            <div class="ss-review-accordion" data-section="sp-diagnostics">
                <div class="ss-accordion-header">
                    <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                    <span class="ss-accordion-emoji">🩺</span>
                    <span class="ss-accordion-title">Diagnostics</span>
                    <span class="ss-accordion-count">(${state.diagnostics.length})</span>
                </div>
                <div class="ss-accordion-content" style="display:none;">
                    <div class="ss-sp-diagnostics">${diagnosticsHtml(state.diagnostics)}</div>
                </div>
            </div>

            <div class="ss-sp-sections-area">
                ${sectionsHtml(state)}
            </div>
            ${buildPruningSection(state.pruningReport)}

            <div class="ss-sp-panel" style="margin-top: 12px;">
                <div class="ss-output-header">
                    <span>Final Output Review</span>
                    <div class="ss-output-actions">
                        <button id="ss-sp-copy-output" class="menu_button">Copy</button>
                        <button id="ss-sp-edit-output" class="menu_button">Edit</button>
                    </div>
                </div>
                <textarea id="ss-sp-output-editor" class="text_pole ss-sp-output-editor" readonly>${escapeHtml(state.finalOutput || '')}</textarea>
            </div>

            ${state.pruningReport?.totalPruned > 0 ? `
            <div class="ss-archive-section">
                <h4>Archive Output</h4>
                <div class="ss-archive-options">
                    <label class="ss-archive-option ${state.ragEnabled ? '' : 'ss-disabled'}" ${state.ragEnabled ? '' : 'title="Enable RAG to use warm archive"'}>
                        <input type="checkbox" id="ss-sp-archive-warm" ${state.ragEnabled ? '' : 'disabled'} />
                        <span>Archive output to warm storage (RAG-retrievable)</span>
                    </label>
                    <label class="ss-archive-option">
                        <input type="checkbox" id="ss-sp-archive-cold" />
                        <span>Log output to cold archive</span>
                    </label>
                </div>
            </div>
            ` : ''}

            <div class="ss-sp-blocking-note" id="ss-sp-blocking-note" style="display:${errors > 0 ? 'block' : 'none'};">
                Save blocked: resolve or manually remove error-level issues.
            </div>
        </div>
    `;
}

function updateSectionCount(state, sectionKey) {
    const items = state.editableSections[sectionKey] || [];
    const { selected, total } = sectionCount(items);
    const el = document.querySelector(`[data-ss-count-key="${CSS.escape(sectionKey)}"]`);
    if (el) el.textContent = `(${selected}/${total})`;
}

function updateOutputEditor(state) {
    state.reconstructedOutput = rebuildOutput(state);
    const editor = document.getElementById('ss-sp-output-editor');
    if (editor) {
        editor.value = typeof state.outputOverride === 'string'
            ? state.outputOverride
            : state.reconstructedOutput;
    }
    state.finalOutput = editor?.value || state.reconstructedOutput;
}

function updatePruningHeaderCount(state) {
    const el = document.getElementById('ss-sp-pruning-count');
    if (el) {
        el.textContent = `(${state.pruningReport?.totalPruned || 0} items)`;
    }
}

function attachPruningGroupHeaderHandler(header) {
    if (!header) return;
    header.addEventListener('click', (e) => {
        if (e.target?.closest?.('button,input,label')) return;
        const group = header.closest('.ss-pruning-group');
        const content = group?.querySelector('.ss-sub-accordion-content');
        const icon = header.querySelector('.ss-sub-accordion-toggle i');
        if (!group || !content || !icon) return;

        const expanded = group.classList.toggle('expanded');
        content.style.display = expanded ? 'block' : 'none';
        icon.className = expanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
    });
}

function wireRescueButton(state, btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        const { type, section, content } = e.currentTarget.dataset;
        state.rescuedItems.push({
            type,
            section: section || type,
            content: content || '',
        });

        e.currentTarget.classList.add('rescued');
        e.currentTarget.textContent = 'Rescued';
        e.currentTarget.disabled = true;

        if (typeof toastr !== 'undefined') {
            toastr.success('Item marked for rescue');
        }
    });
}

function addPrunedItemToReportAndUI(state, sectionKey, itemContent, sceneCodes = []) {
    ensurePruningReport(state);

    const meta = getPruneMetaForSectionKey(sectionKey, state);
    const report = state.pruningReport;
    const metaName = String(meta?.name ?? 'UNKNOWN').trim() || 'UNKNOWN';
    const metaEmoji = String(meta?.emoji ?? '\u{1F4CB}').trim() || '📋';

    let section = report.sections.find((s) => String(s?.name ?? '') === metaName);
    if (!section) {
        section = {
            key: meta.key,
            name: metaName,
            emoji: metaEmoji,
            inputCount: 0,
            outputCount: 0,
            prunedCount: 0,
            prunedItems: [],
        };
        report.sections.push(section);
    }

    section.inputCount += 1;
    section.prunedCount += 1;
    report.totalPruned += 1;

    const sourceLabel = `Sharder Output (${sectionKey})`;
    section.prunedItems.push({
        content: itemContent,
        source: sourceLabel,
        sceneCodes,
        approved: false,
        rescued: false,
    });

    const pruningContent = document.querySelector('.ss-review-accordion[data-section="sp-pruning"] .ss-accordion-content');
    if (!pruningContent) {
        updatePruningHeaderCount(state);
        return;
    }

    const empty = pruningContent.querySelector('.ss-empty');
    if (empty) {
        empty.remove();
    }

    let group = pruningContent.querySelector(`.ss-pruning-group[data-pruning-group="${CSS.escape(metaName)}"]`);

    if (!group) {
        const groupHtml = `
            <div class="ss-pruning-group ss-sub-accordion" data-pruning-group="${escapeHtml(metaName)}">
                <div class="ss-pruning-group-header">
                    <span class="ss-sub-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                    <span class="ss-pruning-group-title">${escapeHtml(metaEmoji)} ${escapeHtml(metaName)}</span>
                    <span class="ss-pruning-group-count">(${section.prunedCount}/${section.inputCount} pruned)</span>
                </div>
                <div class="ss-sub-accordion-content" style="display:none;">
                    <div class="ss-pruning-items"></div>
                </div>
            </div>
        `;

        pruningContent.insertAdjacentHTML('beforeend', groupHtml);
        group = pruningContent.querySelector(`.ss-pruning-group[data-pruning-group="${CSS.escape(metaName)}"]`);
        attachPruningGroupHeaderHandler(group?.querySelector('.ss-pruning-group-header'));
    }

    const countEl = group?.querySelector('.ss-pruning-group-count');
    if (countEl) {
        countEl.textContent = `(${section.prunedCount}/${section.inputCount} pruned)`;
    }

    const itemsEl = group?.querySelector('.ss-pruning-items');
    if (!itemsEl) {
        updatePruningHeaderCount(state);
        return;
    }

    const idx = section.prunedItems.length - 1;
    const preview = (itemContent || '').substring(0, 120);

    const itemHtml = `
        <div class="ss-pruning-item" data-section="${escapeHtml(metaName)}" data-index="${idx}">
            <div class="ss-pruning-content">${escapeHtml(preview)}${(itemContent || '').length > 120 ? '...' : ''}</div>
            <div class="ss-pruning-source">From: ${escapeHtml(sourceLabel)}</div>
            <div class="ss-pruning-actions">
                <label class="ss-approve-toggle">
                    <input type="checkbox" class="ss-approve-checkbox"
                           data-type="pruning"
                           data-section="${escapeHtml(metaName)}"
                           data-index="${idx}" />
                    <span>Archive</span>
                </label>
                <button class="ss-rescue-btn menu_button"
                        data-type="pruning"
                        data-section="${escapeHtml(metaName)}"
                        data-index="${idx}"
                        data-content="${escapeHtml(itemContent || '')}">
                    Rescue
                </button>
            </div>
        </div>
    `;

    itemsEl.insertAdjacentHTML('beforeend', itemHtml);
    const newBtn = itemsEl.querySelector(`.ss-pruning-item[data-index="${CSS.escape(String(idx))}"] .ss-rescue-btn`);
    wireRescueButton(state, newBtn);

    updatePruningHeaderCount(state);
}

function setupAccordionHandlers() {
    document.querySelectorAll('.ss-accordion-header').forEach((header) => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('button,input,textarea,label')) return;
            const accordion = header.closest('.ss-review-accordion');
            const content = accordion?.querySelector('.ss-accordion-content');
            const icon = header.querySelector('.ss-accordion-toggle i');
            if (!accordion || !content || !icon) return;

            const expanded = accordion.classList.toggle('expanded');
            content.style.display = expanded ? 'block' : 'none';
            icon.className = expanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
        });
    });

    document.querySelectorAll('.ss-pruning-group-header').forEach((header) => {
        attachPruningGroupHeaderHandler(header);
    });
}

function setupOutputOverrideHandlers(state) {
    const btn = document.getElementById('ss-sp-edit-output');
    const textarea = document.getElementById('ss-sp-output-editor');
    if (!btn || !textarea) return;

    textarea.addEventListener('input', () => {
        if (!textarea.readOnly) {
            state.outputOverride = textarea.value;
            state.finalOutput = textarea.value;
        }
    });

    btn.addEventListener('click', () => {
        const isEditing = !textarea.readOnly;
        if (isEditing) {
            textarea.readOnly = true;
            state.outputOverride = textarea.value;
            btn.textContent = 'Edit';
            return;
        }

        state.outputOverride = textarea.value;
        textarea.readOnly = false;
        btn.textContent = 'Done';
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
}

function setupCopyOutputHandler() {
    const btn = document.getElementById('ss-sp-copy-output');
    const textarea = document.getElementById('ss-sp-output-editor');
    if (!btn || !textarea) return;

    btn.addEventListener('click', async () => {
        const text = textarea.value || '';
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                textarea.setSelectionRange(0, 0);
            }
            if (typeof toastr !== 'undefined') {
                toastr.success('Output copied');
            }
        } catch (err) {
            log.error('Copy failed:', err);
            if (typeof toastr !== 'undefined') {
                toastr.error('Copy failed');
            }
        }
    });
}

function createNewItem(sectionKey) {
    return {
        id: `${sectionKey}:new:${Math.random().toString(36).slice(2, 8)}`,
        content: '',
        sceneCodes: [],
        archived: false,
        selected: true,
        weight: 3,
    };
}

function setupSectionHandlers(state, regenFn) {
    document.querySelectorAll('.ss-cr-item-editor').forEach((editor) => {
        editor.addEventListener('input', (e) => {
            const sectionKey = e.target.dataset.sectionKey;
            const itemId = e.target.dataset.itemId;
            const item = (state.editableSections[sectionKey] || []).find(i => i.id === itemId);
            if (!item) return;
            item.content = e.target.value;
            item.sceneCodes = parseSceneCodes(item.content || '');
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-sp-item-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', (e) => {
            const sectionKey = e.target.dataset.sectionKey;
            const itemId = e.target.dataset.itemId;
            const item = (state.editableSections[sectionKey] || []).find(i => i.id === itemId);
            if (!item) return;

            item.selected = e.target.checked;
            const row = document.querySelector(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"][data-item-id="${CSS.escape(itemId)}"]`);
            if (row) {
                row.classList.toggle('is-selected', item.selected);
                row.classList.toggle('is-unselected', !item.selected);
            }

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-weight-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const weightVal = parseInt(e.currentTarget.dataset.weight, 10);
            const selector = e.currentTarget.closest('.ss-sharder-weight-selector');
            if (!selector) return;

            const itemId = selector.dataset.itemId;
            const row = selector.closest('.ss-cr-item-row');
            const sectionKey = row?.dataset.sectionKey;
            if (!sectionKey || !itemId) return;

            const item = (state.editableSections[sectionKey] || []).find(i => i.id === itemId);
            if (!item) return;

            item.weight = weightVal;
            selector.querySelectorAll('.ss-weight-btn').forEach(b => b.classList.remove('selected'));
            e.currentTarget.classList.add('selected');
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-sp-select-all').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const sectionKey = e.currentTarget.dataset.sectionKey;
            const items = state.editableSections[sectionKey] || [];
            items.forEach(item => { item.selected = true; });

            document.querySelectorAll(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"]`).forEach((row) => {
                row.classList.add('is-selected');
                row.classList.remove('is-unselected');
                const cb = row.querySelector('.ss-sp-item-checkbox');
                if (cb) cb.checked = true;
            });

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-sp-deselect-all').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const sectionKey = e.currentTarget.dataset.sectionKey;
            const items = state.editableSections[sectionKey] || [];
            items.forEach(item => { item.selected = false; });

            document.querySelectorAll(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"]`).forEach((row) => {
                row.classList.remove('is-selected');
                row.classList.add('is-unselected');
                const cb = row.querySelector('.ss-sp-item-checkbox');
                if (cb) cb.checked = false;
            });

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-sp-add-item').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const sectionKey = e.currentTarget.dataset.sectionKey;
            const items = state.editableSections[sectionKey];
            if (!items) return;

            const newItem = createNewItem(sectionKey);
            items.push(newItem);

            const container = document.querySelector(`.ss-cr-items[data-section-key="${CSS.escape(sectionKey)}"]`);
            if (!container) return;

            const empty = container.querySelector('.ss-empty');
            if (empty) empty.remove();

            const weightHtml = sectionKey === 'events'
                ? `<div class="ss-sp-weight-row">${weightSelectorHtml(newItem)}</div>`
                : '';

            const rowHtml = `
                <div class="ss-cr-item-row is-selected" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(newItem.id)}">
                    <div class="ss-cr-item-top">
                        <div class="ss-cr-item-select">
                            <input type="checkbox" class="ss-sp-item-checkbox"
                                   data-section-key="${escapeHtml(sectionKey)}"
                                   data-item-id="${escapeHtml(newItem.id)}"
                                   checked />
                        </div>
                        <div class="ss-cr-item-meta">
                            <div class="ss-cr-scene-codes"><span class="ss-hint">No scene tags</span></div>
                            <button class="ss-cr-item-prune menu_button" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(newItem.id)}">Prune</button>
                            <button class="ss-cr-item-archive menu_button"
                                    data-section-key="${escapeHtml(sectionKey)}"
                                    data-item-id="${escapeHtml(newItem.id)}"
                                    ${!state.ragEnabled ? 'disabled title="Enable RAG to use warm archive"' : ''}>
                                Archive
                            </button>
                        </div>
                    </div>
                    <textarea class="ss-cr-item-editor text_pole" rows="2" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(newItem.id)}"></textarea>
                    ${weightHtml}
                </div>
            `;

            container.insertAdjacentHTML('beforeend', rowHtml);

            // Wire handlers for the new row
            const newRow = container.querySelector(`.ss-cr-item-row[data-item-id="${CSS.escape(newItem.id)}"]`);
            if (newRow) {
                const editor = newRow.querySelector('.ss-cr-item-editor');
                if (editor) {
                    editor.addEventListener('input', (ev) => {
                        newItem.content = ev.target.value;
                        newItem.sceneCodes = parseSceneCodes(newItem.content || '');
                        updateOutputEditor(state);
                    });
                    editor.focus();
                }

                const cb = newRow.querySelector('.ss-sp-item-checkbox');
                if (cb) {
                    cb.addEventListener('change', (ev) => {
                        newItem.selected = ev.target.checked;
                        newRow.classList.toggle('is-selected', newItem.selected);
                        newRow.classList.toggle('is-unselected', !newItem.selected);
                        updateSectionCount(state, sectionKey);
                        updateOutputEditor(state);
                    });
                }

                const pruneBtn = newRow.querySelector('.ss-cr-item-prune');
                if (pruneBtn) {
                    pruneBtn.addEventListener('click', () => {
                        const idx = items.findIndex(i => i.id === newItem.id);
                        if (idx >= 0) {
                            addPrunedItemToReportAndUI(state, sectionKey, newItem.content || '', newItem.sceneCodes || []);
                            items.splice(idx, 1);
                            newRow.remove();
                            if (items.length === 0) {
                                container.insertAdjacentHTML('beforeend', '<p class="ss-empty">No items in this section.</p>');
                            }
                            updateSectionCount(state, sectionKey);
                            updateOutputEditor(state);
                        }
                    });
                }

                const archiveBtn = newRow.querySelector('.ss-cr-item-archive');
                if (archiveBtn && state.ragEnabled) {
                    archiveBtn.addEventListener('click', async () => {
                        if (newItem.archived) return;
                        const range = inferRangeFromSceneCodes([], state.metadata?.startIndex, state.metadata?.endIndex);
                        archiveBtn.disabled = true;
                        archiveBtn.textContent = 'Archiving...';
                        const result = await archiveToWarm(
                            [{ content: newItem.content, sectionKey, itemId: newItem.id, sceneCodes: [], source: 'single-pass-item' }],
                            range.startIndex, range.endIndex, state.settings, { source: 'single-pass-item' }
                        );
                        if (!result.success) {
                            archiveBtn.disabled = false;
                            archiveBtn.textContent = 'Archive';
                            if (typeof toastr !== 'undefined') toastr.error('Failed to archive item');
                            return;
                        }
                        newItem.archived = true;
                        state.archivedItems.push({ itemId: newItem.id, sectionKey, source: 'single-pass-item', timestamp: Date.now() });
                        archiveBtn.classList.add('ss-cr-item-archived');
                        archiveBtn.textContent = 'Archived ✓';
                        if (typeof toastr !== 'undefined') toastr.success('Item archived to warm storage');
                    });
                }

                if (sectionKey === 'events') {
                    newRow.querySelectorAll('.ss-weight-btn').forEach((wb) => {
                        wb.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            const weightVal = parseInt(ev.currentTarget.dataset.weight, 10);
                            newItem.weight = weightVal;
                            newRow.querySelectorAll('.ss-weight-btn').forEach(b => b.classList.remove('selected'));
                            ev.currentTarget.classList.add('selected');
                            updateOutputEditor(state);
                        });
                    });
                }
            }

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);
        });
    });

    document.querySelectorAll('.ss-sp-exclude-all').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const sectionKey = e.currentTarget.dataset.sectionKey;
            const items = state.editableSections[sectionKey] || [];
            if (items.length === 0) return;

            // Get section name for confirmation message
            const sectionMeta = reviewSections(state).find(s => s.key === sectionKey);
            const sectionName = sectionMeta ? sectionTitle(sectionMeta) : sectionKey;

            // Show confirmation dialog
            const confirmPopup = new Popup(
                `<div class="ss-confirm-prune ss-modal">
                    <h3>✂️ Prune All Items</h3>
                    <p>Are you sure you want to prune all <strong>${items.length}</strong> item(s) from "<strong>${escapeHtml(sectionName)}</strong>"?</p>
                    <p class="ss-warning-text">Items will be moved to the Pruning Report.</p>
                </div>`,
                POPUP_TYPE.CONFIRM,
                null,
                { okButton: 'Prune All', cancelButton: 'Cancel' }
            );

            const result = await confirmPopup.show();
            if (result !== POPUP_RESULT.AFFIRMATIVE) return;

            // Move all items to pruning report
            for (const item of items) {
                addPrunedItemToReportAndUI(state, sectionKey, item.content || '', item.sceneCodes || []);
            }
            state.editableSections[sectionKey] = [];

            // Remove all DOM rows for this section
            document.querySelectorAll(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"]`).forEach((row) => row.remove());

            // Add empty message
            const container = document.querySelector(`.ss-cr-items[data-section-key="${CSS.escape(sectionKey)}"]`);
            if (container && !container.querySelector('.ss-empty')) {
                container.insertAdjacentHTML('beforeend', '<p class="ss-empty">No items in this section.</p>');
            }

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);

            if (typeof toastr !== 'undefined') {
                toastr.info(`All items in section pruned (moved to Pruning Report)`);
            }
        });
    });

    document.querySelectorAll('.ss-cr-item-prune').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const sectionKey = e.currentTarget.dataset.sectionKey;
            const itemId = e.currentTarget.dataset.itemId;
            const items = state.editableSections[sectionKey] || [];
            const index = items.findIndex((i) => i.id === itemId);
            if (index < 0) return;

            const item = items[index];
            addPrunedItemToReportAndUI(state, sectionKey, item?.content || '', item?.sceneCodes || []);
            items.splice(index, 1);

            const row = document.querySelector(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"][data-item-id="${CSS.escape(itemId)}"]`);
            if (row) row.remove();

            // Show empty message if section is now empty
            if (items.length === 0) {
                const container = document.querySelector(`.ss-cr-items[data-section-key="${CSS.escape(sectionKey)}"]`);
                if (container && !container.querySelector('.ss-empty')) {
                    container.insertAdjacentHTML('beforeend', '<p class="ss-empty">No items in this section.</p>');
                }
            }

            updateSectionCount(state, sectionKey);
            updateOutputEditor(state);

            if (typeof toastr !== 'undefined') {
                toastr.info('Item pruned (moved to Pruning Report)');
            }
        });
    });

    document.querySelectorAll('.ss-cr-item-archive').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            if (!state.ragEnabled) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Enable RAG to use warm archive');
                }
                return;
            }

            const sectionKey = e.currentTarget.dataset.sectionKey;
            const itemId = e.currentTarget.dataset.itemId;
            const item = (state.editableSections[sectionKey] || []).find(i => i.id === itemId);
            if (!item || item.archived) return;

            const sceneCodes = normalizeSceneCodes(item.sceneCodes);
            const range = inferRangeFromSceneCodes(
                sceneCodes,
                state.metadata?.startIndex,
                state.metadata?.endIndex
            );

            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Archiving...';

            const result = await archiveToWarm(
                [{
                    content: item.content,
                    sectionKey,
                    itemId,
                    sceneCodes,
                    source: 'single-pass-item'
                }],
                range.startIndex,
                range.endIndex,
                state.settings,
                { source: 'single-pass-item' }
            );

            if (!result.success) {
                e.currentTarget.disabled = false;
                e.currentTarget.textContent = 'Archive';
                if (typeof toastr !== 'undefined') {
                    toastr.error(result.reason === 'rag-disabled'
                        ? 'Enable RAG to use warm archive'
                        : 'Failed to archive item');
                }
                return;
            }

            item.archived = true;
            state.archivedItems.push({
                itemId,
                sectionKey,
                source: 'single-pass-item',
                timestamp: Date.now()
            });

            e.currentTarget.classList.add('ss-cr-item-archived');
            e.currentTarget.textContent = 'Archived ✓';
            if (typeof toastr !== 'undefined') {
                toastr.success('Item archived to warm storage');
            }
        });
    });

    document.querySelectorAll('.ss-approve-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', async (e) => {
            if (!e.target.checked) return;

            if (!state.ragEnabled) {
                e.target.checked = false;
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Enable RAG to use warm archive');
                }
                return;
            }

            const sectionName = String(e.target.dataset.section || '');
            const idx = parseInt(e.target.dataset.index, 10);
            const reportSection = (state.pruningReport?.sections || []).find(s => String(s?.name || '') === sectionName);
            const prunedItem = reportSection?.prunedItems?.[idx];
            if (!prunedItem?.content) {
                e.target.checked = false;
                return;
            }

            const sceneCodes = normalizeSceneCodes(prunedItem.sceneCodes);
            const range = inferRangeFromSceneCodes(
                sceneCodes,
                state.metadata?.startIndex,
                state.metadata?.endIndex
            );
            e.target.disabled = true;

            const result = await archiveToWarm(
                [{
                    content: prunedItem.content,
                    sectionKey: sectionName,
                    itemId: `pruned:${sectionName}:${idx}`,
                    sceneCodes,
                    source: 'single-pass-pruned'
                }],
                range.startIndex,
                range.endIndex,
                state.settings,
                { source: 'single-pass-pruned' }
            );

            if (!result.success) {
                e.target.disabled = false;
                e.target.checked = false;
                if (typeof toastr !== 'undefined') {
                    toastr.error(result.reason === 'rag-disabled'
                        ? 'Enable RAG to use warm archive'
                        : 'Failed to archive item');
                }
                return;
            }

            state.archivedItems.push({
                itemId: `pruned:${sectionName}:${idx}`,
                sectionKey: sectionName,
                source: 'single-pass-pruned',
                timestamp: Date.now()
            });

            const label = e.target.closest('label');
            const span = label?.querySelector('span');
            if (span) span.textContent = 'Archived ✓';
            if (typeof toastr !== 'undefined') {
                toastr.success('Item archived to warm storage');
            }
        });
    });

    document.querySelectorAll('.ss-rescue-btn').forEach((btn) => {
        wireRescueButton(state, btn);
    });
}

function setupGlobalSelectionHandlers(state) {
    const selectAllBtn = document.getElementById('ss-sp-select-all-global');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            reviewSections(state).forEach((section) => {
                const items = state.editableSections[section.key] || [];
                items.forEach(item => { item.selected = true; });

                document.querySelectorAll(`.ss-cr-item-row[data-section-key="${CSS.escape(section.key)}"]`).forEach((row) => {
                    row.classList.add('is-selected');
                    row.classList.remove('is-unselected');
                    const cb = row.querySelector('.ss-sp-item-checkbox');
                    if (cb) cb.checked = true;
                });

                updateSectionCount(state, section.key);
            });
            updateOutputEditor(state);
        });
    }

    const deselectAllBtn = document.getElementById('ss-sp-deselect-all-global');
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            reviewSections(state).forEach((section) => {
                const items = state.editableSections[section.key] || [];
                items.forEach(item => { item.selected = false; });

                document.querySelectorAll(`.ss-cr-item-row[data-section-key="${CSS.escape(section.key)}"]`).forEach((row) => {
                    row.classList.remove('is-selected');
                    row.classList.add('is-unselected');
                    const cb = row.querySelector('.ss-sp-item-checkbox');
                    if (cb) cb.checked = false;
                });

                updateSectionCount(state, section.key);
            });
            updateOutputEditor(state);
        });
    }
}

async function setupRegenerateHandler(state, regenFn) {
    const btn = document.getElementById('ss-sp-regenerate');
    if (!btn || !regenFn) {
        if (btn) btn.style.display = 'none';
        return;
    }

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Regenerating...';
        try {
            const newResult = await regenFn();

            // Update state
            state.diagnostics = newResult.diagnostics || [];
            state.editableSections = normalizeSectionItems(
                newResult.sections || parseExtractionResponse(newResult.reconstructed || '', { sectionRegistry: state.sectionRegistry }),
                state.sectionRegistry
            );
            state.pruningReport = newResult.llmPruningReport || { totalPruned: 0, sections: [] };
            state.outputOverride = null;
            state.rescuedItems = [];

            // Re-render sections area
            const sectionsArea = document.querySelector('.ss-sp-sections-area');
            if (sectionsArea) sectionsArea.innerHTML = sectionsHtml(state);

            // Re-render pruning section
            const pruningAccordion = document.querySelector('.ss-review-accordion[data-section="sp-pruning"]');
            if (pruningAccordion) pruningAccordion.outerHTML = buildPruningSection(state.pruningReport);

            // Re-render diagnostics content
            const diagArea = document.querySelector('.ss-sp-diagnostics');
            if (diagArea) diagArea.innerHTML = diagnosticsHtml(state.diagnostics);

            // Re-wire all handlers
            setupAccordionHandlers();
            setupSectionHandlers(state, regenFn);
            updateOutputEditor(state);

            if (typeof toastr !== 'undefined') {
                toastr.success('Regenerated successfully');
            }
        } catch (err) {
            log.error('Regeneration failed:', err);
            if (typeof toastr !== 'undefined') {
                toastr.error(`Regeneration failed: ${err.message}`);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = 'Regenerate';
        }
    });
}

function setupArchiveOptionHandlers(state) {
    const warm = document.getElementById('ss-sp-archive-warm');
    if (warm) {
        warm.addEventListener('change', (e) => {
            state.archiveOptions.archiveWarm = e.target.checked;
        });
    }

    const cold = document.getElementById('ss-sp-archive-cold');
    if (cold) {
        cold.addEventListener('change', (e) => {
            state.archiveOptions.archiveCold = e.target.checked;
        });
    }
}

/**
 * @param {{reconstructed:string, diagnostics:Array, sections?:Object, metadata?:Object}} pipelineResult
 * @param {Object} settings
 * @param {Function|null} regenFn
 * @returns {Promise<{confirmed:boolean, finalOutput:string, archiveOptions:Object, archivedItems:Array}>}
 */
export async function openSharderReviewModal(pipelineResult, settings, regenFn = null) {
    const sectionRegistry = getSharderSectionRegistry(pipelineResult.metadata?.sectionRegistry || 'narrative');
    const parsed = parseExtractionResponse(pipelineResult.reconstructed || '', { sectionRegistry });

    const state = {
        sectionRegistry,
        diagnostics: pipelineResult.diagnostics || [],
        metadata: pipelineResult.metadata || {},
        editableSections: normalizeSectionItems(pipelineResult.sections || parsed, sectionRegistry),
        finalOutput: pipelineResult.reconstructed || '',
        reconstructedOutput: pipelineResult.reconstructed || '',
        rescuedItems: [],
        pruningReport: pipelineResult.llmPruningReport || {
            totalPruned: 0,
            sections: [],
        },
        outputOverride: null,
        settings,
        ragEnabled: settings?.rag?.enabled === true,
        archivedItems: [],
        archiveOptions: {
            archiveWarm: false,
            archiveCold: false,
        },
    };

    // Ensure metadata defaults for header stability
    if (!Number.isFinite(state.metadata.startIndex) || !Number.isFinite(state.metadata.endIndex)) {
        const id = parsed?._header?.identifier || '';
        const m = /Messages\s+(\d+)\s*-\s*(\d+)/i.exec(id);
        if (m) {
            state.metadata.startIndex = parseInt(m[1], 10);
            state.metadata.endIndex = parseInt(m[2], 10);
        }
    }

    const popup = new Popup(
        buildModalHtml(state),
        POPUP_TYPE.TEXT,
        null,
        {
            okButton: 'Save Sharder Output',
            cancelButton: 'Cancel',
            wide: true,
            large: true,
        }
    );

    const showPromise = popup.show();

    setTimeout(() => {
        setupAccordionHandlers();
        setupSectionHandlers(state, regenFn);
        setupGlobalSelectionHandlers(state);
        setupRegenerateHandler(state, regenFn);
        setupOutputOverrideHandlers(state);
        setupCopyOutputHandler();
        setupArchiveOptionHandlers(state);
        updateOutputEditor(state);
    }, 80);

    const result = await showPromise;
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const hasErrors = state.diagnostics.some((d) => d.level === 'error');
        if (hasErrors) {
            toastr.warning('Save blocked due to error-level diagnostics');
            return {
                confirmed: false,
                finalOutput: '',
                archiveOptions: { archiveWarm: false, archiveCold: false },
                archivedItems: []
            };
        }

        const baseOutput = typeof state.outputOverride === 'string'
            ? state.outputOverride
            : rebuildOutput(state);

        return {
            confirmed: true,
            finalOutput: applyRescues(baseOutput, state.rescuedItems),
            archiveOptions: state.archiveOptions,
            archivedItems: state.archivedItems,
        };
    }

    return {
        confirmed: false,
        finalOutput: '',
        archiveOptions: { archiveWarm: false, archiveCold: false },
        archivedItems: []
    };
}
