import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHITECTURAL_PROFILE, NARRATIVE_PROFILE } from './sharder-section-registry.js';
import {
    SAVED_SHARD_CLASSIFICATIONS,
    SAVED_SHARD_FORMATS,
    buildArchitecturalShardMetadata,
    classifySavedShardText,
    isSavedShardCompatibleWithProfile,
} from './saved-shard-identity.js';

const WRAPPED_ARCHITECTURAL_SHARD = `[MEMORY SHARD: Messages 10-12]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 10-12

[TIMELINE]
[S10:1] Architectural save completed

[DECISIONS]
[S10:1] ID:persistence-shell | TYPE:IMPLEMENTATION | DECISION:Persist architectural identity | WHY:prevent cross-profile ambiguity | SCOPE:save + reload | STATUS:ACCEPTED | EVIDENCE:"runtime smoke"

[CURRENT]
Project | Persistence phase | Save + reload verified | None | None | Continue

===END===`;

const RAW_ARCHITECTURAL_SHARD = `[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 20-22

[TIMELINE]
[S20:1] Lorebook save preserved architectural body

[CURRENT]
Project | Lorebook reload | Parsing works | None | None | Continue

===END===`;

const WRAPPED_NARRATIVE_SHARD = `[MEMORY SHARD: Messages 30-32]

### 🎨 TONE
- Quiet and precise

### ⚖️ EVENTS
- 🟡 Narrative shard saved normally

### 📍 CURRENT
Location: Test bench`;

const WRAPPED_LEGACY_SHARD = `[MEMORY SHARD: Messages 40-42]

[KEY]
Sources: Messages 40-42

[WORLD]
Legacy bracket body

[CURRENT STATE]
State survives as legacy`;

const MALFORMED_ARCHITECTURAL_SHARD = `[MEMORY SHARD: Messages 50-52]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v2
Sources: Messages 50-52

[CURRENT]
Project | Malformed schema | Exclude safely | None | None | Continue

===END===`;

test('classifies wrapped architectural system-message shard and preserves wrapper range', () => {
    const shard = classifySavedShardText(WRAPPED_ARCHITECTURAL_SHARD);

    assert.equal(shard.classification, SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL);
    assert.equal(shard.profile, ARCHITECTURAL_PROFILE);
    assert.equal(shard.contentFormat, SAVED_SHARD_FORMATS.ARCHITECTURAL_BRACKET);
    assert.equal(shard.wrapperType, 'memory-shard');
    assert.equal(shard.startIndex, 10);
    assert.equal(shard.endIndex, 12);
    assert.equal(shard.body.startsWith('[KEY]'), true);
    assert.equal(shard.body.includes('Profile: architectural-memory'), true);
    assert.equal((shard.body.match(/===END===/g) || []).length, 1);
});

test('classifies raw architectural lorebook shard without requiring outer wrapper', () => {
    const shard = classifySavedShardText(RAW_ARCHITECTURAL_SHARD);

    assert.equal(shard.classification, SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL);
    assert.equal(shard.wrapperType, null);
    assert.equal(shard.profile, ARCHITECTURAL_PROFILE);
    assert.equal(shard.body, RAW_ARCHITECTURAL_SHARD);
});

test('classifies narrative shard using existing emoji-header structure', () => {
    const shard = classifySavedShardText(WRAPPED_NARRATIVE_SHARD);

    assert.equal(shard.classification, SAVED_SHARD_CLASSIFICATIONS.NARRATIVE);
    assert.equal(shard.profile, NARRATIVE_PROFILE);
    assert.equal(shard.contentFormat, SAVED_SHARD_FORMATS.NARRATIVE_EMOJI);
    assert.equal(shard.narrativeHeaderCount >= 2, true);
});

test('classifies wrapper-only non-profile narrative memory shards as legacy', () => {
    const shard = classifySavedShardText(WRAPPED_LEGACY_SHARD);

    assert.equal(shard.classification, SAVED_SHARD_CLASSIFICATIONS.LEGACY);
    assert.equal(shard.profile, null);
    assert.equal(shard.contentFormat, SAVED_SHARD_FORMATS.LEGACY_BRACKET);
});

test('malformed architectural key markers classify as unknown rather than architectural or legacy', () => {
    const shard = classifySavedShardText(MALFORMED_ARCHITECTURAL_SHARD);

    assert.equal(shard.classification, SAVED_SHARD_CLASSIFICATIONS.UNKNOWN);
    assert.equal(shard.keyMetadata.hasMalformedArchitecturalIdentity, true);
    assert.equal(shard.keyMetadata.hasValidArchitecturalIdentity, false);
});

test('profile compatibility allows only architectural baselines in architectural mode', () => {
    const architectural = classifySavedShardText(WRAPPED_ARCHITECTURAL_SHARD);
    const narrative = classifySavedShardText(WRAPPED_NARRATIVE_SHARD);
    const legacy = classifySavedShardText(WRAPPED_LEGACY_SHARD);

    assert.equal(isSavedShardCompatibleWithProfile(architectural, ARCHITECTURAL_PROFILE), true);
    assert.equal(isSavedShardCompatibleWithProfile(narrative, ARCHITECTURAL_PROFILE), false);
    assert.equal(isSavedShardCompatibleWithProfile(legacy, ARCHITECTURAL_PROFILE), false);
    assert.equal(isSavedShardCompatibleWithProfile(architectural, NARRATIVE_PROFILE), false);
    assert.equal(isSavedShardCompatibleWithProfile(narrative, NARRATIVE_PROFILE), true);
    assert.equal(isSavedShardCompatibleWithProfile(legacy, NARRATIVE_PROFILE), true);
});

test('architectural metadata builder exposes schema identity and decision ids for archive/vector boundaries', () => {
    const metadata = buildArchitecturalShardMetadata(WRAPPED_ARCHITECTURAL_SHARD);

    assert.deepEqual(metadata, {
        shardProfile: 'architectural',
        schemaVersion: 1,
        sectionKeys: ['timeline', 'decisions', 'current'],
        stableDecisionIds: ['persistence-shell'],
    });
});

test('narrative shard metadata remains unchanged by architectural metadata builder', () => {
    const metadata = buildArchitecturalShardMetadata(WRAPPED_NARRATIVE_SHARD);

    assert.deepEqual(metadata, {});
});
