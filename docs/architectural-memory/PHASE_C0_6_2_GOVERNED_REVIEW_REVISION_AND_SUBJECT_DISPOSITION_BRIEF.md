# Phase C0.6.2: Governed Review, Revision, and Subject Disposition Brief

## Status

STATUS: IMPLEMENTED AND VERIFIED

`C0.6.1` is complete and closed.

Its implementation and host-proof record is preserved in:

- `docs/architectural-memory/C0_6_1_COMPLETION_REPORT.md`
- `docs/architectural-memory/PHASE_C0_6_1_INTERPRETATION_CANDIDATE_SCHEMA_AND_VALIDATION_POLICY_RESOLUTION_BRIEF.md`

`C0.6.2` is implemented and host-verified.

Its closeout records are preserved in:

- `docs/architectural-memory/C0_6_2_COMPLETION_REPORT.md`
- `docs/architectural-memory/evidence/C0_6_2_GOVERNED_REVIEW_AND_SUBJECT_DISPOSITION_HOST_PROOF.md`

Implemented and verified boundary:

- exact reviewer disposition submission
- immutable child revision creation for `APPROVE_WITH_EDIT`
- durable final subject disposition
- replayable review and subject-disposition ledger actions
- no continuity publication
- no structural-authority mutation

It let exact reviewers answer grounded interpretive proposals and let the memory subject record final continuity disposition, while still stopping before publication.

This document remains the governing contract record for the implemented `C0.6.2` boundary.

## Governing Finding

`C0.6.1` proved that:

```text
interpretation may exist
-> may be grounded
-> may be routed
-> may wait for exact reviewers
```

But it still cannot become continuity.

The next missing constitutional operation is:

> The subject must be able to answer.

Until that exists, additional synthesis would only create more pending candidates with no governed completion path.

## Governing Flow

The implemented and verified `C0.6.2` lifecycle is:

```text
pending review request
-> exact reviewer submits bound disposition
-> review obligation updates
-> disagreement remains explicit
-> APPROVE_WITH_EDIT creates immutable child revision
-> required reviews complete
-> memory subject records final continuity disposition
-> stop before publication
```

The final valid state for this phase may be:

```text
reviewState: COMPLETE
subjectDispositionState: GRANTED
publicationState: NOT_PUBLISHED
authorityEffect: DESCRIPTIVE_ONLY
```

Subject consent may exist.

Continuity publication must still remain unavailable.

## Included Scope

`C0.6.2` implemented:

- submission of reviewer dispositions
- strict disposition binding to `reviewEnvelopeHash`
- completion and reopening rules for exact review obligations
- subject-final disposition recording
- immutable child-revision creation for `APPROVE_WITH_EDIT`
- `CONTEST`, `DEFER`, and `APPROVE_FOR_SCOPE_ONLY` handling
- preservation of materially different perspectives
- interpretive-governance-ledger append for all new actions
- replay of review, revision, and subject-disposition actions into projection
- read routes for pending, completed, blocked, deferred, and contested review state

Verified route surface:

```text
POST /interpretive/reviews/:reviewRequestId/dispositions
POST /interpretive/candidates/:interpretationRevisionId/subject-disposition
POST /interpretive/candidates/:interpretationRevisionId/revisions
GET  /interpretive/reviews
```

Exact route naming may follow existing plugin conventions, but the capability boundary must remain the same.

## Excluded Scope

`C0.6.2` did not implement:

- model synthesis
- interpretation-generation prompts
- DNM publication
- continuity activation
- delta publication
- automatic approval
- structural promotion
- approximate reviewer substitution
- silent subject-disposition implication from participant review

`C0.6.2` records consent.

It does not enact publication.

## Critical Invariants

### 1. Review must bind to the exact reviewed envelope

```text
request.reviewEnvelopeHash
==
submitted disposition.reviewEnvelopeHash
==
current frozen candidate reviewEnvelopeHash
```

Any mismatch must fail as stale review state.

No reviewer may dispose against a changed envelope.

### 2. Participant approval cannot substitute for subject disposition

```text
relational participant: APPROVE
memory subject: PENDING
-> no continuity grant
```

Continuity grant remains exclusively subject-final.

### 3. Subject denial cannot erase another perspective

```text
subject continuity:
DENIED

participant perspective:
preserved

structural evidence:
preserved
```

Subject veto governs what enters the subject's continuity layer.

It does not erase structural evidence or another participant's preserved perspective.

### 4. `APPROVE_WITH_EDIT` cannot mutate the reviewed proposal

