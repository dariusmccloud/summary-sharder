# Phase C0.6.4-3: DNM Lifecycle Governance Brief

## Status

STATUS: ACTIVE C0.6.4-3 IMPLEMENTATION CONTRACT

`C0.6.4-0` defined publication authority.

`C0.6.4-1` established publication policy storage and read-only qualification.

`C0.6.4-2` established one-time publication authorization and atomic DNM publication.

Its live proof is preserved in:

- `docs/architectural-memory/evidence/C0_6_4_2_PUBLICATION_AUTHORIZATION_HOST_PROOF.md`

`C0.6.4-3` is the next contract boundary.

It exists to define the governed lifecycle rules for:

- supersession
- withdrawal
- delta review
- current-active DNM resolution
- replay of complete DNM history

Do not implement publication UI in this slice.

Do not implement generalized memory deletion.

Do not mutate structural authority.

## Governing Finding

`C0.6.4-2` proved that one approved interpretive revision can be:

```text
qualified
-> authorized once
-> published into DNM
-> replayed after restart
-> protected from nonce reuse
```

That proves first publication.

It does not yet define what happens when continuity changes later.

The next missing constitutional operation is:

> Under what exact, replayable authority may a published DNM record remain active, be superseded, be withdrawn, or enter delta review over time?

## Governing Problem

Published continuity cannot remain a flat boolean state.

The system must distinguish:

```text
historical approval
!=
current continuity authority
```

and:

```text
superseded
!=
withdrawn
!=
rejected replacement
!=
never published
```

If those states collapse, replay becomes ambiguous and the system can no longer say what was once endorsed, what is currently active, and why continuity changed.

## Jurisdiction Boundary

`C0.75` remains structural authority only.

`C0.6.4-3` remains interpretive continuity only.

This boundary remains absolute:

```text
structural authority
!=
interpretive continuity lifecycle
```

No DNM lifecycle event may mutate:

- structural live generations
- current structural decisions
- candidate rebuild state
- promotion journals

## Governing Lifecycle Distinctions

`C0.6.4-3` must preserve the following meanings mechanically:

```text
ACTIVE
-> current endorsed continuity record for a target

SUPERSEDED
-> a later published record replaced the previously active one

WITHDRAWN
-> the subject no longer endorses current continuity use of that published record

CONTEST_REOPENED
-> an active or historical published record is under governed re-evaluation

DELTA_PENDING
-> new evidence exists, but no replacement has been published yet
```

And separately:

```text
HISTORICAL_APPROVAL
-> a record of what was once approved and/or published

CURRENT_ACTIVE
-> the single record, if any, presently governing continuity for a target
```

Withdrawal must not rewrite history into `never approved`.

Supersession must not erase the previously active record.

A rejected replacement must not change the current active record.

## Included Scope

`C0.6.4-3` must define and implement:

- DNM supersession authorization rules
- DNM withdrawal authorization rules
- delta-review record shape
- current-active DNM resolution rules
- DNM lifecycle event families and replay semantics
- historical lineage preservation
- stale-lifecycle refusal conditions
- restart and replay expectations for complete DNM history

## Excluded Scope

`C0.6.4-3` must not implement:

- publication UI
- synthesis UI changes
- structural promotion changes
- generalized delete or purge operations
- bulk lifecycle heuristics
- model-authored lifecycle decisions
- cross-subject merge heuristics

## Minimum Event Families

The portable DNM publication ledger must now support at least:

- `DNM_PUBLISHED`
- `DNM_SUPERSEDED`
- `DNM_WITHDRAWN`
- `DNM_DELTA_REVIEW_RECORDED`

Optional refusal or audit events may exist, but replay of current continuity must not depend on SQLite-only state.

## Current-Active Resolution Rule

For a single `continuityTargetId`, the system must be able to answer:

```text
what published DNM record is currently active, if any?
```

Required governing assumptions:

1. At most one `ACTIVE` published DNM record may govern a continuity target at a time.
2. Supersession may change the active record only through an explicit replayable lifecycle event.
3. Withdrawal may leave a target with no active DNM record.
4. Delta review may exist without changing the active record.
5. Replay from the portable DNM ledger alone must produce the same current-active answer.

## Supersession Contract

