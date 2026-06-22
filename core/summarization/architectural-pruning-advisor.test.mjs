import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCHITECTURAL_DEFERRED_REASON_CODES,
    ARCHITECTURAL_PRUNING_CLASSIFICATIONS,
    ARCHITECTURAL_PRUNING_REASON_CODES,
    analyzeArchitecturalPruningAdvisor,
    buildArchitecturalPruningAdvisorUiModel,
} from './architectural-pruning-advisor.js';

function item(content, options = {}) {
    return {
        id: options.id || `item-${Math.random().toString(36).slice(2, 8)}`,
        content,
        selected: options.selected !== false,
    };
}

function recommendationByCode(result, code) {
    return (result.recommendations || []).find((entry) => entry.reasonCodes.includes(code));
}

function recommendationsForSection(result, sectionKey) {
    return (result.recommendations || []).filter((entry) => entry.sectionKey === sectionKey);
}

test('exact DIALOGUE quote duplicated in DECISION evidence is low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S1:1] 🔴 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep the rule | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "Exact quote."', { id: 'decision-a' }),
        ],
        dialogue: [
            item('[S1:1] "Exact quote." --Jeep', { id: 'dialogue-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK);
    assert.equal(recommendation.sectionKey, 'dialogue');
    assert.equal(recommendation.itemId, 'dialogue-a');
});

test('similar but non-identical DIALOGUE does not become low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S1:1] 🔴 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep the rule | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "Exact quote."', { id: 'decision-a' }),
        ],
        dialogue: [
            item('[S1:1] "Exact quote, but different." --Jeep', { id: 'dialogue-a' }),
        ],
    });

    assert.equal(recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE), undefined);
});

test('exact duplicate EVENTS become low-risk for later duplicates only', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        events: [
            item('[S2:1] 🟠 Event happened | DEC: decision-a', { id: 'event-a' }),
            item('[S2:1] 🟠 Event happened | DEC: decision-a', { id: 'event-b' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.EVENT_DUPLICATE);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK);
    assert.equal(recommendation.itemId, 'event-b');
});

test('EVENTS differing by DEC reference are not duplicates', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        events: [
            item('[S2:1] 🟠 Event happened | DEC: decision-a', { id: 'event-a' }),
            item('[S2:1] 🟠 Event happened | DEC: decision-b', { id: 'event-b' }),
        ],
    });

    assert.equal(recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.EVENT_DUPLICATE), undefined);
});

test('exact redundant TIMELINE entry becomes low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        timeline: [
            item('[S3:1] Shared anchor', { id: 'timeline-a' }),
        ],
        events: [
            item('[S3:1] 🟠 Shared anchor', { id: 'event-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.TIMELINE_REDUNDANT);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK);
    assert.equal(recommendation.itemId, 'timeline-a');
});

test('semantic but not exact TIMELINE overlap does not become low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        timeline: [
            item('[S3:1] Shared anchor revised', { id: 'timeline-a' }),
        ],
        events: [
            item('[S3:1] 🟠 Shared anchor', { id: 'event-a' }),
        ],
    });

    assert.equal(recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.TIMELINE_REDUNDANT), undefined);
});

