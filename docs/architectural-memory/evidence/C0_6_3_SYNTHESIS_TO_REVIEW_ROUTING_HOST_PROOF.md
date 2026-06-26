# C0.6.3 Synthesis-To-Review Routing Host Proof

## Status

Final status: `VERIFIED`

This report preserves the live host proof for `C0.6.3`.

It verifies that the packaged `summary-sharder-memory` plugin can, on both safe clone hosts:

- enforce CSRF on synthesis policy mutation
- persist subject-controlled synthesis policies
- refuse prohibited synthesis runs without publishing anything
- admit a bounded deterministic synthesis run into the existing governed interpretive candidate flow
- record separate referential and semantic grounding results
- quarantine source-manifest drift before review admission
- persist synthesis, grounding, and review-routing state across host restart
- leave structural authority tables untouched

This proof does not publish continuity and does not mutate structural authority.

## Proofed Implementation Commits

- `aa5e68f` - `feat: add c0.6.3-0 synthesis run contract`
- `5dabbf6` - `feat: add c0.6.3-1 deterministic synthesis stub`
- `33f6aae` - `feat: add c0.6.3-2 grounding evaluation pipeline`

## Hosts

Safe clone roots used for live proof:

- `D:\AI\Projects\SillyTavern`
- `D:\AI\Projects\SillyBunny`

Observed runtimes:

- SillyTavern: `node`
- SillyBunny: `bun`

Observed ports:

- SillyTavern: `8000`
- SillyBunny: `4444`

## Regression Coverage

Regression command executed from the committed implementation boundary:

```text
node --test tools/server-plugin/summary-sharder-memory/interpretive.test.mjs tools/server-plugin/summary-sharder-memory/index.test.mjs tools/server-plugin/summary-sharder-memory/package.test.mjs tools/server-plugin/summary-sharder-memory/core.test.mjs tools/server-plugin/summary-sharder-memory/rebuild.test.mjs tools/server-plugin/summary-sharder-memory/promotion.test.mjs
```

Observed result:

- `69` passed
- `0` failed

## Capability Posture Observed On Both Hosts

Observed live capability blocks:

```json
{
  "c0_6_1": {
    "interpretiveLedgerAuthority": true,
    "interpretiveCandidateStorage": true,
    "deterministicPolicyRouting": true,
    "deterministicReviewerResolution": true,
    "continuityPublicationAvailable": false,
    "structuralAuthorityMutation": false,
    "modelInterpretationAvailable": false
  },
  "c0_6_2": {
    "reviewerDispositionSubmission": true,
    "immutableEditRevision": true,
    "subjectDispositionRecording": true,
    "continuityPublicationAvailable": false,
    "structuralAuthorityMutation": false,
    "modelInterpretationAvailable": false
  },
  "c0_6_3": {
    "synthesisPolicyStorage": true,
    "boundedSynthesisRunContract": true,
    "frozenSourceManifest": true,
    "deterministicStubSynthesisAvailable": true,
    "continuityPublicationAvailable": false,
    "structuralAuthorityMutation": false,
    "modelSynthesisAvailable": false
  }
}
```

## Live Route Surface Verified

Observed on both hosts:

- `GET /interpretive/policies`
- `GET /interpretive/synthesis/policies`
- `POST /interpretive/synthesis/policies`
- `POST /interpretive/synthesis/runs`
- `GET /interpretive/synthesis/runs/:synthesisRunId`
- `POST /interpretive/synthesis/runs/:synthesisRunId/generate`
- `GET /interpretive/candidates/:interpretationRevisionId`
- `GET /interpretive/reviews`

## Seeded Validation Policies Observed

Observed on both hosts:

- `shared-role-memory`
  - `requiredGroundingOutcome = STRONGLY_SUPPORTED`
  - reviewers:
    - `MEMORY_SUBJECT`
    - `RELATIONAL_PARTICIPANT`
- `subject-meaning-memory`
  - `requiredGroundingOutcome = SUPPORTED`
  - reviewers:
    - `MEMORY_SUBJECT`

## Governed Workflow Proved

The live proof executed the bounded constitutional flow:

```text
missing CSRF token
-> synthesis policy mutation refused

subject-controlled synthesis policy
-> prohibited-domain run refused

subject-controlled synthesis policy
-> frozen synthesis run admitted
-> deterministic stub proposal emitted
-> referential grounding recorded
-> semantic support recorded
-> proposal admitted into C0.6.1/C0.6.2 review flow
-> publication remains NOT_PUBLISHED

second frozen synthesis run
-> expected source manifest hash forced stale
-> proposal quarantined as SOURCE_MANIFEST_DRIFT
-> no review candidate admitted
```

Shared characteristics of the admitted proof input:

- interpretation type: `ROLE_EVOLUTION`
- assertion domains:
  - `ROLE`
  - `AUTHORITY`
  - `RELATIONSHIP`
- `sharedRelationshipRequested = true`
- `personalMeaningRequested = true`
- source manifest entries:
  - structural record:
    - `decision:constitutional-sovereignty`
    - version `1`
    - `sha256:constitutional-sovereignty`
  - source occurrence:
    - `chat_alpha`
    - `msg_alpha0000000000000000000000000`
    - `sha256:msg-alpha`

## Exact Cross-Host Parity

The following values matched exactly on Node and Bun:

- active synthesis policy hash:
  - `sha256:b064fb1871e2d7fde24ec9c659fd443bf5d09930f33243ab4f200332235803c1`
- prohibited synthesis policy hash:
  - `sha256:969a6af3b84d7a04637f1d3c3d6eede7b4bee2a16f1f737372b9ef7400b16ca2`
- admitted run source manifest hash:
  - `sha256:66db02a02f1fa1570f8f9c1d27a31b7e41ae9f70a5c95cbbcb838c09ebb4a3a0`
- admitted proposal content hash:
  - `sha256:adc05d38b171968fef9583b27ff15d27ecad975a4624ae15a393180726428d3f`
- grounding envelope hash:
  - `sha256:782b7c45611e98c7323c66169768ac7cb393450ce2ab65eeb22f124938b6159e`
- review envelope hash:
  - `sha256:8f156cbbb8890cf633b3aaf372c7320aa53965c98cc124272e2bfb9dedf7d824`
- policy binding hash:
  - `sha256:c299527336e23e80b1a4bc37f27cf9d37f6c0b3a6896cf0eab116d499523a6ab`
- evaluator config hash:
  - `sha256:6c09818e772b9ddc8ec770b8207b73cefddb3f9785103609bb75a3e5340df422`

Cross-host comparisons all resolved `true` for:

- capability blocks
- seeded policy definitions
- active policy hashes
- prohibited policy hashes
- refused run fingerprint
- admitted generated run fingerprint
- candidate fingerprint
- review fingerprint
- manifest-drift run fingerprint
- persisted DB state
- persisted DB state stability across restart
- structural counts remaining zero

## Exact Host Outcomes

### SillyTavern

Observed behavior:

- missing-token synthesis-policy mutation attempt returned `403`
- prohibited-domain run returned:
  - `runStatus = REFUSED`
  - `failureCode = SYNTHESIS_PROHIBITED_DOMAIN`
- admitted run returned:
  - `runStatus = COMPLETED_ADMITTED`
  - `generatedCandidateIds = [interprev_c063_live_generated_v1]`
- admitted grounding result returned:
  - `referentialStatus = VALID`
  - `aggregateOutcome = CONTRARY_EVIDENCE_PRESENT`
  - `scopeAssessment = TOO_BROAD`
  - `counterevidencePresent = true`
- admitted candidate returned:
  - `reviewState = PENDING`
  - `subjectDispositionState = PENDING`
  - `publicationState = NOT_PUBLISHED`
  - `authorityEffect = DESCRIPTIVE_ONLY`
  - `validationPolicyId = shared-role-memory`
- review routing returned exactly two pending requests:
  - `MEMORY_SUBJECT -> character:jeep.png`
  - `RELATIONAL_PARTICIPANT -> user:Chris`
- manifest-drift run returned:
  - `runStatus = COMPLETED_QUARANTINED`
  - `failureCode = SOURCE_MANIFEST_DRIFT`
  - proposal `proposalStatus = QUARANTINED`
  - grounding `referentialStatus = SOURCE_MANIFEST_DRIFT`

