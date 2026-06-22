import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    ARCHITECTURAL_DECISION_NEW_ID_LIMITS,
    buildArchitecturalBaselineLedger,
    mergeArchitecturalDecisionLedger,
} from './architectural-decision-ledger.js';
import { parseArchitecturalExtractionResponse } from './architectural-sharder-format.js';
import { ARCHITECTURAL_PROFILE, getSharderSectionRegistry } from './sharder-section-registry.js';

const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);
const fixtureDir = join(process.cwd(), 'core', 'summarization', 'fixtures');

function readFixture(name) {
    return readFileSync(join(fixtureDir, name), 'utf8');
}

function makeDecision(id, status = 'ACCEPTED', extra = '') {
    return {
        content: `[S9:1] 🟠 ID:${id} | TYPE:IMPLEMENTATION | DECISION:${id} decision | WHY:unstated | SCOPE:tests | STATUS:${status} | EVIDENCE:"${id}"${extra}`,
        selected: true,
    };
}

test('baseline builder preserves deterministic baseline order and conflict diagnostics', () => {
    const conflicting = `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
[S1:1] 🔴 ID:repeat-id | TYPE:GOVERNANCE | DECISION:first | WHY:unstated | SCOPE:test | STATUS:PROPOSED | EVIDENCE:"one"
[S1:2] 🔴 ID:repeat-id | TYPE:GOVERNANCE | DECISION:second | WHY:unstated | SCOPE:test | STATUS:SEALED | EVIDENCE:"two"

[CURRENT]
Fixture | Conflict | Baseline order test | None | None | Continue

===END===
`;

    const ledger = buildArchitecturalBaselineLedger([{ content: conflicting, identifier: 'conflicting-baseline', messageRangeStart: 1 }]);

    assert.deepEqual(ledger.orderedIds, ['repeat-id']);
    assert.equal(ledger.diagnostics.some((entry) => entry.code === 'ARCH_BASELINE_DUPLICATE_ID_CONFLICT'), true);
});

test('baseline omissions are carried forward and formatting-only overlays remain inherited', () => {
    const baselineContent = readFixture('architectural-lifecycle-baseline-01.txt');
    const baselineLedger = buildArchitecturalBaselineLedger([{ content: baselineContent, identifier: 'baseline', messageRangeStart: 1 }]);
    const parsed = parseArchitecturalExtractionResponse(baselineContent, registry);
    const generatedItems = parsed.decisions.map((item) => ({
        ...item,
        content: String(item.content).replace('| TYPE:GOVERNANCE |', '| TYPE: GOVERNANCE |'),
    }));

    const merged = mergeArchitecturalDecisionLedger(generatedItems, baselineLedger);

    assert.equal(merged.items.length >= baselineLedger.orderedIds.length, true);
    assert.equal(merged.metrics.newCount, 0);
    assert.equal(merged.metrics.updatedCount, 0);
    assert.equal(merged.metrics.inheritedCount, baselineLedger.orderedIds.length);
});

test('twelve baseline ids plus nine new ids is valid because only new ids count against capacity', () => {
    const baselineDecisions = Array.from({ length: 12 }, (_, index) => makeDecision(`baseline-${index + 1}`));
    const baselineLedger = buildArchitecturalBaselineLedger([{
        content: reconstructFixtureFromDecisions(baselineDecisions),
        identifier: 'baseline',
        messageRangeStart: 1,
    }]);
    const generated = baselineDecisions.concat(Array.from({ length: 9 }, (_, index) => makeDecision(`new-${index + 1}`)));

    const merged = mergeArchitecturalDecisionLedger(generated, baselineLedger);

    assert.equal(merged.metrics.inheritedCount, 12);
    assert.equal(merged.metrics.newCount, 9);
    assert.equal(merged.metrics.guidanceLevel, 'soft');
});

test('more than twenty new ids is blocked while more than twenty total ids can still be valid', () => {
    const baselineLedger = buildArchitecturalBaselineLedger([{
        content: reconstructFixtureFromDecisions(Array.from({ length: 12 }, (_, index) => makeDecision(`baseline-${index + 1}`))),
        identifier: 'baseline',
        messageRangeStart: 1,
    }]);

    const underHardCap = mergeArchitecturalDecisionLedger(
        Array.from({ length: 12 }, (_, index) => makeDecision(`baseline-${index + 1}`))
            .concat(Array.from({ length: 20 }, (_, index) => makeDecision(`new-${index + 1}`))),
        baselineLedger
    );
    assert.equal(underHardCap.metrics.newCount, 20);
    assert.notEqual(underHardCap.metrics.guidanceLevel, 'blocked');

    const overHardCap = mergeArchitecturalDecisionLedger(
        Array.from({ length: 21 }, (_, index) => makeDecision(`fresh-${index + 1}`)),
        { decisionsById: {}, orderedIds: [], diagnostics: [] }
    );
    assert.equal(overHardCap.metrics.newCount, 21);
    assert.equal(overHardCap.metrics.guidanceLevel, 'blocked');
});

test('override eligibility requires all excess new ids to remain PROPOSED', () => {
    const proposedOverflow = mergeArchitecturalDecisionLedger(
        Array.from({ length: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax + 2 }, (_, index) => makeDecision(`proposed-${index + 1}`, 'PROPOSED')),
        { decisionsById: {}, orderedIds: [], diagnostics: [] }
    );
    assert.equal(proposedOverflow.metrics.overrideEligible, true);

    const acceptedOverflow = mergeArchitecturalDecisionLedger(
        Array.from({ length: ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax + 1 }, (_, index) =>
            makeDecision(`mixed-${index + 1}`, index >= ARCHITECTURAL_DECISION_NEW_ID_LIMITS.hardMax ? 'ACCEPTED' : 'PROPOSED')
        ),
        { decisionsById: {}, orderedIds: [], diagnostics: [] }
    );
    assert.equal(acceptedOverflow.metrics.overrideEligible, false);
});

test('generated new replacement retains baseline order and counts as one new id', () => {
    const baselineContent = readFixture('architectural-lifecycle-baseline-01.txt');
    const baselineLedger = buildArchitecturalBaselineLedger([{ content: baselineContent, identifier: 'baseline', messageRangeStart: 1 }]);
    const generated = parseArchitecturalExtractionResponse(baselineContent, registry).decisions.concat([
        makeDecision('replacement-new', 'ACCEPTED', ' | SUPERSEDES:decision-accepted'),
    ]);

    const merged = mergeArchitecturalDecisionLedger(generated, baselineLedger);

    assert.equal(merged.metrics.newCount, 1);
    assert.equal(merged.items[merged.items.length - 1].content.includes('ID:replacement-new'), true);
});

function reconstructFixtureFromDecisions(decisions) {
    return `
[KEY]
Profile: architectural-memory
Schema: architectural-memory/v1

[DECISIONS]
${decisions.map((item) => item.content).join('\n')}

[CURRENT]
Fixture | Generated | Baseline ledger test | None | None | Continue

===END===
`;
}

