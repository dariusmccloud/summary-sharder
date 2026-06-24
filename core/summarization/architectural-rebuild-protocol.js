import crypto from 'node:crypto';

export const ARCHITECTURAL_REBUILD_PROTOCOL_VERSION = 'architectural-rebuild-protocol/v1';
export const ARCHITECTURAL_REBUILD_MANIFEST_SCHEMA_VERSION = 1;
export const ARCHITECTURAL_REBUILD_REPORT_SCHEMA_VERSION = 1;

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
        `Outputs: ${Number(output.candidateAuthorityRecordCount || 0)} authority record(s), ${Number(output.candidateIssueCount || 0)} issue(s).`,
        'Promotion remains unavailable in C0.5A.',
    ];
}
