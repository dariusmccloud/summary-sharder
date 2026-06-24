function normalizeValue(value, maxLength = 96) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '';
    }

    return text.slice(0, maxLength);
}

function buildDiagnosticContext(context = {}) {
    const now = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);

    return {
        source: normalizeValue(context.source || 'summary-sharder'),
        subsystem: normalizeValue(context.subsystem),
        operation: normalizeValue(context.operation),
        phase: normalizeValue(context.phase),
        saveKind: normalizeValue(context.saveKind),
        chatId: normalizeValue(context.chatId, 160),
        traceId: normalizeValue(context.traceId || `${now}-${random}`),
    };
}

export async function withSummarySharderSaveDiagnostics(context, fn) {
    const previous = globalThis.summarySharderSaveDiagnosticContext;
    globalThis.summarySharderSaveDiagnosticContext = buildDiagnosticContext(context);

    try {
        return await fn();
    } finally {
        if (typeof previous === 'undefined') {
            delete globalThis.summarySharderSaveDiagnosticContext;
        } else {
            globalThis.summarySharderSaveDiagnosticContext = previous;
        }
    }
}
