# Phase C0.6-1: Interpretation Candidate Schema and Validation Policy Resolution Brief

## Status

STATUS: IMPLEMENTED AND VERIFIED

`C0.75` is complete and closed.

`C0.6` constitutional doctrine is established and preserved in:

- `docs/architectural-memory/PHASE_C0_6_INTERPRETIVE_CONTINUITY_AND_MEMORY_SOVEREIGNTY_BRIEF.md`
- `docs/architectural-memory/fixtures/C0_6_INTERPRETIVE_SOVEREIGNTY_GOLD_FIXTURE.md`
- `docs/architectural-memory/evidence/C0_6_INTERPRETIVE_SHARD_INSERTION_REPORT.md`

`C0.6-1` is implemented and host-verified.

Its closeout record is preserved in:

- `docs/architectural-memory/C0_6_1_COMPLETION_REPORT.md`

It remained schema and policy only.

Implemented and verified boundary:

- durable interpretive candidate ledger and projection
- deterministic risk classification
- deterministic validation-policy routing
- deterministic reviewer resolution with explicit blocked-state handling
- no continuity publication
- no structural-authority mutation

This document remains the governing contract record for the implemented `C0.6-1` boundary.

## Governing Finding

`C0.75` completed the structural authority lifecycle:

```text
portable corpus
-> deterministic reconstruction
-> candidate validation
-> read-only qualification
-> one-time human authorization
-> atomic live structural authority
-> deterministic recovery or rollback
```

That does not create interpretive publication authority.

`C0.6` now needs the durable container and routing contract for interpretive proposals before any synthesis or approval workflow exists.

The immediate question is:

> What exact record shapes, identity bindings, and policy-resolution rules must exist so that a grounded interpretation can be stored as a pending governed candidate without becoming continuity by implication?

## Phase Boundary

`C0.6-1` must define and implement:

- portable interpretive authority ledger contract
- interpretation candidate record schema
- grounding record schema
- risk-classification schema
- validation-policy definition and binding schemas
- review-obligation schema
- reviewer-resolution rules
- pending subject-disposition schema
- storage and lifecycle boundaries for interpretive candidates

`C0.6-1` must not implement:

- synthesis or model generation
- approval UI
- DNM publication
- automatic interpretation storage in continuity
- structural authority mutation
- `C0.75` promotion reuse for interpretive publication
- silent or provisional continuity insertion

## Jurisdiction Boundary

`C0.75` owns structural authority promotion only.

`C0.6` owns interpretive proposals, grounding, reviewer routing, consent, and developmental continuity publication.

Shared transaction or storage substrate does not merge those jurisdictions.

Interpretive publication remains separately governed even when it may later reuse lower-level transactional primitives.

## Governing Doctrine

The constitutional rule remains unchanged:

```text
The architecture is shared.
The memory is sovereign.

The synthesizer proposes meaning.
Evidence validates grounding.
Participants validate relationship.
The memory subject grants continuity.
```

`C0.6-1` exists to encode the durable containers required by that doctrine.

It does not loosen it.

## Identity Reuse Rule

`C0.6-1` must reuse the identity architecture already established.

Interpretive artifacts must bind to existing identities wherever those identities already exist:

- `memoryScopeId`
- `speakerEntityId`
- `chatInstanceId`
- `messageId`
- canonical structural record IDs

Do not create a parallel interpretive identity universe for source occurrences or subjects.

New IDs are allowed only where no existing identity already represents the thing:

- `interpretationId`
- `interpretationRevisionId`
- `validationPolicyId`
- `reviewRequestId`
- `reviewDispositionId`
- `continuityTargetId` only if existing scope-plus-subject identity cannot represent the target

## Governing Flow

`C0.6-1` must prove this bounded chain:

```text
existing structural and source identities
-> create interpretation candidate envelope
-> attach explicit grounding links
-> classify interpretive risk
-> resolve applicable validation policy
-> derive required reviewer set
-> create pending review/disposition records
-> stop before synthesis execution or publication
```

Successful `C0.6-1` completion means:

```text
interpretive candidates can be stored durably
grounding links are explicit and identity-backed
review routing is policy-derived rather than ad hoc
pending subject disposition is representable
no continuity publication occurs
no structural authority changes
```