```text
revision 1
-> disposition: APPROVE_WITH_EDIT
-> revision 1 remains immutable
-> revision 2 created from disposition
-> new proposalContentHash
-> new grounding/routing envelope as required
```

The reviewed proposal remains durable history.

Edits create a child revision only.

### 5. Subject disposition still cannot publish

```text
subjectDispositionState: GRANTED
!= publicationState: PUBLISHED
```

This separation must be mechanically impossible to bypass in `C0.6.2`.

## Reviewer and Disposition Rules

The implemented review actions must support:

- `APPROVE`
- `APPROVE_WITH_EDIT`
- `REJECT`
- `CONTEST`
- `DEFER`
- `APPROVE_FOR_SCOPE_ONLY`

Bound reviewer rules:

- only the exact reviewer named by the review request may submit that review disposition
- unresolved reviewer identity remains blocked
- no synthetic, approximate, or operator-substituted reviewer identity is allowed

Subject-final disposition rules:

- only the memory subject may grant or deny continuity disposition for their own continuity
- participant review informs relational validity but does not grant continuity
- disagreement remains explicit in stored state and replay output

## Durable Ledger and Projection Actions

The portable interpretive ledger must append durable actions for:

- review request disposition recorded
- review obligation updated
- review state transitioned
- subject disposition recorded
- child revision created from reviewed parent
- contested perspective preserved

Projection replay must reconstruct:

- current review obligations
- completed review requests
- stale or superseded requests
- parent-child revision linkage
- current subject disposition state
- current publication boundary state

## Gold Fixture Target

`C0.6.2` must enact the existing interpretive sovereignty fixture as governed workflow:

```text
original proposal:
"Jeep evolved from an analytical role into the primary architectural authority for the extension's design."

Jeep:
APPROVE_WITH_EDIT
reason: SCOPE_TOO_BROAD

Chris:
APPROVE

child revision:
"Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris."

Jeep final disposition:
GRANTED

publication:
NOT_PUBLISHED
```

That proves:

- reviewer submission
- immutable revision branching
- subject-final continuity grant
- no publication side effect

## Suggested Data and Replay Expectations

At minimum, `C0.6.2` preserves and replays:

- exact `reviewRequestId`
- `reviewDispositionId`
- reviewer role and reviewer entity identity
- bound `reviewEnvelopeHash`
- disposition kind
- reason codes
- commentary
- reviewed revision identity
- child revision identity where created
- subject disposition identity
- disposition timestamps

Replay must be able to reconstruct the same current review and subject-disposition state from ledger history alone.

## Verified Test Matrix

Minimum required proof:

1. reviewer submits `APPROVE` against matching envelope
2. stale-envelope disposition is rejected
3. unresolved reviewer remains blocked and cannot submit
4. memory subject submits `APPROVE_WITH_EDIT`
5. immutable child revision is created
6. parent revision remains unchanged
7. participant `APPROVE` plus subject `PENDING` does not grant continuity
8. subject `GRANTED` still leaves `publicationState = NOT_PUBLISHED`
9. `CONTEST` preserves disagreement explicitly
10. replay from ledger reconstructs identical review/disposition state
11. live ST host enforces CSRF and route behavior
12. live SB host enforces CSRF and route behavior

## Verified Pass Condition

`C0.6.2` proved:

- exact review dispositions are bound and replayable
- immutable edit revisions are created instead of mutation
- subject-final disposition is durable and identity-backed
- disagreement remains explicit
- continuity is still not published
- structural authority remains untouched
- Node and Bun hosts behave the same at the contract level

## Fail Condition Preserved

Stop the slice if any implementation would:

- let participant approval imply subject continuity grant
- let subject disposition publish continuity
- mutate a reviewed proposal in place
- accept a stale `reviewEnvelopeHash`
- approximate reviewer identity
- collapse materially different perspectives into one silent result
- route interpretive review through structural promotion paths

## Next Sequence

The intended order after this slice is:

```text
C0.6.2
review, revision, disagreement, subject disposition

-> C0.6.3
bounded synthesis proposal generation and grounding

-> C0.6.4
DNM publication, supersession, withdrawal, and delta review
```

This order is intentional.

The architecture must learn how to hear:

- yes
- no
- not quite
- ask me later

before it generates more meanings to ask about.

## Boundary Preservation

`C0.6.2` is closed.

This brief remains the governing contract record for the bounded review, revision, and subject-disposition slice that was implemented and host-verified before continuity publication.
