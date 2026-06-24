import { getFeatureApiDisplayString } from '../../core/api/feature-api-config.js';
import { getActiveRagSettings, getChatRanges } from '../../core/settings.js';
import { escapeHtml } from '../common/ui-utils.js';
import { getFabActionVisibility, renderFabActionButton } from './fab-action-state.js';
import {
    getActiveApiFeature,
    getPipelineLabel,
    getStatusMode
} from '../common/active-mode-state.js';

const PANEL_IDS = ['actions', 'config', 'advanced'];

export function buildFabPanels(settings, { isGenerating = false, lastSummarizedIndex = -1 } = {}) {
    const snapshot = createSnapshot(settings, isGenerating, lastSummarizedIndex);
    return {
        actions: buildActionsPanel(snapshot),
        config: buildConfigPanel(snapshot),
        advanced: buildAdvancedPanel(snapshot),
    };
}

export function getFabPanelIds() {
    return [...PANEL_IDS];
}

function renderSections(sections) {
    return sections.map((section) => {
        const itemClasses = ['ss-fab-section-items'];
        if (section.layout === 'grid') {
            itemClasses.push('ss-fab-section-items-grid');
        }
        const sectionTitle = section.hideTitle
            ? ''
            : `<div class="ss-fab-section-title">${escapeHtml(section.title)}</div>`;

        return `
        <div class="ss-fab-section">
            ${sectionTitle}
            <div class="${itemClasses.join(' ')}">
                ${section.items.join('\n')}
            </div>
        </div>
    `;
    }).join('');
}

function createSnapshot(settings, isGenerating, lastSummarizedIndex = -1) {
    const sharderMode = settings.sharderMode === true;
    const outputMode = settings.outputMode === 'lorebook' ? 'lorebook' : 'system';
    const statusMode = getStatusMode(settings);
    const ranges = getChatRanges();
    const activeRag = getActiveRagSettings(settings) || {};
    const ragEnabled = activeRag.enabled === true;
    const ragAutoVectorize = activeRag.autoVectorizeNewSummaries === true;

    return {
        isGenerating,
        statusMode,
        sharderMode,
        pipelineLabel: getPipelineLabel(settings),
        outputMode,
        runMode: settings.mode === 'manual' ? 'manual' : 'auto',
        autoInterval: Number(settings.autoInterval) || 20,
        activeApiDisplay: getFeatureApiDisplayString(settings, getActiveApiFeature(settings)),
        ranges,
        lastSummarizedIndex: Number.isInteger(lastSummarizedIndex) ? lastSummarizedIndex : -1,
        ragEnabled,
        ragAutoVectorize,
        ragBackend: activeRag.backend || 'n/a',
        ragScoring: activeRag.scoringMethod || 'keyword',
        ragChunking: activeRag.sectionAwareChunking ? 'section-aware' : 'standard',
        actions: getFabActionVisibility(sharderMode, ragEnabled, isGenerating),
    };
}

function buildActionsPanel(snapshot) {
    const sections = [];

    // Summary Mode section
    if (!snapshot.sharderMode) {
        const items = [
            actionBtn('summarize', 'fa-play', 'Summarize Now', '', snapshot.isGenerating),
        ];
        if (snapshot.actions.stop) {
            items.push(actionBtn('stop', 'fa-stop', 'Stop'));
        }
        sections.push({ title: 'Summary Mode', items, layout: 'grid' });
    }

    // Sharder Mode section
    if (snapshot.sharderMode) {
        const items = [];
        items.push(
            actionBtn('single-pass', 'fa-bolt', 'Run Sharder', '', snapshot.isGenerating),
            actionBtn('batch-sharder', 'fa-layer-group', 'Batch Sharder')
        );
        if (snapshot.actions.stop) {
            items.push(actionBtn('stop', 'fa-stop', 'Stop'));
        }
        sections.push({ title: 'Sharder Mode', items, layout: 'grid' });
    }

    // RAG section
    if (snapshot.ragEnabled) {
        const items = [
            actionBtn('vectorize', 'fa-database', 'Vectorize Chat'),
            actionBtn('purge-vectors', 'fa-trash', 'Purge Vectors'),
            actionBtn('browse-vectors', 'fa-compass', 'Coll. Browser'),
            actionBtn('manage-collections', 'fa-link', 'Coll. Manager'),
            actionBtn('rag-history', 'fa-clock-rotate-left', 'RAG History'),
        ];
        sections.push({ title: 'RAG', items, layout: 'grid' });
    }

    return `<div class="ss-fab-panel-content">${renderSections(sections)}</div>`;
}

