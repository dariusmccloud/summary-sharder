# Phase C0.5B-2: Tier-2 Noise Control and Review Surfaces Brief

## Status

This is the proposed next implementation boundary after `C0.5B-1`.

`C0.5B-1` is complete and committed:

- `3d307c3` - `feat: add c0.5b1 deterministic tier-2 reconstruction`

This brief exists to convert the live `C0.5B-1` smoke findings into a reviewed, bounded next slice.

It does not authorize:

- model-assisted interpretation
- bounded dialogue-pair interpretation
- lorebook compilation
- candidate promotion
- live authority adoption

## Governing Finding from C0.5B-1

The deterministic Tier-2 pipeline behaved correctly on both hosts:

- no LLM calls
- no promotion surface
- no live-authority mutation
- no candidate-to-live fallback
- no duplicate `claimId` failures after occurrence-scoped identity correction

However, the first live corpus smoke showed a practical review-surface problem:

- real corpora produced mostly `NON_ADMITTED_MENTION` detections from quoted, pasted, or fenced material
- those detections were structurally correct
- but they are too noisy to be equally prominent in ordinary candidate reports

The same live smoke also showed:

- candidate invalidation was caused by pre-existing Tier-1 `REBUILD_DECISION_COLLISION` issues
- not by Tier-2 extraction failure

That distinction now governs `C0.5B-2`.

## Internal Phase Boundary

`C0.5B-2` is a review-surface and admission-accounting slice.

It must improve:

- Tier-2 signal-to-noise ratio
- ordinary report readability
- reviewer understanding of what was admitted, blocked, deferred, or merely mentioned

It must not expand:

- evidence tier
- semantic interpretation scope
- authority semantics

## Governing Flow

`C0.5B-2` remains inside the same isolated candidate workflow:

```text
discover frozen corpus
-> run Tier-1 and deterministic Tier-2 extraction
-> separate admitted claims from review-only detections
-> compress ordinary review noise
-> expose detailed review surfaces lazily
-> emit clearer candidate report
-> stop before promotion
```

## Included

- tighter classification of mention-only detections
- ordinary report compaction for high-volume mention noise
- richer Tier-2 summary counters
- explicit separation of:
  - admitted claims
  - blocked claims
  - ambiguous/context-dependent claims
  - mention-only detections
- detail-surface reporting that still preserves provenance and determinism
- host smoke confirming the new review surfaces on both SillyTavern and SillyBunny

## Excluded

- model-assisted extraction or review proposals
- contextual resolution of `Agree.`, `Do that.`, or pronoun-only updates
- semantic similarity reconciliation beyond deterministic exact bases
- Tier-3 or lower evidence classes
- promotion
- live authority adoption

## Primary Objectives

### 1. Reduce ordinary report noise without losing evidence

Mention-only detections remain valid review evidence, but ordinary reports should not present them with the same weight as admitted or potentially admitted claims.

Required rule:

> `NON_ADMITTED_MENTION` remains preserved, but ordinary candidate reports must summarize high-volume mention-only detections instead of foregrounding them as if they were candidate authority inputs.

### 2. Separate review surfaces by actionability

The report should distinguish:

- admitted Tier-2 claims
- blocked claims
- ambiguous or context-dependent candidates
- mention-only detections
- Tier-1 collisions and structural blockers

Required rule:

> A reviewer must be able to tell immediately whether a report failed because of Tier-1 structural problems, Tier-2 conflicts, or merely because the corpus contains review-only noise.

### 3. Preserve deterministic traceability

Compaction must not erase:

- source message identity
- extraction rule
- claim zone class
- occurrence-scoped claim identity
- review reason

Detailed review retrieval may be lazier or secondary, but it must remain deterministic.

## Derivation Invariant

Ordinary and detailed review surfaces must be derived from the same immutable detection rows.

Required rule:

> Compaction may change presentation only. It must never change admission state, claim identity, provenance, or canonical candidate state.

This means:

- ordinary summaries are projections of already-recorded detections
- detailed rows are the lossless review surface for the same detections
- no report mode may reclassify a detection differently from another mode
- compact and detailed views must reconcile exactly against the same candidate-run evidence

## New Reporting Contract

`C0.5B-2` should keep the existing candidate tables and add only the minimum reporting shape needed to control noise.

### Ordinary report expectations

The ordinary report should foreground:

- Tier-1 admitted artifact counts
- Tier-2 admitted claim counts
- Tier-2 blocked counts
- Tier-2 ambiguous/context-dependent counts
- mention-only count
- structural blocker counts

