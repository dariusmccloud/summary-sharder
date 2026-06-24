# C0.5B Completion Report

## Status

Final status: `C0.5B COMPLETE`

`C0.5B` expanded isolated candidate reconstruction into deterministic Tier-2 dialogue evidence while keeping live authority untouched and promotion unavailable.

This report closes the `C0.5B` phase and records the proof points that now govern the next reconstruction step.

## Implementation Commits

- `3d307c3` - `feat: add c0.5b1 deterministic tier-2 reconstruction`
- `663e7ba` - `feat: add c0.5b2 tier-2 report compaction`

## Phase Result

`C0.5B` is complete at the bounded deterministic Tier-2 boundary.

Delivered:

- deterministic extraction of self-contained explicit Tier-2 dialogue claims
- no-LLM claim extraction
- no model-assisted extraction path
- no contextual dialogue-pair interpretation
- mechanical Tier-1 reconciliation only
- occurrence-scoped deterministic Tier-2 claim identity
- candidate-only Tier-2 claim, link, conflict, and review persistence
- compact ordinary review summaries derived from immutable claim rows
- detailed mention-only review surfaces preserved for audit
- explicit execution-versus-validity separation in candidate reports

Explicitly not delivered:

- contextual interpretation of `Agree.`, `Do that.`, or pronoun-only updates
- model-assisted review proposals
- semantic similarity reconciliation beyond deterministic exact bases
- lorebook or lower-tier recovery
- candidate promotion
- live authority adoption

## Deterministic Extraction Scope

`C0.5B` remained bounded to deterministic Tier-2 evidence only.

Compiled claim classes:

- `DECISION`
- `CORRECTION`
- `SUPERSESSION`
- `UNRESOLVED_COMMITMENT`

Admission rules remained conservative:

- asserted message body may become admissible
- mention zones remain non-admitted by default
- context-dependent statements remain review-only
- evidence-policy exclusion still blocks admission
- Tier-1 reconciliation remains mechanical only

No part of `C0.5B` introduced:

- model calls
- semantic freeform interpretation
- promotion behavior

## Compaction and Reconciliation Proof

`C0.5B-2` established the reporting invariant:

> ordinary and detailed review surfaces are derived from the same immutable detection rows.

Compaction changes presentation only.

It does not change:

- admission state
- claim identity
- provenance
- canonical candidate state

Verified report additions:

- `executionSummary`
- `candidateValidity`
- `tier2Summary`
- `reviewSummary`
- `detailedReview`

Mention-only detections now reconcile across all surfaces:

- `tier2Summary.mentionOnly`
- compact mention buckets
- detailed mention rows

The report also preserves deterministic ordering for compact and detailed review structures.

## Execution Versus Validity Separation

`C0.5B-2` made execution success explicit rather than overloading overall candidate validity.

Candidate reports now distinguish:

- successful Tier-2 extraction/report derivation
- overall candidate validity
- structural blockers
- non-blocking review-only noise

This resolved the earlier ambiguity where a candidate could be invalid for pre-existing Tier-1 reasons even though Tier-2 extraction itself succeeded.

## Live SillyTavern and SillyBunny Outcome

Live candidate rebuild smoke was rerun on both clone hosts against `scope.c0.st`.

### SillyTavern

Observed outcome:

- `status: invalid`
- `executionSummary.compileCompleted: true`
- `executionSummary.tier2ExtractionCompleted: true`
- `candidateValidity.valid: false`
- `candidateValidity.structuralBlockers`:
  - `REBUILD_DECISION_COLLISION x2`
- `tier2Summary.mentionOnly: 13`
- compact mention review reduced those 13 rows to one ordinary bucket:
  - `sourceClass: quoted_or_pasted_spec_material`
  - `claimZoneClass: MENTION_CODE`
  - `extractionRuleId: mention-zone:mention_code`

### SillyBunny

Observed outcome:

- `status: invalid`
- `executionSummary.compileCompleted: true`
- `executionSummary.tier2ExtractionCompleted: true`
- `candidateValidity.valid: false`
- `candidateValidity.structuralBlockers`:
  - `REBUILD_DECISION_COLLISION x2`
- `tier2Summary.mentionOnly: 1`
- compact mention review reduced that one row to one ordinary bucket with the same source-class/zone shape

## Explanation for Differing Mention Counts

The differing mention counts are explained by corpus content, not runtime divergence.

SillyTavern and SillyBunny were not carrying the same frozen scope material:

- SillyTavern’s `scope.c0.st` corpus included multiple quoted/pasted specification-style messages that legitimately triggered `NON_ADMITTED_MENTION`
- SillyBunny’s `scope.c0.st` corpus included only one such message in the admitted frozen set

The important cross-host proof is therefore not equal raw mention count.

The proof is:

- each host produced deterministic mention compaction for its own frozen corpus
- compaction reconciled exactly against detailed rows
- neither host misclassified mention-only noise as admitted authority

## Remaining Structural Blocker

The remaining blocker exposed by both live host smokes is:

- `REBUILD_DECISION_COLLISION`

This is a Tier-1 structural blocker.

It means the current candidate’s invalidity belongs to structured evidence collision handling, not to Tier-2 extraction or Tier-2 review-surface shaping.

That distinction is now explicit in runtime reporting and should govern the next phase boundary.

## No-Promotion Proof

`C0.5B` preserved the no-promotion boundary established earlier.

Verified through regression coverage:

- no promote route
- no promote helper
- no startup adoption
- no candidate-to-live fallback
- candidate reports still expose promotion as unavailable

## Final Boundary

`C0.5B` is closed.

This phase proved that deterministic Tier-2 extraction can operate inside the isolated candidate chamber, remain conservative about authority, preserve detailed evidence, and compact review noise without changing candidate meaning.

It also proved that current candidate invalidity on the live test scopes is caused by a different problem class: Tier-1 collision handling.

## Next Phase

The next clean boundary is collision classification and candidate-validity recovery.

Recommended governing chain:

```text
inspect Tier-1 collisions
→ classify duplicate lineage, corroboration, version chain, or conflict
→ reconcile only mechanically proven cases
→ preserve unresolved conflicts
→ rebuild candidate
→ validate
→ stop before promotion
```

That next phase should remain:

- candidate-only
- mechanically conservative
- promotion-free

`C0.5B-3` may still exist later as a small observability enhancement if human review shows the compact Tier-2 surfaces are too coarse, but it is no longer the main blocker.
