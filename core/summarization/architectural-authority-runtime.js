import { chat_metadata, saveMetadata } from '../../../../../../script.js';
import { loadWorldInfo } from '../../../../../world-info.js';
import {
    ARCHITECTURAL_PROFILE,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import {
    bindChatToArchitecturalMemoryScope,
    buildArchitecturalDecisionAuthorityInput,
    exportLegacyArchitecturalAuthorityPayload,
    hasLegacyArchitecturalAuthorityData,
} from './architectural-authority-store.js';
import {
    bindArchitecturalAuthorityChat,
    commitArchitecturalAuthorityServerUpdate,
    initArchitecturalAuthorityServer,
    loadArchitecturalMessageIdentitySchema,
    loadArchitecturalAuthorityCurrentDecisions,
    migrateArchitecturalBrowserStore,
    scanArchitecturalPersistedChatMetadata,
    validateArchitecturalBrowserMigration,
} from './architectural-authority-server-api.js';
import { recordArchitecturalIntegrationEvent } from './architectural-authority-integration.js';
import {
    getMessageIdentitySchemaDescriptor,
    summarizeMessageIdentitySurface,
} from './message-identity-schema.js';

const PROJECTION_METADATA_SCHEMA_VERSION = 1;

function getSummarySharderMetadataRoot(root = chat_metadata) {
    if (!root.summary_sharder) {
        root.summary_sharder = {};
    }
    return root.summary_sharder;
}

function normalizeChatId(chatId) {
    return String(chatId || '').trim().replace(/\.jsonl$/i, '').replace(/\.json$/i, '').trim();
}

function projectionKeyFromIdentity({ source = 'system', uid = null, startIndex = null, endIndex = null }) {
    const identity = uid ? `${source}:${uid}` : `${source}:${startIndex ?? '?'}-${endIndex ?? '?'}`;
    return String(identity);
}

function ensureProjectionStore(root = chat_metadata) {
    const ss = getSummarySharderMetadataRoot(root);
    if (!ss.architecturalProjectionRegistry || typeof ss.architecturalProjectionRegistry !== 'object') {
        ss.architecturalProjectionRegistry = {};
    }
    return ss.architecturalProjectionRegistry;
}

function ensureServerState(root = chat_metadata) {
    const ss = getSummarySharderMetadataRoot(root);
    if (!ss.architecturalAuthorityServerState || typeof ss.architecturalAuthorityServerState !== 'object') {
        ss.architecturalAuthorityServerState = {};
    }
    return ss.architecturalAuthorityServerState;
}

async function ensureArchitecturalAuthorityServerReady() {
    const response = await initArchitecturalAuthorityServer();
    return response?.manifest || null;
}

async function migrateLegacyAuthorityStoreIfNeeded() {
    const serverState = ensureServerState(chat_metadata);
    if (serverState.browserStoreMigratedAt) {
        return;
    }

    const hasLegacy = await hasLegacyArchitecturalAuthorityData();
    if (!hasLegacy) {
        serverState.browserStoreMigratedAt = null;
        serverState.migrationSkippedAt = Date.now();
        await saveMetadata();
        return;
    }

    const payload = await exportLegacyArchitecturalAuthorityPayload();
    await validateArchitecturalBrowserMigration(payload);
    await migrateArchitecturalBrowserStore(payload);
    serverState.browserStoreMigratedAt = Date.now();
    await saveMetadata();
}

export function getArchitecturalProjectionMetadata(root, identity) {
    const registry = ensureProjectionStore(root);
    const key = projectionKeyFromIdentity(identity || {});
    return registry[key] || null;
}

export function getArchitecturalChatBinding(root = chat_metadata) {
    const ss = getSummarySharderMetadataRoot(root);
    return ss.architecturalMemoryBinding || null;
}

export async function ensureArchitecturalChatScopeBinding(chatId, options = {}) {
    const ss = getSummarySharderMetadataRoot(chat_metadata);
    const binding = await bindChatToArchitecturalMemoryScope({ summary_sharder: ss }, {
        chatId,
        requestedScopeId: options.memoryScopeId || null,
        requestedScopeAlias: options.scopeAlias || '',
        now: options.now,
    });
    await ensureArchitecturalAuthorityServerReady();
    await bindArchitecturalAuthorityChat(binding.memoryScopeId, {
        chatInstanceId: binding.chatInstanceId,
        chatLocator: binding.chatId,
        scopeAlias: binding.scopeAlias || '',
        branchedFromChatInstanceId: binding.branchedFromChatInstanceId || null,
        importedFromChatInstanceId: binding.importedFromChatInstanceId || null,
        now: options.now,
    });
    await saveMetadata();
    return binding;
}

export async function persistArchitecturalAuthorityProjection(summary, options = {}) {
    const {
        chatId,
        outputUID = null,
        mode = 'system',
        startIndex = null,
        endIndex = null,
        baselineLedger = null,
        now = Date.now(),
    } = options;

    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedChatId) {
        recordArchitecturalIntegrationEvent('AUTHORITY_ADOPTION_BLOCKED', {
            profile: ARCHITECTURAL_PROFILE,
            mode,
            memoryScopeId: null,
            outputUID,
            code: 'ARCH_AUTHORITY_MISSING_CHAT_ID',
            message: 'Architectural authority commit was skipped because no active chat id was available after host save.',
            stage: 'binding',
        });
        return {
            committed: false,
            reason: 'missing-chat-id',
            projectionMetadata: null,
            diagnostics: [],
        };
    }

    let stage = 'binding';
    let binding = null;

    try {
        binding = await ensureArchitecturalChatScopeBinding(normalizedChatId, { now });
        stage = 'migration';
        await migrateLegacyAuthorityStoreIfNeeded();

        stage = 'parse-sections';
        const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
        const sections = parseArchitecturalExtractionResponse(String(summary || ''), registry);
        const decisionItems = Array.isArray(sections?.decisions) ? sections.decisions : [];
        const authorityInputs = [];

        stage = 'build-authority-inputs';
        for (const item of decisionItems) {
            if (item?.selected === false) continue;
            const authorityInput = await buildArchitecturalDecisionAuthorityInput(item);
            if (!authorityInput.decisionId || authorityInput.parserErrors.length > 0) continue;
            authorityInputs.push(authorityInput);
        }

        stage = 'baseline-version-map';
        const expectedDecisionVersionsById = {};
        const baselineDecisions = baselineLedger?.decisionsById || baselineLedger || {};
        for (const [decisionId, entry] of Object.entries(baselineDecisions || {})) {
            const version = entry?.authority?.currentRecordVersion;
            if (Number.isFinite(version)) {
                expectedDecisionVersionsById[decisionId] = version;
            }
        }

        stage = 'commit-start';
        recordArchitecturalIntegrationEvent('AUTHORITY_ADOPTION_STARTED', {
            profile: ARCHITECTURAL_PROFILE,
            mode,
            memoryScopeId: binding.memoryScopeId,
            chatInstanceId: binding.chatInstanceId,
            decisionIds: authorityInputs.map((input) => input.decisionId),
            expectedScopeVersion: baselineLedger?.scopeVersion ?? null,
            expectedDecisionVersionsById,
        });

        stage = 'commit-request';
        const authorityCommit = await commitArchitecturalAuthorityServerUpdate(binding.memoryScopeId, {
            scopeAlias: binding.scopeAlias || '',
            sourceChatInstanceId: binding.chatInstanceId,
            expectedScopeVersion: baselineLedger?.scopeVersion ?? null,
            expectedDecisionVersionsById,
            decisions: authorityInputs,
            now,
        });

        stage = 'projection-metadata';
        const projectionMetadata = {
            schemaVersion: PROJECTION_METADATA_SCHEMA_VERSION,
            source: mode === 'lorebook' ? 'lorebook' : 'system',
            uid: outputUID || null,
            startIndex,
            endIndex,
            memoryScopeId: binding.memoryScopeId,
            scopeVersion: authorityCommit.registry.scopeVersion,
            currentScopeRun: authorityCommit.registry.currentScopeRun,
            decisionVersionsById: Object.fromEntries(
                Object.entries(authorityCommit.projectionState || {})
                    .map(([decisionId, ref]) => [decisionId, ref.currentRecordVersion])
            ),
            canonicalHashesById: Object.fromEntries(
                Object.entries(authorityCommit.projectionState || {})
                    .map(([decisionId, ref]) => [decisionId, ref.canonicalHash])
            ),
            savedAt: Number.isFinite(now) ? now : Date.now(),
        };

        stage = 'projection-save';
        ensureProjectionStore(chat_metadata)[projectionKeyFromIdentity({
            source: projectionMetadata.source,
            uid: projectionMetadata.uid,
            startIndex,
            endIndex,
        })] = projectionMetadata;
        await saveMetadata();

        recordArchitecturalIntegrationEvent('AUTHORITY_ADOPTION_COMMITTED', {
            profile: ARCHITECTURAL_PROFILE,
            mode,
            memoryScopeId: binding.memoryScopeId,
            scopeVersion: authorityCommit.registry.scopeVersion,
            currentScopeRun: authorityCommit.registry.currentScopeRun,
            decisionVersionsById: projectionMetadata.decisionVersionsById,
            canonicalHashesById: projectionMetadata.canonicalHashesById,
            outputUID,
        });

        return {
            committed: true,
            projectionMetadata,
            diagnostics: [],
        };
    } catch (error) {
        const failureStage = String(error?.stage || stage || 'unknown');
        recordArchitecturalIntegrationEvent('AUTHORITY_ADOPTION_FAILED', {
            profile: ARCHITECTURAL_PROFILE,
            mode,
            stage: failureStage,
            code: String(error?.code || 'ARCH_AUTHORITY_ADOPTION_FAILED'),
            message: String(error?.message || 'Architectural authority adoption failed before commit completion.'),
            outputUID,
        });
        const projectionMetadata = {
            schemaVersion: PROJECTION_METADATA_SCHEMA_VERSION,
            source: mode === 'lorebook' ? 'lorebook' : 'system',
            uid: outputUID || null,
            startIndex,
            endIndex,
            memoryScopeId: binding?.memoryScopeId || getArchitecturalChatBinding(chat_metadata)?.memoryScopeId || null,
            authorityCommitBlocked: true,
            authorityBlockCode: String(error?.code || 'ARCH_AUTHORITY_COMMIT_BLOCKED'),
            authorityFailureStage: failureStage,
            savedAt: Number.isFinite(now) ? now : Date.now(),
        };
        ensureProjectionStore(chat_metadata)[projectionKeyFromIdentity({
            source: projectionMetadata.source,
            uid: projectionMetadata.uid,
            startIndex,
            endIndex,
        })] = projectionMetadata;
        await saveMetadata();

        recordArchitecturalIntegrationEvent('AUTHORITY_ADOPTION_BLOCKED', {
            profile: ARCHITECTURAL_PROFILE,
            mode,
            memoryScopeId: projectionMetadata.memoryScopeId,
            outputUID,
            code: String(error?.code || 'ARCH_AUTHORITY_COMMIT_BLOCKED'),
            message: String(error?.message || 'Architectural authority commit was blocked.'),
            stage: failureStage,
        });
        return {
            committed: false,
            reason: error?.code || 'authority-commit-blocked',
            error,
            projectionMetadata,
            diagnostics: [{
                level: 'warning',
                code: String(error?.code || 'ARCH_AUTHORITY_COMMIT_BLOCKED'),
                message: String(error?.message || 'Architectural authority commit was blocked.'),
            }],
        };
    }
}