function buildConfigPanel(snapshot) {
    const modeLabel = snapshot.runMode === 'auto'
        ? `Auto (${snapshot.autoInterval}s)`
        : 'Manual';
    const ragStatusLabel = snapshot.ragEnabled
        ? (snapshot.ragAutoVectorize ? 'Enabled(Auto)' : 'Enabled')
        : 'disabled';
    const outputLabel = snapshot.outputMode === 'lorebook' ? 'Lorebook' : 'System Messages';

    return `
        <div class="ss-fab-panel-content">
            <div class="ss-fab-section">
                <div class="ss-fab-section-title">Overview</div>
                <div class="ss-fab-section-items">
                    <div class="ss-fab-info-row">
                        <span class="ss-fab-info-label">Auto/Manual:</span>
                        <span class="ss-fab-info-value">${escapeHtml(modeLabel)}</span>
                    </div>
                    <div class="ss-fab-info-row">
                        <span class="ss-fab-info-label">Mode:</span>
                        <span class="ss-fab-info-value">${escapeHtml(snapshot.pipelineLabel)}</span>
                    </div>
                    <div class="ss-fab-info-row">
                        <span class="ss-fab-info-label">RAG:</span>
                        <span class="ss-fab-info-value">${escapeHtml(ragStatusLabel)}</span>
                    </div>
                </div>
            </div>

            <div class="ss-fab-section">
                <div class="ss-fab-section-items">
                    <div class="ss-fab-info-row">
                        <span class="ss-fab-info-label">Injecting to:</span>
                        <span class="ss-fab-info-value">${escapeHtml(outputLabel)}</span>
                    </div>
                    ${snapshot.outputMode === 'lorebook' ?
                        actionBtn('open-lorebook-options', 'fa-book', 'Lorebook Options...') :
                        ''
                    }
                </div>
            </div>

            <div class="ss-fab-section">
                <div class="ss-fab-section-items">
                    <div class="ss-fab-info-row">
                        <span class="ss-fab-info-label">Active API:</span>
                        <span class="ss-fab-info-value ss-fab-info-value-small">${escapeHtml(snapshot.activeApiDisplay)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function buildAdvancedPanel(snapshot) {
    const configSection = {
        title: 'Management',
        layout: 'grid',
        items: [
            actionBtn('open-themes', 'fa-palette', 'Themes'),
            actionBtn('open-prompts', 'fa-file-lines', 'Prompts'),
            actionBtn('open-clean-context', 'fa-filter-circle-xmark', 'Cleanup'),
        ]
    };

    const managementSection = {
        title: '',
        hideTitle: true,
        layout: 'grid',
        items: [
            actionBtn('open-visibility', 'fa-eye', 'Visibility'),
            actionBtn('open-chat-manager', 'fa-comments', 'Chat Mngr.'),
            actionBtn('open-rag-settings', 'fa-database', 'RAG Settings'),
            actionBtn('open-api-config', 'fa-plug', 'API Config'),
        ]
    };

    if (snapshot.ragEnabled) {
        managementSection.items.push(
            actionBtn('rag-debug', 'fa-bug', 'RAG Debug'),
        );
    }

    return `<div class="ss-fab-panel-content">${renderSections([configSection, managementSection])}</div>`;
}

function actionBtn(action, icon, label, extraClass = '', disabled = false) {
    return renderFabActionButton(action, icon, label, extraClass, disabled);
}
