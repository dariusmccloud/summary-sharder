# C0.6.3-6 Governed Review UI Host Proof

## Status

Final status: `LIVE-PROVEN`

This report preserves the live host proof for `C0.6.3-6`.

It verifies that the interpretive review system is no longer backend-only theory. The governed review and subject-disposition flow was operated through the application UI on both safe clone hosts, with the intended authority split preserved:

```text
Chris decides for Chris
Jeep owns Jeep's disposition
Chris records Jeep's decision under trusted delegation
the system preserves both owner and operator
GRANTED != PUBLISHED
```

This slice still stops before continuity publication and still does not mutate structural authority.

## Proofed Implementation Commit

- `c97184f` - `feat: add governed interpretive review submission UI`

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
node --test tools/server-plugin/summary-sharder-memory/interpretive.test.mjs tools/server-plugin/summary-sharder-memory/index.test.mjs tools/server-plugin/summary-sharder-memory/package.test.mjs core/summarization/architectural-authority-server-api.test.mjs ui/modals/management/interpretive-review-form-state.test.mjs
```

Observed result:

- `44` passed
- `0` failed

Additional syntax checks:

- `node --check ui/modals/management/interpretive-review-modal.js`
- `node --check tools/server-plugin/summary-sharder-memory/interpretive.js`

## Live Route Surface Verified

Observed on both hosts:

- `GET /api/plugins/summary-sharder-memory/interpretive/reviews`
- `POST /api/plugins/summary-sharder-memory/interpretive/reviews/:reviewRequestId/dispositions`
- `POST /api/plugins/summary-sharder-memory/interpretive/candidates/:interpretationRevisionId/subject-disposition`

Verified behavior:

- CSRF token missing on governed write routes returns `403`
- review queue and detail state load from backend projections
- UI write controls submit only to governed backend routes
- UI does not expose continuity publication or activation controls

## Live UI Surface Verified

Observed entry points:

- FAB Advanced
  - `Interp. Review`
- Settings or action-bar review entry
  - opens the same interpretive review surface

Observed UI properties on both hosts:

- pending requests render in queue form
- candidate detail loads exact revision data
- risk class renders as `HIGH` for the sovereignty candidate
- grounding and scope warnings render, including:
  - `CONTRARY_EVIDENCE_PRESENT`
  - `TOO_BROAD`
- policy binding renders
- reviewer obligations render for:
  - `Jeep`
  - `Chris`
- closing and reopening returns to the same backend state
- no `Publish`
- no `Activate continuity`
- no structural promotion control

## Governing Workflow Proved

The live proof executed the bounded constitutional flow:

```text
pending candidate
-> Chris participant approval
-> Jeep review recorded under trusted delegation
-> Jeep final GRANTED disposition recorded under trusted delegation
-> queue completes
-> publication remains NOT_PUBLISHED
```

Proof candidate:

- interpretation revision:
  - `interprev_c063_live_generated_v1`
- memory scope:
  - `scope_c063_live`
- memory subject:
  - `character:jeep.png`
- interpretation type:
  - `ROLE_EVOLUTION`
- delegation policy:
  - `jeep-chris-continuity-delegation`

Delegation policy binding used in live proof:

- principal:
  - `character:jeep.png`
- delegate:
  - `user:Chris`
- allowed actions:
  - `REVIEW_DISPOSITION`
  - `SUBJECT_DISPOSITION`
  - `SUBJECT_REVISION`
- continuity target:
  - `character:jeep.png`
- evidence requirement:
  - `OPTIONAL`

## Exact Host Outcomes

### SillyTavern

Observed live UI behavior:

- Chris submitted direct participant approval
- Chris submitted Jeep's review as `TRUSTED_DELEGATE`
- Chris submitted Jeep's final subject disposition as `TRUSTED_DELEGATE`
- queue completed in the UI

Observed route symptom immediately after the original UI submission:

- review and subject state updated correctly
- `provenance` returned as `null` in the live projection

This defect is preserved separately below because it materially changed the slice closeout.

### SillyBunny

Observed live UI behavior:

- Chris submitted direct participant approval
- Chris submitted Jeep's review as `TRUSTED_DELEGATE`
- Chris submitted Jeep's final subject disposition as `TRUSTED_DELEGATE`
- queue completed in the UI

Observed final route state after the fix:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Observed persisted provenance in the live projection:

- participant review provenance:
  - `submissionMode = DIRECT_REVIEWER_ACTION`
  - `dispositionOwnerId = user:Chris`
  - `submittedByActorId = user:Chris`
- subject review provenance:
  - `submissionMode = TRUSTED_DELEGATE`
  - `dispositionOwnerId = character:jeep.png`
  - `submittedByActorId = user:Chris`
  - `delegationPolicyId = jeep-chris-continuity-delegation`
- final subject disposition provenance:
  - `submissionMode = TRUSTED_DELEGATE`
  - `dispositionOwnerId = character:jeep.png`
  - `submittedByActorId = user:Chris`
  - `delegationPolicyId = jeep-chris-continuity-delegation`

## Load-Bearing Contract Results

The host proof established all of the following:

- direct participant review is operable through the application UI
- trusted delegated subject review is operable through the application UI
- trusted delegated final subject disposition is operable through the application UI
- exact delegation policy binding is preserved
- action provenance persists owner and operator distinctly
- queue completion occurs without continuity publication
- final state still reports:
  - `publicationState = NOT_PUBLISHED`
  - `authorityEffect = DESCRIPTIVE_ONLY`

## ST Integrity Defect Preserved

One live defect belongs in the permanent evidence set because the UI exposed a backend integrity gap that route-level tests had not previously caught.

Classification:

```text
PROJECTION_PROVENANCE_OMISSION
```

Observed defect:

```text
review and subject state updated,
but action provenance was absent from the projection
```

Observed symptom:

```text
provenance: null after UI submission
```

Root cause:

```text
direct write paths appended provenance-bearing ledger events
but did not persist provenance rows into the live projection transaction
```

Correction:

```text
persist owner, actor, mode, delegation binding,
and subject evidence references into the live projection
for both review-disposition and subject-disposition writes
```

Implemented correction:

- `persistActionProvenanceRow(adapter, reviewDisposition.provenance)`
- `persistActionProvenanceRow(adapter, nextSubjectDisposition.provenance)`

## ST Ledger vs Projection Distinction

This distinction was verified explicitly.

The SillyTavern defect was projection loss, not authority-record loss.

Observed in the original ST ledger:

- `REVIEW_DISPOSITION_RECORDED` events already contained full `payload.provenance`
- `SUBJECT_DISPOSITION_RECORDED` events already contained full `payload.provenance`

Non-destructive replay proof:

```text
clone ST summary-sharder storage into a temporary user root
-> replay interpretive ledger into the cloned operational DB
-> reload interprev_c063_live_generated_v1
-> confirm provenance reappears for both review dispositions and the final subject disposition
```

Observed replay result:

- participant review provenance recovered
- subject review provenance recovered
- final subject disposition provenance recovered

Therefore:

- the original ST authority ledger remained complete
- the missing provenance was a projection omission
- no historical action provenance had to be inferred or fabricated

Operational consequence:

- the already-mutated ST projection rows created before the fix remain provenance-incomplete until projection replay or rebuild
- the fresh SB candidate serves as the clean post-fix live proof

## Jurisdiction Boundary Still Intact

This live proof still stops short of publication.

Not implemented or exposed in this slice:

- continuity publication
- continuity activation
- structural authority mutation
- subject-consent inference from prose
- automatic interpretation publication

The enforced boundary remained:

```text
GRANTED
!=
PUBLISHED
```

## Verdict

`C0.6.3-6` is implemented and live-proven at the correct boundary.

It proved:

- governed interpretive review is operable through the product UI
- delegated subject action preserves owner and operator distinctly
- action provenance survives end-to-end after the fix
- the review system still stops before publication

The next slice is not broader publication.

The next slice is the immutable edit path:

```text
C0.6.3-7
Governed Approve-With-Edit Revision Flow
```