export async function resolveArchitecturalProjectionContext(memoryScopeId, projectionMetadata = null) {
    const projectionState = {};
    const decisionVersionsById = projectionMetadata?.decisionVersionsById || {};
    const canonicalHashesById = projectionMetadata?.canonicalHashesById || {};

    for (const decisionId of Object.keys(decisionVersionsById)) {
        projectionState[decisionId] = {
            decisionId,
            currentRecordVersion: decisionVersionsById[decisionId],
            canonicalHash: canonicalHashesById[decisionId] || null,
        };
    }

    const response = await loadArchitecturalAuthorityCurrentDecisions(memoryScopeId, Object.keys(projectionState));
    const resolved = {};
    const diagnostics = [];

    for (const [decisionId, projectionRef] of Object.entries(projectionState)) {
        const authority = response?.decisions?.[decisionId] || null;
        if (!authority?.pointer) {
            continue;
        }

        const stale = String(authority.pointer.canonicalHash || '') !== String(projectionRef.canonicalHash || '')
            || Number(authority.pointer.currentRecordVersion || 0) !== Number(projectionRef.currentRecordVersion || 0);

        resolved[decisionId] = {
            ...projectionRef,
            authority: authority.pointer,
            stale,
        };

        if (stale) {
            diagnostics.push({
                level: 'warning',
                code: 'ARCH_SCOPE_PROJECTION_STALE',
                message: `Projection for decision ${decisionId} is stale relative to current scope authority.`,
                recordId: decisionId,
            });
        }
    }

    return {
        projectionState: resolved,
        diagnostics,
    };
}