Supersession must mean:

```text
existing active published DNM
+ later granted and newly published replacement
-> explicit lineage event
-> old record becomes SUPERSEDED
-> new record becomes ACTIVE
```

Minimum required bindings:

- prior active `dnmRecordId`
- replacement `dnmRecordId`
- shared `continuityTargetId`
- replacement source interpretation revision id
- supersession authorization id or equivalent governed authority binding
- occurred-at timestamp

Required refusals:

- prior active record not found
- prior record already inactive
- replacement target mismatch
- replacement not published
- replacement already active for a different target
- stale supersession against changed active state

## Withdrawal Contract

Withdrawal must mean:

```text
published DNM remains historical fact
-> current continuity endorsement is removed
-> record becomes WITHDRAWN
-> no replacement is implied
```

Minimum required bindings:

- withdrawn `dnmRecordId`
- `continuityTargetId`
- withdrawal authority owner
- submitted-by actor
- provenance mode and delegation binding where applicable
- reason codes and commentary
- occurred-at timestamp

Required refusals:

- record not found
- record not currently active
- target mismatch
- stale withdrawal against changed active state

## Delta Review Contract

Delta review must mean:

```text
new evidence exists
-> current active continuity is questioned or extended
-> review is recorded
-> no automatic continuity mutation occurs
```

Delta review must not itself publish, supersede, or withdraw.

It is a governed signal that continuity needs re-evaluation.

Minimum required bindings:

- target `dnmRecordId` or `continuityTargetId`
- source interpretation revision or evidence basis
- delta review state
- actor provenance
- reason codes
- commentary
- occurred-at timestamp

Required rule:

```text
DELTA_PENDING
!=
SUPERSEDED
!=
WITHDRAWN
```

## Projection Contract

The disposable SQLite projection must be able to represent, at minimum:

```json
{
  "dnmRecordId": "dnmrec_...",
  "continuityTargetId": "character:jeep.png",
  "sourceInterpretationRevisionId": "interprev_...",
  "publicationState": "PUBLISHED",
  "lifecycleState": "ACTIVE | SUPERSEDED | WITHDRAWN | CONTEST_REOPENED | DELTA_PENDING",
  "supersededByDnmRecordId": "dnmrec_... | null",
  "supersedesDnmRecordId": "dnmrec_... | null",
  "withdrawnAt": 0,
  "deltaReviewState": "NONE | PENDING | CLOSED",
  "updatedAt": 0
}
```

This is a contract sketch.

Exact field names may evolve, but the lifecycle semantics are mandatory.

## Replay and Recovery Rule

Replay must be sufficient to rebuild:

- all published DNM records
- current-active resolution
- supersession lineage
- withdrawal lineage
- delta-review lineage

Required rule:

```text
portable DNM lifecycle events
-> replay
-> identical current-active continuity projection
```

Rebuild must never infer supersession or withdrawal from missing rows.

It may only apply explicit lifecycle events.

## Required Refusal Conditions

At minimum, `C0.6.4-3` must define machine-exact refusals for:

- target DNM record not found
- current-active target mismatch
- stale lifecycle action against changed active state
- replacement publication not found
- replacement publication not eligible for supersession
- lifecycle event already applied
- lifecycle target already withdrawn
- lifecycle target already superseded
- cross-target supersession attempt
- unresolved contest or blocker state where policy forbids transition

## Capability Boundary At This Slice

At the end of `C0.6.4-3`, the system may report:

- DNM publication lifecycle available
- supersession available
- withdrawal available
- delta-review recording available
- replay of complete DNM history available

It must not report:

- publication UI available
- generalized memory deletion available
- structural authority mutation available

## Successful Completion Means

Successful `C0.6.4-3` completion means:

```text
published DNM can be superseded
published DNM can be withdrawn
delta review can be recorded without silent continuity mutation
historical lineage is preserved
current-active DNM resolution is deterministic
portable replay reproduces the same lifecycle state
jurisdiction remains separate from C0.75
```

## Stop-Before-Code Condition

Do not begin implementation until this contract is reviewed for:

- supersession authority sufficiency
- withdrawal authority sufficiency
- delta-review state sufficiency
- current-active resolution sufficiency
- replay completeness
- continued separation from structural authority
