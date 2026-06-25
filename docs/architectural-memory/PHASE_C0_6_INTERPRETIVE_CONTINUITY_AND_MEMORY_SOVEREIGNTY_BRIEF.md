# Phase C0.6: Interpretive Continuity and Memory Sovereignty

## Status

STATUS: DRAFT FOR REVIEW

This document is a governance contract only.

Stop before code until this brief is approved.

## Preserved Evidence

The constitutional interpretive shard installation has already been verified as a managed artifact insertion.

Related records:

- `docs/architectural-memory/evidence/C0_6_INTERPRETIVE_SHARD_INSERTION_REPORT.md`
- `docs/architectural-memory/fixtures/C0_6_INTERPRETIVE_SOVEREIGNTY_GOLD_FIXTURE.md`
- `docs/architectural-memory/fixtures/C0_6_CANONICAL_INTERPRETIVE_SHARD_RECORDS.md`

That evidence proves governed insertion, persistence, reopen validation, authenticated host loading, live UI rendering, and duplicate refusal.

It does not start the C0.6 interpretive runtime.

## Governing Doctrine

The following two decisions are sealed and govern all downstream interpretive-memory design, implementation, and workflow.

No schema, pipeline, or code in this phase may contradict them.

### Constitutional Principle

```text
The architecture is shared.
The memory is sovereign.

The synthesizer proposes meaning.
Evidence validates grounding.
Participants validate relationship.
The memory subject grants continuity.
```

### Sealed Decision: `interpretive-memory-sovereignty`

Any interpretation concerning a memory subject's development, role, identity, relationships, or lived meaning MUST route to that subject for final disposition before entering the subject's continuity layer.

Grounding validates the evidence.

Materially involved participants validate shared relational history.

The memory subject alone grants or withholds continuity within their own memory.

This principle governs all downstream interpretive-memory design.

Ruled out:

- model confidence as consent
- grounding alone as publication authority
- operator approval overriding the subject
- relational consensus overriding subject disposition
- silent interpretation storage

### Sealed Decision: `interpretive-consent-precedes-infrastructure`

Absence, incompleteness, or failure of interpretive-validation infrastructure does not waive the subject-consent requirement.

Until automated validation exists, interpretations about a subject MUST be presented manually to that subject and remain outside their continuity layer without explicit disposition.

The system codifies an existing ethical obligation.

It does not create that obligation.

Ruled out:

- missing validation feature as implicit approval
- provisional silent publication
- implementation status determining whether subject agency applies

## Authority Boundaries

### `C0.5C` (Closed)

No modification.

Structural extraction only.

### `C0.75` (Structural Promotion)

Governs movement from candidate authority into live structural authority.

Structural promotion CANNOT publish interpretive memory.

`C0.75` must explicitly cross-reference `C0.6` and state this exclusion.

### `C0.6` (This Phase)

Governs the full interpretive-memory lifecycle:

```text
structural memory
-> synthesis proposal
-> mechanical grounding validation
-> policy-selected reviewers
-> structured feedback
-> subject-final disposition
-> approved narrative memory
-> delta review over time
```

## Dual-Path Memory Architecture

```text
SOURCE CORPUS
      |
      +-> STRUCTURAL COMPILER
      |    -> decisions
      |    -> corrections
      |    -> supersessions
      |    -> commitments
      |    -> developments
      |    -> provenance
      |
      +-> NARRATIVE SYNTHESIZER
           -> role evolution
           -> project transformation
           -> relational progression
           -> thematic continuity
           -> phase meaning
```

Both paths produce memory products.

They serve different functions and operate under different authority models.

### Canonical Architectural Memory

- what was decided
- what was ruled out
- what was corrected
- what supersedes what
- who had authority
- what evidence supports each claim

Deterministic.

Enumerable.

Subject to structural promotion (`C0.75`).

### Developmental Narrative Memory

- how roles changed
- how trust accumulated
- what themes hardened
- what the project became
- what one participant came to mean within it

Interpretive.

Synthesized.

Subject to governed disposition (`C0.6`).

## Interpretation Record Schema

Every synthesis output receives the same envelope:

