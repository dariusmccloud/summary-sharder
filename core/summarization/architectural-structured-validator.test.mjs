import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseArchitecturalExtractionResponse, reconstructArchitecturalExtraction } from './architectural-sharder-format.js';
import { ARCHITECTURAL_PROFILE, getSharderSectionRegistry } from './sharder-section-registry.js';
import {
    ARCHITECTURAL_DECISION_TYPES,
    ARCHITECTURAL_SECTION_CAPS,
    buildArchitecturalBaselineFromShards,
    indexedSelectedItems,
    validateArchitecturalStructuredSections,
} from './architectural-structured-validator.js';

const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
const fixtureDir = join(process.cwd(), 'core', 'summarization', 'fixtures');

function readFixture(name) {
    return readFileSync(join(fixtureDir, name), 'utf8');
}

function parseFixture(name) {
    return parseArchitecturalExtractionResponse(readFixture(name), registry);
}

function codes(diagnostics) {
    return diagnostics.map((entry) => entry.code);
}

test('valid minimal architectural fixture passes structured validation', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });

    assert.equal(diagnostics.some((entry) => entry.level === 'error'), false);
});

test('canonical decision TYPE list includes PROCEDURE', () => {
    assert.deepEqual(ARCHITECTURAL_DECISION_TYPES, [
        'GOVERNANCE',
        'JURISDICTION',
        'HIERARCHY',
        'CORRECTION',
        'REPLACEMENT',
        'RENAME',
        'SCOPE',
        'DIAGNOSTIC',
        'IMPLEMENTATION',
        'STRATEGY',
        'COMMITMENT',
        'PROCEDURE',
    ]);
});

test('selected-entry section caps treat deselected entries as non-counting', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    const over = Array.from({ length: ARCHITECTURAL_SECTION_CAPS.timeline + 1 }, (_, index) => ({
        content: `[S10:${index + 1}] timeline item ${index + 1}`,
        selected: index < ARCHITECTURAL_SECTION_CAPS.timeline,
    }));
    over.push({
        content: '[S10:99] over-cap item',
        selected: true,
    });

    sections.timeline = over;
    let diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(codes(diagnostics).includes('ARCH_CAP_EXCEEDED'), true);

    sections.timeline[sections.timeline.length - 1].selected = false;
    diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(codes(diagnostics).includes('ARCH_CAP_EXCEEDED'), false);
});

test('lifecycle validation accepts allowed transitions and rejects regressions', () => {
    const baselineContent = readFixture('architectural-lifecycle-baseline-01.txt');
    const baseline = buildArchitecturalBaselineFromShards([{ content: baselineContent, identifier: 'baseline' }]);
    const valid = parseFixture('architectural-lifecycle-current-valid-01.txt');
    const invalid = parseFixture('architectural-lifecycle-current-invalid-01.txt');

    const validDiagnostics = validateArchitecturalStructuredSections(valid, { baselineDecisions: baseline.decisions });
    const invalidDiagnostics = validateArchitecturalStructuredSections(invalid, { baselineDecisions: baseline.decisions });

    assert.equal(validDiagnostics.some((entry) => entry.code === 'ARCH_LIFECYCLE_INVALID_TRANSITION'), false);
    assert.equal(invalidDiagnostics.some((entry) => entry.code === 'ARCH_LIFECYCLE_INVALID_TRANSITION'), true);
});

test('supersession validation allows baseline-only targets and warns on unresolved historical targets', () => {
    const baselineContent = readFixture('architectural-lifecycle-baseline-01.txt');
    const baseline = buildArchitecturalBaselineFromShards([{ content: baselineContent, identifier: 'baseline' }]);
    const sections = parseFixture('architectural-valid-minimal-01.txt');

    sections.decisions.push({
        content: '[S11:1] 🟠 ID:new-target | TYPE:REPLACEMENT | DECISION:Resolve missing history | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | SUPERSEDES:missing-history | EVIDENCE:"history missing"',
        selected: true,
    });

    let diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });
    assert.equal(codes(diagnostics).includes('ARCH_SUPERSESSION_HISTORICAL_UNRESOLVED'), true);

    sections.decisions[sections.decisions.length - 1].content = '[S11:1] 🟠 ID:new-target | TYPE:REPLACEMENT | DECISION:Resolve baseline history | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | SUPERSEDES:legacy-replaced | EVIDENCE:"baseline history exists"';
    diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });
    assert.equal(codes(diagnostics).includes('ARCH_SUPERSESSION_HISTORICAL_UNRESOLVED'), false);
});

