import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDesiredVisibilityState, detectHiddenRangesFromMessages } from './visibility-policy.js';

test('buildDesiredVisibilityState preserves archive-owned prompt exclusion outside summarized ranges', () => {
    const messages = [
        { name: 'A', is_system: false },
        {
            name: 'B',
            is_system: true,
            extra: {
                summary_sharder: {
                    archive: {
                        isArchived: true,
                        archivedAt: '2026-06-23T00:00:00.000Z',
                        promptVisibilityBeforeArchive: 'shown',
                    },
                },
            },
        },
        { name: 'C', is_system: false },
    ];
    const ranges = [{ start: 0, end: 0, hidden: true, ignoreCollapse: false, ignoreNames: '' }];

    const state = buildDesiredVisibilityState(messages, ranges, {
        hideAllSummarized: false,
        collapseAll: true,
        globalIgnoreNames: '',
    });

    assert.deepEqual(state, [
        { isSystem: true, collapsed: true },
        { isSystem: true, collapsed: false },
        { isSystem: false, collapsed: false },
    ]);
});

test('detectHiddenRangesFromMessages ignores archived messages', () => {
    const messages = [
        { is_system: false },
        { is_system: true },
        {
            is_system: true,
            extra: {
                summary_sharder: {
                    archive: {
                        isArchived: true,
                        archivedAt: '2026-06-23T00:00:00.000Z',
                        promptVisibilityBeforeArchive: 'shown',
                    },
                },
            },
        },
        { is_system: true },
        { is_system: false },
    ];

    assert.deepEqual(detectHiddenRangesFromMessages(messages), [
        { start: 1, end: 1, hidden: true, ignoreCollapse: false, ignoreNames: '' },
        { start: 3, end: 3, hidden: true, ignoreCollapse: false, ignoreNames: '' },
    ]);
});
