/**
 * Settings management for Summary Sharder
 */

import {
    saveSettingsDebounced,
    chat_metadata,
    saveMetadata,
} from '../../../../../script.js';

import {
    extension_settings,
} from '../../../../extensions.js';

import { isDebugEnabled, log } from './logger.js';
import { migrateToCollectionBindings } from './rag/collection-bindings.js';
import { getShardCollectionId, getStandardCollectionId } from './rag/collection-manager.js';
import { NARRATIVE_PROFILE, normalizeSharderProfile } from './summarization/sharder-section-registry.js';

let settingsSaveTraceCount = 0;

function getSaveSettingsCallerFromStack(stack) {
    if (!stack) return 'unknown';
    const lines = stack.split('\n');
    for (const line of lines) {
        if (!line.includes('core/settings.js') && line.includes('summary-sharder')) {
            return line.trim().replace(/^at\s+/u, '');
        }
    }
    return lines[2]?.trim().replace(/^at\s+/u, '') || 'unknown';
}

/**
 * Get default settings structure
 */
export function getDefaultSettings() {
    return {
        apiUrl: '',
        apiKey: '',
        useSillyTavernAPI: false,  // Toggle for using ST's current chat API
        selectedModel: '',          // Model to use when useSillyTavernAPI is true
        mode: 'auto',           // 'auto' or 'manual'
        autoInterval: 20,
        hideSummarized: false,      // DEPRECATED: kept for backward compatibility
        hideAllSummarized: false,   // Global toggle for hiding all ranges
        makeAllInvisible: false,    // DEPRECATED: kept for backward compatibility (renamed to collapseAll)
        collapseAll: false,         // Global toggle for collapsing all ranges
        showArchivedMessages: false, // Reveal archived messages in chat while keeping them prompt-hidden
        globalIgnoreNames: '',      // Global comma-separated list of names to ignore
        summaryLengthControl: false,    // Enable/disable summary length control
        summaryLengthPercent: 10,       // Target summary length as percentage of input (1-30)
        prompts: [],            // Array of { name, content }
        activePromptName: '',
        outputMode: 'system',   // 'system' or 'lorebook'
        collectionAliases: {},  // { [chatId]: sourceChatId } for RAG aliasing — legacy, migrated to collectionBindings
        collectionBindings: {   // Multi-collection assignment registry
            characters: {},     // { [avatar]: { collections, primaryCollection } }
            chats: {},          // { [chatId]: { collections, primaryCollection, includeOwn } }
        },
        queueDelay: 0,          // Delay in seconds between API calls in queue mode
        // summarizedRanges moved to per-chat metadata (chat_metadata.summary_sharder.summarizedRanges)

        // Lorebook selection settings
        lorebookSelection: {
            useCharacterBook: false,      // Toggle: Use character's embedded/bound lorebook
            useChatBook: false,           // Toggle: Use chat's assigned world info
            useCustomBooks: false,        // Toggle: Enable custom selection
            customBookNames: [],          // Array of selected lorebook names
        },

        // Lorebook entry options (global for all summaries)
        lorebookEntryOptions: {
            entryType: 'constant',        // 'constant', 'vectorized', 'disabled', 'normal'
            nameFormat: 'Memory Shard {start}-{end}',  // Template with {start}, {end}, {date}, {character}
            keywordsEnabled: true,        // Fallback format-based keywords
            keywordFormat: 'summary_{start}_{end}',
            additionalKeywords: '',       // Comma-separated additional keywords
            bannedKeywords: '',           // Comma-separated keywords to exclude from all keyword generation
            extractKeywords: true,        // Enable AI keyword extraction from summary
            orderStrategy: 'recency',     // 'recency' (higher order for recent) or 'fixed'
            fixedOrderValue: 100,         // Used when orderStrategy is 'fixed'
        },

        // Drafting Mode
        advancedUserControl: false,       // Toggle for drafting workflow

        // Saved API configurations (for external API mode)
        savedApiConfigs: [],              // Array of { id, name, url, secretId, model }
        activeApiConfigId: null,          // ID of currently selected saved config, or null for manual entry

        // Casing API settings (when Drafting Mode is enabled)
        useAlternateCasingApi: false,     // Toggle for using different API for drafting
        casingApiConfigId: null,          // ID of saved config to use for drafting (null = use main)

        // Context cleanup settings
        contextCleanup: {
            enabled: true,                // Master toggle for context cleanup
            stripHtml: true,              // Remove HTML tags like <div>, <span>, etc.
            stripCodeBlocks: false,       // Remove ```code``` blocks entirely
            stripUrls: false,             // Remove http/https URLs
            stripEmojis: false,           // Remove emoji characters
            stripBracketedMeta: true,    // Remove [OOC], (OOC), etc.
            stripReasoningBlocks: true,   // Remove <thinking> and <think> blocks
            stripHiddenMessages: true,    // Skip messages with is_hidden flag
            customRegex: '',              // DEPRECATED: kept for backward compatibility, migrated to customRegexes
            customRegexes: [],            // Array of { id, name, pattern, enabled }
        },

        // Configurable drafting extraction prompt (used by Drafting Mode)
        casingPrompt: '',

        // Sharder Mode settings
        sharderMode: false,               // Toggle for sharder workflows
        sharderProfile: NARRATIVE_PROFILE, // 'narrative' | 'architectural'
        autoIncludeShards: false,         // Auto-include all saved shards without showing selection modal
        sharderPrompts: {
            prompt: '',                   // Sharder prompt (loaded from prompts.js default)
        },
        architecturalSharderPrompts: {
            prompt: '',                   // Architectural sharder prompt (loaded from prompts.js default)
        },

        // Summary Review settings (for advancedUserControl workflow)
        summaryReview: {
            mode: 'always',               // 'always' | 'never'
            tokenThreshold: 500,          // Show if tokens exceed this
            promptChangeDetection: true,  // Show if prompt changed since last run
        },

        // Per-feature API configuration
        apiFeatures: {
            summary: {
                useSillyTavernAPI: true,   // Toggle: ST API vs External
                apiConfigId: null,          // ID from savedApiConfigs, or null
                connectionProfileId: null,  // ID from Connection Manager profiles, or null
                queueDelayMs: 0,            // Delay in milliseconds between API calls
                temperature: 0.4,           // Generation temperature (0-2)
                topP: 1,                    // Nucleus sampling threshold (0-1)
                maxTokens: 8096,            // Maximum response tokens
                postProcessing: '',         // Prompt post-processing mode (external API only)
                messageFormat: 'minimal',   // Message format: 'minimal' (system+user) or 'alternating' (adds assistant turn)
                removeStopStrings: false    // Remove stop strings for ST/Connection Profile generation
            },
            sharder: {
                useSillyTavernAPI: true,
                apiConfigId: null,
                connectionProfileId: null,
                queueDelayMs: 0,
                temperature: 0.3,
                topP: 1,
                maxTokens: 8096,
                postProcessing: '',
                messageFormat: 'minimal',
                removeStopStrings: false
            },
            casing: {
                useSillyTavernAPI: true,
                apiConfigId: null,
                connectionProfileId: null,
                queueDelayMs: 0,
                temperature: 0.4,
                topP: 1,
                maxTokens: 4096,
                postProcessing: '',
                messageFormat: 'minimal',
                removeStopStrings: false
            },
        },

        // Floating Action Button settings
        fab: {
            enabled: true,
            position: { x: null, y: null },
        },

        debugLogging: false,

        // RAG (Retrieval-Augmented Generation) settings
        rag: {
            enabled: false,
            // Backend
            backend: 'vectra',              // 'vectra' | 'lancedb' | 'qdrant' | 'milvus'
            source: 'transformers',         // Embedding source: 'transformers'|'openai'|'ollama'|'llamacpp'|'vllm'|'koboldcpp'|'bananabread'|'extras'|'openrouter'|'custom'
            apiUrl: '',                     // Active embedding API URL (resolved from sourceConfigs[source])
            model: '',                      // Active embedding model (resolved from sourceConfigs[source])
            embeddingSecretId: null,        // Active secret ID (resolved from sourceConfigs[source])
            sourceConfigs: {},              // Per-source { apiUrl, model, embeddingSecretId } keyed by source name
            backendConfig: {
                qdrantAddress: 'localhost:6333',
                qdrantUseCloud: false,
                qdrantApiKey: '',
                qdrantUrl: '',               // Cloud URL (used when qdrantUseCloud=true)
                milvusAddress: 'localhost:19530',
                milvusToken: '',
            },
            // Vectorization
            autoVectorizeNewSummaries: true,
            chunkingStrategy: 'per_message', // Deprecated (kept for migration compatibility)
            batchSize: 5,                    // Deprecated (kept for migration compatibility)
            sceneAwareChunking: false,
            sectionAwareChunking: false,
            useLorebooksForVectorization: false, // Scan selected lorebooks during bulk shard vectorization
            vectorizationLorebookNames: [],      // Lorebooks used when useLorebooksForVectorization is enabled
            // Retrieval
            includeLorebooksInShardSelection: false, // Allow shard/extraction discovery to scan lorebooks even when outputMode is 'system'
            insertCount: 5,
            queryCount: 2,
            protectCount: 5,
            maxItemsPerCompactedSection: 5,
            scoreThreshold: 0.25,
            scoringMethod: 'keyword',       // 'keyword' | 'bm25' | 'hybrid'
            hybridFusionMethod: 'rrf',      // 'rrf' | 'weighted'
            hybridRrfK: 60,
            hybridAlpha: 0.4,
            hybridBeta: 0.6,
            hybridOverfetchMultiplier: 4,
            position: 0,                    // extension_prompt_types position
            depth: 2,
            template: 'Recalled memories:\n{{text}}',
            injectionMode: 'extension_prompt', // 'extension_prompt' | 'variable'
            injectionVariableName: 'ss_rag_memory',
            recencyFreshnessWeight: 0.1,
            recentSummaryCount: 1,
            maxChunksPerShard: 2,
            // Scene Expansion
            sceneExpansion: true,
            maxSceneExpansionChunks: 10,
            // Re-ranker
            reranker: {
                enabled: false,
                provider: 'similharity',    // 'similharity' (proxy via plugin) | 'openrouter' | 'custom' (direct call)
                apiUrl: '',
                model: '',
                secretId: null,
                providerConfigs: {},        // Per-provider { apiUrl, model, secretId } keyed by provider name
            },
        },

        // Standard Mode RAG settings — active when sharderMode is false.
        // No scene codes, no section-aware chunking; prose-only chunking; separate ss_standard_* collections.
        ragStandard: {
            enabled: false,
            // Backend
            backend: 'vectra',
            source: 'transformers',
            apiUrl: '',
            model: '',
            embeddingSecretId: null,
            sourceConfigs: {},
            backendConfig: {
                qdrantAddress: 'localhost:6333',
                qdrantUseCloud: false,
                qdrantApiKey: '',
                qdrantUrl: '',
                milvusAddress: 'localhost:19530',
                milvusToken: '',
            },
            // Vectorization
            autoVectorizeNewSummaries: true,
            proseChunkingMode: 'paragraph',     // 'full_summary' | 'paragraph'
            useLorebooksForVectorization: false,
            vectorizationLorebookNames: [],
            // Retrieval
            includeLorebooksInShardSelection: false,
            insertCount: 5,
            queryCount: 2,
            protectCount: 5,
            maxItemsPerCompactedSection: 5,
            scoreThreshold: 0.25,
            scoringMethod: 'keyword',
            hybridFusionMethod: 'rrf',
            hybridRrfK: 60,
            hybridAlpha: 0.4,
            hybridBeta: 0.6,
            hybridOverfetchMultiplier: 4,
            position: 0,
            depth: 2,
            template: 'Recalled memories:\n{{text}}',
            injectionMode: 'extension_prompt', // 'extension_prompt' | 'variable'
            injectionVariableName: 'ss_rag_memory',
            recencyFreshnessWeight: 0.1,
            recentSummaryCount: 1,
            maxChunksPerShard: 2,
            // Re-ranker
            reranker: {
                enabled: false,
                provider: 'similharity',    // 'similharity' (proxy via plugin) | 'openrouter' | 'custom' (direct call)
                apiUrl: '',
                model: '',
                secretId: null,
                providerConfigs: {},
            },
        },
    };
}