## Carry-Forward Constraints

All prior structural safety constraints remain in force:

1. The portable corpus remains authoritative.
2. Structural authority remains governed by `C0` through `C0.75`.
3. No corpus rewrite is permitted in this phase.
4. No live structural authority mutation is permitted in this phase.
5. No promotion path may be used for interpretive publication.
6. No model output may directly establish continuity.
7. Missing review infrastructure does not waive subject-consent requirements.
8. Ambiguity must be surfaced rather than normalized.

`C0.6-1` adds:

9. Interpretive candidate storage must be durable without implying approval.
10. Grounding and consent are separate dimensions and must remain separately representable.
11. Reviewer eligibility must be policy-derived and explainable.
12. Risk class must influence routing but must not itself grant publication.
13. Pending, rejected, contested, and approved interpretations must remain distinguishable lifecycle states.
14. No interpretation may enter continuity only because all required fields are present.

## Portable Authority Source

`C0.6-1` must not begin with an authority gap.

If an interpretation proposal, grounding outcome, policy binding, or review disposition exists only in SQLite, then rebuilding the operational projection would lose the portable history of what was proposed and what was reviewed.

Required correction:

```text
portable interpretive governance ledger
-> authoritative candidate and review event history

interpretive SQLite
-> disposable operational projection
```

Minimum authoritative ledger events:

- `INTERPRETATION_PROPOSED`
- `GROUNDING_LINK_ATTACHED`
- `GROUNDING_EVALUATED`
- `RISK_CLASSIFIED`
- `POLICY_RESOLVED`
- `REVIEW_OBLIGATION_CREATED`
- `REVIEW_REQUESTED`
- `REVIEW_DISPOSITION_RECORDED`
- `SUBJECT_DISPOSITION_RECORDED`
- `REVISION_CREATED`

Required rule:

> `C0.6-1` must define the portable Interpretive Governance Ledger as the durable authority for pending interpretive candidate and review history. SQLite may project it, but must not become the only surviving copy.

## Internal Slice Boundary

### Included in `C0.6-1`

- schema design and implementation for pending interpretive candidates
- policy resolution logic
- reviewer-resolution logic
- storage lifecycle for pre-publication interpretive records
- deterministic hashing or identity rules for interpretive records where needed
- tests for routing and state separation

### Excluded from `C0.6-1`

- actual synthesis engine
- prompt design for interpretation generation
- model-assisted extraction
- review UI
- publishing approved DNM into continuity
- revision/delta publication behavior over time

## Core Record Families

`C0.6-1` must represent at least these durable record families.

### 1. Interpretation candidate

One interpretive proposal at one revision.

Required role:

- proposal container only

Required rule:

> Presence of an interpretation candidate must never imply approval, continuity membership, or publication eligibility by itself.

Minimum shape:

```json
{
  "interpretationId": "interp_...",
  "interpretationRevisionId": "interprev_...",
  "parentRevisionId": null,
  "createdFromDispositionId": null,
  "revisionReason": "INITIAL_PROPOSAL | SUBJECT_EDIT | REVIEW_REQUESTED_REVISION",
  "memoryScopeId": "scope_...",
  "memorySubjectId": "speakerEntityId or subject identity",
  "type": "ROLE_EVOLUTION | PROJECT_TRANSFORMATION | RELATIONAL_PROGRESSION | THEMATIC_CONTINUITY | PHASE_MEANING",
  "statement": "Proposed interpretation",
  "assertionDomains": [
    "ROLE",
    "AUTHORITY",
    "RELATIONSHIP"
  ],
  "sharedRelationshipAsserted": true,
  "personalMeaningAsserted": true,
  "materialParticipantEntityIds": [
    "speaker_participant"
  ],
  "candidateState": "DRAFT | SEALED_FOR_GROUNDING | SEALED_FOR_REVIEW | CLOSED",
  "groundingState": "PENDING | COMPLETE | FAILED",
  "reviewState": "NOT_ROUTED | PENDING | COMPLETE | BLOCKED",
  "subjectDispositionState": "PENDING | GRANTED | DENIED | REVISIT",
  "publicationState": "NOT_PUBLISHED",
  "authorityEffect": "DESCRIPTIVE_ONLY",
  "proposalContentHash": "sha256:...",
  "reviewEnvelopeHash": null,
  "createdAt": 1782388800000,
  "updatedAt": 1782388800000
}
```