export async function getArchitecturalProjectionMetadataForSavedItem(item, options = {}) {
    const root = options.chatMetadata || chat_metadata;
    const source = item?.source === 'lorebook' ? 'lorebook' : 'system';
    const metadata = getArchitecturalProjectionMetadata(root, {
        source,
        uid: item?.uid ?? item?.entryId ?? null,
        startIndex: item?.startIndex ?? item?.messageRangeStart ?? null,
        endIndex: item?.endIndex ?? item?.messageRangeEnd ?? null,
    });

    if (!metadata?.memoryScopeId) {
        return null;
    }

    let authorityContext;
    try {
        authorityContext = await resolveArchitecturalProjectionContext(metadata.memoryScopeId, metadata);
    } catch (error) {
        authorityContext = {
            projectionState: {},
            diagnostics: [{
                level: 'warning',
                code: String(error?.code || 'ARCH_AUTHORITY_CONTEXT_UNAVAILABLE'),
                message: String(error?.message || 'Architectural authority context is unavailable.'),
            }],
        };
    }
    return {
        ...metadata,
        authorityContext,
    };
}

export async function loadArchitecturalLorebookContent(entry) {
    const bookName = String(entry?.world || entry?.book || '').trim();
    if (!bookName) return null;
    try {
        return await loadWorldInfo(bookName);
    } catch {
        return null;
    }
}