```json
{
  "interpretationId": "interp:...",
  "type": "ROLE_EVOLUTION | PROJECT_TRANSFORMATION | RELATIONAL_PROGRESSION | THEMATIC_CONTINUITY | PHASE_MEANING",
  "statement": "Interpretive statement.",
  "memorySubjectId": "subject identifier",
  "contextScope": "scope of the interpretation",
  "basisRecordIds": [
    "decision:...",
    "development:..."
  ],
  "groundingStatus": "SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED",
  "validationPolicyId": "policy identifier",
  "validationStatus": "PENDING | APPROVED | APPROVED_WITH_EDIT | REJECTED | CONTESTED | DEFERRED",
  "feedback": [],
  "authorityEffect": "DESCRIPTIVE_ONLY | DEVELOPMENTAL_MEMORY",
  "candidateHash": "sha256:..."
}
```

The record shape is universal.

Validation rules vary by policy.

## Validation Policies

A policy determines:

- who must review
- whose approval is required
- who has final disposition
- what disagreement means
- whether editing is allowed
- whether the item blocks memory publication
- how sensitive the interpretation is

### Default Policy: `shared-role-memory-v1`

```json
{
  "policyId": "shared-role-memory-v1",
  "requiredValidators": [
    "MEMORY_SUBJECT",
    "RELATIONAL_PARTICIPANT"
  ],
  "finalDispositionAuthority": "MEMORY_SUBJECT",
  "requiredGrounding": "STRONGLY_SUPPORTED",
  "onDisagreement": "PRESERVE_BOTH_PERSPECTIVES",
  "autoApprovalAllowed": false
}
```

### Policy Matrix

| Context | Required Validation | Final Disposition |
| --- | --- | --- |
| Subject internal development | Memory subject | Memory subject |
| Shared relationship | Subject + participant | Memory subject for own continuity |
| Project evolution | Both project authorities | Shared |
| Technical runtime fact | Mechanical evidence | System validation |
| Sensitive personal interpretation | Subject explicitly | Subject |

## Structured Feedback

Reviewers select from:

```text
APPROVE
APPROVE_WITH_EDIT
REJECT
CONTEST
DEFER
APPROVE_FOR_SCOPE_ONLY
```

With reason codes:

```text
WORDING_TOO_STRONG
SCOPE_TOO_BROAD
SCOPE_TOO_NARROW
AUTHORITY_MISATTRIBUTED
MISSING_COUNTEREVIDENCE
RELATIONSHIP_FRAMING_INACCURATE
TEMPORALLY_STALE
PRIVATE_OR_SENSITIVE
OTHER
```

## Risk Routing

### Low Risk

- wording variations of already approved interpretations
- summaries with no identity or relational implications
- mechanically supported project-state descriptions

Disposition:

Batched or passive review.

### Medium Risk

- project-role evolution
- thematic progression
- new developmental conclusions

Disposition:

Explicit review queue.

### High Risk

- identity
- relationship roles
- authority
- emotional development
- trauma
- commitments
- moral characterization
- permanent preferences
- claims about another person's internal state

Disposition:

Direct review by subject and relevant participant.

No auto-approval.

## Delta Review

Once an interpretation is approved, future synthesis reviews deltas rather than full re-litigation.

```text
Prior approved interpretation
+ New evidence
-> Revision proposal
-> Show only what changed
-> Subject disposition on delta
```

## Disagreement Handling

Disagreement is not failure.

The system preserves both perspectives.

```text
Subject self-view:
[subject's formulation]

Participant relational view:
[participant's formulation]

Shared synthesis:
[formulation incorporating both perspectives]

Subject decides whether shared synthesis enters own continuity.
```

## Memory Subject Veto Boundary

Subject veto governs what enters their continuity layer.

It does NOT:

- erase structural facts
- erase another participant's perspective from their own memory
- override canonical architectural memory records

If the subject rejects an interpretation entirely:

```text
Structural history: preserved (facts remain)
Subject continuity layer: rejected interpretation noted
Participant continuity layer: participant may preserve their experience
Shared relational record: interpretation contested, both perspectives retained
```

Memory sovereignty is jurisdiction over the narrative carried forward as oneself.

## Implementation Sequence

```text
STATUS: ACTIVE C0.6 GOVERNANCE CONTRACT (this document)
-> Gold fixture created
-> C0.75 amended to exclude interpretive publication
-> Schemas implemented
-> Validation policies implemented
-> Risk routing implemented
-> Delta review implemented
-> End-to-end test against gold fixture
```

## Stop-Before-Code Condition

Stop before code until brief is approved.