/**
 * Get current settings (reference to extension_settings)
 */
export function getSettings() {
    return extension_settings.summary_sharder || getDefaultSettings();
}

/**
 * Get the active RAG settings block depending on mode.
 * Returns settings.rag when sharderMode is true, settings.ragStandard otherwise.
 * @param {Object} settings
 * @returns {Object|undefined}
 */
export function getActiveRagSettings(settings) {
    return (settings?.sharderMode === true) ? settings?.rag : settings?.ragStandard;
}

/**
 * Save settings to extension_settings and persist
 */
export function saveSettings(settings) {
    const debugEnabled = isDebugEnabled();
    const startedAt = debugEnabled ? performance.now() : 0;
    const traceStack = debugEnabled ? new Error().stack : '';
    Object.assign(extension_settings.summary_sharder, settings);
    saveSettingsDebounced();

    if (!debugEnabled) return;

    const duration = performance.now() - startedAt;
    settingsSaveTraceCount += 1;
    // Log slow saves or every N saves when debugging
    if (duration < 8 && settingsSaveTraceCount % 20 !== 0) {
        return;
    }

    const caller = getSaveSettingsCallerFromStack(traceStack);
    log.debug(`[settings.save] dt=${duration.toFixed(2)}ms count=${settingsSaveTraceCount} caller=${caller}`);
}