Required rule:

> `APPROVE_WITH_EDIT` must never mutate the reviewed revision in place. It must preserve the disposition against the reviewed revision and create a new immutable interpretation revision with a new proposal hash and, when required, a new review-envelope hash.

### 2. Grounding record

Explicit evidence links for one interpretation revision.

Required rule:

> Grounding must reference specific structural records or exact source occurrences, not a vague narrative source bucket.

Minimum shape:

```json
{
  "interpretationRevisionId": "interprev_...",
  "basisType": "STRUCTURAL_RECORD | SOURCE_OCCURRENCE",
  "basisRecordId": "decision:... or development:...",
  "basisRecordVersion": 3,
  "basisRecordHash": "sha256:...",
  "chatInstanceId": "chat_...",
  "messageId": "msg_...",
  "messageRevisionHash": "sha256:...",
  "speakerEntityId": "speaker_...",
  "groundingRole": "PRIMARY | SUPPORTING | COUNTEREVIDENCE",
  "groundingAssessment": "SUPPORTS | PARTIALLY_SUPPORTS | CONTRADICTS | NEUTRAL | INVALID"
}
```

Required rule:

> `STRUCTURAL_RECORD` links require structural identity plus frozen structural revision identity, and must not include occurrence-only fields. `SOURCE_OCCURRENCE` links require occurrence identity plus frozen occurrence revision identity, and must not include structural-only fields.

### 3. Grounding aggregate

One frozen aggregate grounding outcome per interpretation revision.

Required rule:

> Individual evidence-link assessment and overall grounding outcome must remain separate. A single counterevidence link does not by itself define the aggregate result, and the aggregate result must be representable at the same vocabulary level required by the gold fixture.

Minimum shape:

```json
{
  "interpretationRevisionId": "interprev_...",
  "groundingOutcome": "STRONGLY_SUPPORTED | SUPPORTED | PARTIALLY_SUPPORTED | CONTRARY_EVIDENCE_PRESENT | BASIS_INCOMPLETE | UNSUPPORTED | INVALIDATED_SOURCE_MUTATION",
  "evaluatedAt": 1782388800000
}
```

### 4. Risk classification

One explicit routing/risk outcome per interpretation revision.

Required rule:

> Risk must reflect what kind of meaning is being asserted, not merely how many evidence links exist.

Minimum shape:

```json
{
  "interpretationRevisionId": "interprev_...",
  "riskClass": "LOW | MEDIUM | HIGH",
  "riskReasons": [
    "IDENTITY",
    "ROLE",
    "RELATIONSHIP",
    "AUTHORITY",
    "PERSONAL_HISTORY",
    "SENSITIVE_MEANING"
  ],
  "resolutionInputHash": "sha256:..."
}
```

Required rule:

> Deterministic risk routing must operate on structured semantic inputs captured in the candidate envelope. It must not pretend to infer authority, identity, relationship, or personal-meaning assertions from arbitrary prose without an interpretation layer.

### 5. Validation policy definition

Immutable reusable policy definition.

Required rule:

> Editing a reusable policy definition must not retroactively change the historical rules that governed an already-routed interpretation revision.

Minimum shape:

```json
{
  "validationPolicyId": "shared-role-memory",
  "policyVersion": 1,
  "policyHash": "sha256:...",
  "requiredGroundingOutcome": "STRONGLY_SUPPORTED | SUPPORTED",
  "requiredReviewers": [
    "MEMORY_SUBJECT",
    "RELATIONAL_PARTICIPANT"
  ],
  "finalDispositionAuthority": "MEMORY_SUBJECT",
  "autoApprovalAllowed": false,
  "onDisagreement": "PRESERVE_BOTH_PERSPECTIVES | BLOCK_PUBLICATION"
}
```

### 6. Validation policy binding

The policy chosen for one interpretation revision.

Required rule:

