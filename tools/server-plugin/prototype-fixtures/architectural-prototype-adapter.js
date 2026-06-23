// Prototype-only client for the 1B0 negative race and receipt-writing experiments.
// This file must not be imported by the production extension runtime.

const BASE = '/api/plugins/summary-sharder-memory';

async function request(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method: options.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data?.error ?? `Prototype request failed: ${response.status}`);
        error.data = data;
        error.status = response.status;
        throw error;
    }

    return data;
}

export async function healthcheckArchitecturalPrototype() {
    return request('/health');
}

export async function initArchitecturalPrototypeScope(memoryScopeId) {
    return request('/prototype/init-scope', {
        method: 'POST',
        body: { memoryScopeId },
    });
}

export async function loadArchitecturalPrototypeAnchor(memoryScopeId) {
    const response = await fetch(`${BASE}/prototype/load-anchor?memoryScopeId=${encodeURIComponent(memoryScopeId)}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data?.error ?? `Prototype request failed: ${response.status}`);
        error.data = data;
        error.status = response.status;
        throw error;
    }

    return data;
}

export async function appendArchitecturalPrototypeAnchorEvent(payload) {
    return request('/prototype/append-anchor-event', {
        method: 'POST',
        body: payload,
    });
}

export async function writeArchitecturalPrototypeReceipt(payload) {
    return request('/prototype/write-receipt', {
        method: 'POST',
        body: payload,
    });
}

export async function scanArchitecturalPrototypeChatRuntime(payload) {
    return request('/prototype/scan-chat-runtime', {
        method: 'POST',
        body: payload,
    });
}

export async function verifyArchitecturalPrototypeReplay(memoryScopeId) {
    return request('/prototype/verify-replay', {
        method: 'POST',
        body: { memoryScopeId },
    });
}

export async function simulateArchitecturalPrototypeConflict(payload) {
    return request('/prototype/simulate-conflict', {
        method: 'POST',
        body: payload,
    });
}