test('baseline decision retained unchanged passes continuity check', () => {
    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const sections = parseFixture('architectural-lifecycle-baseline-01.txt');

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(codes(diagnostics).includes('ARCH_BASELINE_DECISION_DROPPED'), false);
});

test('baseline decision omitted yields blocking dropped diagnostic', () => {
    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const sections = parseFixture('architectural-valid-minimal-01.txt');

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_BASELINE_DECISION_DROPPED' && entry.recordId === 'decision-proposed'), true);
});

test('baseline decision retained as properly superseded with reciprocal replacement passes', () => {
    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S2:1] 🔴 ID:decision-proposed | TYPE:GOVERNANCE | DECISION:Baseline proposed decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | EVIDENCE:"promoted"', selected: true },
        { content: '[S2:2] 🔴 ID:decision-accepted | TYPE:IMPLEMENTATION | DECISION:Baseline accepted decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:SUPERSEDED | SUPERSEDED-BY:decision-accepted-replacement | EVIDENCE:"superseded now"', selected: true },
        { content: '[S2:3] 🔴 ID:decision-accepted-replacement | TYPE:REPLACEMENT | DECISION:Replacement decision established | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | SUPERSEDES:decision-accepted | EVIDENCE:"replacement accepted"', selected: true },
        { content: '[S2:4] 🔴 ID:decision-sealed | TYPE:COMMITMENT | DECISION:Baseline sealed decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:SEALED | EVIDENCE:"still sealed"', selected: true },
        { content: '[S2:5] 🔴 ID:legacy-replaced | TYPE:REPLACEMENT | DECISION:Baseline replaced decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:SUPERSEDED | SUPERSEDED-BY:new-replacement | EVIDENCE:"baseline superseded"', selected: true },
        { content: '[S2:6] 🔴 ID:new-replacement | TYPE:REPLACEMENT | DECISION:Replacement for historical superseded record | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | SUPERSEDES:legacy-replaced | EVIDENCE:"historical replacement"', selected: true },
    ];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(codes(diagnostics).includes('ARCH_BASELINE_DECISION_DROPPED'), false);
    assert.equal(codes(diagnostics).includes('ARCH_SUPERSESSION_RECIPROCAL_MISSING'), false);
});

test('baseline decision renamed without supersession yields blocking drop', () => {
    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S2:1] 🔴 ID:decision-proposed | TYPE:GOVERNANCE | DECISION:Baseline proposed decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | EVIDENCE:"promoted"', selected: true },
        { content: '[S2:2] 🔴 ID:renamed-accepted-decision | TYPE:IMPLEMENTATION | DECISION:Renamed without supersession | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | EVIDENCE:"rename only"', selected: true },
        { content: '[S2:3] 🔴 ID:decision-sealed | TYPE:COMMITMENT | DECISION:Baseline sealed decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:SEALED | EVIDENCE:"still sealed"', selected: true },
        { content: '[S2:4] 🔴 ID:legacy-replaced | TYPE:REPLACEMENT | DECISION:Baseline replaced decision | WHY:unstated | SCOPE:Lifecycle test | STATUS:SUPERSEDED | SUPERSEDED-BY:new-replacement | EVIDENCE:"baseline superseded"', selected: true },
        { content: '[S2:5] 🔴 ID:new-replacement | TYPE:REPLACEMENT | DECISION:Replacement for historical superseded record | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | SUPERSEDES:legacy-replaced | EVIDENCE:"historical replacement"', selected: true },
    ];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_BASELINE_DECISION_DROPPED' && entry.recordId === 'decision-accepted'), true);
});

