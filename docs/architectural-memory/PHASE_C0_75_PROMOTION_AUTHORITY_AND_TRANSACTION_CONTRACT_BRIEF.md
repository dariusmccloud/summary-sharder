# Phase C0.75-1: Candidate Qualification and Bound Promotion Evidence Brief

## Status

STATUS: ACTIVE C0.75-1 IMPLEMENTATION CONTRACT

`C0.5C` is complete.

`C0.75-0` is closed as a documentation boundary.

`C0.75-1` is the first implementation slice.

It is strictly read only.

Its purpose is to determine whether one exact candidate is eligible to replace one exact live authority generation, and to bind the evidence required for later human authorization.

This phase does not authorize:

- authorization execution
- candidate promotion
- automatic promotion
- startup adoption from candidate state
- rebuild-route promotion
- candidate mutation
- live authority mutation
- rollback execution
- pointer movement
- journal writes
- cross-host promotion proof

The next implementation slice after this document is expected to be `C0.75-2`.

## Interpretive Memory Exclusion

`C0.75` governs structural promotion only: movement from candidate authority into live structural authority.

`C0.75` CANNOT publish interpretive memory.

Interpretive memory includes any synthesis, narrative summary, or developmental characterization concerning a memory subject's development, role, identity, relationships, or lived meaning.

Interpretive memory is governed by `C0.6` (Interpretive Continuity and Memory Sovereignty).

`C0.75` must explicitly exclude interpretive publication from its jurisdiction.

## Governing Finding

`C0.5A` through `C0.5C` proved that candidate reconstruction can be deterministic, cross-runtime stable, provenance-preserving, and structurally auditable while remaining completely isolated from live authority.

That success does not authorize promotion.

Promotion is a separate authority transition with different failure modes:

- time-of-check/time-of-use drift between reviewed candidate and current live state
- partial transition under crash or restart
- rollback artifact failure
- promotion-journal ambiguity
- startup ambiguity about which authority generation is live
- accidental exposure of promotion through ordinary rebuild routes

`C0.75-1` must therefore answer:

> Is this exact candidate eligible to replace this exact live generation, and what evidence would a human need before authorizing it?

## Governing Principles

`C0.75` is governed by these principles:

1. Reconstruction success does not authorize promotion.
2. MVP promotion is manual only.
3. Promotion authorization must be evidence-backed and one-time scoped.
4. Old live authority must remain recoverable.
5. Provenance must survive and expand across generations.
6. Ordinary rebuild routes must remain incapable of promotion.
7. Candidate and live authority are separate artifact roles.
8. Transaction state must be represented explicitly and recovered mechanically.
9. Promotion must fail closed on ambiguity.
10. Automatic startup adoption remains out of scope.

## Governing Flow

The full promotion program must eventually prove this chain:

```text
qualify candidate
-> present bound live/candidate evidence
-> record one-time authorization
-> acquire scope lock
-> revalidate candidate and live hashes and generations
-> create verified rollback generation
-> persist PREPARED transaction journal
-> stage next live generation
-> atomically flip authoritative live pointer
-> verify new live generation
-> persist COMMITTED transaction journal
-> release lock
```

`C0.75-1` does not implement that chain.

It only qualifies inputs and binds review evidence that later slices must honor exactly.

## Internal Phase Decomposition

### `C0.75-0`

Promotion authority and transaction contract.

Documentation only.

### `C0.75-1`

Candidate qualification and bound promotion evidence.

Read only.

No promotion route.

### `C0.75-2`

Manual authorization and atomic generation transition.

No automatic promotion.

### `C0.75-3`

Crash, rollback, restart, cross-host, and partial-failure proof.

## Carry-Forward Constraints

All reconstruction-era safety constraints remain in force unless explicitly superseded by a reviewed promotion slice:

