# C0.6.3-7 Immutable Revision UI Host Proof

## Status

Final status: `LIVE-PROVEN`

This report preserves the live host proof for `C0.6.3-7`.

It verifies that the governed interpretive review surface can now enact the full immutable child-revision path:

```text
pending parent candidate
-> memory subject APPROVE_WITH_EDIT
-> immutable child revision created
-> participant review moves to the child
-> final subject disposition binds to the child
-> parent remains immutable history
-> publication remains unavailable
```

This slice still stops before continuity publication and still does not mutate structural authority.

## Proofed Implementation Commit

- `04a89bd` - `feat: add c0.6.3 immutable revision review flow`

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

- `46` passed
- `0` failed

Additional syntax check:

- `node --check ui/modals/management/interpretive-review-modal.js`

## Live Route Surface Verified

Observed on both hosts:

- `GET /api/plugins/summary-sharder-memory/interpretive/candidates/:interpretationRevisionId`
- `GET /api/plugins/summary-sharder-memory/interpretive/reviews`
- `POST /api/plugins/summary-sharder-memory/interpretive/reviews/:reviewRequestId/dispositions`
- `POST /api/plugins/summary-sharder-memory/interpretive/candidates/:interpretationRevisionId/subject-disposition`

Verified behavior:

- `APPROVE_WITH_EDIT` creates a child revision instead of mutating the parent
- the parent review request records `APPROVE_WITH_EDIT`
- sibling pending parent requests are marked `SUPERSEDED_BY_CHILD`
- the child carries forward only the remaining required review requests
- final subject disposition on the parent is refused once a child exists
- final subject disposition on the child persists correctly

## Cross-Host Route Proof

Installed-runtime route proof was executed on both hosts after deployment of `04a89bd`.

### SillyTavern route proof

- parent revision:
  - `interprev_c063_ui_st_v1`
- child revision:
  - `interprev_c063_ui_st_v2`

Observed final child state:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Observed child provenance:

- disposition owner:
  - `character:jeep.png`
- recorded by:
  - `user:Chris`
- submission mode:
  - `TRUSTED_DELEGATE`
- delegation policy:
  - `jeep-chris-continuity-delegation`

### SillyBunny route proof

- parent revision:
  - `interprev_c063_ui_sb_v1`
- child revision:
  - `interprev_c063_ui_sb_v2`

Observed final child state:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Observed child provenance:

- disposition owner:
  - `character:jeep.png`
- recorded by:
  - `user:Chris`
- submission mode:
  - `TRUSTED_DELEGATE`
- delegation policy:
  - `jeep-chris-continuity-delegation`

## Live UI Smoke

Manual UI smoke was completed on the SillyTavern safe clone.

Manual smoke revisions:

- parent revision:
  - `interprev_c063_ui_manual_st_20260626201936_v1`
- child revision:
  - `interprev_9cb4ca2d4f284feb8f7142a8ba168f71`

Observed UI path:

```text
open interpretive review queue
-> select pending MEMORY_SUBJECT request
-> choose Review Disposition = Approve With Edit
-> submit narrower child statement
-> open child revision
-> submit RELATIONAL_PARTICIPANT approval on child
-> record final GRANTED subject disposition on child
-> verify no publication control and no continuity activation
```

Observed final child state from live host readback:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Observed final child provenance from live host readback:

- disposition owner:
  - `character:jeep.png`
- recorded by:
  - `user:Chris`
- submission mode:
  - `TRUSTED_DELEGATE`
- delegation policy:
  - `jeep-chris-continuity-delegation`

## UI Defects Exposed And Corrected

The first live UI smoke exposed two real surface defects. Both were corrected before the successful rerun.

### 1. Queue filter ambiguity

Observed defect:

```text
the upper-right queue status filter could be mistaken for the review action selector,
causing the operator to switch the queue to prior APPROVE_WITH_EDIT requests
instead of changing the active review disposition
```

Correction:

- `Review Status` relabeled to `Queue Filter`
- queue filter options relabeled as request-list filters
- inline hint added:
  - `Filters the request list only. Record actions from the review card.`
- review form field relabeled to `Review Disposition`

### 2. Delegation-policy selection ambiguity

Observed defect:

```text
trusted delegation required a delegationPolicyId,
but the only matching policy still presented a blank placeholder first
and displayed [OPTIONAL] in a way that looked like the policy choice itself was optional
```

Correction:

- when exactly one matching policy exists, it is auto-selected
- policy option text now renders `Evidence OPTIONAL` or `Evidence REQUIRED`
- trusted-delegation hint now states that the policy itself is required

### 3. Recorded-by field posture

Observed issue:

```text
Recorded By was editable even though the effective recorder is the active persona
for the live smoke path
```

Correction:

- `Recorded By` is now rendered read-only in the governed review modal

## Load-Bearing Contract Results

The live proof established all of the following:

- `APPROVE_WITH_EDIT` does not rewrite the parent revision in place
- the parent revision remains durable history
- the child revision receives a new revision identity and new proposal hash
- child lineage remains visible through:
  - `Parent Revision`
  - `Created From Disposition`
- the memory-subject review that created the child is not re-requested on the child
- remaining participant review moves to the child
- parent subject disposition is refused once a child exists
- final subject disposition binds only to the latest child revision
- owner and operator provenance remain distinct on the final child
- publication remains unavailable
- structural authority remains untouched

## Boundary Preserved

`C0.6.3-7` remained within the intended bounded jurisdiction:

- no continuity publication
- no continuity activation
- no structural promotion
- no structural-authority mutation
- no model authority over final governance state

This slice makes immutable correction operable.

It does not publish continuity.