test('baseline continuity cap conflict emits explicit blocking error', () => {
    const baselineDecisions = {};
    for (let index = 0; index < ARCHITECTURAL_SECTION_CAPS.decisions; index++) {
        baselineDecisions[`baseline-${index + 1}`] = { id: `baseline-${index + 1}`, status: 'ACCEPTED', source: 'baseline' };
    }
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = Array.from({ length: ARCHITECTURAL_SECTION_CAPS.decisions }, (_, index) => ({
        content: `[S3:${index + 1}] 🔴 ID:${index < ARCHITECTURAL_SECTION_CAPS.decisions - 1 ? `baseline-${index + 1}` : 'new-extra'} | TYPE:GOVERNANCE | DECISION:Decision ${index + 1} | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"fixture"`,
        selected: true,
    }));

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions });

    assert.equal(codes(diagnostics).includes('ARCH_BASELINE_DECISION_CAP_CONFLICT'), true);
    assert.equal(codes(diagnostics).includes('ARCH_BASELINE_DECISION_DROPPED'), true);
});

test('live fixture parses exact counts and surfaces expected errors without PROCEDURE false positives', () => {
    const sections = parseFixture('architectural-live-over-cap-01.txt');
    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    const output = reconstructArchitecturalExtraction(sections, registry);

    assert.equal(sections.timeline.length, 23);
    assert.equal(sections.decisions.length, 14);
    assert.equal(sections.events.length, 16);
    assert.equal(sections.developments.length, 10);
    assert.equal(sections.dialogue.length, 8);
    assert.equal(sections.threads.length, 2);
    assert.equal(sections.current.length, 1);

    assert.equal(codes(diagnostics).includes('ARCH_CAP_EXCEEDED'), true);
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_DECISION_TYPE_INVALID' && /PROCEDURE/.test(entry.message)), false);
    assert.equal(diagnostics.some((entry) => entry.code.startsWith('ARCH_DIALOGUE_')), true);
    assert.equal(output.match(/Profile: architectural-memory/g)?.length || 0, 1);
    assert.equal(output.match(/===END===/g)?.length || 0, 1);
});

test('baseline builder ignores malformed historical records with warnings instead of crashing', () => {
    const malformed = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:Bad_ID | TYPE:GOVERNANCE | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:INVALID | EVIDENCE:"z"

[CURRENT]
Fixture | Bad historical | Ignore malformed baseline | None | None | Continue

===END===
`;

    const baseline = buildArchitecturalBaselineFromShards([{ content: malformed, identifier: 'bad-baseline' }]);

    assert.equal(Object.keys(baseline.decisions).length, 0);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);
});

test('baseline builder uses deterministic latest precedence by messageRangeStart and stable tie break', () => {
    const low = readFixture('architectural-lifecycle-baseline-01.txt');
    const high = low.replace('STATUS:PROPOSED', 'STATUS:SEALED');
    const equalA = low.replace('STATUS:ACCEPTED', 'STATUS:PROPOSED');
    const equalB = low.replace('STATUS:ACCEPTED', 'STATUS:SEALED');

    let baseline = buildArchitecturalBaselineFromShards([
        { content: high, identifier: 'high', messageRangeStart: 50 },
        { content: low, identifier: 'low', messageRangeStart: 10 },
    ]);
    assert.equal(baseline.decisions['decision-proposed'].status, 'SEALED');

    baseline = buildArchitecturalBaselineFromShards([
        { content: equalB, identifier: 'equal-b', messageRangeStart: 20 },
        { content: equalA, identifier: 'equal-a', messageRangeStart: 20 },
    ]);
    assert.equal(baseline.decisions['decision-accepted'].status, 'PROPOSED');

    const repeated = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:repeat-id | TYPE:GOVERNANCE | DECISION:first | WHY:unstated | SCOPE:test | STATUS:PROPOSED | EVIDENCE:"one"
[S1:2] 🔴 ID:repeat-id | TYPE:GOVERNANCE | DECISION:second | WHY:unstated | SCOPE:test | STATUS:SEALED | EVIDENCE:"two"

[CURRENT]
Fixture | Repeat ids | Baseline order test | None | None | Continue

===END===
`;
    baseline = buildArchitecturalBaselineFromShards([{ content: repeated, identifier: 'repeated', messageRangeStart: 5 }]);
    assert.equal(baseline.decisions['repeat-id'].status, 'SEALED');
});

