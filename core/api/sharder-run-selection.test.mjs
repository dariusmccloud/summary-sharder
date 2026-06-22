import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareSharderHeadlessRun, resolveSelectedShardsForRun } from './sharder-run-selection.js';

function makeDeps(overrides = {}) {
    const calls = {
        findSavedExtractions: 0,
        openShardSelectionModal: 0,
        parseSelectedShards: 0,
        runSharderHeadless: 0,
        modalItems: null,
        headlessSelectedShards: null,
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
        parseSelectedShards: (items) => {
            calls.parseSelectedShards += 1;
            return items.map((item) => ({ identifier: item.identifier, content: item.content, parsedSections: item.parsedSections || {} }));
        },
        openShardSelectionModal: async (_settings, items) => {
            calls.openShardSelectionModal += 1;
            calls.modalItems = items;
            return overrides.modalResult || { confirmed: true, selectedShards: [] };
        },
        runSharderHeadless: async (_start, _end, _settings, selectedShards) => {
            calls.runSharderHeadless += 1;
            calls.headlessSelectedShards = selectedShards;
            return { result: { ok: true }, chatText: 'chat', extractKeywords: false };
        },
        ...overrides.deps,
    };

    return { deps, calls };
}

test('architectural plus saved shard plus auto-include off calls selection modal', async () => {
    const saved = [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.findSavedExtractions, 1);
    assert.equal(calls.openShardSelectionModal, 1);
    assert.deepEqual(calls.modalItems, saved);
});

test('selected architectural shard reaches prompt assembly path through headless run', async () => {
    const selected = [{ identifier: 'Memory Shard 1-50', content: 'selected baseline', parsedSections: { decisions: [] } }];
    const { deps, calls } = makeDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'selected baseline' }],
        modalResult: { confirmed: true, selectedShards: selected },
    });

    const result = await prepareSharderHeadlessRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.runSharderHeadless, 1);
    assert.deepEqual(calls.headlessSelectedShards, selected);
});

test('architectural plus auto-include on skips modal and includes compatible shards', async () => {
    const saved = [
        { classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' },
        { classification: 'narrative', identifier: 'Memory Shard 9-20', content: 'B' },
    ];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: true },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.openShardSelectionModal, 0);
    assert.equal(calls.parseSelectedShards, 1);
    assert.deepEqual(result.selectedShards.map((item) => item.identifier), ['Memory Shard 1-50']);
});

test('architectural plus RAG enabled still calls selection modal when auto-include is off', async () => {
    const saved = [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false, rag: { enabled: true } },
        undefined,
        {
            ...deps,
            shouldBypassShardSelectionForRag: () => false,
        },
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.openShardSelectionModal, 1);
});

test('narrative plus RAG preserves bypass', async () => {
    const { deps, calls } = makeDeps();

    const result = await resolveSelectedShardsForRun(
        { profile: 'narrative', autoIncludeShards: false, bypass: true, rag: { enabled: true } },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.deepEqual(result.selectedShards, []);
    assert.equal(calls.findSavedExtractions, 0);
    assert.equal(calls.openShardSelectionModal, 0);
});

test('canceling selection aborts the sharder run before generation', async () => {
    const { deps, calls } = makeDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: false, selectedShards: [] },
    });

    const result = await prepareSharderHeadlessRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, false);
    assert.equal(calls.runSharderHeadless, 0);
});

test('selecting zero shards continues from scratch', async () => {
    const { deps, calls } = makeDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: true, selectedShards: [] },
    });

    const result = await prepareSharderHeadlessRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.deepEqual(calls.headlessSelectedShards, []);
});

test('incompatible narrative, legacy, unknown, and malformed shards do not appear in architectural selection', async () => {
    const saved = [
        { classification: 'architectural', identifier: 'architectural', content: 'A' },
        { classification: 'narrative', identifier: 'narrative', content: 'B' },
        { classification: 'legacy', identifier: 'legacy', content: 'C' },
        { classification: 'unknown', identifier: 'unknown', content: 'D' },
    ];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    await resolveSelectedShardsForRun(
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.deepEqual(calls.modalItems.map((item) => item.identifier), ['architectural']);
});

test('no compatible shards proceeds directly to generation without showing modal', async () => {
    const { deps, calls } = makeDeps({
        discoveredItems: [{ classification: 'narrative', identifier: 'narrative', content: 'B' }],
    });

    const result = await prepareSharderHeadlessRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.openShardSelectionModal, 0);
    assert.equal(calls.runSharderHeadless, 1);
    assert.deepEqual(calls.headlessSelectedShards, []);
});