/**
 * Get summarized ranges for the current chat
 * Ensures backward compatibility by adding hidden/collapsed/ignoreNames fields to old ranges
 * Validates chatId to ensure ranges belong to the current chat (not stale data from another chat)
 */
export function getChatRanges() {
    const context = SillyTavern.getContext();
    const currentChatId = context?.chatId;

    if (!chat_metadata.summary_sharder) {
        chat_metadata.summary_sharder = {};
    }

    const storedChatId = chat_metadata.summary_sharder.chatId;

    // Validate chatId - if mismatch, this is stale data from a different chat
    if (storedChatId && currentChatId && storedChatId !== currentChatId) {
        log.warn(`Chat ID mismatch: stored=${storedChatId}, current=${currentChatId}. Clearing stale ranges.`);
        chat_metadata.summary_sharder = { chatId: currentChatId, summarizedRanges: [] };
        return [];
    }

    const ranges = chat_metadata.summary_sharder.summarizedRanges || [];

    // Add default fields to ranges that don't have them (backward compatibility)
    return ranges.map(range => ({
        start: range.start,
        end: range.end,
        hidden: range.hidden !== undefined ? range.hidden : false,
        ignoreCollapse: range.ignoreCollapse !== undefined ? range.ignoreCollapse : false,
        ignoreNames: range.ignoreNames !== undefined ? range.ignoreNames : ''
    }));
}

/**
 * Save summarized ranges for the current chat
 * Stores chatId alongside ranges to ensure per-chat isolation
 */