export function buildArchitecturalMessageIdentityScanLocator(options = {}) {
    const context = options.context || globalThis.SillyTavern?.getContext?.() || {};
    const chatLocator = normalizeChatId(options.chatId ?? context.chatId ?? '');
    if (!chatLocator) {
        return null;
    }

    const groupId = String(options.groupId ?? context.groupId ?? context.group_id ?? '').trim();
    if (groupId) {
        return {
            isGroup: true,
            groupId,
            chatLocator,
        };
    }

    const avatarUrl = String(
        options.avatarUrl
        || context.characters?.[context.characterId]?.avatar
        || ''
    ).trim();

    if (!avatarUrl) {
        return null;
    }

    return {
        isGroup: false,
        avatarUrl,
        chatLocator,
    };
}

export async function scanArchitecturalMessageIdentityReadiness(options = {}) {
    const context = options.context || globalThis.SillyTavern?.getContext?.() || {};
    const chatState = Array.isArray(options.messages) ? options.messages : (Array.isArray(context.chat) ? context.chat : []);
    const metadata = options.chatMetadata || context.chat_metadata || chat_metadata || {};
    const schema = getMessageIdentitySchemaDescriptor();
    const live = summarizeMessageIdentitySurface(chatState, metadata);
    const locator = options.locator || buildArchitecturalMessageIdentityScanLocator({
        context,
        chatId: options.chatId,
        avatarUrl: options.avatarUrl,
        groupId: options.groupId,
    });

    const diagnostics = [];
    let persisted = null;
    let serverSchema = null;

    try {
        serverSchema = await loadArchitecturalMessageIdentitySchema();
    } catch (error) {
        diagnostics.push({
            level: 'warning',
            code: String(error?.code || 'ARCH_MESSAGE_IDENTITY_SCHEMA_UNAVAILABLE'),
            message: String(error?.message || 'Message identity schema endpoint is unavailable.'),
        });
    }

    if (locator) {
        try {
            persisted = await scanArchitecturalPersistedChatMetadata(locator);
        } catch (error) {
            diagnostics.push({
                level: 'warning',
                code: String(error?.code || 'ARCH_PERSISTED_CHAT_SCAN_UNAVAILABLE'),
                message: String(error?.message || 'Persisted chat metadata scan is unavailable.'),
            });
        }
    } else {
        diagnostics.push({
            level: 'warning',
            code: 'ARCH_CHAT_SCAN_LOCATOR_UNAVAILABLE',
            message: 'A persisted chat scan locator could not be derived from the active context.',
        });
    }

    return {
        phase: 'c0.25a',
        schema,
        serverSchema,
        locator,
        live,
        persisted,
        diagnostics,
    };
}
