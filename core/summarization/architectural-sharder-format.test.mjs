import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import {
    countStandaloneArchitecturalTerminators,
    inspectCanonicalArchitecturalOutput,
    normalizeArchitecturalResponse,
} from './architectural-sharder-shell.js';
import {
    parseArchitecturalExtractionResponse,
    reconstructArchitecturalExtraction,
} from './architectural-sharder-format.js';
import { validateArchitecturalStructuredSections } from './architectural-structured-validator.js';

const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
const fixtureDir = join(process.cwd(), 'core', 'summarization', 'fixtures');

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

test('architectural parser strips every standalone raw terminator line before section parsing', () => {
    const response = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1
Sources: Messages 4-6
===END===

[CURRENT]
Project|State|Focus|Pending|Blocked|Next

===END===

===END===
`;

    const sections = parseArchitecturalExtractionResponse(response, registry);

    assert.equal(countStandaloneArchitecturalTerminators(response), 3);
    assert.equal(sections._metadata.architectural.terminatorCount, 3);
    assert.equal(sections.current[0].content.includes('===END==='), false);
});

test('architectural terminator normalization handles missing and repeated raw markers', () => {
    assert.equal(countStandaloneArchitecturalTerminators(''), 0);
    assert.equal(countStandaloneArchitecturalTerminators('===END==='), 1);
    assert.equal(countStandaloneArchitecturalTerminators('===END===\n===END==='), 2);
    assert.equal(countStandaloneArchitecturalTerminators('\n===END===\n\n===END===\n\n===END===\n'), 3);

    assert.equal(normalizeArchitecturalResponse('\n===END===\n[CURRENT]\nA\n===END===\n').includes('===END==='), false);
});

test('canonical architectural output has one final terminator and only approved headers', () => {
    const output = reconstructArchitecturalExtraction({
        _metadata: {
            keyLines: [
                'Sources: Messages 9-10',
                'xref: decisions -> events',
            ],
        },
        timeline: [{ content: '(S9:1) Timeline item', selected: true }],
        decisions: [{ content: '(S9:1) Decision item', selected: true }],
        events: [{ content: '(S9:2) Event item', selected: true }],
        developments: [],
        dialogue: [],
        threads: [],
        current: [{ content: 'Project|State|Focus|Pending|Blocked|Next', selected: true }],
    }, registry);

    const inspection = inspectCanonicalArchitecturalOutput(output, registry);

    assert.equal(inspection.beginsWithKey, true);
    assert.deepEqual(inspection.unsupportedHeaders, []);
    assert.equal(inspection.currentHeaderCount, 1);
    assert.equal(inspection.terminatorCount, 1);
    assert.equal(inspection.endsWithTerminator, true);
    assert.equal(inspection.hasTrailingContent, false);
});

test('architectural dialogue parser preserves a two-line dialogue record as one item through reconstruction', () => {
    const source = readFileSync(join(fixtureDir, 'architectural-dialogue-two-line-01.txt'), 'utf8');
    const sections = parseArchitecturalExtractionResponse(source, registry);
    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    const reconstructed = reconstructArchitecturalExtraction(sections, registry);

    assert.equal(sections.dialogue.length, 1);
    assert.equal(sections.dialogue[0].content.split('\n').length, 2);
    assert.equal(diagnostics.some((entry) => entry.level === 'error'), false);
    assert.equal(reconstructed.includes('[S40:1] "Speaker and context must survive multiline parsing"\n--Archivist | fixture validation context'), true);

    sections.dialogue[0].content += '\nthird line';
    const blocked = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(blocked.some((entry) => entry.code === 'ARCH_DIALOGUE_TOO_MANY_LINES'), true);
});
