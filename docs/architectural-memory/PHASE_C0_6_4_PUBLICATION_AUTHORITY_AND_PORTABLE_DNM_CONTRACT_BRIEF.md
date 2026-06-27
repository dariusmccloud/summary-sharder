# Phase C0.6.4-0: Publication Authority and Portable DNM Contract Brief

## Status

STATUS: ACTIVE C0.6.4-0 IMPLEMENTATION CONTRACT

`C0.6.1`, `C0.6.2`, and `C0.6.3` are complete and closed.

Their implementation and closeout records are preserved in:

- `docs/architectural-memory/C0_6_1_COMPLETION_REPORT.md`
- `docs/architectural-memory/C0_6_2_COMPLETION_REPORT.md`
- `docs/architectural-memory/C0_6_3_COMPLETION_REPORT.md`
- `docs/architectural-memory/evidence/C0_6_3_7_IMMUTABLE_REVISION_UI_HOST_PROOF.md`

`C0.6.4-0` is the next contract boundary.

It exists to define the exact authority, durability, replay, and refusal rules by which one approved interpretive revision may become one subject's published Developmental Narrative Memory record.

Do not implement publication writes, publication UI, continuity activation, automatic publication, or publication-side supersession behavior in this slice.

## Governing Finding

`C0.6.3` completed the full pre-publication sovereignty loop:

```text
subject permits synthesis
-> system proposes meaning
-> evidence qualifies and constrains it
-> policy routes exact reviewers
-> participants respond under explicit provenance
-> subject corrects the proposal where needed
-> immutable child revision preserves the correction
-> final subject disposition binds to the child
-> continuity remains untouched
```

That success does not authorize publication.

The system can now prove that a candidate was grounded, reviewed, corrected, and granted.

The next missing constitutional operation is:

> Under what exact, replayable authority may one approved interpretation revision enter one subject's continuity target?

## Jurisdiction Boundary

`C0.75` owns structural authority promotion only.

`C0.6` owns interpretive publication into Developmental Narrative Memory.

This boundary remains absolute:

```text
structural authority
!=
interpretive continuity
```

Shared storage, hashing, transaction, or rollback substrate does not merge those jurisdictions.

An approved interpretation revision is not structural authority and may not be promoted through `C0.75`.

## Governing Inequality

`C0.6.4-0` must preserve this inequality explicitly:

```text
subject grants continuity
!=
system has published continuity
```

And also:

```text
approved interpretation revision
!=
published DNM record
```

Publication is a separate, replayable, one-time governed act.

## Governing Flow

`C0.6.4` must eventually implement this lifecycle:

```text
approved interpretation revision
-> publication qualification
-> continuity-target validation
-> publication-policy binding
-> one-time publication authorization
-> portable publication event
-> DNM projection update
-> supersession / withdrawal / delta review over time
```

`C0.6.4-0` does not implement that lifecycle.

It defines the contract that later slices must honor exactly.

## Included Scope

`C0.6.4-0` must define:

- publication eligibility contract
- portable DNM authority record shape
- continuity-target identity and binding rules
- publication-policy record and binding rules
- one-time publication authorization shape
- publication-event authority source
- replay and rebuild expectations for DNM publication
- publication refusal and invalidation conditions
- high-level supersession, withdrawal, and delta-review lifecycle states
- interpretive publication capability boundary

## Excluded Scope

`C0.6.4-0` must not implement:

- actual DNM publication writes
- publication UI
- automatic publication after `GRANTED`
- continuity activation
- subject-review UI changes unrelated to publication
- structural promotion reuse
- publication-side merge heuristics
- withdrawal execution
- supersession execution
- delta-review execution
- model-authored publication decisions

## Carry-Forward Constraints

All prior interpretive and structural safety constraints remain in force:

1. The portable corpus remains authoritative.
2. Structural authority remains governed by `C0` through `C0.75`.
3. Interpretive candidate and review history remain replayable from the portable interpretive ledger.
4. No model output directly establishes continuity.
5. No subject grant implies silent publication.
6. No structural authority mutation may occur through interpretive publication flows.
7. Ambiguity must be surfaced rather than normalized.
8. Owner and operator provenance must remain distinct.

`C0.6.4-0` adds:

9. Publication must be a separately recorded authority act.
10. A published DNM record must remain traceable back to the exact approved interpretation revision.
11. Publication eligibility must bind exact hashes, not approximate semantic identity.
12. Publication authorization must be one-time and invalidated by relevant drift.
13. Publication events must be portable and replayable without depending on SQLite survival.
14. Withdrawal and supersession must preserve historical publication lineage rather than erase it.
15. Published continuity must be attributable to an exact continuity target, not a vague scope.

## Publication Qualification Question

`C0.6.4-0` exists to answer one machine-checkable question:

```text
is this exact interpretation revision,
with this exact grounding state,
this exact review state,
this exact subject disposition,
and this exact continuity target,
eligible to be published into Developmental Narrative Memory?
```

If the answer is yes, the contract must still stop before publication.

If the answer is no, the contract must define explicit ineligibility reasons.

## Minimum Eligibility Binding

