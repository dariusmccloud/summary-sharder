import test from 'node:test';
import assert from 'node:assert/strict';

import {
    beginArchitecturalIntegrationTrace,
    clearArchitecturalIntegrationTrace,
    consumeDebugHostSaveFailure,
    getArchitecturalIntegrationTrace,
    recordArchitecturalIntegrationEvent,
} from './architectural-authority-integration.js';

function createStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        },
        clear() {
            map.clear();
        },
    };
}

test('integration trace resets and records ordered events', () => {
    const originalSessionStorage = globalThis.sessionStorage;
    const storage = createStorage();
    globalThis.sessionStorage = storage;

    try {
        clearArchitecturalIntegrationTrace();
        beginArchitecturalIntegrationTrace({ mode: 'system' });
        recordArchitecturalIntegrationEvent('SHARD_SAVE_REQUESTED', { outputUID: null });
        recordArchitecturalIntegrationEvent('HOST_SAVE_CONFIRMED', { outputUID: 'uid-1' });

        const trace = getArchitecturalIntegrationTrace();
        assert.equal(trace.length, 3);
        assert.deepEqual(
            trace.map((entry) => entry.type),
            ['TRACE_STARTED', 'SHARD_SAVE_REQUESTED', 'HOST_SAVE_CONFIRMED']
        );
        assert.deepEqual(
            trace.map((entry) => entry.sequence),
            [1, 2, 3]
        );
        assert.equal(JSON.parse(storage.getItem('summary_sharder:architectural_integration_trace')).length, 3);
    } finally {
        globalThis.sessionStorage = originalSessionStorage;
    }
});

test('debug host save failure is consumed once and mode filtered', () => {
    const originalSessionStorage = globalThis.sessionStorage;
    const storage = createStorage();
    globalThis.sessionStorage = storage;

    try {
        storage.setItem('summary_sharder:debug_fail_next_host_save', JSON.stringify({
            modes: ['system'],
            reason: 'test',
        }));

        assert.equal(consumeDebugHostSaveFailure('lorebook'), null);
        const failure = consumeDebugHostSaveFailure('system');
        assert.equal(failure.reason, 'test');
        assert.equal(consumeDebugHostSaveFailure('system'), null);
    } finally {
        globalThis.sessionStorage = originalSessionStorage;
    }
});
