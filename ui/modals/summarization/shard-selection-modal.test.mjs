import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHITECTURAL_PROFILE } from '../../../core/summarization/sharder-section-registry.js';
import { shouldBypassShardSelectionForRag } from '../../../core/summarization/shard-selection-policy.js';

test('architectural mode with RAG enabled does not bypass saved-shard selection', () => {
    assert.equal(shouldBypassShardSelectionForRag({
        sharderMode: true,
        sharderProfile: ARCHITECTURAL_PROFILE,
        rag: { enabled: true },
    }), false);
});

test('narrative mode with RAG enabled may still bypass saved-shard selection', () => {
    assert.equal(shouldBypassShardSelectionForRag({
        sharderMode: true,
        sharderProfile: 'narrative',
        rag: { enabled: true },
    }), true);
});