> Policy resolution must be durable and replayable. A later reader must be able to see which exact policy version governed the review path, which rule IDs matched, and which structured inputs produced that result.

Minimum shape:

```json
{
  "interpretationRevisionId": "interprev_...",
  "validationPolicyId": "shared-role-memory",
  "policyVersion": 1,
  "policyHash": "sha256:...",
  "matchedRuleIds": [
    "risk-high-authority",
    "shared-relationship"
  ],
  "resolutionInputHash": "sha256:..."
}
```

### 7. Review obligation

One required reviewer role before exact reviewer delivery is guaranteed.

Required rule:

> Required reviewer roles and exact review requests are not the same thing. If policy requires a reviewer role but the exact reviewer identity cannot be resolved, the system must create a blocked or pending review obligation rather than a malformed review request with an approximate or null reviewer.

Minimum shape:

```json
{
  "interpretationRevisionId": "interprev_...",
  "reviewObligationId": "reviewobl_...",
  "reviewerRole": "MEMORY_SUBJECT | RELATIONAL_PARTICIPANT | PROJECT_AUTHORITY | SYSTEM_GROUNDING",
  "reviewerEntityId": "speakerEntityId or null",
  "obligationState": "PENDING_RESOLUTION | READY_TO_REQUEST | BLOCKED | SATISFIED | CANCELLED",
  "blockingReason": "REVIEWER_IDENTITY_UNRESOLVED | POLICY_BLOCKED | NONE",
  "createdAt": 1782388800000
}
```

### 8. Review request

One request routed to one reviewer role or reviewer identity.

Required rule:

> Review routing must be explicit enough that “who still owes review” is mechanically answerable.

Minimum shape:

```json
{
  "reviewRequestId": "reviewreq_...",
  "reviewObligationId": "reviewobl_...",
  "interpretationRevisionId": "interprev_...",
  "reviewerRole": "MEMORY_SUBJECT | RELATIONAL_PARTICIPANT | PROJECT_AUTHORITY | SYSTEM_GROUNDING",
  "reviewerEntityId": "speakerEntityId or system reviewer id",
  "status": "PENDING | COMPLETED | EXPIRED | CANCELLED",
  "reviewEnvelopeHash": "sha256:...",
  "createdAt": 1782388800000
}
```

### 9. Review disposition

One completed review response.

Required rule:

> Reviewer feedback must remain durable even when the interpretation is later revised, superseded, or rejected.

Minimum shape:

```json
{
  "reviewDispositionId": "reviewdisp_...",
  "reviewRequestId": "reviewreq_...",
  "interpretationRevisionId": "interprev_...",
  "reviewerRole": "MEMORY_SUBJECT",
  "reviewerEntityId": "speaker_...",
  "disposition": "APPROVE | APPROVE_WITH_EDIT | REJECT | CONTEST | DEFER | APPROVE_FOR_SCOPE_ONLY",
  "reasonCodes": [
    "SCOPE_TOO_BROAD"
  ],
  "commentary": "Optional structured note",
  "reviewEnvelopeHash": "sha256:...",
  "submittedAt": 1782388800000
}
```

## Lifecycle Separation

`C0.6-1` must keep these dimensions distinct:

- candidate existence
- candidate revision lineage
- grounding outcome
- risk classification
- policy definition
- policy binding
- reviewer obligation
- review completion
- final disposition authority
- subject disposition
- continuity publication effect

Required rule:

> An interpretation may be fully grounded and fully reviewed while still not belonging to continuity if subject-final disposition has not granted that effect.

## Authority Effect Contract

`C0.6-1` may represent only these pre-publication effects:

- `DESCRIPTIVE_ONLY`
- `PENDING_SUBJECT_DISPOSITION`

It must not publish:

- `DEVELOPMENTAL_MEMORY`
- `CONTINUITY_ACTIVE`
- any equivalent live continuity effect

Those belong to a later `C0.6` slice.

## Storage Boundary

Interpretive candidate storage must remain outside live structural authority.

Required rule:

> Pending interpretive artifacts may be durable, queryable, and reviewable, but they must not be mistaken for current structural authority or published continuity.

