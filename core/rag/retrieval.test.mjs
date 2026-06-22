import assert from 'node:assert/strict';
import test from 'node:test';

import { excludeArchitecturalResults, filterResultsByOriginBoundary } from './architectural-rag-boundary.js';

function makeChunk(hash, metadata = {}) {
    return {
        hash,
        text: hash,
        metadata: { ...metadata },
    };
}

test('primary-query style results exclude architectural chunks while keeping narrative and legacy chunks', () => {
    const results = [
        makeChunk('arch', { shardProfile: 'architectural' }),
        makeChunk('narrative', { shardProfile: 'narrative' }),
        makeChunk('legacy', {}),
    ];

    const filtered = excludeArchitecturalResults(results);

    assert.deepEqual(filtered.map((item) => item.hash), ['narrative', 'legacy']);
});

test('fallback-style origin filtering also excludes architectural chunks', () => {
    const results = [
        makeChunk('arch-fallback', { shardProfile: 'architectural', originChatId: 'chat-a' }),
        makeChunk('narrative-fallback', { shardProfile: 'narrative', originChatId: 'chat-a' }),
        makeChunk('legacy-fallback', { originChatId: 'chat-a' }),
    ];

    const filtered = filterResultsByOriginBoundary(results, {
        chatId: 'chat-a',
        ownCollectionId: 'own-a',
        collectionId: 'shared-a',
    });

    assert.deepEqual(filtered.map((item) => item.hash), ['narrative-fallback', 'legacy-fallback']);
});

test('mixed collections cannot inject architectural chunks into narrative retrieval', () => {
    const results = [
        makeChunk('wrong-chat', { shardProfile: 'narrative', originChatId: 'chat-b' }),
        makeChunk('arch-right-chat', { shardProfile: 'architectural', originChatId: 'chat-a' }),
        makeChunk('narrative-right-chat', { shardProfile: 'narrative', originChatId: 'chat-a' }),
        makeChunk('legacy-right-chat', { originChatId: 'chat-a' }),
    ];

    const filtered = filterResultsByOriginBoundary(results, {
        chatId: 'chat-a',
        ownCollectionId: 'own-a',
        collectionId: 'shared-a',
    });

    assert.deepEqual(filtered.map((item) => item.hash), ['narrative-right-chat', 'legacy-right-chat']);
});
