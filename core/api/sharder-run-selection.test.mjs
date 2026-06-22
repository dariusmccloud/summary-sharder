import assert from 'node:assert/strict';
import test from 'node:test';

import { annotateShardSelectionCandidates, resolveSelectedShardsForRun } from './sharder-run-selection.js';

function makeDeps(overrides = {}) {
    const calls = {
        findSavedExtractions: 0,
        openShardSelectionModal: 0,
        parseSelectedShards: 0,
        modalItems: null,
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
        openShardSelectionModal: async (_settings, items, context) => {
            calls.openShardSelectionModal += 1;
            calls.modalItems = items;
            calls.modalContext = context;
            return overrides.modalResult || { confirmed: true, selectedShards: [] };
        },
        ...overrides.deps,
    };

    return { deps, calls };
}

test('architectural plus saved shard plus auto-include off calls selection modal', async () => {
    const saved = [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.findSavedExtractions, 1);
    assert.equal(calls.openShardSelectionModal, 1);
    assert.equal(calls.modalItems.length, 1);
    assert.equal(calls.modalItems[0].identifier, 'Memory Shard 1-50');
    assert.equal(calls.modalItems[0].selectionEligible, true);
    assert.equal(calls.modalItems[0].overlapsCurrentRange, false);
});

test('architectural plus auto-include on skips modal and includes compatible shards', async () => {
    const saved = [
        { classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' },
        { classification: 'narrative', identifier: 'Memory Shard 9-20', content: 'B' },
    ];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        52,
        101,
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
        52,
        101,
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
        52,
        101,
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
    const { deps } = makeDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: false, selectedShards: [] },
    });

    const result = await resolveSelectedShardsForRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, false);
});

test('selecting zero shards continues from scratch', async () => {
    const { deps } = makeDeps({
        discoveredItems: [{ classification: 'architectural', identifier: 'Memory Shard 1-50', content: 'A' }],
        modalResult: { confirmed: true, selectedShards: [] },
    });

    const result = await resolveSelectedShardsForRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.deepEqual(result.selectedShards, []);
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
        52,
        101,
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

    const result = await resolveSelectedShardsForRun(
        52,
        101,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(result.confirmed, true);
    assert.equal(calls.openShardSelectionModal, 0);
    assert.deepEqual(result.selectedShards, []);
});

test('overlapping compatible shards remain visible but are marked ineligible for manual selection', async () => {
    const saved = [
        { classification: 'architectural', identifier: 'Memory Shard 0-50', content: 'A', startIndex: 0, endIndex: 50 },
        { classification: 'architectural', identifier: 'Memory Shard 60-80', content: 'B', startIndex: 60, endIndex: 80 },
    ];
    const { deps, calls } = makeDeps({ discoveredItems: saved });

    await resolveSelectedShardsForRun(
        0,
        100,
        { profile: 'architectural', autoIncludeShards: false },
        undefined,
        deps,
    );

    assert.equal(calls.openShardSelectionModal, 1);
    assert.equal(calls.modalItems[0].selectionEligible, false);
    assert.equal(calls.modalItems[0].overlapsCurrentRange, true);
    assert.match(calls.modalItems[0].selectionDisabledReason, /overlaps the current run range/i);
    assert.equal(calls.modalItems[1].selectionEligible, false);
    assert.equal(calls.modalContext.overlappingCount, 2);
    assert.equal(calls.modalContext.eligibleCount, 0);
});

test('auto-include excludes overlapping shards and reports filtered mode', async () => {
    const saved = [
        { classification: 'architectural', identifier: 'Memory Shard 0-50', content: 'A', startIndex: 0, endIndex: 50 },
        { classification: 'architectural', identifier: 'Memory Shard 120-140', content: 'B', startIndex: 120, endIndex: 140 },
    ];
    const { deps } = makeDeps({ discoveredItems: saved });

    const result = await resolveSelectedShardsForRun(
        0,
        100,
        { profile: 'architectural', autoIncludeShards: true },
        undefined,
        deps,
    );

    assert.equal(result.mode, 'auto-include-overlap-filtered');
    assert.equal(result.excludedOverlapCount, 1);
    assert.deepEqual(result.selectedShards.map((item) => item.identifier), ['Memory Shard 120-140']);
});

test('annotateShardSelectionCandidates uses inclusive range overlap', () => {
    const annotated = annotateShardSelectionCandidates([
        { identifier: 'left', startIndex: 0, endIndex: 49 },
        { identifier: 'inside', startIndex: 60, endIndex: 80 },
        { identifier: 'touching', startIndex: 101, endIndex: 120 },
    ], 50, 100);

    assert.equal(annotated[0].selectionEligible, true);
    assert.equal(annotated[1].selectionEligible, false);
    assert.equal(annotated[2].selectionEligible, true);
});
