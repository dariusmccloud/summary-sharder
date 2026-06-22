/**
 * Sharder Review Modal
 * Consolidation-style sectioned review for sharder output.
 */

import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../../../../popup.js';
import { escapeHtml } from '../../common/ui-utils.js';
import { archiveToWarm } from '../../../core/rag/archive.js';
import { log } from '../../../core/logger.js';
import {
    ARCHITECTURAL_KEY_LEGEND_LINES,
    buildArchitecturalKeyLines,
    isWarmArchiveEligible,
    validateArchitecturalShellSections,
} from '../../../core/summarization/architectural-sharder-shell.js';
import {
    ARCHITECTURAL_SECTION_CAPS,
    validateArchitecturalStructuredSections,
} from '../../../core/summarization/architectural-structured-validator.js';
import {
    ARCHITECTURAL_PRUNING_CLASSIFICATIONS,
    analyzeArchitecturalPruningAdvisor,
    buildArchitecturalPruningAdvisorUiModel,
} from '../../../core/summarization/architectural-pruning-advisor.js';
import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
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

function isArchitecturalState(state) {
    return state?.sectionRegistry?.profile === ARCHITECTURAL_PROFILE;
}

function isArchitecturalCurrentSection(state, sectionKey) {
    return isArchitecturalState(state) && sectionKey === 'current';
}

function getSelectedItems(items) {
    return (Array.isArray(items) ? items : []).filter((item) => item?.selected !== false);
}

function getArchitecturalCurrentError(state) {
    if (!isArchitecturalState(state)) return null;
    const currentItems = state.editableSections?.current || [];
    const selectedCurrent = getSelectedItems(currentItems);
    if (selectedCurrent.length === 0) {
        return {
            level: 'error',
            code: 'ARCH_CURRENT_EMPTY',
            message: 'Architectural CURRENT requires one selected entry.',
        };
    }
    if (selectedCurrent.length > 1) {
        return {
            level: 'error',
            code: 'ARCH_CURRENT_MULTIPLE',
            message: 'Architectural CURRENT must contain exactly one selected entry.',
        };
    }
    return null;
}

const ARCHITECTURAL_IMMUTABLE_DIAGNOSTIC_CODES = new Set([
    'ARCH_KEY_RECOVERED',
    'ARCH_KEY_PROFILE_RECOVERED',
    'ARCH_KEY_SCHEMA_RECOVERED',
    'ARCH_TERMINATOR_RECOVERED',
    'ARCH_UNKNOWN_SECTION_IGNORED',
    'ARCH_BASELINE_DECISION_IGNORED',
]);

const SUPPRESSED_REVIEW_DIAGNOSTIC_CODES = new Set([
    'ARCH_KEY_RECOVERED',
    'ARCH_KEY_PROFILE_RECOVERED',
    'ARCH_KEY_SCHEMA_RECOVERED',
    'ARCH_TERMINATOR_RECOVERED',
    'ARCH_EVENT_DEC_LIST_NORMALIZED',
]);

const ARCHITECTURAL_REVIEW_LEGEND_ROWS = [
    {
        emoji: '🔴',
        label: 'Foundational',
        description: 'A governing principle, authority boundary, hierarchy, replacement, or systemic correction with broad downstream effect.',
    },
    {
        emoji: '🟠',
        label: 'Governing',
        description: 'An accepted design, criterion, scope, classification, naming rule, or validated mechanism with continuing effect.',
    },
    {
        emoji: '🟡',
        label: 'Operational',
        description: 'A provisional plan, implementation choice, local correction, test method, or discovery that future work must carry forward.',
    },
    {
        emoji: '🟢',
        label: 'Contextual',
        description: 'A limited or reversible detail worth retaining because it helps interpret current work, but does not independently govern it.',
    },
];

function reviewSections(stateOrRegistry = null) {
    const registry = stateOrRegistry?.sectionRegistry || stateOrRegistry;
    return getSharderContentSections(registry);
}

function getWarmArchiveUnavailableMessage(state) {
    return isArchitecturalState(state)
        ? 'Architectural RAG support is deferred for this profile.'
        : 'Enable RAG to use warm archive';
}