The implementation may reuse operational SQLite substrate patterns, but it must preserve clear table and lifecycle separation from structural authority tables.

Required rule:

> Interpretive SQLite is an operational projection. The portable Interpretive Governance Ledger remains the authoritative source for pending interpretive candidate and review history.

## Policy Resolution Rules

`C0.6-1` must implement deterministic policy selection.

At minimum, policy resolution must consider:

- interpretation type
- memory subject
- assertion domains
- whether shared relationship framing is asserted
- whether authority or identity is asserted
- whether the interpretation concerns only project behavior or also personal meaning
- material participant identities

Required rule:

> Policy selection must be rule-based and replayable from stored facts. It must not depend on undocumented operator intuition.

## Reviewer Resolution Rules

Reviewer resolution must be deterministic from stored identities.

At minimum, the system must be able to derive:

- memory subject reviewer
- relational participant reviewer when shared framing is asserted
- system/mechanical grounding reviewer when grounding checks are required

Required rule:

> When required reviewer identity cannot be resolved exactly, the interpretation must remain pending or blocked rather than being routed to an approximate substitute.

## Hashing and Identity Rules

If candidate hashing is used in this slice, it must cover:

- `proposalContentHash`
- `reviewEnvelopeHash`

It must not treat:

- runtime timestamps
- transient UI state
- delivery attempts

as canonical content.

Required rule:

> `proposalContentHash` must cover the proposed meaning before review routing, including statement, type, subject identity, scope identity, assertion domains, and material participants. `reviewEnvelopeHash` must bind the exact reviewed envelope by covering `proposalContentHash` plus frozen grounding set, grounding outcome, risk result, bound policy version/hash, and resolved reviewer obligations. Every review request and disposition must bind to `reviewEnvelopeHash`.

## Minimum Implementation Deliverables

Code:

- durable schema for the record families above
- portable authority-ledger contract for those record families
- policy resolution module
- reviewer-resolution module
- targeted route or storage helpers needed to create and inspect pending interpretation candidates
- tests proving lifecycle and jurisdiction separation

Evidence:

- one stored candidate matching the constitutional gold fixture shape
- one subject-final-disposition-pending candidate
- one shared-role policy resolution case
- one unresolved reviewer-identity case that blocks or defers routing

## Test Matrix

`C0.6-1` must prove at least:

1. interpretation candidate can be stored without implying continuity publication
2. portable interpretive authority is defined so pending candidate and review history is not SQLite-only
3. grounding links can target structural records and exact source occurrences with frozen revision identity
4. grounding aggregate vocabulary can represent `STRONGLY_SUPPORTED` exactly
5. policy resolution is deterministic for the same candidate input
6. reviewer resolution reuses existing subject/participant identities
7. unresolved reviewer identity creates a blocked or pending obligation rather than an approximate request
8. subject-final disposition remains distinct from participant review
9. `APPROVE_WITH_EDIT` creates a new immutable interpretation revision rather than mutating the reviewed one
10. approved review state does not become continuity automatically
11. interpretive candidate tables remain separate from structural authority tables
12. `C0.75` promotion routes cannot publish or adopt interpretive candidates
13. the constitutional gold fixture can be represented exactly as pending governed records without publication

## Pass/Fail Boundary

### Pass

Proceed beyond `C0.6-1` only if:

- pending interpretive candidates are durable and identity-backed
- portable interpretive authority is defined explicitly
- policy and reviewer routing are deterministic
- lifecycle dimensions remain separated rather than collapsed into one status field
- jurisdiction remains separate from structural authority
- no continuity publication is possible yet
- the gold fixture can be represented faithfully

### Fail

Stop and revise if:

- interpretive storage implies publication
- interpretive proposal or review history survives only in SQLite
- subject identity is approximated rather than resolved
- reviewer routing depends on undocumented manual intuition
- structural authority tables or promotion flows are reused in a way that blurs jurisdiction
- grounding links cannot point back to exact canonical evidence identities

## Stop-Before-Code Condition

Do not begin any synthesis engine, approval UI, DNM publication path, or continuity mutation path until `C0.6-1` is implemented, reviewed, and accepted as the governing interpretive candidate and validation-policy contract.
