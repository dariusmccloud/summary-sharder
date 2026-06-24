import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCHIVE_PROMPT_VISIBILITY_HIDDEN,
    ARCHIVE_PROMPT_VISIBILITY_SHOWN,
    archiveMessage,
    collectArchivedMessageIndices,
    isArchivedMessage,
    restoreArchivedMessage,
} from './archive-policy.js';

test('archiveMessage preserves prior prompt visibility when archiving a shown message', () => {
    const message = {
        is_system: false,
        extra: {},
    };

    const changed = archiveMessage(message, {
        archivedAt: '2026-06-23T00:00:00.000Z',
    });

    assert.equal(changed, true);
    assert.equal(message.is_system, true);
    assert.equal(isArchivedMessage(message), true);
    assert.deepEqual(message.extra.summary_sharder.archive, {
        isArchived: true,
        archivedAt: '2026-06-23T00:00:00.000Z',
        promptVisibilityBeforeArchive: ARCHIVE_PROMPT_VISIBILITY_SHOWN,
    });
});

test('archiveMessage preserves prior hidden visibility when archiving a hidden message', () => {
    const message = {
        is_system: true,
        extra: {},
    };

    archiveMessage(message, {
        archivedAt: '2026-06-23T00:00:00.000Z',
    });

    assert.equal(message.extra.summary_sharder.archive.promptVisibilityBeforeArchive, ARCHIVE_PROMPT_VISIBILITY_HIDDEN);
});

test('restoreArchivedMessage clears archive metadata and restores shown state', () => {
    const message = {
        is_system: true,
        extra: {
            summary_sharder: {
                archive: {
                    isArchived: true,
                    archivedAt: '2026-06-23T00:00:00.000Z',
                    promptVisibilityBeforeArchive: ARCHIVE_PROMPT_VISIBILITY_SHOWN,
                },
            },
        },
    };

    const changed = restoreArchivedMessage(message);

    assert.equal(changed, true);
    assert.equal(message.is_system, false);
    assert.equal(message.extra, undefined);
});

test('restoreArchivedMessage restores prior hidden state when message was hidden before archive', () => {
    const message = {
        is_system: true,
        extra: {
            summary_sharder: {
                archive: {
                    isArchived: true,
                    archivedAt: '2026-06-23T00:00:00.000Z',
                    promptVisibilityBeforeArchive: ARCHIVE_PROMPT_VISIBILITY_HIDDEN,
                },
                evidencePolicy: 'include',
            },
        },
    };

    restoreArchivedMessage(message);

    assert.equal(message.is_system, true);
    assert.equal(message.extra.summary_sharder.archive, undefined);
    assert.equal(message.extra.summary_sharder.evidencePolicy, 'include');
});

test('collectArchivedMessageIndices returns only archived message positions', () => {
    const messages = [
        {},
        { extra: { summary_sharder: { archive: { isArchived: true } } } },
        { extra: { summary_sharder: { archive: { isArchived: false } } } },
        { extra: { summary_sharder: { archive: { isArchived: true } } } },
    ];

    assert.deepEqual(collectArchivedMessageIndices(messages), [1, 3]);
});
