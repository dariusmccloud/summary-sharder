import crypto from 'node:crypto';

export const ARCHITECTURAL_REBUILD_PROTOCOL_VERSION = 'architectural-rebuild-protocol/v1';
export const ARCHITECTURAL_REBUILD_MANIFEST_SCHEMA_VERSION = 1;
export const ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION = 1;
export const ARCHITECTURAL_DIALOGUE_CLAIM_ID_VERSION = 1;
export const ARCHITECTURAL_DIALOGUE_NORMALIZATION_VERSION = 1;
export const ARCHITECTURAL_DIALOGUE_EXTRACTION_RULE_VERSION = 1;

export const TIER2_EXTRACTION_MODE = Object.freeze({
    DETERMINISTIC: 'deterministic',
});

export const TIER2_CLAIM_CLASS = Object.freeze({
    DECISION: 'DECISION',
    CORRECTION: 'CORRECTION',
    SUPERSESSION: 'SUPERSESSION',
    UNRESOLVED_COMMITMENT: 'UNRESOLVED_COMMITMENT',
});

export const TIER2_CLAIM_STATE = Object.freeze({
    PROPOSED: 'PROPOSED',
    ACCEPTED: 'ACCEPTED',
    SEALED: 'SEALED',
    SUPERSEDED: 'SUPERSEDED',
    UNRESOLVED: 'UNRESOLVED',
});

export const TIER2_AUTHORITY_CLASS = Object.freeze({
    USER_AUTHORITY: 'USER_AUTHORITY',
    CHARACTER_SELF_AUTHORITY: 'CHARACTER_SELF_AUTHORITY',
    SYSTEM_GOVERNANCE_AUTHORITY: 'SYSTEM_GOVERNANCE_AUTHORITY',
    ASSISTANT_PROPOSAL: 'ASSISTANT_PROPOSAL',
    UNKNOWN_AUTHORITY: 'UNKNOWN_AUTHORITY',
});

export const TIER2_CLAIM_ZONE_CLASS = Object.freeze({
    ASSERTED_BODY: 'ASSERTED_BODY',
    MENTION_CODE: 'MENTION_CODE',
    MENTION_QUOTE: 'MENTION_QUOTE',
    MENTION_LOG: 'MENTION_LOG',
    MENTION_EXAMPLE: 'MENTION_EXAMPLE',
    MENTION_REJECTED_ALTERNATIVE: 'MENTION_REJECTED_ALTERNATIVE',
    MENTION_ATTRIBUTED: 'MENTION_ATTRIBUTED',
});

export const TIER2_CONFIDENCE_CLASS = Object.freeze({
    EXPLICIT_DETERMINISTIC: 'EXPLICIT_DETERMINISTIC',
    AMBIGUOUS: 'AMBIGUOUS',
    CONFLICTED: 'CONFLICTED',
    OUT_OF_SCOPE: 'OUT_OF_SCOPE',
    NON_ADMITTED_MENTION: 'NON_ADMITTED_MENTION',
    CONTEXT_DEPENDENT: 'CONTEXT_DEPENDENT',
});

export const TIER2_REVIEW_KIND = Object.freeze({
    POSSIBLE_CORROBORATION: 'POSSIBLE_CORROBORATION',
    CONTEXT_DEPENDENT_CANDIDATE: 'CONTEXT_DEPENDENT_CANDIDATE',
    NON_ADMITTED_MENTION: 'NON_ADMITTED_MENTION',
    INCOMPLETE_SUPERSESSION: 'INCOMPLETE_SUPERSESSION',
    DETERMINISTIC_CORRECTION_REVIEW_REQUIRED: 'DETERMINISTIC_CORRECTION_REVIEW_REQUIRED',
    TARGET_RECORD_MISSING: 'TARGET_RECORD_MISSING',
});

export const TIER2_RECONCILIATION_BASIS = Object.freeze({
    EXPLICIT_RECORD_ID: 'EXPLICIT_RECORD_ID',
    EXACT_CANONICAL_PAYLOAD_MATCH: 'EXACT_CANONICAL_PAYLOAD_MATCH',
    GOVERNED_ALIAS_MAPPING: 'GOVERNED_ALIAS_MAPPING',
    EXPLICIT_TARGET_RELATIONSHIP: 'EXPLICIT_TARGET_RELATIONSHIP',
    SELF_CONTAINED_TIER2_DECISION: 'SELF_CONTAINED_TIER2_DECISION',
    EXACT_DECISION_TEXT_MATCH: 'EXACT_DECISION_TEXT_MATCH',
});

export const TIER2_CLAIM_RELATIONSHIP = Object.freeze({
    CORROBORATES: 'CORROBORATES',
    CORRECTS: 'CORRECTS',
    SUPERSEDES: 'SUPERSEDES',
    CREATES_RECORD: 'CREATES_RECORD',
    TARGETS_RECORD: 'TARGETS_RECORD',
});

export const RECONSTRUCTION_STATUS = Object.freeze({
    INITIALIZED: 'INITIALIZED',
    MANIFEST_FROZEN: 'MANIFEST_FROZEN',
    COMPILING: 'COMPILING',
    VALIDATING: 'VALIDATING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    INVALID: 'INVALID',
    INVALIDATED_SOURCE_MUTATION: 'INVALIDATED_SOURCE_MUTATION',
});

export const TERMINAL_RECONSTRUCTION_STATUS = new Set([
    RECONSTRUCTION_STATUS.SUCCEEDED,
    RECONSTRUCTION_STATUS.FAILED,
    RECONSTRUCTION_STATUS.INVALID,
    RECONSTRUCTION_STATUS.INVALIDATED_SOURCE_MUTATION,
]);

export function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function sha256Text(text) {
    return `sha256:${crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex')}`;
}

export function buildDeterministicHashId(prefix, version, payload) {
    return `${prefix}v${version}:${sha256Text(stableStringify(payload))}`;
}

export function canonicalizeRow(row, ignoredColumns = []) {
    const ignore = new Set(ignoredColumns);
    const normalized = {};
    for (const [key, value] of Object.entries(row || {})) {
        if (ignore.has(key)) continue;
        normalized[key] = value ?? null;
    }
    return normalized;
}

export function buildDeterministicTableDump(tableSpecs, rowProvider) {
    const tables = {};
    for (const spec of tableSpecs) {
        const rows = rowProvider(spec.name)
            .map((row) => canonicalizeRow(row, spec.ignoredColumns || []))
            .sort((left, right) => {
                const a = stableStringify(left);
                const b = stableStringify(right);
                return a.localeCompare(b);
            });
        tables[spec.name] = rows;
    }
    return tables;
}

export function hashDeterministicTableDump(dump) {
    return sha256Text(stableStringify(dump));
}

export function summarizeCompactRebuildReport(report) {
    const input = report?.inputSummary || {};
    const output = report?.outputSummary || {};
    return [
        `Run ${report?.reconstructionRunId || 'unknown'} for scope ${report?.memoryScopeId || 'unknown'} finished with status ${report?.status || 'unknown'}.`,
        `Inputs: ${Number(input.totalFiles || 0)} file(s), ${Number(input.totalArtifacts || 0)} artifact(s), ${Number(input.admittedArtifacts || 0)} admitted.`,
        `Outputs: ${Number(output.candidateAuthorityRecordCount || 0)} authority record(s), ${Number(output.candidateClaimCount || 0)} claim(s), ${Number(output.candidateIssueCount || 0)} issue(s).`,
        'Promotion remains unavailable in C0.5.',
    ];
}
