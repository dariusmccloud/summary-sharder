const BASE = '/api/plugins/summary-sharder-memory';

let csrfTokenPromise = null;
let initPromise = null;
let manifestCache = null;

async function fetchJson(path, options = {}) {
    const method = options.method || 'GET';
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    if (method !== 'GET') {
        const token = await getCsrfToken();
        if (token && token !== 'disabled') {
            headers['x-csrf-token'] = token;
        }
    }

    const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const error = new Error(data?.error || `Architectural server request failed: ${response.status}`);
        error.status = response.status;
        error.code = data?.code || 'ARCH_SERVER_REQUEST_FAILED';
        error.data = data;
        throw error;
    }

    return data;
}

function buildQueryString(filters = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters || {})) {
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (!text) continue;
        params.set(key, text);
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

export async function getCsrfToken() {
    if (!csrfTokenPromise) {
        csrfTokenPromise = fetch('/csrf-token', {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-store',
            },
        })
            .then((response) => response.json())
            .then((data) => data?.token || 'disabled')
            .catch(() => 'disabled');
    }
    return csrfTokenPromise;
}

export function resetArchitecturalAuthorityServerApiState() {
    csrfTokenPromise = null;
    initPromise = null;
    manifestCache = null;
}

export async function healthcheckArchitecturalAuthorityServer() {
    return await fetchJson('/health');
}

export async function loadArchitecturalAuthorityCapabilities() {
    return await fetchJson('/capabilities');
}

export async function loadArchitecturalMessageIdentitySchema() {
    return await fetchJson('/c0-25a/schema');
}

export async function scanArchitecturalPersistedChatMetadata(locator) {
    return await fetchJson('/c0-25a/scan-chat', {
        method: 'POST',
        body: locator,
    });
}

export async function initArchitecturalAuthorityServer() {
    if (!initPromise) {
        initPromise = fetchJson('/init', {
            method: 'POST',
            body: {},
        })
            .then((data) => {
                manifestCache = data?.manifest || null;
                return data;
            })
            .catch((error) => {
                initPromise = null;
                throw error;
            });
    }
    return await initPromise;
}

export async function loadArchitecturalAuthorityManifest() {
    if (manifestCache) {
        return manifestCache;
    }
    const data = await fetchJson('/manifest');
    manifestCache = data?.manifest || null;
    return manifestCache;
}

export async function ensureArchitecturalAuthorityScope(memoryScopeId, scopeAlias = '') {
    return await fetchJson('/scopes/ensure', {
        method: 'POST',
        body: { memoryScopeId, scopeAlias },
    });
}

export async function bindArchitecturalAuthorityChat(memoryScopeId, payload) {
    return await fetchJson(`/scopes/${encodeURIComponent(memoryScopeId)}/bind-chat`, {
        method: 'POST',
        body: payload,
    });
}

export async function loadArchitecturalAuthorityScope(memoryScopeId) {
    return await fetchJson(`/scopes/${encodeURIComponent(memoryScopeId)}`);
}

export async function loadArchitecturalAuthorityCurrentDecisions(memoryScopeId, decisionIds = []) {
    const ids = decisionIds.map((value) => String(value || '').trim()).filter(Boolean);
    if (ids.length === 0) {
        return { decisions: {} };
    }
    const query = `?ids=${encodeURIComponent(ids.join(','))}`;
    return await fetchJson(`/scopes/${encodeURIComponent(memoryScopeId)}/decisions/current${query}`);
}

export async function commitArchitecturalAuthorityServerUpdate(memoryScopeId, payload) {
    return await fetchJson(`/scopes/${encodeURIComponent(memoryScopeId)}/commit`, {
        method: 'POST',
        body: payload,
    });
}

export async function listInterpretiveDelegationPolicies(filters = {}) {
    return await fetchJson(`/interpretive/delegation-policies${buildQueryString(filters)}`);
}

