import assert from 'node:assert/strict';
import test from 'node:test';

import {
    cleanupSharderHeadlessOperation,
    executeSharderHeadlessRun,
    startSharderHeadlessOperation,
} from './sharder-run-execution.js';
import { resolveSelectedShardsForRun } from './sharder-run-selection.js';

function makeSelectionDeps(overrides = {}) {
    const calls = {
        findSavedExtractions: 0,
        openShardSelectionModal: 0,
    };

    const deps = {
        shouldBypassShardSelectionForRag: (settings) => settings?.bypass === true,
        getActiveSharderProfile: (settings) => settings?.profile || 'narrative',
        findSavedExtractions: async () => {
            calls.findSavedExtractions += 1;
            return overrides.discoveredItems || [];
        },
        isSavedShardCompatibleWithProfile: (item, activeProfile) => {
            if (activeProfile === 'architectural') {
                return item.classification === 'architectural';
            }
            return item.classification === 'narrative' || item.classification === 'legacy';
        },
        parseSelectedShards: (items) => items.map((item) => ({ identifier: item.identifier, content: item.content })),
        openShardSelectionModal: async (_settings, items) => {
            calls.openShardSelectionModal += 1;
            calls.modalItems = items;
            return overrides.modalResult || { confirmed: true, selectedShards: [] };
        },
        ...overrides.deps,
    };

    return { deps, calls };
}

function makeExecutionDeps(overrides = {}) {
    const events = [];
    const calls = {
        createAbortController: 0,
        startUiOperation: 0,
        showProgressToast: 0,
        runSharderHeadless: 0,
        clearProgressToast: 0,
        clearAbortController: 0,
        endUiOperation: 0,
        selectedShards: null,
    };

    const deps = {
        createAbortController: () => {
            calls.createAbortController += 1;
            events.push('createAbortController');
        },
        startUiOperation: () => {
            calls.startUiOperation += 1;
            events.push('startUiOperation');
            return 'op-1';
        },
        showProgressToast: () => {
            calls.showProgressToast += 1;
            events.push('showProgressToast');
            return 'toast-1';
        },
        runSharderHeadless: async (_start, _end, _settings, selectedShards) => {
            calls.runSharderHeadless += 1;
            calls.selectedShards = selectedShards;
            events.push('runSharderHeadless');
            if (overrides.headlessError) {
                throw overrides.headlessError;
            }
            return { result: { ok: true }, chatText: 'chat', extractKeywords: false };
        },
        throwIfAborted: () => {
            events.push('throwIfAborted');
        },
        clearProgressToast: () => {
            calls.clearProgressToast += 1;
            events.push('clearProgressToast');
        },
        clearAbortController: () => {
            calls.clearAbortController += 1;
            events.push('clearAbortController');
        },
        endUiOperation: () => {
            calls.endUiOperation += 1;
            events.push('endUiOperation');
        },
        ...overrides.deps,
    };

    return { deps, calls, events };
}

test('selection resolves before generation', async () => {
    const selectionDeps = makeSelectionDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: true, selectedShards: [{ identifier: 'Memory Shard 1-50', content: 'A' }] },
    });
    const executionDeps = makeExecutionDeps();

    const selection = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        {
            ...selectionDeps.deps,
            findSavedExtractions: async (...args) => {
                executionDeps.events.push('resolveSelection');
                return selectionDeps.deps.findSavedExtractions(...args);
            },
        },
    );

    startSharderHeadlessOperation(52, 101, executionDeps.deps);
    await executeSharderHeadlessRun(52, 101, {}, selection.selectedShards, executionDeps.deps);

    assert.deepEqual(
        executionDeps.events.filter((event) => event === 'resolveSelection' || event === 'runSharderHeadless'),
        ['resolveSelection', 'runSharderHeadless'],
    );
});

test('cancelled selection never starts generation or operation state', async () => {
    const { deps } = makeSelectionDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: false, selectedShards: [] },
    });
    const { calls } = makeExecutionDeps();

    const selection = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(selection.confirmed, false);
    assert.equal(calls.createAbortController, 0);
    assert.equal(calls.runSharderHeadless, 0);
});

test('confirmed selection initializes operation state before headless run', async () => {
    const { deps, events } = makeExecutionDeps();

    startSharderHeadlessOperation(52, 101, deps);
    await executeSharderHeadlessRun(52, 101, {}, [{ identifier: 'Memory Shard 1-50', content: 'A' }], deps);

    assert.deepEqual(events.slice(0, 4), [
        'createAbortController',
        'startUiOperation',
        'showProgressToast',
        'runSharderHeadless',
    ]);
});

test('selected shards are passed unchanged to the headless run', async () => {
    const selectedShards = [{ identifier: 'Memory Shard 1-50', content: 'selected baseline', parsedSections: { decisions: [] } }];
    const { deps, calls } = makeExecutionDeps();

    startSharderHeadlessOperation(52, 101, deps);
    await executeSharderHeadlessRun(52, 101, {}, selectedShards, deps);

    assert.equal(calls.selectedShards, selectedShards);
});

test('generation error clears operation state and abort controller when cleanup runs', async () => {
    const expectedError = new Error('generation failed');
    const { deps, calls } = makeExecutionDeps({ headlessError: expectedError });
    const state = startSharderHeadlessOperation(52, 101, deps);
    state.originalText = 'Run Sharder';

    await assert.rejects(
        async () => {
            try {
                await executeSharderHeadlessRun(52, 101, {}, [], deps);
            } finally {
                cleanupSharderHeadlessOperation(state, deps);
            }
        },
        expectedError,
    );

    assert.equal(calls.clearProgressToast, 1);
    assert.equal(calls.clearAbortController, 1);
    assert.equal(calls.endUiOperation, 1);
});

test('narrative RAG bypass still reaches generation through the core path', async () => {
    const selectionDeps = makeSelectionDeps({
        deps: {
            shouldBypassShardSelectionForRag: () => true,
        },
    });
    const executionDeps = makeExecutionDeps();

    const selection = await resolveSelectedShardsForRun(
        { profile: 'narrative', autoIncludeShards: false, rag: { enabled: true } },
        undefined,
        selectionDeps.deps,
    );
    const started = startSharderHeadlessOperation(52, 101, executionDeps.deps);
    await executeSharderHeadlessRun(52, 101, {}, selection.selectedShards, executionDeps.deps);

    assert.equal(selection.mode, 'rag-bypass');
    assert.deepEqual(selection.selectedShards, []);
    assert.equal(executionDeps.calls.runSharderHeadless, 1);
    assert.equal(started.operationStarted, true);
});

test('architectural RAG still performs selection before generation', async () => {
    const selectionDeps = makeSelectionDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
    });
    const executionDeps = makeExecutionDeps();

    const selection = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false, rag: { enabled: true } },
        undefined,
        {
            ...selectionDeps.deps,
            shouldBypassShardSelectionForRag: () => false,
        },
    );
    startSharderHeadlessOperation(52, 101, executionDeps.deps);
    await executeSharderHeadlessRun(52, 101, {}, selection.selectedShards, executionDeps.deps);

    assert.equal(selectionDeps.calls.openShardSelectionModal, 1);
    assert.equal(executionDeps.calls.runSharderHeadless, 1);
});
