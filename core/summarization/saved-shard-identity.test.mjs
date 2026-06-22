import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHITECTURAL_PROFILE, NARRATIVE_PROFILE } from './sharder-section-registry.js';
import {
    SAVED_SHARD_CLASSIFICATIONS,
    SAVED_SHARD_FORMATS,
    buildSavedShardCandidate,
    buildStandardSummaryCandidate,
    buildArchitecturalShardMetadata,
    classifySavedShardText,
    isSavedShardCompatibleWithProfile,
    parseManagedMemoryShardComment,
    parseManagedSummaryComment,
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

const WRAPPED_MALFORMED_ARCHITECTURAL_SHARD = `[MEMORY SHARD: Messages 60-62]

[KEY]
Profile: architectural-memory
Schema: architectural-memory/v2
Sources: Messages 60-62

[CURRENT]
Project | Wrapped malformed | Reject in standard summary | None | None | Continue

===END===`;

const GENERIC_PROSE_SUMMARY = `A plain prose recap with no managed shard markers.`;

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

test('managed memory shard comment parsing only accepts managed memory shard names', () => {
    assert.deepEqual(parseManagedMemoryShardComment('Memory Shard 7-9'), {
        startIndex: 7,
        endIndex: 9,
    });
    assert.equal(parseManagedMemoryShardComment('Summary 7-9'), null);
    assert.equal(parseManagedMemoryShardComment('Not a shard'), null);
});

test('managed summary comment parsing accepts only summary names', () => {
    assert.deepEqual(parseManagedSummaryComment('Summary 7-9'), {
        startIndex: 7,
        endIndex: 9,
    });
    assert.equal(parseManagedSummaryComment('Memory Shard 7-9'), null);
});

test('comment fallback accepts compatible narrative and legacy lorebook bodies only in narrative mode', () => {
    const narrativeCandidate = buildSavedShardCandidate(WRAPPED_NARRATIVE_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 30-32',
        activeProfile: NARRATIVE_PROFILE,
    });
    const legacyCandidate = buildSavedShardCandidate(WRAPPED_LEGACY_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 40-42',
        activeProfile: NARRATIVE_PROFILE,
    });

    assert.equal(narrativeCandidate.classification, SAVED_SHARD_CLASSIFICATIONS.NARRATIVE);
    assert.equal(narrativeCandidate.startIndex, 30);
    assert.equal(legacyCandidate.classification, SAVED_SHARD_CLASSIFICATIONS.LEGACY);
    assert.equal(legacyCandidate.startIndex, 40);
});

test('comment fallback accepts only architectural lorebook bodies in architectural mode', () => {
    const architecturalCandidate = buildSavedShardCandidate(RAW_ARCHITECTURAL_SHARD, {
        comment: 'Memory Shard 20-22',
        activeProfile: ARCHITECTURAL_PROFILE,
    });
    const narrativeCandidate = buildSavedShardCandidate(WRAPPED_NARRATIVE_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 30-32',
        activeProfile: ARCHITECTURAL_PROFILE,
    });
    const malformedCandidate = buildSavedShardCandidate(MALFORMED_ARCHITECTURAL_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 50-52',
        activeProfile: ARCHITECTURAL_PROFILE,
    });

    assert.equal(architecturalCandidate.classification, SAVED_SHARD_CLASSIFICATIONS.ARCHITECTURAL);
    assert.equal(architecturalCandidate.startIndex, 20);
    assert.equal(narrativeCandidate, null);
    assert.equal(malformedCandidate, null);
});

test('managed memory shard comments never override unknown content identity', () => {
    const candidate = buildSavedShardCandidate('Unclassified shard body', {
        comment: 'Memory Shard 90-91',
        activeProfile: NARRATIVE_PROFILE,
    });

    assert.equal(candidate, null);
});

test('standard summary admission accepts wrapped narrative memory shard', () => {
    const candidate = buildStandardSummaryCandidate(WRAPPED_NARRATIVE_SHARD);

    assert.equal(candidate.kind, 'memory-shard-wrapper');
    assert.equal(candidate.startIndex, 30);
    assert.equal(candidate.endIndex, 32);
});

test('standard summary admission accepts wrapped legacy memory shard', () => {
    const candidate = buildStandardSummaryCandidate(WRAPPED_LEGACY_SHARD);

    assert.equal(candidate.kind, 'memory-shard-wrapper');
    assert.equal(candidate.startIndex, 40);
    assert.equal(candidate.endIndex, 42);
});

test('standard summary admission rejects wrapped architectural memory shard', () => {
    const candidate = buildStandardSummaryCandidate(WRAPPED_ARCHITECTURAL_SHARD);

    assert.equal(candidate, null);
});

test('standard summary admission rejects wrapped malformed architectural memory shard', () => {
    const candidate = buildStandardSummaryCandidate(WRAPPED_MALFORMED_ARCHITECTURAL_SHARD);

    assert.equal(candidate, null);
});

test('standard summary admission rejects raw architectural lorebook body even when comment is memory shard', () => {
    const candidate = buildStandardSummaryCandidate(RAW_ARCHITECTURAL_SHARD, {
        comment: 'Memory Shard 20-22',
    });

    assert.equal(candidate, null);
});

test('standard summary admission rejects malformed architectural lorebook body for memory shard and summary comments', () => {
    const memoryShardCandidate = buildStandardSummaryCandidate(MALFORMED_ARCHITECTURAL_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 50-52',
    });
    const summaryCandidate = buildStandardSummaryCandidate(MALFORMED_ARCHITECTURAL_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Summary 50-52',
    });

    assert.equal(memoryShardCandidate, null);
    assert.equal(summaryCandidate, null);
});

test('standard summary admission accepts generic prose summary by Summary N-N comment', () => {
    const candidate = buildStandardSummaryCandidate(GENERIC_PROSE_SUMMARY, {
        comment: 'Summary 70-71',
    });

    assert.equal(candidate.kind, 'summary-comment');
    assert.equal(candidate.startIndex, 70);
    assert.equal(candidate.endIndex, 71);
    assert.equal(candidate.text, GENERIC_PROSE_SUMMARY);
});

test('standard summary admission accepts narrative and legacy lorebook bodies by memory shard comment', () => {
    const narrativeCandidate = buildStandardSummaryCandidate(WRAPPED_NARRATIVE_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 30-32',
    });
    const legacyCandidate = buildStandardSummaryCandidate(WRAPPED_LEGACY_SHARD.replace(/^\[MEMORY SHARD:[\s\S]*?\]\n\n/, ''), {
        comment: 'Memory Shard 40-42',
    });

    assert.equal(narrativeCandidate.kind, 'memory-shard-comment');
    assert.equal(legacyCandidate.kind, 'memory-shard-comment');
});