export async function listInterpretivePublicationPolicies(filters = {}) {
    return await fetchJson(`/interpretive/publication/policies${buildQueryString(filters)}`);
}

export async function listInterpretiveReviews(filters = {}) {
    return await fetchJson(`/interpretive/reviews${buildQueryString(filters)}`);
}

export async function getInterpretiveCandidate(interpretationRevisionId) {
    const normalizedId = String(interpretationRevisionId || '').trim();
    if (!normalizedId) {
        throw new Error('interpretationRevisionId is required');
    }
    return await fetchJson(`/interpretive/candidates/${encodeURIComponent(normalizedId)}`);
}

export async function getInterpretivePublicationOperatorState(interpretationRevisionId, filters = {}) {
    const normalizedId = String(interpretationRevisionId || '').trim();
    if (!normalizedId) {
        throw new Error('interpretationRevisionId is required');
    }
    return await fetchJson(`/interpretive/candidates/${encodeURIComponent(normalizedId)}/publication-operator${buildQueryString(filters)}`);
}

export async function qualifyInterpretivePublication(interpretationRevisionId, payload) {
    const normalizedId = String(interpretationRevisionId || '').trim();
    if (!normalizedId) {
        throw new Error('interpretationRevisionId is required');
    }
    return await fetchJson(`/interpretive/candidates/${encodeURIComponent(normalizedId)}/publication-qualifications`, {
        method: 'POST',
        body: payload || {},
    });
}

export async function createInterpretivePublicationAuthorization(payload) {
    return await fetchJson('/interpretive/publication/authorizations', {
        method: 'POST',
        body: payload || {},
    });
}

export async function executeInterpretivePublicationAuthorization(payload) {
    return await fetchJson('/interpretive/publication/execute', {
        method: 'POST',
        body: payload || {},
    });
}

export async function listDnmPublicationRecords(filters = {}) {
    return await fetchJson(`/interpretive/publication/records${buildQueryString(filters)}`);
}

export async function getCurrentActiveDnmRecord(continuityTargetId) {
    const normalizedId = String(continuityTargetId || '').trim();
    if (!normalizedId) {
        throw new Error('continuityTargetId is required');
    }
    return await fetchJson(`/interpretive/publication/targets/${encodeURIComponent(normalizedId)}/current`);
}

export async function supersedeDnmPublicationRecord(payload) {
    return await fetchJson('/interpretive/publication/supersede', {
        method: 'POST',
        body: payload || {},
    });
}

export async function withdrawDnmPublicationRecord(payload) {
    return await fetchJson('/interpretive/publication/withdraw', {
        method: 'POST',
        body: payload || {},
    });
}

export async function recordDnmDeltaReview(payload) {
    return await fetchJson('/interpretive/publication/delta-reviews', {
        method: 'POST',
        body: payload || {},
    });
}

export async function submitInterpretiveReviewDisposition(reviewRequestId, payload) {
    const normalizedId = String(reviewRequestId || '').trim();
    if (!normalizedId) {
        throw new Error('reviewRequestId is required');
    }
    return await fetchJson(`/interpretive/reviews/${encodeURIComponent(normalizedId)}/dispositions`, {
        method: 'POST',
        body: payload || {},
    });
}

export async function recordInterpretiveSubjectDisposition(interpretationRevisionId, payload) {
    const normalizedId = String(interpretationRevisionId || '').trim();
    if (!normalizedId) {
        throw new Error('interpretationRevisionId is required');
    }
    return await fetchJson(`/interpretive/candidates/${encodeURIComponent(normalizedId)}/subject-disposition`, {
        method: 'POST',
        body: payload || {},
    });
}

export async function validateArchitecturalBrowserMigration(payload) {
    return await fetchJson('/validate-browser-migration', {
        method: 'POST',
        body: { payload },
    });
}

export async function migrateArchitecturalBrowserStore(payload) {
    return await fetchJson('/migrate-browser-store', {
        method: 'POST',
        body: { payload },
    });
}
