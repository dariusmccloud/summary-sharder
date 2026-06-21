import assert from 'node:assert/strict';
import test from 'node:test';

import {
    FREEFORM_SECTIONS,
    NARRATIVE_DISPLAY_NAME,
    NARRATIVE_PROFILE,
    NARRATIVE_SHARDER_REGISTRY,
    SHARDER_METADATA_SECTIONS,
    SHARDER_SECTIONS,
    getSharderContentSections,
    getSharderFreeformSectionKeys,
    getSharderMetadataSections,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';

const EXPECTED_CONTENT_SECTIONS = [
    { emoji: '🎨', name: 'TONE', key: 'tone' },
    { emoji: '👤', name: 'CHARACTERS', key: 'characterNotes', altNames: ['CHARACTER NOTES'] },
    { emoji: '🌍', name: 'WORLD', key: 'worldState', altNames: ['WORLD STATE'] },
    { emoji: '📍', name: 'TIMELINE', key: 'sceneBreaks', altNames: ['SCENE BREAKS'] },
    { emoji: '⚖️', name: 'EVENTS', key: 'events' },
    { emoji: '🔞', name: 'NSFW', key: 'nsfwContent', altNames: ['NSFW CONTENT'] },
    { emoji: '💬', name: 'DIALOGUE', key: 'keyDialogue', altNames: ['KEY DIALOGUE'] },
    { emoji: '🗣️', name: 'VOICE', key: 'voice' },
    { emoji: '🎭', name: 'STATES', key: 'characterStates', altNames: ['CHARACTER STATES'] },
    { emoji: '🔗', name: 'RELATIONSHIPS', key: 'relationshipShifts', altNames: ['RELATIONSHIP SHIFTS'] },
    { emoji: '🌱', name: 'DEVELOPMENTS', key: 'developments' },
    { emoji: '🎣', name: 'CALLBACKS', key: 'callbacks' },
    { emoji: '🧵', name: 'THREADS', key: 'looseThreads', altNames: ['LOOSE THREADS'] },
    { emoji: '🎬', name: 'SCENES', key: 'scenes' },
    { emoji: '⚓', name: 'ANCHORS', key: 'anchors' },
    { emoji: '📍', name: 'CURRENT', key: 'currentState', altNames: ['CURRENT STATE'], isLast: true },
];

test('narrative content sections retain exact original order', () => {
    assert.deepEqual(
        getSharderContentSections().map((section) => section.key),
        EXPECTED_CONTENT_SECTIONS.map((section) => section.key),
    );
});

test('each narrative section retains exact metadata', () => {
    assert.deepEqual(getSharderContentSections(), EXPECTED_CONTENT_SECTIONS);
});

test('KEY exists only in metadata definitions', () => {
    const metadataKeys = getSharderMetadataSections().map((section) => section.key);
    const contentKeys = getSharderContentSections().map((section) => section.key);

    assert.deepEqual(metadataKeys, ['key']);
    assert.equal(contentKeys.includes('key'), false);
});

test('KEY is non-selectable, non-prunable, and mandatory', () => {
    assert.deepEqual(getSharderMetadataSections(), [{
        emoji: '🔑',
        name: 'KEY',
        key: 'key',
        selectable: false,
        prunable: false,
        mandatory: true,
    }]);
});

test('missing profile resolves to narrative', () => {
    const registry = getSharderSectionRegistry();
    assert.equal(registry.profile, NARRATIVE_PROFILE);
    assert.equal(registry.displayName, NARRATIVE_DISPLAY_NAME);
});

test('unknown profile resolves to narrative', () => {
    const registry = getSharderSectionRegistry('unknown-profile');
    assert.equal(registry.profile, NARRATIVE_PROFILE);
    assert.deepEqual(registry.contentSections, EXPECTED_CONTENT_SECTIONS);
});

test('compatibility exports derive from the canonical narrative registry', () => {
    assert.equal(SHARDER_SECTIONS, NARRATIVE_SHARDER_REGISTRY.contentSections);
    assert.equal(SHARDER_METADATA_SECTIONS, NARRATIVE_SHARDER_REGISTRY.metadataSections);
    assert.equal(FREEFORM_SECTIONS, NARRATIVE_SHARDER_REGISTRY.freeformSectionKeys);
});

test('canonical arrays and section objects cannot be mutated', () => {
    assert.equal(Object.isFrozen(NARRATIVE_SHARDER_REGISTRY), true);
    assert.equal(Object.isFrozen(SHARDER_SECTIONS), true);
    assert.equal(Object.isFrozen(SHARDER_METADATA_SECTIONS), true);
    assert.equal(Object.isFrozen(FREEFORM_SECTIONS), true);
    assert.equal(Object.isFrozen(SHARDER_SECTIONS[1]), true);
    assert.equal(Object.isFrozen(SHARDER_SECTIONS[1].altNames), true);

    assert.throws(() => SHARDER_SECTIONS.push({ key: 'bad' }), TypeError);
    assert.throws(() => { SHARDER_SECTIONS[0].key = 'bad'; }, TypeError);
    assert.throws(() => SHARDER_SECTIONS[1].altNames.push('BAD'), TypeError);
});

test('accessor-returned values cannot mutate canonical source', () => {
    const registry = getSharderSectionRegistry();
    registry.contentSections[0].key = 'mutated';
    registry.metadataSections[0].selectable = true;
    registry.freeformSectionKeys.push('mutated');

    assert.equal(NARRATIVE_SHARDER_REGISTRY.contentSections[0].key, 'tone');
    assert.equal(NARRATIVE_SHARDER_REGISTRY.metadataSections[0].selectable, false);
    assert.equal(NARRATIVE_SHARDER_REGISTRY.freeformSectionKeys.includes('mutated'), false);
    assert.equal(getSharderContentSections()[0].key, 'tone');
});

test('optional missing metadata and freeform arrays are handled safely', () => {
    const registry = getSharderSectionRegistry({
        profile: 'custom',
        displayName: 'Custom',
        contentSections: [{ emoji: 'A', name: 'ALPHA', key: 'alpha' }],
    });

    assert.deepEqual(registry.metadataSections, []);
    assert.deepEqual(registry.freeformSectionKeys, []);
    assert.deepEqual(getSharderMetadataSections(registry), []);
    assert.deepEqual(getSharderFreeformSectionKeys(registry), []);
});

test('malformed content-section registries fail predictably', () => {
    assert.throws(
        () => getSharderSectionRegistry({ profile: 'bad' }),
        /non-empty contentSections array/,
    );
    assert.throws(
        () => getSharderSectionRegistry({ profile: 'bad', contentSections: [] }),
        /non-empty contentSections array/,
    );
    assert.throws(
        () => getSharderSectionRegistry({ profile: 'bad', contentSections: [{ name: 'BAD', emoji: 'B' }] }),
        /non-empty key/,
    );
});