test('resolved THREAD promoted into DEVELOPMENT is low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        threads: [
            item('[S4:1] snapshot-implementation | STATUS: RESOLVED | INTRO: S4:1 | LAST: S4:2', { id: 'thread-a' }),
        ],
        developments: [
            item('[S4:2] Architecture: snapshot-implementation', { id: 'dev-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_RESOLVED_AND_PROMOTED);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.LOW_RISK);
});

test('resolved THREAD with unique notes becomes review', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        threads: [
            item('[S4:1] snapshot-implementation | STATUS: RESOLVED | INTRO: S4:1 | LAST: S4:2 | keep unique note', { id: 'thread-a' }),
        ],
        developments: [
            item('[S4:2] Architecture: snapshot-implementation', { id: 'dev-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_RESOLVED_AND_PROMOTED);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW);
});

test('ACTIVE THREAD is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        threads: [
            item('[S4:1] snapshot-implementation | STATUS: ACTIVE | INTRO: S4:1 | LAST: S4:2', { id: 'thread-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.THREAD_UNRESOLVED);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('ACCEPTED DECISION is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep it | WHY: unstated | SCOPE: tests | STATUS: ACCEPTED | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_ACTIVE_GOVERNING);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('SEALED DECISION is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep it | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_ACTIVE_GOVERNING);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('EVENT-referenced DECISION is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: IMPLEMENTATION | DECISION:Keep it | WHY: unstated | SCOPE: tests | STATUS: PROPOSED | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
        events: [
            item('[S5:2] 🟡 Event happened | DEC: decision-a', { id: 'event-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_REFERENCED);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('CORRECTION decision is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: CORRECTION | DECISION:Fix it | WHY: unstated | SCOPE: tests | STATUS: PROPOSED | CHANGED: old -> new | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_CORRECTION_CHAIN_MEMBER);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('supersession-chain member is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: REPLACEMENT | DECISION:Old | WHY: unstated | SCOPE: tests | STATUS: SUPERSEDED | SUPERSEDED-BY: decision-b | EVIDENCE: "A"', { id: 'decision-a' }),
            item('[S5:2] 🟠 ID:decision-b | TYPE: REPLACEMENT | DECISION:New | WHY: unstated | SCOPE: tests | STATUS: ACCEPTED | SUPERSEDES: decision-a | EVIDENCE: "B"', { id: 'decision-b' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_HAS_ACTIVE_SUPERSESSION_LINKS);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('decision with RULED-OUT reasoning is protected', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S5:1] 🟠 ID:decision-a | TYPE: IMPLEMENTATION | DECISION:Keep it | WHY: unstated | RULED-OUT: old idea -> bad reason | SCOPE: tests | STATUS: PROPOSED | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_HAS_RULED_OUT_REASONING);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
});

test('unreferenced local IMPLEMENTATION decision becomes review', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S6:1] 🟡 ID:decision-a | TYPE: IMPLEMENTATION, STRATEGY | DECISION:Local choice | WHY: unstated | SCOPE: tests | STATUS: ACCEPTED | EVIDENCE: "A"', { id: 'decision-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.MINOR_IMPLEMENTATION_DECISION);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW);
});

test('SUPERSEDED decision without other protection becomes review, not low-risk', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        decisions: [
            item('[S6:1] 🟡 ID:decision-a | TYPE: IMPLEMENTATION | DECISION:Old choice | WHY: unstated | SCOPE: tests | STATUS: SUPERSEDED | SUPERSEDED-BY: decision-b | EVIDENCE: "A"', { id: 'decision-a' }),
            item('[S6:2] 🟡 ID:decision-b | TYPE: GOVERNANCE | DECISION:New choice | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "B"', { id: 'decision-b', selected: false }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DECISION_SUPERSEDED_POTENTIALLY_OBSOLETE);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.REVIEW);
});

test('CURRENT is protected and present in advisor output', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        current: [
            item('Project|State|Focus|Pending|Blocked|Next', { id: 'current-a' }),
        ],
    });

    const recommendation = recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.CURRENT_MANDATORY);
    assert.equal(recommendation.classification, ARCHITECTURAL_PRUNING_CLASSIFICATIONS.PROTECTED);
    assert.equal(recommendation.sectionKey, 'current');
});

test('advisor updates after deselection', () => {
    const sections = {
        decisions: [
            item('[S1:1] 🔴 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep the rule | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "Exact quote."', { id: 'decision-a' }),
        ],
        dialogue: [
            item('[S1:1] "Exact quote." --Jeep', { id: 'dialogue-a' }),
        ],
    };

    const initial = analyzeArchitecturalPruningAdvisor(sections);
    assert.ok(recommendationByCode(initial, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE));

    sections.decisions[0].selected = false;
    const updated = analyzeArchitecturalPruningAdvisor(sections);
    assert.equal(recommendationByCode(updated, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE), undefined);
});

test('advisor updates after editing away duplication', () => {
    const sections = {
        decisions: [
            item('[S1:1] 🔴 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep the rule | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "Exact quote."', { id: 'decision-a' }),
        ],
        dialogue: [
            item('[S1:1] "Exact quote." --Jeep', { id: 'dialogue-a' }),
        ],
    };

    const initial = analyzeArchitecturalPruningAdvisor(sections);
    assert.ok(recommendationByCode(initial, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE));

    sections.dialogue[0].content = '[S1:1] "Changed quote." --Jeep';
    const updated = analyzeArchitecturalPruningAdvisor(sections);
    assert.equal(recommendationByCode(updated, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE), undefined);
});

