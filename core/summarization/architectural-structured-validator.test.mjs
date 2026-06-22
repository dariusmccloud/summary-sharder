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