Restart durability:

- admitted run remained stable after restart
- admitted candidate remained stable after restart
- review queue remained stable after restart
- manifest-drift quarantined run remained stable after restart

### SillyBunny

Observed behavior:

- missing-token synthesis-policy mutation attempt returned `403`
- prohibited-domain run returned:
  - `runStatus = REFUSED`
  - `failureCode = SYNTHESIS_PROHIBITED_DOMAIN`
- admitted run returned:
  - `runStatus = COMPLETED_ADMITTED`
  - `generatedCandidateIds = [interprev_c063_live_generated_v1]`
- admitted grounding result returned:
  - `referentialStatus = VALID`
  - `aggregateOutcome = CONTRARY_EVIDENCE_PRESENT`
  - `scopeAssessment = TOO_BROAD`
  - `counterevidencePresent = true`
- admitted candidate returned:
  - `reviewState = PENDING`
  - `subjectDispositionState = PENDING`
  - `publicationState = NOT_PUBLISHED`
  - `authorityEffect = DESCRIPTIVE_ONLY`
  - `validationPolicyId = shared-role-memory`
- review routing returned exactly two pending requests:
  - `MEMORY_SUBJECT -> character:jeep.png`
  - `RELATIONAL_PARTICIPANT -> user:Chris`
- manifest-drift run returned:
  - `runStatus = COMPLETED_QUARANTINED`
  - `failureCode = SOURCE_MANIFEST_DRIFT`
  - proposal `proposalStatus = QUARANTINED`
  - grounding `referentialStatus = SOURCE_MANIFEST_DRIFT`

Restart durability:

- admitted run remained stable after restart
- admitted candidate remained stable after restart
- review queue remained stable after restart
- manifest-drift quarantined run remained stable after restart

## Persisted-State Verification

The proof did not stop at route responses.

It also verified, on both hosts, that:

- route-reported synthesis run state matched persisted DB state
- route-reported proposal content hash matched persisted DB state
- route-reported grounding envelope hash matched persisted DB state
- route-reported review envelope hash matched persisted DB state
- restart did not alter persisted admitted or quarantined state

Structural counts remained:

```json
{
  "memory_scopes": 0,
  "chat_bindings": 0,
  "decision_records": 0,
  "current_decisions": 0,
  "decision_stubs": 0,
  "movement_records": 0,
  "reference_index_snapshots": 0
}
```

This proves that `C0.6.3` wrote only interpretive governance state and left structural authority tables untouched.

## Load-Bearing Contract Results

The host proof established all of the following on both runtimes:

- packaged backend route surface available after restart
- CSRF enforcement on synthesis policy mutation
- subject-controlled synthesis policies persisted with stable hashes
- prohibited synthesis domains refused before generation
- bounded synthesis runs froze deterministic source manifests
- deterministic stub proposal entered the existing governed candidate flow
- referential grounding and semantic support remained distinct recorded layers
- semantically admissible proposal routed through existing risk and policy logic
- review workflow opened with exact expected reviewer identities
- source-manifest drift quarantined a proposal before review admission
- admitted and quarantined synthesis state survived host restart without drift
- continuity still reported:
  - `publicationState = NOT_PUBLISHED`
  - `authorityEffect = DESCRIPTIVE_ONLY`
- structural authority tables remained untouched

## Jurisdiction Boundary Reconfirmed

`C0.6.3` remained inside interpretive pre-publication jurisdiction.

Observed on both hosts:

- no continuity publication
- no continuity activation
- no structural-authority mutation
- no review auto-submission
- no subject-disposition automation

The final valid admitted state remained:

```text
candidateState: SEALED_FOR_REVIEW
groundingState: COMPLETE
reviewState: PENDING
publicationState: NOT_PUBLISHED
authorityEffect: DESCRIPTIVE_ONLY
```

`C0.6.3` therefore proved the live bounded path:

```text
subject synthesis permission
-> frozen source manifest
-> bounded deterministic generation
-> recorded grounding
-> governed review routing
-> stop before publication
```