A later publication slice must not treat publication as free-form approval reuse.

Minimum binding inputs:

```text
interpretationRevisionId
interpretationId
proposalContentHash
groundingEnvelopeHash
reviewEnvelopeHash
reviewState
subjectDispositionState
subjectDispositionRecordId
memoryScopeId
memorySubjectId
continuityTargetId
publicationPolicyId
publicationPolicyVersion
publicationPolicyHash
publicationAuthorizationId
authorizedBy
authorizedAt
authorizationNonce
```

Required minimum verdict:

```text
ELIGIBLE
or
INELIGIBLE with exact refusal codes
```

## Continuity Target Identity Rule

`C0.6.4-0` must not allow publication into an undefined destination.

Every publication contract must bind an explicit continuity target.

Minimum required questions:

1. Is the continuity target fully represented by:
   - `memoryScopeId + memorySubjectId`
2. If not, what additional identity is required?
3. Can one approved interpretation revision publish to more than one target?
4. If yes, must each target receive a separate publication authorization and separate authority event?

Default governing assumption for this slice:

```text
one approved interpretation revision
-> one publication authorization
-> one continuity target
-> one portable publication event
```

Any relaxation of that assumption must be explicit and reviewed.

## Portable Authority Source

`C0.6.4-0` must not create a SQLite-only publication layer.

Required rule:

```text
portable DNM publication ledger
-> authoritative publication history

SQLite DNM projection
-> disposable operational representation
```

At minimum, the portable authority source must be able to replay:

- initial publication
- supersession
- withdrawal
- publication-policy changes needed to interpret historical events
- later delta reviews that alter continuity state lawfully

Minimum future publication event families:

- `DNM_PUBLICATION_AUTHORIZED`
- `DNM_PUBLISHED`
- `DNM_PUBLICATION_REFUSED`
- `DNM_SUPERSEDED`
- `DNM_WITHDRAWN`
- `DNM_DELTA_REVIEW_RECORDED`

`C0.6.4-0` defines the contract only.

It does not require all of those events to be implemented immediately.

## Publication Policy Contract

Publication authority must not be inferred from review policy alone.

A separate publication-policy layer must be defined.

At minimum, publication policy must bind:

- continuity target type
- subject identity
- permitted interpretation types
- required final subject state
- required grounding outcome threshold
- whether participant disagreement blocks publication
- whether contest or defer permanently blocks publication
- whether immutable child revision is required before publication for certain classes
- whether post-grant human publication authorization is mandatory
- policy version and hash

This inequality must remain explicit:

```text
validation policy
!=
publication policy
```

Review policy governs how a candidate is evaluated.

Publication policy governs whether a granted candidate may enter continuity.

## Required Refusal Conditions

At minimum, the contract must define refusal for:

- interpretation revision not found
- interpretation revision not latest eligible child
- `reviewState != COMPLETE`
- `subjectDispositionState != GRANTED`
- `publicationState != NOT_PUBLISHED`
- proposal hash mismatch
- grounding envelope hash mismatch
- review envelope hash mismatch
- continuity target mismatch
- publication-policy mismatch
- publication-policy revoked or inactive
- one-time authorization already used
- stale authorization against changed publication-relevant state
- unsupported interpretation type for the target
- unresolved blocker or contest state still active

Every refusal must be machine-exact and replayable.

## Published Record Shape

`C0.6.4-0` must define the minimum published DNM record shape.

At minimum, a later implementation must be able to project:

```json
{
  "dnmRecordId": "dnmrec_...",
  "continuityTargetId": "character:jeep.png",
  "memorySubjectId": "character:jeep.png",
  "memoryScopeId": "scope_c063_live",
  "sourceInterpretationRevisionId": "interprev_...",
  "sourceInterpretationId": "interp_...",
  "publishedStatement": "Published continuity statement.",
  "proposalContentHash": "sha256:...",
  "groundingEnvelopeHash": "sha256:...",
  "reviewEnvelopeHash": "sha256:...",
  "publicationPolicyId": "dnm-publication-v1",
  "publicationPolicyVersion": 1,
  "publicationPolicyHash": "sha256:...",
  "publicationState": "PUBLISHED",
  "lifecycleState": "ACTIVE",
  "publishedAt": 0,
  "publicationAuthorizationId": "dnmauth_..."
}
```

This is a contract sketch, not an implementation mandate for exact field names.

The binding semantics are mandatory even if the schema evolves.

## Supersession, Withdrawal, And Delta Review

`C0.6.4-0` must define the future lifecycle dimensions up front so initial publication does not trap the system in irreversible flat state.

At minimum, separate:

- publication state
- lifecycle state
- supersession lineage
- withdrawal lineage
- delta-review lineage

Candidate future lifecycle states:

- `ACTIVE`
- `SUPERSEDED`
- `WITHDRAWN`
- `CONTEST_REOPENED`
- `DELTA_PENDING`

Required rule:

> Later continuity updates must not silently overwrite prior published continuity. They must create explicit lineage.

## Rebuild and Replay Rule

The published DNM layer must be reconstructable from portable events.

Required rule:

```text
portable publication events
-> replay
-> identical published continuity projection
```

