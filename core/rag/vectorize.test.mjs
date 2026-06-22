import assert from 'node:assert/strict';
import test from 'node:test';

import { annotateShardIdentityMetadata } from './vectorize-identity.js';

const ARCHITECTURAL_A = `[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 1-2

[DECISIONS]
[S1:1] ID:alpha-decision | TYPE:IMPLEMENTATION | DECISION:Alpha path | WHY:unstated | SCOPE:test | STATUS:ACCEPTED | EVIDENCE:"a"

[CURRENT]
Alpha | State | Focus | Pending | Blocked | Next

===END===`;

const ARCHITECTURAL_B = `[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 3-4

[DECISIONS]
[S3:1] ID:beta-decision | TYPE:IMPLEMENTATION | DECISION:Beta path | WHY:unstated | SCOPE:test | STATUS:ACCEPTED | EVIDENCE:"b"

[CURRENT]
Beta | State | Focus | Pending | Blocked | Next

===END===`;

const NARRATIVE = `### 🎨 TONE
- Quiet

### 📍 CURRENT
State: narrative`;

function chunk(hash) {
    return {
        hash,
        text: hash,
        metadata: {},
    };
}

test('single architectural vectorization metadata is attached to chunk metadata', () => {
    const chunks = [chunk('single')];

    annotateShardIdentityMetadata(chunks, { sharderProfile: 'architectural' }, ARCHITECTURAL_A);

    assert.equal(chunks[0].metadata.shardProfile, 'architectural');
    assert.equal(chunks[0].metadata.schemaVersion, 1);
    assert.deepEqual(chunks[0].metadata.stableDecisionIds, ['alpha-decision']);
    assert.deepEqual(chunks[0].metadata.sectionKeys, ['decisions', 'current']);
});

test('bulk architectural vectorization metadata is attached per shard without cross-contamination', () => {
    const chunksA = [chunk('a')];
    const chunksB = [chunk('b')];

    annotateShardIdentityMetadata(chunksA, { sharderProfile: 'architectural' }, ARCHITECTURAL_A);
    annotateShardIdentityMetadata(chunksB, { sharderProfile: 'architectural' }, ARCHITECTURAL_B);

    assert.deepEqual(chunksA[0].metadata.stableDecisionIds, ['alpha-decision']);
    assert.deepEqual(chunksB[0].metadata.stableDecisionIds, ['beta-decision']);
    assert.notDeepEqual(chunksA[0].metadata.stableDecisionIds, chunksB[0].metadata.stableDecisionIds);
});

test('narrative chunks remain unchanged by shard identity metadata annotation', () => {
    const chunks = [chunk('narrative')];

    annotateShardIdentityMetadata(chunks, { sharderProfile: 'narrative' }, NARRATIVE);

    assert.equal(Object.prototype.hasOwnProperty.call(chunks[0].metadata, 'shardProfile'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(chunks[0].metadata, 'schemaVersion'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(chunks[0].metadata, 'stableDecisionIds'), false);
});
