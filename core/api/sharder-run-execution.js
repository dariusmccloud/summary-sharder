export function startSharderHeadlessOperation(startIndex, endIndex, deps) {
    const {
        createAbortController,
        startUiOperation,
        showProgressToast,
    } = deps;

    createAbortController();

    const opId = startUiOperation({
        feature: 'sharder',
        primaryButton: 'ss-run-single-pass',
        disabled: true,
        label: 'Running Sharder...',
        lockButtons: [],
        showStop: true,
    });

    const progressToast = showProgressToast(
        `Sharder processing messages ${startIndex} to ${endIndex}...`,
        'Sharder',
        { timeOut: 0, extendedTimeOut: 0 },
    );

    return {
        opId,
        progressToast,
        operationStarted: true,
    };
}

export async function executeSharderHeadlessRun(startIndex, endIndex, settings, selectedShards, deps) {
    const {
        runSharderHeadless,
        throwIfAborted,
    } = deps;

    const headless = await runSharderHeadless(startIndex, endIndex, settings, selectedShards);
    throwIfAborted('sharder generation');
    return headless;
}

export function cleanupSharderHeadlessOperation(state, deps) {
    const {
        progressToast,
        operationStarted,
        opId,
        originalText = 'Run Sharder',
    } = state || {};

    const {
        clearProgressToast,
        clearAbortController,
        endUiOperation,
    } = deps;

    if (progressToast) {
        clearProgressToast(progressToast);
    }

    if (operationStarted) {
        clearAbortController();
        endUiOperation({
            feature: 'sharder',
            primaryButton: 'ss-run-single-pass',
            disabled: false,
            label: originalText,
            lockButtons: [],
            showStop: false,
            opId,
        });
    }
}
