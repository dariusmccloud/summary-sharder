import { chat_metadata, saveMetadata } from '../../../../../../script.js';
import { loadWorldInfo } from '../../../../../world-info.js';
import {
    ARCHITECTURAL_PROFILE,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import {
    attachChatBindingToScopeRegistry,
    bindChatToArchitecturalMemoryScope,
    buildArchitecturalDecisionAuthorityInput,
    buildArchitecturalImportedProjectionDiagnostic,
    commitArchitecturalScopeAuthorityUpdate,
    loadArchitecturalScopeRegistry,
    resolveProjectionAuthoritySet,
} from './architectural-authority-store.js';

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
    await attachChatBindingToScopeRegistry(binding, { now: options.now });
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
        return {
            committed: false,
            reason: 'missing-chat-id',
            projectionMetadata: null,
            diagnostics: [],
        };
    }

    const binding = await ensureArchitecturalChatScopeBinding(normalizedChatId, { now });
    const scopeRegistry = await loadArchitecturalScopeRegistry(binding.memoryScopeId);
    const importedProjectionDiagnostic = buildArchitecturalImportedProjectionDiagnostic(binding, scopeRegistry);
    const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
    const sections = parseArchitecturalExtractionResponse(String(summary || ''), registry);
    const decisionItems = Array.isArray(sections?.decisions) ? sections.decisions : [];
    const authorityInputs = [];

    for (const item of decisionItems) {
        if (item?.selected === false) continue;
        const authorityInput = await buildArchitecturalDecisionAuthorityInput(item);
        if (!authorityInput.decisionId || authorityInput.parserErrors.length > 0) continue;
        authorityInputs.push(authorityInput);
    }

    const expectedDecisionVersionsById = {};
    const baselineDecisions = baselineLedger?.decisionsById || baselineLedger || {};
    for (const [decisionId, entry] of Object.entries(baselineDecisions || {})) {
        const version = entry?.authority?.currentRecordVersion;
        if (Number.isFinite(version)) {
            expectedDecisionVersionsById[decisionId] = version;
        }
    }

    try {
        const authorityCommit = await commitArchitecturalScopeAuthorityUpdate({
            memoryScopeId: binding.memoryScopeId,
            scopeAlias: binding.scopeAlias || '',
            expectedScopeVersion: scopeRegistry?.scopeVersion ?? null,
            expectedDecisionVersionsById,
            decisions: authorityInputs,
            sourceChatId: normalizedChatId,
            now,
        });

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

        ensureProjectionStore(chat_metadata)[projectionKeyFromIdentity({
            source: projectionMetadata.source,
            uid: projectionMetadata.uid,
            startIndex,
            endIndex,
        })] = projectionMetadata;
        await saveMetadata();

        return {
            committed: true,
            projectionMetadata,
            diagnostics: importedProjectionDiagnostic ? [importedProjectionDiagnostic] : [],
        };
    } catch (error) {
        const projectionMetadata = {
            schemaVersion: PROJECTION_METADATA_SCHEMA_VERSION,
            source: mode === 'lorebook' ? 'lorebook' : 'system',
            uid: outputUID || null,
            startIndex,
            endIndex,
            memoryScopeId: binding.memoryScopeId,
            authorityCommitBlocked: true,
            authorityBlockCode: String(error?.code || 'ARCH_AUTHORITY_COMMIT_BLOCKED'),
            savedAt: Number.isFinite(now) ? now : Date.now(),
        };
        ensureProjectionStore(chat_metadata)[projectionKeyFromIdentity({
            source: projectionMetadata.source,
            uid: projectionMetadata.uid,
            startIndex,
            endIndex,
        })] = projectionMetadata;
        await saveMetadata();

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

    return await resolveProjectionAuthoritySet(memoryScopeId, projectionState);
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

    const authorityContext = await resolveArchitecturalProjectionContext(metadata.memoryScopeId, metadata);
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
