export const SUMMARY_SHARDER_NAMESPACE = 'summary_sharder';
export const MESSAGE_IDENTITY_SCHEMA_VERSION = 1;
export const CHAT_IDENTITY_STATUS_SCHEMA_VERSION = 1;
export const EVIDENCE_POLICY_INCLUDE = 'include';
export const EVIDENCE_POLICY_EXCLUDE = 'exclude';
export const IDENTITY_STATUS_VALUES = Object.freeze([
    'IDENTITY_COMPLETE',
    'IDENTITY_PARTIAL',
    'IDENTITY_AMBIGUOUS',
    'IDENTITY_UNRECOVERABLE',
]);

export function getMessageIdentitySchemaDescriptor() {
    return {
        namespace: SUMMARY_SHARDER_NAMESPACE,
        messageIdentity: {
            path: `extra.${SUMMARY_SHARDER_NAMESPACE}.messageIdentity`,
            schemaVersion: MESSAGE_IDENTITY_SCHEMA_VERSION,
            fields: {
                schemaVersion: 'extra.summary_sharder.messageIdentity.schemaVersion',
                messageId: 'extra.summary_sharder.messageIdentity.messageId',
                initFingerprint: 'extra.summary_sharder.messageIdentity.initFingerprint',
                revisionHash: 'extra.summary_sharder.messageIdentity.revisionHash',
            },
        },
        archive: {
            path: `extra.${SUMMARY_SHARDER_NAMESPACE}.archive`,
            fields: {
                isArchived: 'extra.summary_sharder.archive.isArchived',
                archivedAt: 'extra.summary_sharder.archive.archivedAt',
                promptVisibilityBeforeArchive: 'extra.summary_sharder.archive.promptVisibilityBeforeArchive',
            },
            defaultArchived: false,
        },
        evidencePolicy: {
            path: `extra.${SUMMARY_SHARDER_NAMESPACE}.evidencePolicy`,
            defaultValue: EVIDENCE_POLICY_INCLUDE,
            allowedValues: [EVIDENCE_POLICY_INCLUDE, EVIDENCE_POLICY_EXCLUDE],
        },
        speakerIdentity: {
            path: `extra.${SUMMARY_SHARDER_NAMESPACE}.speakerIdentity`,
            fields: {
                speakerEntityId: 'extra.summary_sharder.speakerIdentity.speakerEntityId',
                speakerPathAtInit: 'extra.summary_sharder.speakerIdentity.speakerPathAtInit',
                displayNameAtInit: 'extra.summary_sharder.speakerIdentity.displayNameAtInit',
                sourceType: 'extra.summary_sharder.speakerIdentity.sourceType',
            },
        },
        chatIdentityStatus: {
            path: `chat_metadata.${SUMMARY_SHARDER_NAMESPACE}.messageIdentity`,
            schemaVersion: CHAT_IDENTITY_STATUS_SCHEMA_VERSION,
            allowedValues: [...IDENTITY_STATUS_VALUES],
        },
        promptVisibility: {
            hostField: 'is_system',
            shownValue: false,
            hiddenValue: true,
        },
    };
}

export function getSummarySharderMessageRoot(message) {
    const extra = message?.extra;
    if (!extra || typeof extra !== 'object') {
        return null;
    }
    const root = extra[SUMMARY_SHARDER_NAMESPACE];
    return root && typeof root === 'object' ? root : null;
}

export function getMessageIdentityMetadata(message) {
    const root = getSummarySharderMessageRoot(message);
    const metadata = root?.messageIdentity;
    return metadata && typeof metadata === 'object' ? metadata : null;
}

export function getMessageArchiveMetadata(message) {
    const root = getSummarySharderMessageRoot(message);
    const metadata = root?.archive;
    return metadata && typeof metadata === 'object' ? metadata : null;
}

export function getMessageEvidencePolicy(message) {
    const root = getSummarySharderMessageRoot(message);
    const value = root?.evidencePolicy;
    if (value === EVIDENCE_POLICY_EXCLUDE) {
        return EVIDENCE_POLICY_EXCLUDE;
    }
    return EVIDENCE_POLICY_INCLUDE;
}

export function getMessageSpeakerIdentity(message) {
    const root = getSummarySharderMessageRoot(message);
    const metadata = root?.speakerIdentity;
    return metadata && typeof metadata === 'object' ? metadata : null;
}

export function getChatIdentityStatusMetadata(chatMetadata) {
    const root = chatMetadata?.[SUMMARY_SHARDER_NAMESPACE];
    const metadata = root?.messageIdentity;
    return metadata && typeof metadata === 'object' ? metadata : null;
}

export function summarizeMessageIdentitySurface(messages = [], chatMetadata = {}) {
    const summary = {
        schema: getMessageIdentitySchemaDescriptor(),
        messageCount: Array.isArray(messages) ? messages.length : 0,
        promptHiddenCount: 0,
        swipeCarrierCount: 0,
        identity: {
            presentCount: 0,
            missingCount: 0,
            malformedCount: 0,
            duplicateIds: [],
        },
        archive: {
            archivedCount: 0,
            promptVisibilityBeforeArchiveCount: 0,
        },
        evidencePolicy: {
            includeCount: 0,
            excludeCount: 0,
        },
        speakerIdentityCount: 0,
        chatIdentityStatus: null,
    };

    const seenIds = new Set();
    const duplicateIds = new Set();

    for (const message of Array.isArray(messages) ? messages : []) {
        if (message?.is_system === true) {
            summary.promptHiddenCount += 1;
        }
        if (Array.isArray(message?.swipes) || message?.swipe_id !== undefined || message?.swipe_info !== undefined) {
            summary.swipeCarrierCount += 1;
        }

        const identity = getMessageIdentityMetadata(message);
        if (identity) {
            const messageId = String(identity.messageId || '').trim();
            const initFingerprint = String(identity.initFingerprint || '').trim();
            const revisionHash = String(identity.revisionHash || '').trim();
            if (messageId && initFingerprint && revisionHash) {
                summary.identity.presentCount += 1;
                if (seenIds.has(messageId)) {
                    duplicateIds.add(messageId);
                } else {
                    seenIds.add(messageId);
                }
            } else {
                summary.identity.malformedCount += 1;
            }
        } else {
            summary.identity.missingCount += 1;
        }

        const archive = getMessageArchiveMetadata(message);
        if (archive?.isArchived === true) {
            summary.archive.archivedCount += 1;
            if (archive.promptVisibilityBeforeArchive !== undefined && archive.promptVisibilityBeforeArchive !== null) {
                summary.archive.promptVisibilityBeforeArchiveCount += 1;
            }
        }

        const evidencePolicy = getMessageEvidencePolicy(message);
        if (evidencePolicy === EVIDENCE_POLICY_EXCLUDE) {
            summary.evidencePolicy.excludeCount += 1;
        } else {
            summary.evidencePolicy.includeCount += 1;
        }

        if (getMessageSpeakerIdentity(message)) {
            summary.speakerIdentityCount += 1;
        }
    }

    summary.identity.duplicateIds = [...duplicateIds].sort();
    summary.chatIdentityStatus = getChatIdentityStatusMetadata(chatMetadata);

    return summary;
}