test('baseline builder ignores structurally malformed historical authority even with valid id and status', () => {
    const malformed = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:valid-id | STATUS:ACCEPTED | DECISION:X | SCOPE:Y | EVIDENCE:"z"

[CURRENT]
Fixture | Bad history | Ignore record | None | None | Continue

===END===
`;

    const baseline = buildArchitecturalBaselineFromShards([{ content: malformed, identifier: 'missing-fields', messageRangeStart: 1 }]);
    assert.equal(baseline.decisions['valid-id'], undefined);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);
});

test('baseline builder ignores malformed historical supersession semantics', () => {
    const missingSupersededBy = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:valid-id | TYPE:REPLACEMENT | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:SUPERSEDED | EVIDENCE:"z"

[CURRENT]
Fixture | Bad history | Ignore record | None | None | Continue

===END===
`;
    let baseline = buildArchitecturalBaselineFromShards([{ content: missingSupersededBy, identifier: 'missing-superseded-by', messageRangeStart: 1 }]);
    assert.equal(baseline.decisions['valid-id'], undefined);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);

    const supersededByOnAccepted = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:valid-id | TYPE:REPLACEMENT | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:ACCEPTED | SUPERSEDED-BY:other-id | EVIDENCE:"z"

[CURRENT]
Fixture | Bad history | Ignore record | None | None | Continue

===END===
`;
    baseline = buildArchitecturalBaselineFromShards([{ content: supersededByOnAccepted, identifier: 'superseded-by-on-accepted', messageRangeStart: 1 }]);
    assert.equal(baseline.decisions['valid-id'], undefined);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);

    const selfSupersedes = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:valid-id | TYPE:REPLACEMENT | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:ACCEPTED | SUPERSEDES:valid-id | EVIDENCE:"z"

[CURRENT]
Fixture | Bad history | Ignore record | None | None | Continue

===END===
`;
    baseline = buildArchitecturalBaselineFromShards([{ content: selfSupersedes, identifier: 'self-supersedes', messageRangeStart: 1 }]);
    assert.equal(baseline.decisions['valid-id'], undefined);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);

    const selfSupersededBy = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:valid-id | TYPE:REPLACEMENT | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:SUPERSEDED | SUPERSEDED-BY:valid-id | EVIDENCE:"z"

[CURRENT]
Fixture | Bad history | Ignore record | None | None | Continue

