import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import {
    parseArchitecturalExtractionResponse,
    reconstructArchitecturalExtraction,
} from './architectural-sharder-format.js';

const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);

test('architectural parser reads bracket headers without narrative sections', () => {
    const sections = parseArchitecturalExtractionResponse(`
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 1-3

[TIMELINE]
(S1:1) Architectural profile selected

[DECISIONS]
(S1:1) ID:profile-shell | STATUS:ACCEPTED | WHY:unstated

[EVENTS]
(S2:1) 🟠 Shell test ran -> output validated

[CURRENT]
Project|State|Focus|Pending|Blocked|Next
===END===
`, registry);

    assert.deepEqual(Object.keys(sections).filter((key) => !key.startsWith('_')), [
        'timeline',
        'decisions',
        'events',
        'developments',
        'dialogue',
        'threads',
        'current',
    ]);
    assert.equal(sections._metadata.architectural.keyPresent, true);
    assert.equal(sections._metadata.architectural.terminatorCount, 1);
    assert.deepEqual(sections._metadata.keyLines, [
        'Profile: architectural-memory',
        'Schema: architectural-memory/v1',
        'Sources: Messages 1-3',
    ]);
    assert.equal(sections.timeline[0].content, '(S1:1) Architectural profile selected');
    assert.equal(sections.events[0].weight, 4);
    assert.equal(sections.current.length, 1);
    assert.equal(sections.tone, undefined);
    assert.equal(sections.characterNotes, undefined);
});

test('architectural parser records unsupported headers as warnings metadata', () => {
    const sections = parseArchitecturalExtractionResponse(`
[KEY]
Sources: Messages 1-3

[WORLD]
Should not become a content section.

[CURRENT]
Project|State|Focus|Pending|Blocked|Next
`, registry);

    assert.deepEqual(sections._metadata.architectural.unknownSectionHeaders, ['WORLD']);
    assert.equal(sections.worldState, undefined);
});

test('architectural renderer owns canonical KEY metadata and terminator', () => {
    const output = reconstructArchitecturalExtraction({
        _metadata: {
            keyLines: [
                'Profile: wrong',
                'Schema: wrong',
                'Sources: Messages 1-3',
                '#=TIMELINE xref',
            ],
        },
        timeline: [{ content: '(S1:1) Timeline item', selected: true }],
        decisions: [{ content: '(S1:1) Decision item', selected: true }],
        events: [{ content: '(S2:1) Event item', selected: false }],
        developments: [],
        dialogue: [],
        threads: [],
        current: [{ content: 'Project|State|Focus|Pending|Blocked|Next', selected: true }],
    }, registry);

    assert.equal((output.match(/\[KEY\]/g) || []).length, 1);
    assert.equal((output.match(new RegExp(`Profile: ${ARCHITECTURAL_PROFILE_MARKER}`, 'g')) || []).length, 1);
    assert.equal((output.match(new RegExp(`Schema: ${ARCHITECTURAL_SCHEMA_MARKER}`, 'g')) || []).length, 1);
    assert.equal((output.match(/===END===/g) || []).length, 1);
    assert.equal(output.endsWith('===END==='), true);
    assert.equal(output.includes('Profile: wrong'), false);
    assert.equal(output.includes('Schema: wrong'), false);
    assert.equal(output.includes('Sources: Messages 1-3'), true);
    assert.equal(output.includes('(S2:1) Event item'), false);
});