function getReviewKeyLines(sections) {
    return Array.isArray(sections?._metadata?.keyLines)
        ? [...sections._metadata.keyLines]
        : [];
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

function buildLocationLabel(diagnostic) {
    if (!diagnostic) return '';
    if (diagnostic.recordId && diagnostic.sectionKey === 'decisions') {
        return `${String(diagnostic.sectionKey || '').toUpperCase()} ID:${diagnostic.recordId}`;
    }
    if (diagnostic.sectionKey && Number.isInteger(diagnostic.itemIndex)) {
        return `${String(diagnostic.sectionKey || '').toUpperCase()} item ${diagnostic.itemIndex + 1}`;
    }
    if (diagnostic.sectionKey) {
        return String(diagnostic.sectionKey || '').toUpperCase();
    }
    return '';
}

function diagnosticSignature(diagnostic) {
    return [
        diagnostic?.level || '',
        diagnostic?.code || '',
        diagnostic?.message || '',
        diagnostic?.sectionKey || '',
        Number.isInteger(diagnostic?.itemIndex) ? diagnostic.itemIndex : '',
        diagnostic?.recordId || '',
        diagnostic?.field || '',
    ].join('|');
}

function mergeDiagnostics(sourceDiagnostics, dynamicDiagnostics) {
    const merged = [];
    const seen = new Set();

    [...(sourceDiagnostics || []), ...(dynamicDiagnostics || [])].forEach((diagnostic) => {
        if (SUPPRESSED_REVIEW_DIAGNOSTIC_CODES.has(diagnostic?.code)) {
            return;
        }
        const signature = diagnosticSignature(diagnostic);
        if (seen.has(signature)) return;
        seen.add(signature);
        merged.push(diagnostic);
    });

    return merged;
}

function getRowDiagnostics(state, sectionKey, itemIndex) {
    return (state.diagnostics || []).filter((diagnostic) =>
        diagnostic?.sectionKey === sectionKey && diagnostic?.itemIndex === itemIndex
    );
}

function getSectionDiagnosticSummary(state, sectionKey) {
    const sectionDiagnostics = (state.diagnostics || []).filter((diagnostic) => diagnostic?.sectionKey === sectionKey);
    const counts = {
        error: 0,
        warning: 0,
        info: 0,
    };

    sectionDiagnostics.forEach((diagnostic) => {
        if (diagnostic?.level === 'error') counts.error += 1;
        else if (diagnostic?.level === 'warning') counts.warning += 1;
        else if (diagnostic?.level === 'info') counts.info += 1;
    });

    const level = counts.error > 0
        ? 'error'
        : counts.warning > 0
            ? 'warning'
            : counts.info > 0
                ? 'info'
                : null;

    return {
        counts,
        level,
        total: counts.error + counts.warning + counts.info,
    };
}

function buildSectionHeaderStatus(summary) {
    if (!summary?.level) {
        return '';
    }

    const label = summary.level === 'error'
        ? `${summary.counts.error} error${summary.counts.error === 1 ? '' : 's'}`
        : summary.level === 'warning'
            ? `${summary.counts.warning} warning${summary.counts.warning === 1 ? '' : 's'}`
            : `${summary.counts.info} info`;

    return `
        <span class="ss-accordion-status ss-level-${escapeHtml(summary.level)}" title="${escapeHtml(label)}">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        </span>
    `;
}

function buildDynamicArchitecturalSections(state) {
    const sections = {};
    reviewSections(state).forEach((section) => {
        sections[section.key] = (state.editableSections?.[section.key] || []).map((item) => ({
            content: item.content,
            selected: item.selected !== false,
            weight: item.weight,
            sceneCodes: item.sceneCodes,
        }));
    });

    sections._metadata = {
        ...(sections._metadata || {}),
        keyLines: [...(state.keyLines || [])],
        architectural: {
            keyPresent: true,
            terminatorCount: 1,
            unknownSectionHeaders: [],
        },
    };

    return sections;
}

function computeArchitecturalDynamicDiagnostics(state) {
    const sections = buildDynamicArchitecturalSections(state);
    const shellDiagnostics = validateArchitecturalShellSections(sections)
        .filter((diagnostic) =>
            !ARCHITECTURAL_IMMUTABLE_DIAGNOSTIC_CODES.has(diagnostic.code)
            && !['ARCH_CURRENT_MISSING', 'ARCH_CURRENT_EMPTY', 'ARCH_CURRENT_MULTIPLE'].includes(diagnostic.code)
        );
    const structuredDiagnostics = validateArchitecturalStructuredSections(sections, {
        baselineDecisions: state.metadata?.baselineDecisions || {},
        profile: ARCHITECTURAL_PROFILE,
    });

    return mergeDiagnostics(shellDiagnostics, structuredDiagnostics);
}

function refreshArchitecturalDiagnostics(state) {
    if (!isArchitecturalState(state)) return;
    state.dynamicDiagnostics = computeArchitecturalDynamicDiagnostics(state);
    state.diagnostics = mergeDiagnostics(state.sourceDiagnostics, state.dynamicDiagnostics);
}

function getCurrentSaveDiagnostics(state) {
    if (isArchitecturalState(state)) {
        refreshArchitecturalDiagnostics(state);
        refreshArchitecturalAdvisor(state);
        return mergeDiagnostics(state.sourceDiagnostics, state.dynamicDiagnostics);
    }

    return state.diagnostics || [];
}

function hasBlockingReviewErrors(diagnostics) {
    return (Array.isArray(diagnostics) ? diagnostics : []).some((diagnostic) => diagnostic?.level === 'error');
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
    if (isArchitecturalState(state)) {
        sections._metadata = {
            ...(sections._metadata || {}),
            keyLines: [...state.keyLines],
        };
    }

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

function refreshArchitecturalAdvisor(state) {
    if (!isArchitecturalState(state)) return;
    state.pruningAdvisor = analyzeArchitecturalPruningAdvisor(state.editableSections, {
        profile: ARCHITECTURAL_PROFILE,
    });
}

function formatAdvisorLabel(classification) {
    if (classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK) return 'Low-risk candidate';
    if (classification === ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW) return 'Review carefully';
    return 'Protected';
}

function buildAdvisorItemLabel(entry) {
    if (entry.stableDecisionId) {
        return `ID:${entry.stableDecisionId}`;
    }
    if (entry.sourceRef) {
        return entry.sourceRef;
    }
    return `item ${entry.itemIndex + 1}`;
}

function buildAdvisorGroup(title, entries, cssClass) {
    if (!entries.length) {
        return `
            <div class="ss-pruning-advisor-group ${cssClass}">
                <div class="ss-pruning-advisor-group-title">${escapeHtml(title)}</div>
                <p class="ss-empty">No items in this group.</p>
            </div>
        `;
    }

    return `
        <div class="ss-pruning-advisor-group ${cssClass}">
            <div class="ss-pruning-advisor-group-title">${escapeHtml(title)}</div>
            <div class="ss-pruning-advisor-items">
                ${entries.map((entry) => `
                    <div class="ss-pruning-advisor-item">
                        <div class="ss-pruning-advisor-item-header">
                            <span class="ss-pruning-advisor-item-title">${escapeHtml(String(entry.sectionKey || '').toUpperCase())} item ${entry.itemIndex + 1}</span>
                            <span class="ss-pruning-advisor-item-meta">${escapeHtml(buildAdvisorItemLabel(entry))}</span>
                            <span class="ss-pruning-advisor-badge ss-pruning-advisor-badge-${escapeHtml(entry.classification)}">${escapeHtml(formatAdvisorLabel(entry.classification))}</span>
                        </div>
                        <div class="ss-pruning-advisor-reasons">
                            ${entry.reasonCodes.map((code) => `<span class="ss-pruning-advisor-reason-code">${escapeHtml(code)}</span>`).join('')}
                        </div>
                        <div class="ss-pruning-advisor-basis">
                            <div class="ss-pruning-advisor-basis-title">Based on what</div>
                            <ul>
                                ${entry.basis.map((basis) => `<li>${escapeHtml(basis)}</li>`).join('')}
                            </ul>
                        </div>
                        <div class="ss-pruning-advisor-actions">
                            <button class="menu_button ss-pruning-advisor-go" data-section-key="${escapeHtml(entry.sectionKey)}" data-item-id="${escapeHtml(entry.itemId)}">Go to item</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function buildPruningAdvisorSection(state) {
    if (!isArchitecturalState(state)) {
        return '';
    }

    const uiModel = buildArchitecturalPruningAdvisorUiModel(state.pruningAdvisor);
    const overCap = uiModel.overCapSections.filter((entry) => entry.excess > 0);
    const overCapSummary = overCap.length > 0
        ? `
            <div class="ss-pruning-advisor-summary">
                ${overCap.map((entry) => `
                    <div class="ss-pruning-advisor-summary-row">
                        <div>
                            <strong>${escapeHtml(String(entry.sectionKey || '').toUpperCase())}</strong>
                            needs ${entry.excess} removal${entry.excess === 1 ? '' : 's'} (${entry.selectedCount}/${entry.cap})
                        </div>
                        ${entry.message ? `<div class="ss-pruning-advisor-summary-note">${escapeHtml(entry.message)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `
        : '<p class="ss-hint">No sections are currently over cap. Advisor remains available for inspection.</p>';

    return `
        <div class="ss-review-accordion ${overCap.length > 0 ? 'ss-section-warning expanded' : ''}" data-section="sp-pruning-advisor">
            <div class="ss-accordion-header">
                <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                <span class="ss-accordion-emoji">🧭</span>
                <span class="ss-accordion-title">Pruning Advisor</span>
                <span class="ss-accordion-count">(${(state.pruningAdvisor?.recommendations || []).length})</span>
            </div>
            <div class="ss-accordion-content" style="display:${overCap.length > 0 ? 'block' : 'none'};">
                ${overCapSummary}
                ${buildAdvisorGroup('Low-risk candidates', uiModel.lowRisk, 'ss-pruning-advisor-low-risk')}
                ${buildAdvisorGroup('Review carefully', uiModel.review, 'ss-pruning-advisor-review')}
                ${buildAdvisorGroup('Protected', uiModel.protected, 'ss-pruning-advisor-protected')}
            </div>
        </div>
    `;
}

function architecturalKeyBlockHtml(state) {
    if (!isArchitecturalState(state)) {
        return '';
    }

    const keyLines = buildArchitecturalKeyLines(state.keyLines);
    const body = keyLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
    const expandedLegendRows = ARCHITECTURAL_REVIEW_LEGEND_ROWS.map((row) => `
        <li>
            <strong>${escapeHtml(`${row.emoji} ${row.label}:`)}</strong>
            ${escapeHtml(row.description)}
        </li>
    `).join('');

    return `
        <div class="ss-review-accordion" data-section="sp-key">
            <div class="ss-accordion-header">
                <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                <span class="ss-accordion-emoji">🗝️</span>
                <span class="ss-accordion-title">KEY Metadata</span>
            </div>
            <div class="ss-accordion-content" style="display:none;">
                <div class="ss-sp-panel" style="margin-bottom: 12px;">
                    <div class="ss-sp-key-metadata">${body}</div>
                    <details class="ss-sp-architectural-legend" style="margin-top: 10px;">
                        <summary>Architectural Fidelity Legend</summary>
                        <div class="ss-sp-architectural-legend-body" style="margin-top: 8px;">
                            <p>Weights measure future continuity importance, not sentiment, quality, urgency, or emotional intensity.</p>
                            <ul style="margin: 8px 0 8px 18px; padding: 0;">
                                ${expandedLegendRows}
                            </ul>
                            <p>Omit chatter, praise, repetition, filler, redundant summaries, and wording changes that do not alter scope, authority, classification, behavior, or future continuity.</p>
                            <p class="ss-hint" style="margin-bottom: 0;">Internal numeric weights remain unchanged. Saved shards show the compact legend only: ${escapeHtml(ARCHITECTURAL_KEY_LEGEND_LINES[2])}</p>
                        </div>
                    </details>
                </div>
            </div>
        </div>
    `;
}

function diagnosticsHtml(diagnostics) {
    if (!diagnostics?.length) {
        return '<div class="ss-sp-diag-empty">No diagnostics. Output looks structurally clean.</div>';
    }

    return diagnostics.map((d) => `
        <div class="ss-sp-diag ss-level-${escapeHtml(d.level)}" data-diag-level="${escapeHtml(d.level || 'info')}" data-diag-code="${escapeHtml(d.code || 'UNSPECIFIED')}">
            <div class="ss-sp-diag-head">
                <span class="ss-sp-diag-level">${escapeHtml((d.level || 'info').toUpperCase())}</span>
                <span class="ss-sp-diag-code">${escapeHtml(d.code || 'UNSPECIFIED')}</span>
            </div>
            ${buildLocationLabel(d) ? `<div class="ss-sp-diag-loc">${escapeHtml(buildLocationLabel(d))}</div>` : ''}
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

function rowDiagnosticsHtml(state, sectionKey, itemIndex) {
    const diagnostics = getRowDiagnostics(state, sectionKey, itemIndex);
    if (!diagnostics.length) return '';

    return `
        <div class="ss-sp-inline-diagnostics">
            ${diagnostics.map((diagnostic) => `
                <div class="ss-sp-inline-diag ss-level-${escapeHtml(diagnostic.level)}">
                    <span class="ss-sp-inline-code">${escapeHtml(diagnostic.code || 'UNSPECIFIED')}</span>
                    <span class="ss-sp-inline-msg">${escapeHtml(diagnostic.message || '')}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function updateInlineDiagnostics(state) {
    if (!isArchitecturalState(state)) return;

    reviewSections(state).forEach((section) => {
        const items = state.editableSections?.[section.key] || [];
        items.forEach((item, itemIndex) => {
            const row = document.querySelector(`.ss-cr-item-row[data-section-key="${CSS.escape(section.key)}"][data-item-id="${CSS.escape(item.id)}"]`);
            if (!row) return;

            const existing = row.querySelector('.ss-sp-inline-diagnostics');
            const html = rowDiagnosticsHtml(state, section.key, itemIndex);
            if (html) {
                if (existing) {
                    existing.outerHTML = html;
                } else {
                    row.insertAdjacentHTML('beforeend', html);
                }
            } else if (existing) {
                existing.remove();
            }
        });
    });
}

function sectionRows(state, sectionKey, items) {
    if (!items.length) {
        return '<p class="ss-empty">No items in this section.</p>';
    }

    const warmArchiveUnavailableMessage = getWarmArchiveUnavailableMessage(state);

    return items.map((item, itemIndex) => {
        const isSelected = item.selected !== false;
        const isProtectedCurrent = isArchitecturalCurrentSection(state, sectionKey) && items.length <= 1;
        const codes = (item.sceneCodes || [])
            .map((c) => {
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object' && typeof c.code === 'string') return c.code;
                return '';
            })
            .filter(Boolean)
            .map((code) => `<span class="ss-scene-badge">${escapeHtml(code)}</span>`)
            .join(' ');

        const weightHtml = sectionKey === 'events' && !isArchitecturalState(state)
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
                        <button class="ss-cr-item-prune menu_button" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(item.id)}" ${isProtectedCurrent ? 'disabled title="Architectural CURRENT must keep one row"' : ''}>Prune</button>
                        <button class="ss-cr-item-archive menu_button ${item.archived ? 'ss-cr-item-archived' : ''}"
                                data-section-key="${escapeHtml(sectionKey)}"
                                data-item-id="${escapeHtml(item.id)}"
                                ${(!state.warmArchiveAvailable || item.archived) ? 'disabled' : ''}
                                ${!state.warmArchiveAvailable ? `title="${escapeHtml(warmArchiveUnavailableMessage)}"` : ''}>
                            ${item.archived ? 'Archived ✓' : 'Archive'}
                        </button>
                    </div>
                </div>
                <textarea class="ss-cr-item-editor text_pole" rows="2" data-section-key="${escapeHtml(sectionKey)}" data-item-id="${escapeHtml(item.id)}">${escapeHtml(item.content || '')}</textarea>
                ${weightHtml}
                ${rowDiagnosticsHtml(state, sectionKey, itemIndex)}
            </div>
        `;
    }).join('');
}

function sectionsHtml(state) {
    return reviewSections(state).map((section) => {
        const items = state.editableSections[section.key] || [];
        const { selected, total } = sectionCount(items);
        const isProtectedCurrent = isArchitecturalCurrentSection(state, section.key);
        const addItemDisabled = isProtectedCurrent;
        const cap = isArchitecturalState(state) ? ARCHITECTURAL_SECTION_CAPS[section.key] : null;
        const countText = isArchitecturalState(state) && Number.isInteger(cap)
            ? `(${selected} selected / cap ${cap})`
            : `(${selected}/${total})`;
        const overCap = isArchitecturalState(state) && Number.isInteger(cap) && selected > cap;
        const sectionDiagnosticSummary = getSectionDiagnosticSummary(state, section.key);
        const severityClass = sectionDiagnosticSummary.level ? `ss-section-${sectionDiagnosticSummary.level}` : '';
        return `
            <div class="ss-review-accordion ${overCap ? 'ss-over-cap' : ''} ${severityClass}" data-section="sp-${escapeHtml(section.key)}">
                <div class="ss-accordion-header">
                    <span class="ss-accordion-toggle"><i class="fa-solid fa-chevron-right"></i></span>
                    <span class="ss-accordion-emoji">${section.emoji}</span>
                    <span class="ss-accordion-title">${escapeHtml(sectionTitle(section))}</span>
                    ${buildSectionHeaderStatus(sectionDiagnosticSummary)}
                    <span class="ss-accordion-count" data-ss-count-key="${escapeHtml(section.key)}">${escapeHtml(countText)}</span>
                </div>
                <div class="ss-accordion-content" style="display:none;">
                    <div class="ss-sp-section-actions" style="margin-bottom:8px;">
                        <button class="menu_button ss-sp-exclude-all" data-section-key="${escapeHtml(section.key)}" ${isProtectedCurrent ? 'disabled title="Architectural CURRENT must keep one row"' : ''}>Prune All</button>
                        <button class="menu_button ss-sp-select-all" data-section-key="${escapeHtml(section.key)}">Select All</button>
                        <button class="menu_button ss-sp-deselect-all" data-section-key="${escapeHtml(section.key)}" ${isProtectedCurrent ? 'disabled title="Architectural CURRENT must keep one row"' : ''}>Deselect All</button>
                    </div>
                    <div class="ss-cr-items" data-section-key="${escapeHtml(section.key)}">
                        ${sectionRows(state, section.key, items)}
                    </div>
                    <button class="menu_button ss-sp-add-item" data-section-key="${escapeHtml(section.key)}" style="margin-top:6px;" ${addItemDisabled ? 'disabled title="Architectural CURRENT must remain singular"' : ''}>+ Add Item</button>
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

function buildPruningSection(state) {
    const report = state.pruningReport;
    const hasSections = report?.sections?.length > 0;
    const uncoveredMessages = report?.uncoveredMessages || [];
    const hasUncovered = uncoveredMessages.length > 0;
    const hasContent = hasSections || hasUncovered;
    const allowWarmArchive = state.warmArchiveAvailable;
    const allowRescue = !isArchitecturalState(state);
    const warmArchiveUnavailableMessage = getWarmArchiveUnavailableMessage(state);

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
                        ${allowWarmArchive ? `
                        <label class="ss-approve-toggle">
                            <input type="checkbox" class="ss-approve-checkbox"
                                   data-type="pruning"
                                   data-section="${escapeHtml(groupName)}"
                                   data-index="${i}" />
                            <span>Archive</span>
                        </label>
                        ` : `<span class="ss-hint" title="${escapeHtml(warmArchiveUnavailableMessage)}">Warm archive unavailable</span>`}
                        ${allowRescue ? `
                        <button class="ss-rescue-btn menu_button"
                                data-type="pruning"
                                data-section="${escapeHtml(groupName)}"
                                data-index="${i}"
                                data-content="${escapeHtml(item.content || '')}">
                            Rescue
                        </button>
                        ` : ''}
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
        <div class="ss-single-pass-review-modal" tabindex="0" aria-label="Sharder Review">
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
                ${architecturalKeyBlockHtml(state)}
                ${sectionsHtml(state)}
            </div>
            ${buildPruningAdvisorSection(state)}
            ${buildPruningSection(state)}

            <div class="ss-sp-panel" style="margin-top: 12px;">
                <div class="ss-output-header">
                    <span>Final Output Review</span>
                    <div class="ss-output-actions">
                        <button id="ss-sp-copy-output" class="menu_button">Copy</button>
                        ${isArchitecturalState(state) ? '' : '<button id="ss-sp-edit-output" class="menu_button">Edit</button>'}
                    </div>
                </div>
                <textarea id="ss-sp-output-editor" class="text_pole ss-sp-output-editor" readonly>${escapeHtml(state.finalOutput || '')}</textarea>
            </div>

            ${isArchitecturalState(state) ? `
            <div class="ss-sp-panel" style="margin-top: 12px;">
                <div class="ss-sp-diag ss-level-info">
                    <div class="ss-sp-diag-head">
                        <span class="ss-sp-diag-level">INFO</span>
                        <span class="ss-sp-diag-code">ARCH_RAG_DEFERRED</span>
                    </div>
                    <div class="ss-sp-diag-msg">Architectural RAG support is deferred. Warm archive and retrieval are unavailable for this profile.</div>
                </div>
            </div>
            ` : ''}

            ${state.pruningReport?.totalPruned > 0 ? `
            <div class="ss-archive-section">
                <h4>Archive Output</h4>
                <div class="ss-archive-options">
                    <label class="ss-archive-option ${state.warmArchiveAvailable ? '' : 'ss-disabled'}" ${state.warmArchiveAvailable ? '' : `title="${escapeHtml(getWarmArchiveUnavailableMessage(state))}"`}>
                        <input type="checkbox" id="ss-sp-archive-warm" ${state.warmArchiveAvailable ? '' : 'disabled'} />
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
    const cap = isArchitecturalState(state) ? ARCHITECTURAL_SECTION_CAPS[sectionKey] : null;
    const el = document.querySelector(`[data-ss-count-key="${CSS.escape(sectionKey)}"]`);
    if (el) {
        el.textContent = isArchitecturalState(state) && Number.isInteger(cap)
            ? `(${selected} selected / cap ${cap})`
            : `(${selected}/${total})`;
    }

    const accordion = document.querySelector(`.ss-review-accordion[data-section="sp-${CSS.escape(sectionKey)}"]`);
    if (accordion && isArchitecturalState(state) && Number.isInteger(cap)) {
        accordion.classList.toggle('ss-over-cap', selected > cap);
    }

    if (accordion) {
        const summary = getSectionDiagnosticSummary(state, sectionKey);
        accordion.classList.toggle('ss-section-error', summary.level === 'error');
        accordion.classList.toggle('ss-section-warning', summary.level === 'warning');
        accordion.classList.toggle('ss-section-info', summary.level === 'info');

        const statusContainer = accordion.querySelector('.ss-accordion-status');
        const statusMarkup = buildSectionHeaderStatus(summary).trim();
        if (statusMarkup) {
            if (statusContainer) {
                statusContainer.outerHTML = statusMarkup;
            } else {
                const title = accordion.querySelector('.ss-accordion-title');
                title?.insertAdjacentHTML('afterend', statusMarkup);
            }
        } else if (statusContainer) {
            statusContainer.remove();
        }
    }
}

function updateOutputEditor(state) {
    if (isArchitecturalState(state)) {
        refreshArchitecturalDiagnostics(state);
        refreshArchitecturalAdvisor(state);
    }

    state.reconstructedOutput = rebuildOutput(state);
    const editor = document.getElementById('ss-sp-output-editor');
    if (editor) {
        editor.value = !isArchitecturalState(state) && typeof state.outputOverride === 'string'
            ? state.outputOverride
            : state.reconstructedOutput;
    }
    state.finalOutput = editor?.value || state.reconstructedOutput;

    const errors = state.diagnostics.filter((d) => d.level === 'error').length;
    const warnings = state.diagnostics.filter((d) => d.level === 'warning').length;
    const infos = state.diagnostics.filter((d) => d.level === 'info').length;
    const summary = document.querySelector('.ss-sp-summary');
    if (summary) {
        summary.innerHTML = `
            <span class="ss-sp-pill ss-level-error">Errors: ${errors}</span>
            <span class="ss-sp-pill ss-level-warning">Warnings: ${warnings}</span>
            <span class="ss-sp-pill ss-level-info">Info: ${infos}</span>
        `;
    }

    const blockingNote = document.getElementById('ss-sp-blocking-note');
    if (blockingNote) {
        blockingNote.style.display = errors > 0 ? 'block' : 'none';
    }

    const diagArea = document.querySelector('.ss-sp-diagnostics');
    if (diagArea) {
        diagArea.innerHTML = diagnosticsHtml(state.diagnostics);
    }

    const diagCount = document.querySelector('.ss-review-accordion[data-section="sp-diagnostics"] .ss-accordion-count');
    if (diagCount) {
        diagCount.textContent = `(${state.diagnostics.length})`;
    }

    if (isArchitecturalState(state)) {
        const advisorAccordion = document.querySelector('.ss-review-accordion[data-section="sp-pruning-advisor"]');
        if (advisorAccordion) {
            advisorAccordion.outerHTML = buildPruningAdvisorSection(state);
            setupAccordionHandlers();
            setupPruningAdvisorHandlers();
        }
    }

    updateInlineDiagnostics(state);
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
    if (!btn || isArchitecturalState(state)) return;
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
                ${state.warmArchiveAvailable ? `<label class="ss-approve-toggle">
                    <input type="checkbox" class="ss-approve-checkbox"
                           data-type="pruning"
                           data-section="${escapeHtml(metaName)}"
                           data-index="${idx}" />
                    <span>Archive</span>
                </label>` : `<span class="ss-hint" title="${escapeHtml(getWarmArchiveUnavailableMessage(state))}">Warm archive unavailable</span>`}
                ${isArchitecturalState(state) ? '' : `<button class="ss-rescue-btn menu_button"
                        data-type="pruning"
                        data-section="${escapeHtml(metaName)}"
                        data-index="${idx}"
                        data-content="${escapeHtml(itemContent || '')}">
                    Rescue
                </button>`}
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
        if (header.dataset.ssAccordionBound === 'true') return;
        header.dataset.ssAccordionBound = 'true';
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

function expandAccordion(sectionName) {
    const accordion = document.querySelector(`.ss-review-accordion[data-section="${CSS.escape(sectionName)}"]`);
    const content = accordion?.querySelector('.ss-accordion-content');
    const icon = accordion?.querySelector('.ss-accordion-toggle i');
    if (!accordion || !content || !icon) return null;

    accordion.classList.add('expanded');
    content.style.display = 'block';
    icon.className = 'fa-solid fa-chevron-down';
    return accordion;
}

function revealFirstBlockingDiagnostic() {
    const accordion = expandAccordion('sp-diagnostics');
    const firstError = accordion?.querySelector('.ss-sp-diag[data-diag-level="error"]');
    if (!firstError) return;

    firstError.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
    });
}

function navigateToReviewItem(sectionKey, itemId) {
    const accordion = expandAccordion(`sp-${sectionKey}`);
    const row = document.querySelector(`.ss-cr-item-row[data-section-key="${CSS.escape(sectionKey)}"][data-item-id="${CSS.escape(itemId)}"]`);
    if (accordion) {
        accordion.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
}

function setupPruningAdvisorHandlers() {
    document.querySelectorAll('.ss-pruning-advisor-go').forEach((button) => {
        if (button.dataset.ssAdvisorBound === 'true') return;
        button.dataset.ssAdvisorBound = 'true';
        button.addEventListener('click', (event) => {
            const sectionKey = event.currentTarget.dataset.sectionKey;
            const itemId = event.currentTarget.dataset.itemId;
            if (!sectionKey || !itemId) return;
            navigateToReviewItem(sectionKey, itemId);
        });
    });
}

function handleBlockedSave(state, message = 'Save blocked due to error-level diagnostics') {
    updateOutputEditor(state);
    revealFirstBlockingDiagnostic();

    if (typeof toastr !== 'undefined') {
        toastr.warning(message);
    }
}

function setupOutputOverrideHandlers(state) {
    const btn = document.getElementById('ss-sp-edit-output');
    const textarea = document.getElementById('ss-sp-output-editor');
    if (!textarea) return;
    if (isArchitecturalState(state)) {
        textarea.readOnly = true;
        state.outputOverride = null;
        return;
    }
    if (!btn) return;

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

            if (!e.target.checked && isArchitecturalCurrentSection(state, sectionKey)) {
                const selectedCount = getSelectedItems(state.editableSections[sectionKey]).length;
                if (selectedCount <= 1) {
                    e.target.checked = true;
                    item.selected = true;
                    if (typeof toastr !== 'undefined') {
                        toastr.warning('Architectural CURRENT must keep one selected row');
                    }
                    return;
                }
            }

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
            if (isArchitecturalCurrentSection(state, sectionKey)) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Architectural CURRENT must keep one selected row');
                }
                return;
            }
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
            if (isArchitecturalCurrentSection(state, sectionKey)) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Architectural CURRENT must remain singular');
                }
                return;
            }
            const items = state.editableSections[sectionKey];
            if (!items) return;

            const newItem = createNewItem(sectionKey);
            items.push(newItem);

            const container = document.querySelector(`.ss-cr-items[data-section-key="${CSS.escape(sectionKey)}"]`);
            if (!container) return;

            const empty = container.querySelector('.ss-empty');
            if (empty) empty.remove();

            const weightHtml = sectionKey === 'events' && !isArchitecturalState(state)
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
                                    ${!state.warmArchiveAvailable ? `disabled title="${escapeHtml(getWarmArchiveUnavailableMessage(state))}"` : ''}>
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
                        if (!ev.target.checked && isArchitecturalCurrentSection(state, sectionKey)) {
                            const selectedCount = getSelectedItems(items).length;
                            if (selectedCount <= 1) {
                                ev.target.checked = true;
                                newItem.selected = true;
                                if (typeof toastr !== 'undefined') {
                                    toastr.warning('Architectural CURRENT must keep one selected row');
                                }
                                return;
                            }
                        }
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
                        if (isArchitecturalCurrentSection(state, sectionKey) && items.length <= 1) {
                            if (typeof toastr !== 'undefined') {
                                toastr.warning('Architectural CURRENT must keep one row');
                            }
                            return;
                        }
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
                if (archiveBtn && state.warmArchiveAvailable) {
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

                if (sectionKey === 'events' && !isArchitecturalState(state)) {
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
            if (isArchitecturalCurrentSection(state, sectionKey)) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Architectural CURRENT must keep one row');
                }
                return;
            }
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
            if (isArchitecturalCurrentSection(state, sectionKey)
                && (items.length <= 1 || (item?.selected !== false && getSelectedItems(items).length <= 1))) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('Architectural CURRENT must keep one selected row');
                }
                return;
            }
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
            if (!state.warmArchiveAvailable) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning(getWarmArchiveUnavailableMessage(state));
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
                        ? getWarmArchiveUnavailableMessage(state)
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

            if (!state.warmArchiveAvailable) {
                e.target.checked = false;
                if (typeof toastr !== 'undefined') {
                    toastr.warning(getWarmArchiveUnavailableMessage(state));
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
                        ? getWarmArchiveUnavailableMessage(state)
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
                if (isArchitecturalCurrentSection(state, section.key)) {
                    return;
                }
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
            const regeneratedSections = newResult.sections || parseExtractionResponse(newResult.reconstructed || '', { sectionRegistry: state.sectionRegistry });

            // Update state
            state.diagnostics = newResult.diagnostics || [];
            state.sourceDiagnostics = isArchitecturalState(state)
                ? (newResult.diagnostics || []).filter((diagnostic) => ARCHITECTURAL_IMMUTABLE_DIAGNOSTIC_CODES.has(diagnostic.code))
                : (newResult.diagnostics || []);
            state.editableSections = normalizeSectionItems(
                regeneratedSections,
                state.sectionRegistry
            );
            state.keyLines = getReviewKeyLines(regeneratedSections);
            state.pruningReport = newResult.llmPruningReport || { totalPruned: 0, sections: [] };
            state.outputOverride = null;
            state.rescuedItems = [];

            // Re-render sections area
            const sectionsArea = document.querySelector('.ss-sp-sections-area');
            if (sectionsArea) sectionsArea.innerHTML = architecturalKeyBlockHtml(state) + sectionsHtml(state);
            state.pruningAdvisor = analyzeArchitecturalPruningAdvisor(state.editableSections, {
                profile: ARCHITECTURAL_PROFILE,
            });

            // Re-render pruning section
            const advisorAccordion = document.querySelector('.ss-review-accordion[data-section="sp-pruning-advisor"]');
            if (advisorAccordion) advisorAccordion.outerHTML = buildPruningAdvisorSection(state);
            const pruningAccordion = document.querySelector('.ss-review-accordion[data-section="sp-pruning"]');
            if (pruningAccordion) pruningAccordion.outerHTML = buildPruningSection(state);

            // Re-render diagnostics content
            const diagArea = document.querySelector('.ss-sp-diagnostics');
            if (diagArea) diagArea.innerHTML = diagnosticsHtml(state.diagnostics);

            // Re-wire all handlers
            setupAccordionHandlers();
            setupSectionHandlers(state, regenFn);
            setupPruningAdvisorHandlers();
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
    const sectionRegistry = getSharderSectionRegistry(
        pipelineResult.metadata?.sectionRegistry || pipelineResult.metadata?.profile || NARRATIVE_PROFILE
    );
    const parsed = parseExtractionResponse(pipelineResult.reconstructed || '', { sectionRegistry });

    const state = {
        sectionRegistry,
        diagnostics: pipelineResult.diagnostics || [],
        sourceDiagnostics: [],
        dynamicDiagnostics: [],
        metadata: pipelineResult.metadata || {},
        editableSections: normalizeSectionItems(pipelineResult.sections || parsed, sectionRegistry),
        keyLines: getReviewKeyLines(pipelineResult.sections || parsed),
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
        warmArchiveAvailable: isWarmArchiveEligible(sectionRegistry, settings?.rag?.enabled === true),
        archivedItems: [],
        archiveOptions: {
            archiveWarm: false,
            archiveCold: false,
        },
    };

    if (isArchitecturalState(state)) {
        state.sourceDiagnostics = (pipelineResult.diagnostics || []).filter((diagnostic) =>
            ARCHITECTURAL_IMMUTABLE_DIAGNOSTIC_CODES.has(diagnostic.code)
        );
        refreshArchitecturalDiagnostics(state);
        refreshArchitecturalAdvisor(state);
    } else {
        state.sourceDiagnostics = pipelineResult.diagnostics || [];
    }

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
            onClosing: (activePopup) => {
                if (activePopup?.result !== POPUP_RESULT.AFFIRMATIVE) {
                    return true;
                }

                const saveDiagnostics = getCurrentSaveDiagnostics(state);

                if (hasBlockingReviewErrors(saveDiagnostics)) {
                    handleBlockedSave(state);
                    return false;
                }

                return true;
            },
        }
    );

    const showPromise = popup.show();

    setTimeout(() => {
        setupAccordionHandlers();
        setupSectionHandlers(state, regenFn);
        setupPruningAdvisorHandlers();
        setupGlobalSelectionHandlers(state);
        setupRegenerateHandler(state, regenFn);
        setupOutputOverrideHandlers(state);
        setupCopyOutputHandler();
        setupArchiveOptionHandlers(state);
        updateOutputEditor(state);
    }, 80);

    const result = await showPromise;
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        const saveDiagnostics = getCurrentSaveDiagnostics(state);
        if (hasBlockingReviewErrors(saveDiagnostics)) {
            handleBlockedSave(state);
            return {
                confirmed: false,
                finalOutput: '',
                archiveOptions: { archiveWarm: false, archiveCold: false },
                archivedItems: []
            };
        }

        const baseOutput = !isArchitecturalState(state) && typeof state.outputOverride === 'string'
            ? state.outputOverride
            : rebuildOutput(state);

        return {
            confirmed: true,
            finalOutput: isArchitecturalState(state)
                ? baseOutput
                : applyRescues(baseOutput, state.rescuedItems),
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