===END===
`;
    baseline = buildArchitecturalBaselineFromShards([{ content: selfSupersededBy, identifier: 'self-superseded-by', messageRangeStart: 1 }]);
    assert.equal(baseline.decisions['valid-id'], undefined);
    assert.equal(codes(baseline.diagnostics).includes('ARCH_BASELINE_DECISION_IGNORED'), true);
});

test('indexed selected items preserve original row indices after deselection', () => {
    const items = [
        { content: 'row 0', selected: false },
        { content: 'row 1', selected: true },
        { content: 'row 2', selected: true },
    ];

    assert.deepEqual(indexedSelectedItems(items).map(({ itemIndex }) => itemIndex), [1, 2]);
});

test('duplicate decision and lifecycle diagnostics preserve original item indices after deselection', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S1:1] 🔴 ID:decision-sealed | TYPE:REPLACEMENT | DECISION:skip me | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"skip"', selected: false },
        { content: '[S1:2] 🔴 ID:decision-sealed | TYPE:REPLACEMENT | DECISION:bad transition one | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"dup one"', selected: true },
        { content: '[S1:3] 🔴 ID:decision-sealed | TYPE:REPLACEMENT | DECISION:bad transition two | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"dup two"', selected: true },
    ];

    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_DECISION_DUPLICATE_ID' && entry.itemIndex === 2), true);
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_LIFECYCLE_INVALID_TRANSITION' && entry.itemIndex === 1), true);
});

test('ordinary accepted wording in events does not require DEC but explicit decision transition does', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.events = [
        { content: '[S2:1] 🟠 Parser accepted the payload', selected: true },
        { content: '[S2:2] 🟠 decision accepted after review', selected: true },
    ];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_REQUIRED' && entry.itemIndex === 0), false);
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_REQUIRED' && entry.itemIndex === 1), true);
});

test('repeated pipe-delimited DEC fields pass event validation', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S4:1] 🔴 ID:first-id | TYPE:GOVERNANCE | DECISION:First decision | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"one"', selected: true },
        { content: '[S4:2] 🔴 ID:second-id | TYPE:GOVERNANCE | DECISION:Second decision | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"two"', selected: true },
    ];
    sections.events = [{ content: '[S4:3] 🟠 Event description | DEC:first-id | DEC:second-id', selected: true }];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_UNRESOLVED'), false);
});

test('comma-delimited explicit DEC list normalizes safely with warning', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S4:1] 🔴 ID:first-id | TYPE:GOVERNANCE | DECISION:First decision | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"one"', selected: true },
        { content: '[S4:2] 🔴 ID:second-id | TYPE:GOVERNANCE | DECISION:Second decision | WHY:unstated | SCOPE:Tests | STATUS:ACCEPTED | EVIDENCE:"two"', selected: true },
    ];
    sections.events = [{ content: '[S4:3] 🟠 Event description | DEC:first-id, DEC:second-id', selected: true }];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_LIST_NORMALIZED'), true);
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_UNRESOLVED'), false);
});

test('event referencing dropped baseline decision remains unresolved', () => {
    const baseline = buildArchitecturalBaselineFromShards([{ content: readFixture('architectural-lifecycle-baseline-01.txt'), identifier: 'baseline' }]);
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.decisions = [
        { content: '[S4:1] 🔴 ID:renamed-accepted-decision | TYPE:IMPLEMENTATION | DECISION:Renamed without supersession | WHY:unstated | SCOPE:Lifecycle test | STATUS:ACCEPTED | EVIDENCE:"rename only"', selected: true },
    ];
    sections.events = [{ content: '[S4:2] 🟠 Event description | DEC:decision-accepted', selected: true }];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: baseline.decisions });

    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_BASELINE_DECISION_DROPPED' && entry.recordId === 'decision-accepted'), true);
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_EVENT_DEC_UNRESOLVED' && entry.recordId === 'decision-accepted'), true);
});

test('event descriptions cannot be empty', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.events = [{ content: '[S2:1] 🟠 | DEC:pipe-escape-proof', selected: true }];

    const diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(codes(diagnostics).includes('ARCH_EVENT_EMPTY_DESCRIPTION'), true);
});

test('dialogue allows omitted context but rejects explicitly empty context', () => {
    const sections = parseFixture('architectural-valid-minimal-01.txt');
    sections.dialogue = [
        { content: '[S2:1] "Exact quote." --Elena', selected: true },
        { content: '[S2:2] "Exact quote." --Elena | optional structural context', selected: true },
    ];

    let diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_DIALOGUE_MISSING_CONTEXT'), false);

    sections.dialogue = [
        { content: '[S2:3] "Exact quote." --Elena |', selected: true },
    ];
    diagnostics = validateArchitecturalStructuredSections(sections, { baselineDecisions: {} });
    assert.equal(diagnostics.some((entry) => entry.code === 'ARCH_DIALOGUE_MISSING_CONTEXT'), true);
});