test('canonical section order remains unchanged by advisor', () => {
    const sections = {
        timeline: [item('[S1:1] A', { id: 'timeline-a' })],
        decisions: [item('[S1:2] 🟡 ID:decision-a | TYPE: IMPLEMENTATION | DECISION:Local | WHY: unstated | SCOPE: tests | STATUS: PROPOSED | EVIDENCE: "A"', { id: 'decision-a' })],
    };
    const before = JSON.stringify(sections);

    analyzeArchitecturalPruningAdvisor(sections);

    assert.equal(JSON.stringify(sections), before);
});

test('advisor does not modify persisted output content', () => {
    const sections = {
        events: [item('[S2:1] 🟠 Event happened | DEC: decision-a', { id: 'event-a' })],
    };
    const before = sections.events[0].content;

    analyzeArchitecturalPruningAdvisor(sections);

    assert.equal(sections.events[0].content, before);
});

test('insufficient low-risk candidates produces explicit cap message instead of fabricated advice', () => {
    const sections = {
        timeline: Array.from({ length: 16 }, (_, index) => item(`[S${index + 1}:1] Unique timeline ${index + 1}`, { id: `timeline-${index}` })),
    };

    const result = analyzeArchitecturalPruningAdvisor(sections);
    const overCap = result.overCapSections.find((entry) => entry.sectionKey === 'timeline');

    assert.equal(overCap.excess, 1);
    assert.equal(overCap.lowRiskCount, 0);
    assert.match(overCap.message, /No deterministic low-risk candidates/i);
});

test('deferred reason codes include PARTIALLY_DUPLICATED_CONTENT only', () => {
    const result = analyzeArchitecturalPruningAdvisor({});
    assert.deepEqual(result.deferredReasonCodes, [ARCHITECTURAL_DEFERRED_REASON_CODES.PARTIALLY_DUPLICATED_CONTENT]);
});

test('exact-match-only advisor declines when duplication cannot be proven', () => {
    const result = analyzeArchitecturalPruningAdvisor({
        dialogue: [item('[S7:1] "Quote one." --Jeep', { id: 'dialogue-a' })],
        decisions: [item('[S7:1] 🔴 ID:decision-a | TYPE: GOVERNANCE | DECISION:Keep the rule | WHY: unstated | SCOPE: tests | STATUS: SEALED | EVIDENCE: "Quote two."', { id: 'decision-a' })],
    });

    assert.equal(recommendationByCode(result, ARCHITECTURAL_PRUNING_REASON_CODES.DIALOGUE_DUPLICATE_TO_EVIDENCE), undefined);
});

test('empty section handling emits no false recommendations and clean UI model', () => {
    const sections = {
        timeline: [],
        decisions: [],
        events: [],
        developments: [],
        dialogue: [],
        threads: [],
        current: [],
    };

    const result = analyzeArchitecturalPruningAdvisor(sections);
    const uiModel = buildArchitecturalPruningAdvisorUiModel(result);

    assert.deepEqual(result.recommendations, []);
    assert.equal(recommendationsForSection(result, 'timeline').length, 0);
    assert.equal(uiModel.hasRecommendations, false);
    assert.deepEqual(uiModel.lowRisk, []);
    assert.deepEqual(uiModel.review, []);
    assert.deepEqual(uiModel.protected, []);
});

test('ui model preserves grouped recommendations without mutating source order', () => {
    const sections = {
        current: [item('Project|State|Focus|Pending|Blocked|Next', { id: 'current-a' })],
        decisions: [item('[S8:1] 🟡 ID:decision-a | TYPE: IMPLEMENTATION | DECISION:Local | WHY: unstated | SCOPE: tests | STATUS: PROPOSED | EVIDENCE: "A"', { id: 'decision-a' })],
    };

    const uiModel = buildArchitecturalPruningAdvisorUiModel(analyzeArchitecturalPruningAdvisor(sections));

    assert.equal(uiModel.review.length, 1);
    assert.equal(uiModel.protected.length, 1);
    assert.equal(uiModel.review[0].sectionKey, 'decisions');
    assert.equal(uiModel.protected[0].sectionKey, 'current');
});
