const TRACE_STORAGE_KEY = 'summary_sharder:architectural_integration_trace';
const FAIL_STORAGE_KEY = 'summary_sharder:debug_fail_next_host_save';
const TRACE_GLOBAL_KEY = '__summarySharderArchitecturalIntegrationTrace';

function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getStorage() {
    try {
        if (typeof globalThis?.sessionStorage?.getItem === 'function') {
            return globalThis.sessionStorage;
        }
    } catch {
        // ignore session storage access failures
    }
    return null;
}

function readStoredTrace() {
    const storage = getStorage();
    if (!storage) {
        return [];
    }

    try {
        const raw = storage.getItem(TRACE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeStoredTrace(trace) {
    const storage = getStorage();
    if (!storage) {
        return;
    }

    try {
        storage.setItem(TRACE_STORAGE_KEY, JSON.stringify(trace));
    } catch {
        // ignore storage write failures
    }
}

function setGlobalTrace(trace) {
    globalThis[TRACE_GLOBAL_KEY] = trace;
    if (!globalThis.summarySharderDebug || typeof globalThis.summarySharderDebug !== 'object') {
        globalThis.summarySharderDebug = {};
    }
    globalThis.summarySharderDebug.getArchitecturalIntegrationTrace = getArchitecturalIntegrationTrace;
    globalThis.summarySharderDebug.clearArchitecturalIntegrationTrace = clearArchitecturalIntegrationTrace;
}

function nextSequence(trace) {
    const last = trace[trace.length - 1];
    return Number.isFinite(last?.sequence) ? last.sequence + 1 : 1;
}

export function getArchitecturalIntegrationTrace() {
    const trace = Array.isArray(globalThis[TRACE_GLOBAL_KEY])
        ? globalThis[TRACE_GLOBAL_KEY]
        : readStoredTrace();
    return cloneJson(trace);
}

export function clearArchitecturalIntegrationTrace() {
    setGlobalTrace([]);
    writeStoredTrace([]);
}

export function beginArchitecturalIntegrationTrace(metadata = {}) {
    clearArchitecturalIntegrationTrace();
    return recordArchitecturalIntegrationEvent('TRACE_STARTED', metadata);
}

export function recordArchitecturalIntegrationEvent(type, metadata = {}) {
    const trace = Array.isArray(globalThis[TRACE_GLOBAL_KEY])
        ? [...globalThis[TRACE_GLOBAL_KEY]]
        : readStoredTrace();
    const entry = {
        sequence: nextSequence(trace),
        type: String(type || '').trim(),
        timestamp: Date.now(),
        ...cloneJson(metadata || {}),
    };
    trace.push(entry);
    setGlobalTrace(trace);
    writeStoredTrace(trace);
    return cloneJson(entry);
}

export function consumeDebugHostSaveFailure(mode) {
    const storage = getStorage();
    if (!storage) {
        return null;
    }

    try {
        const raw = storage.getItem(FAIL_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed !== true && (!parsed || typeof parsed !== 'object')) {
            return null;
        }

        const modes = Array.isArray(parsed?.modes)
            ? parsed.modes.map((value) => String(value || '').trim()).filter(Boolean)
            : null;
        const applies = parsed === true
            || !modes
            || modes.length === 0
            || modes.includes(String(mode || '').trim());

        if (!applies) {
            return null;
        }

        storage.removeItem(FAIL_STORAGE_KEY);
        return parsed === true ? { injected: true } : parsed;
    } catch {
        return null;
    }
}