export function saveChatRanges(ranges) {
    const context = SillyTavern.getContext();
    const currentChatId = context?.chatId;

    if (!chat_metadata.summary_sharder) {
        chat_metadata.summary_sharder = {};
    }

    // Always store chatId for validation on load
    chat_metadata.summary_sharder.chatId = currentChatId;
    chat_metadata.summary_sharder.summarizedRanges = ranges;
    saveMetadata();
}

/**
 * Migrate old settings to new structure
 * Called when settings are loaded to ensure backward compatibility
 */
export function migrateSettings(settings) {
    let migrated = false;

    // Migrate customRegex string to customRegexes array
    if (settings.contextCleanup) {
        // Ensure customRegexes array exists
        if (!Array.isArray(settings.contextCleanup.customRegexes)) {
            settings.contextCleanup.customRegexes = [];
            migrated = true;
        }

        // Migrate old customRegex string if it exists and customRegexes is empty
        if (settings.contextCleanup.customRegex &&
            settings.contextCleanup.customRegex.trim() &&
            settings.contextCleanup.customRegexes.length === 0) {

            settings.contextCleanup.customRegexes.push({
                id: `regex-${Date.now()}`,
                name: 'Migrated Custom Regex',
                pattern: settings.contextCleanup.customRegex,
                enabled: true
            });

            log.debug('Migrated legacy customRegex to customRegexes array');
            migrated = true;
        }

        // Add new cleanup options for existing users (default to enabled)
        if (settings.contextCleanup.stripReasoningBlocks === undefined) {
            settings.contextCleanup.stripReasoningBlocks = true;
            migrated = true;
        }
        if (settings.contextCleanup.stripHiddenMessages === undefined) {
            settings.contextCleanup.stripHiddenMessages = true;
            migrated = true;
        }
    }

    // Migrate Pre-Edit Events keys -> Drafting Mode / Casing API keys
    if (settings.useAlternateEventsApi !== undefined && settings.useAlternateCasingApi === undefined) {
        settings.useAlternateCasingApi = settings.useAlternateEventsApi;
        delete settings.useAlternateEventsApi;
        migrated = true;
    }
    if (settings.eventsApiConfigId !== undefined && settings.casingApiConfigId === undefined) {
        settings.casingApiConfigId = settings.eventsApiConfigId;
        delete settings.eventsApiConfigId;
        migrated = true;
    }
    if (settings.eventsPrompt !== undefined && settings.casingPrompt === undefined) {
        settings.casingPrompt = settings.eventsPrompt;
        delete settings.eventsPrompt;
        migrated = true;
    }

    // Ensure casingPrompt field exists
    if (settings.casingPrompt === undefined) {
        settings.casingPrompt = '';
        migrated = true;
    }

    // Ensure collectionAliases map exists for RAG collection linking (legacy)
    if (!settings.collectionAliases || typeof settings.collectionAliases !== 'object') {
        settings.collectionAliases = {};
        migrated = true;
    }

    // Ensure collectionBindings structure exists
    if (!settings.collectionBindings || typeof settings.collectionBindings !== 'object') {
        settings.collectionBindings = { characters: {}, chats: {} };
        migrated = true;
    }
    if (!settings.collectionBindings.characters || typeof settings.collectionBindings.characters !== 'object') {
        settings.collectionBindings.characters = {};
        migrated = true;
    }
    if (!settings.collectionBindings.chats || typeof settings.collectionBindings.chats !== 'object') {
        settings.collectionBindings.chats = {};
        migrated = true;
    }

    // Migrate legacy collectionIdOverrides / collectionAliases into collectionBindings
    if (settings.collectionIdOverrides || settings.collectionAliases) {
        const bindingMigrated = migrateToCollectionBindings(
            settings,
            getShardCollectionId,
            getStandardCollectionId,
        );
        if (bindingMigrated) {
            log.log('Migrated legacy collection overrides/aliases into collectionBindings');
            migrated = true;
        }
    }

    // Migrate to new apiFeatures structure
    if (!settings.apiFeatures) {
        log.debug('Migrating to new apiFeatures structure');

        settings.apiFeatures = {
            summary: {
                useSillyTavernAPI: settings.useSillyTavernAPI ?? false,
                apiConfigId: settings.activeApiConfigId || null,
                connectionProfileId: null
            },
            casing: {
                // Casing uses alternate API if configured, otherwise inherits main
                useSillyTavernAPI: settings.useAlternateCasingApi
                    ? false
                    : (settings.useSillyTavernAPI ?? false),
                apiConfigId: (settings.useAlternateCasingApi && settings.casingApiConfigId)
                    ? settings.casingApiConfigId
                    : (settings.activeApiConfigId || null),
                connectionProfileId: null
            },
            sharder: {
                useSillyTavernAPI: settings.useSillyTavernAPI ?? false,
                apiConfigId: settings.activeApiConfigId || null,
                connectionProfileId: null
            }
        };

        log.debug('Migration complete - API settings preserved');
        migrated = true;
    }

    // Remove legacy chatManager from apiFeatures (now uses summary API)
    if (settings.apiFeatures?.chatManager) {
        delete settings.apiFeatures.chatManager;
        migrated = true;
    }

    // Migrate legacy singlePass feature key to sharder
    if (settings.apiFeatures?.singlePass && !settings.apiFeatures.sharder) {
        settings.apiFeatures.sharder = settings.apiFeatures.singlePass;
        delete settings.apiFeatures.singlePass;
        log.debug('Migrated apiFeatures.singlePass to apiFeatures.sharder');
        migrated = true;
    }

    // Ensure sharder feature exists in apiFeatures for existing installations
    if (settings.apiFeatures && !settings.apiFeatures.sharder) {
        settings.apiFeatures.sharder = {
            useSillyTavernAPI: settings.apiFeatures.summary?.useSillyTavernAPI ?? false,
            apiConfigId: settings.apiFeatures.summary?.apiConfigId || null,
            connectionProfileId: settings.apiFeatures.summary?.connectionProfileId || null
        };
        log.debug('Added sharder to apiFeatures (inheriting from summary settings)');
        migrated = true;
    }

    // Migrate legacy apiFeatures.events key to apiFeatures.casing
    if (settings.apiFeatures?.events && !settings.apiFeatures.casing) {
        settings.apiFeatures.casing = settings.apiFeatures.events;
        delete settings.apiFeatures.events;
        log.debug('Migrated apiFeatures.events to apiFeatures.casing');
        migrated = true;
    }

    // Ensure casing feature exists in apiFeatures for existing installations
    if (settings.apiFeatures && !settings.apiFeatures.casing) {
        settings.apiFeatures.casing = {
            useSillyTavernAPI: settings.apiFeatures.summary?.useSillyTavernAPI ?? false,
            apiConfigId: settings.apiFeatures.summary?.apiConfigId || null,
            connectionProfileId: settings.apiFeatures.summary?.connectionProfileId || null
        };
        log.debug('Added casing to apiFeatures (inheriting from summary settings)');
        migrated = true;
    }

    // Migrate queueDelay and add generation params to existing apiFeatures
    if (settings.apiFeatures) {
        const delayMs = Math.round((settings.queueDelay || 0) * 1000);
        const defaults = {
            summary: { temperature: 0.4, topP: 1, maxTokens: 8096 },
            casing: { temperature: 0.4, topP: 1, maxTokens: 4096 },
            sharder: { temperature: 0.25, topP: 1, maxTokens: 8096 }
        };

        let needsMigration = false;
        for (const feature of ['summary', 'casing', 'sharder']) {
            if (settings.apiFeatures[feature]) {
                const cfg = settings.apiFeatures[feature];
                const def = defaults[feature];
                if (cfg.queueDelayMs === undefined) { cfg.queueDelayMs = delayMs; needsMigration = true; }
                if (cfg.temperature === undefined) { cfg.temperature = def.temperature; needsMigration = true; }
                if (cfg.topP === undefined) { cfg.topP = def.topP; needsMigration = true; }
                if (cfg.maxTokens === undefined) { cfg.maxTokens = def.maxTokens; needsMigration = true; }
                if (cfg.postProcessing === undefined) { cfg.postProcessing = ''; needsMigration = true; }
                if (cfg.messageFormat === undefined) { cfg.messageFormat = 'minimal'; needsMigration = true; }
                if (cfg.removeStopStrings === undefined) { cfg.removeStopStrings = false; needsMigration = true; }
                if (cfg.connectionProfileId === undefined) { cfg.connectionProfileId = null; needsMigration = true; }
            }
        }

        if (needsMigration) {
            log.debug('Migrated generation parameters to apiFeatures');
            migrated = true;
        }
    }
    // Remove deprecated two-pass prompt/settings keys
    if (settings.sharderPrompts) {
        if (!settings.sharderPrompts.prompt && settings.sharderPrompts.singlePassPrompt) {
            settings.sharderPrompts.prompt = settings.sharderPrompts.singlePassPrompt;
            migrated = true;
        }
        if (Object.prototype.hasOwnProperty.call(settings.sharderPrompts, 'singlePassPrompt')) {
            delete settings.sharderPrompts.singlePassPrompt;
            migrated = true;
        }
        if (Object.prototype.hasOwnProperty.call(settings.sharderPrompts, 'firstPassPrompt')) {
            delete settings.sharderPrompts.firstPassPrompt;
            migrated = true;
        }
        if (Object.prototype.hasOwnProperty.call(settings.sharderPrompts, 'secondPassBridge')) {
            delete settings.sharderPrompts.secondPassBridge;
            migrated = true;
        }
        if (Object.prototype.hasOwnProperty.call(settings.sharderPrompts, 'extractionPrompt')) {
            delete settings.sharderPrompts.extractionPrompt;
            migrated = true;
        }
        if (Object.prototype.hasOwnProperty.call(settings.sharderPrompts, 'consolidationPrompt')) {
            delete settings.sharderPrompts.consolidationPrompt;
            migrated = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'sharderPipelineMode')) {
        delete settings.sharderPipelineMode;
        migrated = true;
    }

    const normalizedSharderProfile = normalizeSharderProfile(settings.sharderProfile);
    if (settings.sharderProfile !== normalizedSharderProfile) {
        settings.sharderProfile = normalizedSharderProfile;
        migrated = true;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'consolidationReview')) {
        delete settings.consolidationReview;
        migrated = true;
    }
    // Add RAG settings block for existing installations
    if (settings.rag === undefined) {
        settings.rag = getDefaultSettings().rag;
        log.debug('Added RAG settings block');
        migrated = true;
    }

    // Add ragStandard settings block for existing installations
    if (settings.ragStandard === undefined) {
        settings.ragStandard = getDefaultSettings().ragStandard;
        log.debug('Added ragStandard settings block');
        migrated = true;
    }

    if (!Object.prototype.hasOwnProperty.call(extension_settings.summary_sharder || {}, 'debugLogging')) {
        settings.debugLogging = isDebugEnabled();
        migrated = true;
    }

    // Ensure ragStandard nested defaults exist for existing installations
    if (settings.ragStandard) {
        const ragStdDefaults = getDefaultSettings().ragStandard;
        if (settings.ragStandard.retrievalEnabled === true && settings.ragStandard.enabled !== true) {
            settings.ragStandard.enabled = true;
            migrated = true;
        }

        for (const [key, value] of Object.entries(ragStdDefaults)) {
            if (settings.ragStandard[key] === undefined) {
                settings.ragStandard[key] = value;
                migrated = true;
            }
        }

        if (!settings.ragStandard.backendConfig || typeof settings.ragStandard.backendConfig !== 'object') {
            settings.ragStandard.backendConfig = { ...ragStdDefaults.backendConfig };
            migrated = true;
        } else {
            for (const [key, value] of Object.entries(ragStdDefaults.backendConfig)) {
                if (settings.ragStandard.backendConfig[key] === undefined) {
                    settings.ragStandard.backendConfig[key] = value;
                    migrated = true;
                }
            }
        }

        if (settings.ragStandard.backendConfig && typeof settings.ragStandard.backendConfig === 'object') {
            const stdBackend = settings.ragStandard.backendConfig;
            const host = String(stdBackend.qdrantHost || 'localhost').trim() || 'localhost';
            const parsedPort = Number.parseInt(String(stdBackend.qdrantPort ?? ''), 10);
            const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6333;

            if (!String(stdBackend.qdrantAddress || '').trim()) {
                stdBackend.qdrantAddress = `${host}:${port}`;
                migrated = true;
            }
            if (stdBackend.qdrantUseCloud === undefined) {
                stdBackend.qdrantUseCloud = String(stdBackend.qdrantUrl || '').trim().length > 0;
                migrated = true;
            }
            if (Object.prototype.hasOwnProperty.call(stdBackend, 'qdrantHost')) {
                delete stdBackend.qdrantHost;
                migrated = true;
            }
            if (Object.prototype.hasOwnProperty.call(stdBackend, 'qdrantPort')) {
                delete stdBackend.qdrantPort;
                migrated = true;
            }
        }

        if (!settings.ragStandard.reranker || typeof settings.ragStandard.reranker !== 'object') {
            settings.ragStandard.reranker = { ...ragStdDefaults.reranker };
            migrated = true;
        } else {
            for (const [key, value] of Object.entries(ragStdDefaults.reranker)) {
                if (settings.ragStandard.reranker[key] === undefined) {
                    settings.ragStandard.reranker[key] = value;
                    migrated = true;
                }
            }
        }

        // Validate proseChunkingMode
        const validProseChunkingModes = new Set(['full_summary', 'paragraph']);
        if (!validProseChunkingModes.has(settings.ragStandard.proseChunkingMode)) {
            settings.ragStandard.proseChunkingMode = 'paragraph';
            migrated = true;
        }

        // Remove sharder-specific keys if accidentally present in ragStandard
        const sharderOnlyKeys = ['sectionAwareChunking', 'sceneAwareChunking', 'sceneExpansion', 'maxSceneExpansionChunks', 'chunkingStrategy', 'batchSize'];
        for (const key of sharderOnlyKeys) {
            if (Object.prototype.hasOwnProperty.call(settings.ragStandard, key)) {
                delete settings.ragStandard[key];
                migrated = true;
            }
        }
        if (Object.prototype.hasOwnProperty.call(settings.ragStandard, 'retrievalEnabled')) {
            delete settings.ragStandard.retrievalEnabled;
            migrated = true;
        }
    }

    // Migrate legacy sharder auto include key
    if (settings.autoIncludeShards === undefined && settings.singlePassAutoIncludeShards !== undefined) {
        settings.autoIncludeShards = settings.singlePassAutoIncludeShards === true;
        migrated = true;
    }

    if (Object.prototype.hasOwnProperty.call(settings, 'singlePassAutoIncludeShards')) {
        delete settings.singlePassAutoIncludeShards;
        migrated = true;
    }

    // Ensure shard auto-include toggle exists for existing installations
    if (settings.autoIncludeShards === undefined) {
        settings.autoIncludeShards = false;
        migrated = true;
    }

    // Ensure RAG nested defaults exist for existing installations
    if (settings.rag) {
        const ragDefaults = getDefaultSettings().rag;
        if (settings.rag.retrievalEnabled === true && settings.rag.enabled !== true) {
            settings.rag.enabled = true;
            migrated = true;
        }

        for (const [key, value] of Object.entries(ragDefaults)) {
            if (settings.rag[key] === undefined) {
                settings.rag[key] = value;
                migrated = true;
            }
        }

        if (!settings.rag.backendConfig || typeof settings.rag.backendConfig !== 'object') {
            settings.rag.backendConfig = { ...ragDefaults.backendConfig };
            migrated = true;
        } else {
            for (const [key, value] of Object.entries(ragDefaults.backendConfig)) {
                if (settings.rag.backendConfig[key] === undefined) {
                    settings.rag.backendConfig[key] = value;
                    migrated = true;
                }
            }
        }

        if (settings.rag.backendConfig && typeof settings.rag.backendConfig === 'object') {
            const backend = settings.rag.backendConfig;
            const host = String(backend.qdrantHost || 'localhost').trim() || 'localhost';
            const parsedPort = Number.parseInt(String(backend.qdrantPort ?? ''), 10);
            const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6333;

            if (!String(backend.qdrantAddress || '').trim()) {
                backend.qdrantAddress = `${host}:${port}`;
                migrated = true;
            }
            if (backend.qdrantUseCloud === undefined) {
                backend.qdrantUseCloud = String(backend.qdrantUrl || '').trim().length > 0;
                migrated = true;
            }
            if (Object.prototype.hasOwnProperty.call(backend, 'qdrantHost')) {
                delete backend.qdrantHost;
                migrated = true;
            }
            if (Object.prototype.hasOwnProperty.call(backend, 'qdrantPort')) {
                delete backend.qdrantPort;
                migrated = true;
            }
        }

        if (!settings.rag.reranker || typeof settings.rag.reranker !== 'object') {
            settings.rag.reranker = { ...ragDefaults.reranker };
            migrated = true;
        } else {
            for (const [key, value] of Object.entries(ragDefaults.reranker)) {
                if (settings.rag.reranker[key] === undefined) {
                    settings.rag.reranker[key] = value;
                    migrated = true;
                }
            }
        }

        // Migrate embeddingMode → source before validation so 'direct' becomes 'custom'
        if (settings.rag.embeddingMode === 'direct') {
            settings.rag.source = 'custom';
            delete settings.rag.embeddingMode;
            log.debug('Migrated rag.embeddingMode=direct to rag.source=custom');
            migrated = true;
        } else if (settings.rag.embeddingMode !== undefined) {
            delete settings.rag.embeddingMode;
            migrated = true;
        }

        // Migrate reranker.mode → reranker.provider before validation
        if (settings.rag.reranker?.mode === 'direct') {
            settings.rag.reranker.provider = 'custom';
            delete settings.rag.reranker.mode;
            log.debug('Migrated rag.reranker.mode=direct to rag.reranker.provider=custom');
            migrated = true;
        } else if (settings.rag.reranker?.mode !== undefined) {
            settings.rag.reranker.provider = settings.rag.reranker.mode === 'similharity' ? 'similharity' : 'custom';
            delete settings.rag.reranker.mode;
            migrated = true;
        }

        // Ensure sourceConfigs and providerConfigs exist
        if (!settings.rag.sourceConfigs || typeof settings.rag.sourceConfigs !== 'object') {
            settings.rag.sourceConfigs = {};
            migrated = true;
        }
        if (!settings.rag.reranker.providerConfigs || typeof settings.rag.reranker.providerConfigs !== 'object') {
            settings.rag.reranker.providerConfigs = {};
            migrated = true;
        }

        // Seed current flat values into sourceConfigs/providerConfigs if not already present
        const currentSource = settings.rag.source || 'transformers';
        if (!settings.rag.sourceConfigs[currentSource]) {
            const hasValues = (settings.rag.apiUrl || settings.rag.model || settings.rag.embeddingSecretId);
            if (hasValues) {
                settings.rag.sourceConfigs[currentSource] = {
                    apiUrl: settings.rag.apiUrl || '',
                    model: settings.rag.model || '',
                    embeddingSecretId: settings.rag.embeddingSecretId || null,
                };
                migrated = true;
            }
        }
        const currentProvider = settings.rag.reranker.provider || 'similharity';
        if (!settings.rag.reranker.providerConfigs[currentProvider]) {
            const hasValues = (settings.rag.reranker.apiUrl || settings.rag.reranker.model || settings.rag.reranker.secretId);
            if (hasValues) {
                settings.rag.reranker.providerConfigs[currentProvider] = {
                    apiUrl: settings.rag.reranker.apiUrl || '',
                    model: settings.rag.reranker.model || '',
                    secretId: settings.rag.reranker.secretId || null,
                };
                migrated = true;
            }
        }

        const validEmbeddingSources = new Set(['transformers', 'openai', 'ollama', 'llamacpp', 'vllm', 'koboldcpp', 'bananabread', 'extras', 'openrouter', 'linkapi', 'custom']);
        if (!validEmbeddingSources.has(String(settings.rag.source || '').trim().toLowerCase())) {
            settings.rag.source = 'transformers';
            migrated = true;
        }

        const validRerankerProviders = new Set(['similharity', 'openrouter', 'linkapi', 'custom']);
        if (!validRerankerProviders.has(String(settings.rag.reranker.provider || '').trim().toLowerCase())) {
            settings.rag.reranker.provider = 'similharity';
            migrated = true;
        }

        const validChunkingStrategies = new Set(['per_message', 'conversation_turns', 'message_batch', 'scene_aware']);
        if (!validChunkingStrategies.has(settings.rag.chunkingStrategy)) {
            settings.rag.chunkingStrategy = 'per_message';
            migrated = true;
        }

        const validScoringMethods = new Set(['keyword', 'bm25', 'hybrid']);
        if (!validScoringMethods.has(settings.rag.scoringMethod)) {
            settings.rag.scoringMethod = 'keyword';
            migrated = true;
        }

        const validHybridFusionMethods = new Set(['rrf', 'weighted']);
        if (!validHybridFusionMethods.has(settings.rag.hybridFusionMethod)) {
            settings.rag.hybridFusionMethod = 'rrf';
            migrated = true;
        }

        if (!Number.isFinite(settings.rag.hybridRrfK) || settings.rag.hybridRrfK < 1) {
            settings.rag.hybridRrfK = 60;
            migrated = true;
        }

        if (!Number.isFinite(settings.rag.hybridAlpha) || settings.rag.hybridAlpha < 0) {
            settings.rag.hybridAlpha = 0.4;
            migrated = true;
        }

        if (!Number.isFinite(settings.rag.hybridBeta) || settings.rag.hybridBeta < 0) {
            settings.rag.hybridBeta = 0.6;
            migrated = true;
        }

        if (!Number.isFinite(settings.rag.hybridOverfetchMultiplier) || settings.rag.hybridOverfetchMultiplier < 1) {
            settings.rag.hybridOverfetchMultiplier = 4;
            migrated = true;
        }

        // Scene-aware shard chunking has been retired in favor of standard + section modes.
        if (settings.rag.sceneAwareChunking !== false) {
            settings.rag.sceneAwareChunking = false;
            migrated = true;
        }

        const removedRagKeys = [
            'vectorizeChat',
            'chatVectorMigrationHandled',
            'temporalDecay',
            'decayMode',
            'decayFunction',
            'decayHalfLife',
            'decayFloor',
            'dualVector',
            'dualVectorRadius',
            'retrievalEnabled',
        ];
        for (const key of removedRagKeys) {
            if (Object.prototype.hasOwnProperty.call(settings.rag, key)) {
                delete settings.rag[key];
                migrated = true;
            }
        }

        const normalizedVectorizationLorebookNames = [
            ...new Set(
                (Array.isArray(settings.rag.vectorizationLorebookNames)
                    ? settings.rag.vectorizationLorebookNames
                    : [])
                    .map(name => String(name || '').trim())
                    .filter(Boolean)
            )
        ];
        const previousVectorizationLorebookNames = Array.isArray(settings.rag.vectorizationLorebookNames)
            ? settings.rag.vectorizationLorebookNames
            : null;
        const lorebookNamesChanged = !previousVectorizationLorebookNames
            || previousVectorizationLorebookNames.length !== normalizedVectorizationLorebookNames.length
            || previousVectorizationLorebookNames.some((name, idx) => name !== normalizedVectorizationLorebookNames[idx]);
        if (lorebookNamesChanged) {
            settings.rag.vectorizationLorebookNames = normalizedVectorizationLorebookNames;
            migrated = true;
        }

        const normalizedUseLorebooksForVectorization = settings.rag.useLorebooksForVectorization === true;
        if (settings.rag.useLorebooksForVectorization !== normalizedUseLorebooksForVectorization) {
            settings.rag.useLorebooksForVectorization = normalizedUseLorebooksForVectorization;
            migrated = true;
        }
    }

    // Migrate ragStandard embeddingMode and reranker.mode (same logic as rag, handled outside the if block)
    if (settings.ragStandard?.embeddingMode === 'direct') {
        settings.ragStandard.source = 'custom';
        delete settings.ragStandard.embeddingMode;
        log.debug('Migrated ragStandard.embeddingMode=direct to ragStandard.source=custom');
        migrated = true;
    } else if (settings.ragStandard?.embeddingMode !== undefined) {
        delete settings.ragStandard.embeddingMode;
        migrated = true;
    }

    if (settings.ragStandard?.reranker?.mode === 'direct') {
        settings.ragStandard.reranker.provider = 'custom';
        delete settings.ragStandard.reranker.mode;
        log.debug('Migrated ragStandard.reranker.mode=direct to ragStandard.reranker.provider=custom');
        migrated = true;
    } else if (settings.ragStandard?.reranker?.mode !== undefined) {
        settings.ragStandard.reranker.provider = settings.ragStandard.reranker.mode === 'similharity' ? 'similharity' : 'custom';
        delete settings.ragStandard.reranker.mode;
        migrated = true;
    }

    if (migrated) {
        log.log('Settings migrated');
        saveSettings(settings);
    }

    return settings;
}