Rebuild must never republish by inference.

It may only replay preserved publication authority events.

## Capability Boundary At This Slice

At the end of `C0.6.4-0`, the system may report:

- publication contract defined
- publication eligibility contract defined
- portable DNM authority source defined
- publication still unavailable

It must not report:

- DNM publication available
- continuity activation available
- automatic publication available

## Successful Completion Means

Successful `C0.6.4-0` completion means:

```text
the exact publication authority contract is written
portable DNM authority is defined
publication eligibility is machine-exact
refusal cases are explicit
jurisdiction remains separate from C0.75
no continuity publication is yet possible
```

## Stop-Before-Code Condition

Do not begin `C0.6.4` implementation until this contract is reviewed for:

- publication authority binding sufficiency
- continuity target identity sufficiency
- portable ledger authority sufficiency
- replay and refusal completeness
- supersession and withdrawal lifecycle sufficiency
- continued jurisdiction separation from `C0.75`

## Remaining C0.6.4 Slice Order

The remaining `C0.6.4` path should be completed in this order:

```text
close C0.6.4-1 / C0.6.4-2
-> define C0.6.4-3 lifecycle contract
-> implement supersession, withdrawal, and delta review
-> add publication operator surface
-> run complete gold-path proof
-> freeze and release v1.0
```

Backend lifecycle closure comes before the full publication UI.

The operator surface must not hard-code lifecycle assumptions while publication semantics are still moving.

## Remaining Slice Boundaries

### C0.6.4-3: Lifecycle Governance

This slice should own:

- supersession
- withdrawal
- delta review
- historical publication lineage preservation
- current-active DNM resolution
- replay of the complete DNM lifecycle

The governing distinctions must remain explicit:

```text
SUPERSEDED
-> a later approved meaning replaces the current active meaning

WITHDRAWN
-> the subject no longer endorses current continuity use

REJECTED REVISION
-> a proposed replacement never became active

HISTORICAL APPROVAL
-> remains true as a record of what was previously accepted
```

Withdrawal must not rewrite history into `never approved`.

It changes current continuity authority, not historical review fact.

### C0.6.4-4: Publication UI

This slice should provide:

- qualification inspection
- one-time publication authorization submission
- active DNM inspection
- supersession action surface
- withdrawal action surface
- lineage and delta inspection
- explicit separation between:
  - structural fact
  - interpretive history
  - current continuity

The UI must not collapse these jurisdictions into a generic delete or overwrite action.

### C0.6.4-5: Cross-Host and Recovery Proof

This slice should prove:

- DNM ledger replay into an empty projection
- restart preservation
- stale authorization refusal
- nonce replay refusal
- supersession replay
- withdrawal replay
- identical current-active DNM resolution on Node and Bun
- corpus unchanged
- structural authority unchanged
- interpretive review history unchanged

## Upgrade And Authority-Reconciliation Release Gate

Before `v1.0`, the system must prove governed upgrade and reconciliation behavior, not only fresh install behavior.

The release-hardening path must include:

```text
pre-v1 governed installation
-> install v1 payload
-> migrate additive schemas
-> replay all authority ledgers
-> reconcile projections
-> preserve every hash-bound record
-> preserve capability boundaries
-> restart successfully
```

No candidate, disposition, delegation, qualification, authorization, publication, or DNM record may silently disappear or change meaning during upgrade.

This release gate must explicitly preserve:

- structural live generations
- interpretive governance ledgers
- review projections
- synthesis runs
- granted but unpublished revisions
- publication policies
- publication qualifications
- publication authorizations
- published DNM records

## v1.0 Exit Criteria

`v1.0` should mean that the governed memory lifecycle works end to end:

```text
portable source
-> reconstruct structural truth
-> promote operational authority
-> propose developmental meaning
-> ground and review it
-> grant subject continuity
-> publish governed DNM
-> revise, withdraw, supersede, replay, and recover it
```

Release should remain blocked until all of the following are true:

1. Every authority stream is portable and replayable:
   - source corpus
   - structural authority artifacts
   - interpretive governance ledger
   - DNM publication ledger
2. Every cross-stream reference is validated:
   - published DNM resolves to exact interpretation revision
   - exact review and subject disposition
   - exact qualification and authorization
   - exact continuity target
3. No jurisdictional shortcuts exist:
   - structural promotion cannot publish DNM
   - review grant cannot publish automatically
   - synthesis cannot approve
   - operator action cannot erase subject ownership
   - UI cannot invent eligibility
4. Lifecycle is complete:
   - publish
   - supersede
   - withdraw
   - delta review
   - replay
   - recover
5. The operator surface is usable:
   - no CLI required for ordinary governed operation
   - evidence and consequences are visible
   - stale and blocked states are understandable
   - authority owner and acting operator remain clear
6. Install and upgrade are proven:
   - fresh install
   - packaged payload verification
   - pre-v1 upgrade
   - restart
   - projection rebuild
   - rollback/recovery documentation
7. Capability posture is frozen:
   - explicit supported capabilities
   - explicit unavailable capabilities
   - no ambiguous present-but-unofficial routes
