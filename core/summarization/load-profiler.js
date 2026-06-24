const TRACE_LIMIT = 50;
const BYPASS_STORAGE_KEY = 'summarySharderProfilingBypass';
const BYPASS_QUERY_PARAM = 'ss_profile_bypass';
const DEBUG_STORAGE_KEY = 'summarySharderDebugTracing';
const DEBUG_QUERY_PARAM = 'ss_debug_tracing';
const traces = [];
let nextTraceId = 1;
let bypassAnnouncementSent = false;

function now() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
}

function sanitizeValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeValue(entry));
    }
    if (typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'function') continue;
            output[key] = sanitizeValue(entry);
        }
        return output;
    }
    return value;
}

export function beginLoadTrace(meta = {}) {
    const trace = {
        id: nextTraceId++,
        startedAt: now(),
        finishedAt: null,
        durationMs: null,
        meta: sanitizeValue(meta),
        stages: [],
    };
    return trace;
}

export async function profileLoadStage(trace, stage, fn) {
    const startedAt = now();
    try {
        const result = await fn();
        trace.stages.push({
            stage,
            startedAt,
            finishedAt: now(),
            durationMs: now() - startedAt,
            ok: true,
            result: sanitizeValue(result),
        });
        return result;
    } catch (error) {
        trace.stages.push({
            stage,
            startedAt,
            finishedAt: now(),
            durationMs: now() - startedAt,
            ok: false,
            error: {
                message: String(error?.message || error),
                code: String(error?.code || ''),
            },
        });
        throw error;
    }
}

export function finishLoadTrace(trace, extra = {}) {
    trace.finishedAt = now();
    trace.durationMs = trace.finishedAt - trace.startedAt;
    trace.extra = sanitizeValue(extra);
    traces.unshift(trace);
    if (traces.length > TRACE_LIMIT) {
        traces.length = TRACE_LIMIT;
    }
    return trace;
}

export function getLoadTraces() {
    return traces.map((entry) => sanitizeValue(entry));
}

export function clearLoadTraces() {
    traces.length = 0;
}

function resolveBypassFlag(value) {
    if (value === null || value === undefined) {
        return false;
    }

    const normalized = String(value).trim().toLowerCase();
    return normalized === '1'
        || normalized === 'true'
        || normalized === 'yes'
        || normalized === 'on';
}

export function isLoadProfilingBypassEnabled(target = globalThis) {
    try {
        const search = target?.location?.search;
        if (typeof search === 'string' && search.length > 0) {
            const params = new URLSearchParams(search);
            if (params.has(BYPASS_QUERY_PARAM)) {
                return resolveBypassFlag(params.get(BYPASS_QUERY_PARAM));
            }
        }
    } catch {
        // no-op
    }

    try {
        const raw = target?.localStorage?.getItem?.(BYPASS_STORAGE_KEY);
        return resolveBypassFlag(raw);
    } catch {
        return false;
    }
}

export function setLoadProfilingBypassEnabled(enabled, target = globalThis) {
    try {
        if (enabled) {
            target?.localStorage?.setItem?.(BYPASS_STORAGE_KEY, '1');
        } else {
            target?.localStorage?.removeItem?.(BYPASS_STORAGE_KEY);
        }
    } catch {
        // no-op
    }

    return isLoadProfilingBypassEnabled(target);
}

export function getLoadProfilerFlags(target = globalThis) {
    return {
        profilingBypassActive: isLoadProfilingBypassEnabled(target),
        debugTracingActive: isLoadDebugTracingEnabled(target),
        storageKey: BYPASS_STORAGE_KEY,
        queryParam: BYPASS_QUERY_PARAM,
        debugStorageKey: DEBUG_STORAGE_KEY,
        debugQueryParam: DEBUG_QUERY_PARAM,
    };
}

export function isLoadDebugTracingEnabled(target = globalThis) {
    try {
        const search = target?.location?.search;
        if (typeof search === 'string' && search.length > 0) {
            const params = new URLSearchParams(search);
            if (params.has(DEBUG_QUERY_PARAM)) {
                return resolveBypassFlag(params.get(DEBUG_QUERY_PARAM));
            }
        }
    } catch {
        // no-op
    }

    try {
        const raw = target?.localStorage?.getItem?.(DEBUG_STORAGE_KEY);
        return resolveBypassFlag(raw);
    } catch {
        return false;
    }
}

export function setLoadDebugTracingEnabled(enabled, target = globalThis) {
    try {
        if (enabled) {
            target?.localStorage?.setItem?.(DEBUG_STORAGE_KEY, '1');
        } else {
            target?.localStorage?.removeItem?.(DEBUG_STORAGE_KEY);
        }
    } catch {
        // no-op
    }

    return isLoadDebugTracingEnabled(target);
}

export function announceLoadProfilingBypass(logger = console, target = globalThis) {
    const active = isLoadProfilingBypassEnabled(target);
    if (!active || bypassAnnouncementSent) {
        return active;
    }

    bypassAnnouncementSent = true;
    logger?.warn?.(
        '[SummarySharder] Profiling bypass active. CHAT_CHANGED load processing will be skipped for measurement.'
    );
    return active;
}

export function installLoadTraceDebugApi(target = globalThis) {
    target.summarySharderLoadProfiler = {
        getTraces: () => getLoadTraces(),
        clearTraces: () => clearLoadTraces(),
        getFlags: () => getLoadProfilerFlags(target),
        isBypassEnabled: () => isLoadProfilingBypassEnabled(target),
        setBypassEnabled: (enabled) => setLoadProfilingBypassEnabled(enabled, target),
        isDebugTracingEnabled: () => isLoadDebugTracingEnabled(target),
        setDebugTracingEnabled: (enabled) => setLoadDebugTracingEnabled(enabled, target),
    };
}