Mention-only detections should default to compact summaries such as:

```js
{
  tier2Summary: {
    admitted: 0,
    blocked: 0,
    ambiguous: 0,
    contextDependent: 0,
    mentionOnly: 13,
  },
  reviewSummary: {
    structuralBlockers: [
      { code: 'REBUILD_DECISION_COLLISION', count: 2 }
    ],
    mentionOnlyByZone: [
      { zone: 'MENTION_CODE', count: 13 }
    ],
    mentionOnlyBySourceClass: [
      { sourceClass: 'quoted_or_pasted_spec_material', count: 13 }
    ],
  }
}
```

### Detailed report expectations

Detailed review surfaces must still retain per-detection rows for:

- ambiguous candidates
- context-dependent candidates
- blocked claims
- mention-only detections

But ordinary completion summaries should not dump a long flat list of fence-derived mentions first.

## Count Reconciliation and Deterministic Ordering

Compaction must preserve exact count reconciliation.

Required rule:

> `tier2Summary.mentionOnly` must equal both the sum of compact mention buckets and the number of detailed mention rows.

The same reconciliation rule applies to any compacted review-only grouping introduced by this slice.

Buckets and detailed rows must use a stable deterministic sort.

Preferred sort order:

1. `memoryScopeId`
2. source class
3. `claimZoneClass`
4. `extractionRuleId`
5. source identity

If a more specific tie-breaker is required, it must itself be deterministic and derived from the same immutable detection row.

## Mention-Only Handling Rules

`C0.5B-2` must preserve the existing zone rules from `C0.5B-1` and add compaction rules only.

Required compaction rules:

1. Multiple mention-only detections from the same source message may be summarized together in ordinary reports.
2. Mention-only detections from the same source class and zone may be bucketed in ordinary report summaries.
3. Detailed rows must still be recoverable without re-running interpretation.
4. Mention-only compaction must not merge across different:
   - source messages
   - claim zone classes
   - extraction rules
   - memory scopes

## Structural-Blocker Separation

`C0.5B-2` must clearly separate:

- Tier-1 structural invalidation
- Tier-2 review noise
- Tier-2 real contradiction

Example:

- a run invalidated by `REBUILD_DECISION_COLLISION` must say that the live blocker is Tier-1 structural conflict
- mention-only detections should remain visible as secondary review evidence, not appear to be the cause of invalidation

## Execution Success Versus Candidate Validity

`C0.5B-2` must separate execution success from candidate validity.

Required rule:

> A run may complete Tier-2 extraction and review-surface derivation successfully while the overall candidate remains invalid because of Tier-1 structural blockers.

The report must therefore expose separate fields for at least:

- execution success of the Tier-2 extraction/reporting pass
- overall candidate validity
- blocking Tier-1 structural issues
- non-blocking Tier-2 review-only noise

No single overloaded `valid` result should be used to hide that distinction.

## Host Smoke Requirements

Repeat live smoke on:

- SillyTavern
- SillyBunny

For the same frozen scope used during `C0.5B-1` smoke, confirm:

1. no duplicate `claimId` failures
2. no live-authority mutation
3. no promotion surface
4. Tier-1 collision remains the invalidation reason where applicable
5. mention-only detections are compact in ordinary summaries
6. detailed mention review remains available
7. identical canonical candidate state across unchanged reruns

## File-Level Scope

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

Refine report shaping and counters for:

- compact mention-only summaries
- clearer blocker separation
- admitted-vs-review-only grouping

### `core/summarization/architectural-rebuild-protocol.js`

Add only the minimum new summary/report enums or normalization helpers needed for the compact review surfaces.

### Optional candidate-report helper module

Allowed only if it reduces complexity cleanly and stays within existing packaging patterns.

## Test Matrix

1. many mention-only detections from fenced code are summarized compactly in ordinary reports
2. detailed report rows remain available for the same mention-only detections
3. admitted claims still appear individually with provenance
4. Tier-1 structural blocker remains visibly distinct from Tier-2 mention noise
5. blocked/context-dependent/ambiguous counts remain correct after compaction
6. compaction does not change canonical candidate state
7. unchanged reruns keep identical compact and detailed counts
8. no promotion surface exists
9. live DB, snapshot, state marker, and corpus remain unchanged

## Stop Condition

Do not begin `C0.5B-2` implementation until this brief is reviewed and accepted.
