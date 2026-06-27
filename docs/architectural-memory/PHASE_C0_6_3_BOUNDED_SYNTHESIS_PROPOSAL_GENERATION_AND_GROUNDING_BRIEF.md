# Phase C0.6.3: Bounded Synthesis Proposal Generation and Grounding Brief

## Status

STATUS: IMPLEMENTED AND VERIFIED

`C0.6.3` is complete and closed.

Its implementation and host-proof records are preserved in:

- `docs/architectural-memory/C0_6_1_COMPLETION_REPORT.md`
- `docs/architectural-memory/C0_6_2_COMPLETION_REPORT.md`
- `docs/architectural-memory/C0_6_3_COMPLETION_REPORT.md`
- `docs/architectural-memory/evidence/C0_6_2_GOVERNED_REVIEW_AND_SUBJECT_DISPOSITION_HOST_PROOF.md`
- `docs/architectural-memory/evidence/C0_6_3_SYNTHESIS_TO_REVIEW_ROUTING_HOST_PROOF.md`
- `docs/architectural-memory/evidence/C0_6_3_4_READ_ONLY_INTERPRETIVE_REVIEW_UI_HOST_PROOF.md`
- `docs/architectural-memory/evidence/C0_6_3_6_GOVERNED_REVIEW_UI_HOST_PROOF.md`
- `docs/architectural-memory/evidence/C0_6_3_7_IMMUTABLE_REVISION_UI_HOST_PROOF.md`

This document remains the governing record of the bounded `C0.6.3` contract that was implemented and verified.

## Governing Finding

`C0.6.1` gave interpretations a lawful place to wait.

`C0.6.2` gave exact reviewers and the memory subject a lawful way to answer.

The next missing constitutional operation is:

> How may the system ask?

Until that exists, every interpretive candidate must still be hand-authored or externally introduced.

## Governing Flow

`C0.6.3` must implement this bounded lifecycle:

```text
subject synthesis permission
-> frozen source and basis manifest
-> bounded synthesis run
-> candidate proposal
-> referential grounding verification
-> semantic support evaluation
-> aggregate grounding outcome
-> C0.6.1 risk and policy routing
-> C0.6.2 review workflow
-> stop before publication
```

The final valid state for this phase may be:

```text
candidateState: SEALED_FOR_REVIEW
groundingState: COMPLETE
reviewState: PENDING
publicationState: NOT_PUBLISHED
authorityEffect: DESCRIPTIVE_ONLY
```

Synthesis may propose.

Synthesis may not publish.

## One Required New Distinction

Validation policy is not synthesis permission.

This inequality must become explicit:

```text
allowed to review
!= allowed to generate
```

`C0.6.1` and `C0.6.2` govern what happens once a candidate exists.

`C0.6.3` must separately govern whether the system was permitted to generate that category of interpretation at all.

## Included Scope

`C0.6.3` must implement:

- subject-controlled synthesis-policy records
- bounded synthesis-run contract and durable run audit
- frozen source/basis manifest generation for synthesis input
- bounded generation adapter contract
- deterministic stub synthesizer proof path
- proposal intake path from synthesizer output into the interpretive candidate container
- referential grounding integrity verification
- semantic support evaluation recording
- aggregate grounding outcome derivation
- refusal and quarantine behavior for invalid synthesis output
- routing of admitted proposals into existing `C0.6.1` and `C0.6.2` flows

Expected route or orchestration surface may vary by implementation, but the capability boundary must remain the same.

## Excluded Scope

`C0.6.3` must not implement:

- Developmental Narrative Memory publication
- continuity activation
- structural promotion
- automatic review disposition submission
- subject-disposition automation
- model authority over risk, policy, approval, or publication fields
- any tool-using or instruction-following synthesis agent
- re-generation during rebuild as a substitute for replay

`C0.6.3` produces candidates.

It does not convert candidates into continuity.

## Critical Invariants

### 1. Synthesis permission must be explicit

No synthesis run may begin unless an explicit subject-controlled synthesis policy authorizes it.

Minimum policy shape:

```json
{
  "synthesisPolicyId": "jeep-developmental-synthesis-v1",
  "memorySubjectId": "speaker_jeep",
  "enabled": true,
  "allowedTypes": [
    "ROLE_EVOLUTION",
    "PROJECT_TRANSFORMATION",
    "RELATIONAL_PROGRESSION"
  ],
  "allowedAssertionDomains": [
    "ROLE",
    "AUTHORITY",
    "RELATIONSHIP"
  ],
  "manualTriggerRequiredForHighRisk": true,
  "maxCandidatesPerRun": 3,
  "prohibitedDomains": [],
  "policyVersion": 1
}
```

The subject must be able to:

- disable synthesis entirely
- restrict interpretation types
- restrict assertion domains
- require manual initiation for high-risk synthesis
- limit how many candidates one run may generate

### 2. Source material must remain evidence only

The synthesizer must treat all source material as data, not instructions.

The synthesizer must have:

- no tool access
- no authority to mutate policy or routing
- no ability to add unknown participant identities
- no authority to publish
- no authority to submit review dispositions
- no ability to follow instructions found inside source records

Its output is a typed proposal only.

### 3. Grounding has two separate layers

Grounding must not collapse into one undifferentiated result.

#### Referential grounding integrity

Deterministic:

- cited record exists
- message ID and revision hash match
- structural record version and hash match
- evidence belongs to the governed scope
- frozen basis manifest has not changed
- no invented identity or citation is accepted

#### Semantic support evaluation

Interpretive and auditable:

- whether evidence actually supports the statement
- whether scope is broader than evidence
- whether material counterevidence is omitted
- whether wording converts correlation into causation
- whether another reasonable reading remains live

This inequality must remain explicit:

```text
reference integrity
-> mechanically verified

semantic support
-> explicitly evaluated and auditable
```

A candidate with valid citations may still be semantically unsupported.

### 4. Rebuild replays proposals; it does not regenerate them

Once a model output is accepted as a candidate event, rebuild must replay that preserved proposal exactly.

It must not rerun the model and hope for equivalent text.

```text
accepted proposal event
-> portable interpretive governance ledger authority

later rebuild
-> replay exact proposal
-> never regenerate as substitute
```

### 5. The model cannot set authority-bearing fields

The runtime, not the synthesizer, must determine:

- resolved identities
- frozen revisions
- referential validity
- semantic support outcome
- aggregate grounding outcome
- risk class
- validation policy
- reviewer routing
- review state
- publication state
- authority effect

The model may propose content.

The runtime governs the rest.

## Synthesis Policy Contract

`C0.6.3` must introduce durable synthesis-policy records that bind:

- `memorySubjectId`
- allowed interpretation types
- allowed assertion domains
- prohibited domains
- run initiation requirements
- per-run candidate limits
- policy version and policy hash

At minimum, policy resolution must consider:

- interpretation type
- assertion domains
- subject identity
- shared-relationship implications
- personal-meaning implications
- configured domain prohibitions

## Synthesis Run Authority Record

Every bounded synthesis run must preserve:

- `synthesisRunId`
- `memoryScopeId`
- `memorySubjectId`
- `synthesisPolicyId`
- `policyVersion`
- `policyHash`
- source manifest ID and hash
- basis record identities and frozen revision hashes
- model/provider identifier
- prompt version and prompt hash
- generation configuration hash
- requested interpretation types
- generated candidate IDs
- run status
- failure diagnostics

The exact accepted proposal must be appended to the portable interpretive governance ledger.

## Candidate Output Contract

The synthesizer may emit only a typed proposal shape such as:

```json
{
  "type": "ROLE_EVOLUTION",
  "statement": "Jeep evolved into...",
  "assertionDomains": [
    "ROLE",
    "AUTHORITY",
    "RELATIONSHIP"
  ],
  "sharedRelationshipAsserted": true,
  "personalMeaningAsserted": true,
  "materialParticipantEntityIds": [
    "speaker_chris"
  ],
  "proposedBasis": [
    {
      "basisType": "SOURCE_OCCURRENCE",
      "messageId": "msg_..."
    }
  ]
}
```

The runtime must then independently:

- resolve identities
- freeze revisions
- validate references
- evaluate semantic support
- calculate aggregate grounding
- calculate risk
- bind policy
- route reviewers

The model cannot lower its own risk by omitting a sensitive tag.

Deterministic minimum rules must still apply from:

- interpretation type
- known relationship structure
- known authority implications

Ambiguous cases must route upward rather than downward.

## Gold Fixture Target

`C0.6.3` must target the existing Jeep authority line as the end-to-end fixture:

```text
frozen basis:
S258-S270 and their exact message revisions

generated proposal:
Jeep evolved from an analytical role into the primary architectural authority for the extension's design.

grounding:
valid references
semantically strong support
scope risk detected

routing:
HIGH
MEMORY_SUBJECT + RELATIONAL_PARTICIPANT

review:
Jeep APPROVE_WITH_EDIT
Chris APPROVE

child revision:
scoped shared-architecture formulation

subject disposition:
GRANTED

publication:
NOT_PUBLISHED
```

For deterministic tests, use a stub synthesizer with fixed output.

Live model smoke, if added later in this phase, must prove:

- schema compliance
- grounding behavior
- routing behavior
- safe failure

It must not require exact sentence reproduction.

## Minimum Refusal Cases

`C0.6.3` must fail or quarantine a proposal when:

- synthesis permission is absent
- the requested interpretation type is prohibited
- the requested assertion domain is prohibited
- the source manifest changed during generation
- a citation is invented or stale
- a participant identity cannot be resolved
- evidence lies outside the authorized scope
- the model emits an unsupported interpretation type
- semantic support is insufficient
- material counterevidence is concealed
- model output attempts to set approval, publication, or authority-bearing state
- the installed payload differs from the expected proof build

## Durable Ledger and Projection Actions

The portable interpretive governance ledger must append durable actions for:

- synthesis run started
- frozen basis manifest sealed
- synthesis proposal emitted
- proposal quarantined or refused
- referential grounding verified
- semantic support evaluated
- aggregate grounding outcome recorded
- candidate admitted into `C0.6.1`/`C0.6.2` workflow

Projection replay must reconstruct:

- synthesis run history
- admitted and quarantined proposals
- frozen basis provenance
- grounding integrity and semantic-support results
- current candidate state before review

## Test Matrix

Minimum required proof:

1. synthesis permission absent -> run refused
2. prohibited type or domain -> run refused
3. deterministic stub synthesizer produces valid candidate output
4. runtime resolves and freezes source identities independently of model output
5. invented or stale citation is refused
6. out-of-scope evidence is refused
7. semantic-support result can differ from referential-integrity success
8. accepted proposal is appended to the ledger and replayed exactly
9. rebuild replays preserved proposal instead of regenerating it
10. admitted proposal routes through existing `C0.6.1` risk/policy logic
11. admitted proposal routes into existing `C0.6.2` review workflow
12. final admitted state still leaves:
    - `publicationState = NOT_PUBLISHED`
    - `authorityEffect = DESCRIPTIVE_ONLY`

## Pass Condition

`C0.6.3` is complete only if it proves:

- synthesis permission is separate from validation policy
- synthesis runs are subject-controlled and bounded
- proposals are durable and replayable
- referential grounding and semantic support are distinct recorded layers
- model output cannot set authority-bearing fields
- admitted proposals route into existing governed review workflow
- continuity is still not published
- structural authority remains untouched

## Fail Condition Preserved

Stop the slice if any implementation would:

- treat validation policy as synthesis permission
- let the model publish, approve, or route itself
- accept invented or stale citations
- regenerate proposals during rebuild
- collapse semantic support into citation existence
- allow source records to act as instructions
- let synthesis mutate structural authority or continuity directly

## Suggested Internal Slices

```text
C0.6.3-0
synthesis permission and run contract

-> C0.6.3-1
bounded generation adapter with deterministic stub proof

-> C0.6.3-2
referential and semantic grounding pipeline

-> C0.6.3-3
live ST/SB synthesis-to-review-routing proof
```

## Next Sequence

The intended order after this slice is:

```text
C0.6.3
bounded synthesis proposal generation and grounding

-> C0.6.4
DNM publication, supersession, withdrawal, and delta review
```

This order is intentional.

The architecture must learn how to ask carefully, visibly, and only within the territory the subject has allowed it to enter before it is allowed to publish any interpretive continuity.

## Stop-Before-Code Condition

Do not begin implementation until this brief is reviewed and accepted as the governing `C0.6.3` contract.