1. Corpus discovery remains read only.
2. No chat normalization occurs during qualification or promotion review.
3. No metadata adoption occurs during qualification or promotion review.
4. No native host save is triggered by promotion review.
5. No ordinary rebuild route may mutate live authority.
6. No model call may authorize, finalize, or infer promotion readiness.
7. Live authority reads must not consult candidate artifacts as fallback.
8. Candidate builds remain physically separate from live artifacts.
9. Startup recovery must resolve from durable transaction evidence, not heuristics alone.
10. Promotion remains unavailable until explicitly implemented and enabled.

`C0.75` adds these non-negotiable rules:

11. Promotion authorization binds both the candidate and the expected live state.
12. Artifact role and transaction state are separate dimensions.
13. Live authority must not be overwritten in place.
14. The atomic act must be the smallest possible authoritative-pointer transition.
15. A durable transaction journal must record prepared intent and committed result separately.
16. Rollback artifacts are required before pointer transition.
17. Eligibility must be machine-exact.
18. Contradictory hashes, generations, or journal states fail closed.
19. Promotion must remain manual for the MVP.
20. Automatic startup promotion remains out of scope.

## C0.75-1 Bounded Question

`C0.75-1` exists to answer one machine-checkable question:

```text
candidate identity + candidate hash
vs
live identity + expected live generation + expected live hash
```

If the answer is "eligible", the phase must still stop before authorization or mutation.

If the answer is "ineligible", the phase must explain every blocking reason explicitly.

## C0.75-1 Read-Only Boundary

`C0.75-1` must not create any capability that can change authority state.

Specifically forbidden:

- no authorization endpoint
- no promote endpoint
- no promote helper
- no pointer movement
- no live-state marker movement
- no candidate-to-live fallback
- no rollback artifact creation
- no transaction-journal write
- no startup adoption path
- no hidden flag that converts qualification into promotion

Capability reporting must continue to show promotion unavailable.

## Artifact Roles

Promotion must represent artifact role separately from transition state.

Artifact roles:

- `CANDIDATE`
- `LIVE`
- `ROLLBACK_ARTIFACT`

Rules:

1. A candidate does not become trustworthy merely because a marker says `LIVE`.
2. Startup must verify any claimed live artifact against actual hash, generation, schema, and promotion-journal state.
3. Old live generations remain immutable recovery evidence after supersession.
4. A rollback artifact is not a candidate and not the active live authority.

## Transaction State Machine

Promotion requires explicit intermediate transaction states.

Required transaction states:

- `PREPARED`
- `COMMITTING`
- `VERIFYING`
- `COMMITTED`
- `ROLLING_BACK`
- `ROLLED_BACK`
- `FAILED`

Rules:

1. Transaction state must be stored durably inside the protected promotion boundary.
2. Transaction state must be recoverable across restart.
3. Startup must reconcile journal state with actual authoritative pointer and artifact hashes.
4. Contradictory state must fail closed and require recovery.
5. Journal state does not replace artifact verification.

## Authorization Contract

A human authorizes a specific candidate against a specific live generation, not a floating idea of promotion.

Required authorization fields:

```text
memoryScopeId
candidateHash
candidateSchemaVersion
expectedLiveHash
expectedLiveGeneration
promotionEvidenceDigest
authorizedBy
authorizedAt
expiresAt
oneTimeNonce
```

Rules:

1. Authorization is scope-bound.
2. Authorization is one-time use.
3. Authorization expires.
4. Authorization must be invalidated by any candidate or live drift.
5. Authorization must be revalidated immediately before transition.

Immediately before transition, a later promotion slice must prove:

```text
current candidate hash = authorized candidate hash
current live hash = authorized expected live hash
current live generation = authorized expected generation
```

Any mismatch aborts promotion and requires fresh review.

## Promotion Eligibility Contract

Promotion eligibility must be machine-exact.

Minimum MVP eligibility requires:

```text
candidate build finalized
canonicalCandidateHash final and verified
candidate schema supported
candidate validity = valid
zero unresolved structural blockers
zero malformed authority records
zero incomplete required lifecycle chains
zero source-mutation invalidation
frozen manifest still available and verified
rollback destination writable
live authority hash successfully computed
candidate and live scope identities match
no active reconstruction or promotion for the scope
promotion capability explicitly enabled
```

The contract must explicitly define whether any review-only noise classes remain non-blocking.

Until that definition exists, uncertain review-only classes should be treated as blockers for implementation planning.

`C0.75-1` may calculate eligibility.

It must not consume eligibility as authority to mutate any artifact.

## Qualification Evidence Contract

`C0.75-1` must emit a bound evidence package for one exact candidate and one exact live generation.

Minimum required outputs:

- candidate identity
- candidate canonical hash
- candidate schema version
- candidate validity status
- live generation identity
- expected live hash
- candidate-versus-live structural diff
- source coverage summary
- exclusion summary
- unresolved conflict summary
- irrecoverable-gap disclosure
- rollback-generation plan
- promotion eligibility verdict
- explicit ineligibility reasons
- bound evidence digest

The evidence package must be stable enough that later authorization can bind to it exactly rather than to a narrative summary.

## Candidate-versus-Live Diff Contract

The qualification slice must compare the candidate against the current live authority generation mechanically.

At minimum, the diff must identify:

- records added
- records removed
- records changed
- lifecycle changes
- provenance changes
- unresolved blockers that would persist if promoted

The diff must be exact for the governed structural authority surface.

It must not depend on model interpretation.

## Irrecoverable-Gap Disclosure

Qualification must disclose whether any known source gaps, exclusions, malformed inputs, or unresolved structural blockers prevent the candidate from being treated as a complete replacement for the current live generation.

This disclosure is part of promotion evidence.

Absence of disclosure must not be interpreted as absence of risk.

## Rollback-Generation Planning Contract

`C0.75-1` may describe the rollback plan that a later slice must satisfy.

It must not create rollback artifacts.

At minimum, the plan must identify:

- expected live generation to preserve
- expected rollback generation source
- rollback verification prerequisites
- reasons the later promotion slice must refuse if rollback preparation cannot be completed exactly

## Live Authority Transition Model

Promotion must be a generation-pointer transition, not an in-place overwrite of live authority.

Safer model:

```text
live generation N remains intact
candidate is staged as generation N+1
rollback artifact for N is created and verified
single authoritative pointer moves N -> N+1
N+1 is verified
promotion is committed
```

The governing transition sequence is:

```text
acquire scope promotion lock
-> revalidate authorized candidate and live hashes
-> verify candidate eligibility
-> create and verify rollback artifact
-> write PREPARED promotion journal
-> stage candidate as next live generation
-> fsync staged artifacts
-> atomically flip authoritative live pointer
-> verify new live generation
-> write COMMITTED journal record
-> release promotion lock
```

Rules:

1. The atomic step should be as small as possible, ideally one authoritative-pointer or equivalent state-marker replacement.
2. Database, snapshot, state marker, and audit ledger must not be independently swapped without a recovery protocol.
3. Promotion implementation must not rely on best-effort multi-file mutation.

## Transaction Journal Contract

Audit intent and audit completion are separate events.

Required minimum durable journal records:

- `PROMOTION_PREPARED`
- `PROMOTION_COMMITTED`

Rules:

1. `PROMOTION_PREPARED` must be durably persisted before authoritative mutation.
2. `PROMOTION_COMMITTED` must be durably persisted after pointer transition and verification.
3. Expanded or secondary audit sinks may fail independently and be retried later.
4. Failure of a secondary audit sink must not automatically trigger rollback after a valid authority transition.
5. Startup recovery must be able to reconstruct the transition solely from protected promotion-boundary artifacts.

Startup recovery inputs must include:

- promotion journal
- authoritative live pointer
- candidate and live hashes
- rollback artifact
- generation metadata

## Startup Recovery Matrix

Startup must resolve transaction state deterministically.

| Journal state | Pointer/hash state | Startup action |
| --- | --- | --- |
| No promotion journal | Valid known live generation | Load normally |
| `PREPARED` | Pointer still old | Abort staged promotion, retain candidate |
| `COMMITTING` | Pointer old | Roll back staging |
| `COMMITTING` | Pointer new and hash valid | Complete verification and commit |
| `VERIFYING` | New live valid | Complete commit |
| `VERIFYING` | New live invalid | Restore old generation |
| `ROLLING_BACK` | Old generation valid | Finish rollback |
| `COMMITTED` | New generation valid | Load new live |
| Any state with contradictory hashes | Unknown | Fail closed, require recovery |

Rules:

1. Startup must not rely on marker presence alone.
2. No-marker cases must still resolve mechanically when prior live generation and journal evidence are sufficient.
3. Contradictory evidence must not be silently normalized.

## Superseded Live Authority Ledger

Old live authority becomes superseded and retained.

This should be represented in an immutable promotion ledger rather than by rewriting the old live artifact in place.

Minimum ledger shape:

```json
{
  "authorityGeneration": 7,
  "authorityHash": "sha256:...",
  "status": "SUPERSEDED",
  "supersededByGeneration": 8,
  "supersededByPromotionId": "promo_...",
  "rollbackArtifactId": "rollback_..."
}
```

Rules:

1. Old live generations remain recoverable evidence.
2. Rollback must target verified prior generations, not reconstructed guesses.
3. Supersession of live authority generations is a promotion-ledger fact, not a reason to mutate historical artifacts.

## Promotion Surface Constraints

Ordinary rebuild surfaces must remain incapable of promotion.

Until a later slice explicitly implements promotion, the system must expose:

- no promote route
- no promote helper
- no startup auto-promote behavior
- no candidate-to-live fallback
- no hidden rebuild flag that promotes as a side effect

Capability reporting must continue to show promotion unavailable.

## `C0.75-1` Implementation Contract

This implementation slice is bounded to qualification and review evidence only.

`C0.75-1` may implement:

- candidate eligibility calculation
- explicit live-versus-candidate diff
- authorization payload preparation
- machine-readable promotion blockers
- review-ready evidence digests
- promotion eligibility verdict calculation
- irrecoverable-gap disclosure
- rollback-generation planning evidence

`C0.75-1` must not implement:

- a promotion route
- pointer transition
- rollback execution
- rollback artifact creation
- startup recovery mutation
- automatic authorization
- live artifact mutation
- candidate mutation
- transaction-journal writes
- live-read fallback to candidate state
- promote capability exposure

## Qualification Result Semantics

The qualification result must separate:

- evidence collection success
- eligibility result
- mutation authorization

For example, `C0.75-1` may complete successfully while still concluding:

```text
qualification completed
candidate ineligible
promotion unauthorized
```

Those states must not be collapsed into one generic success flag.

## Required Outputs of `C0.75-1`

This implementation boundary is complete only if it leaves behind:

1. candidate identity plus final verified candidate hash
2. live generation identity plus expected live hash
3. candidate-versus-live structural diff
4. source coverage and exclusion evidence
5. validation, conflict, and irrecoverable-gap disclosure
6. rollback-generation plan
7. promotion eligibility verdict
8. explicit ineligibility reasons when not eligible
9. bound evidence digest for later manual authorization
10. continued proof that promotion remains unavailable

## Stop-Before-Code Condition

Do not begin `C0.75-2` or any mutation-capable promotion slice until this contract is reviewed and accepted as the governing `C0.75-1` boundary.

This coding slice must stop at:

```text
candidate qualification
-> live-versus-candidate evidence
-> authorization payload preparation
-> promotion eligibility decision
-> stop before promotion
```
