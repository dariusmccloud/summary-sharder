# C0.6.2 Governed Review and Subject Disposition Host Proof

## Status

Final status: `VERIFIED`

This report preserves the live host proof for `C0.6.2`.

It verifies that the committed governed-review path works on both safe clone hosts as a packaged plugin payload, enforces exact reviewer identity, enforces `reviewEnvelopeHash` binding, creates immutable child revisions for subject edits, records final subject disposition durably, and still stops before continuity publication.

This proof does not publish continuity and does not mutate structural authority.

## Proofed Implementation Commit

- `ec344675674c08d74974f700201eff1ac1de151e` - `feat: add c0.6.2 governed review dispositions`

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

- `59` passed
- `0` failed

## Capability Posture Observed on Both Hosts

Observed live capability block:

```json
{
  "reviewerDispositionSubmission": true,
  "immutableEditRevision": true,
  "subjectDispositionRecording": true,
  "continuityPublicationAvailable": false,
  "structuralAuthorityMutation": false,
  "modelInterpretationAvailable": false
}
```

## Live Route Surface Verified

Observed on both hosts:

- `POST /interpretive/reviews/:reviewRequestId/dispositions`
- `POST /interpretive/candidates/:interpretationRevisionId/subject-disposition`
- `POST /interpretive/candidates/:interpretationRevisionId/revisions`
- `GET /interpretive/reviews`

## Governed Workflow Proved

The live proof executed the bounded constitutional flow:

```text
pending candidate
-> participant APPROVE
-> memory subject APPROVE_WITH_EDIT
-> immutable child revision created
-> final subject disposition GRANTED
-> publication remains NOT_PUBLISHED
```

Shared characteristics of the proof input:

- interpretation type: `ROLE_EVOLUTION`
- assertion domains:
  - `ROLE`
  - `AUTHORITY`
  - `RELATIONSHIP`
- `sharedRelationshipAsserted = true`
- `personalMeaningAsserted = true`
- participants:
  - `character:jeep.png`
  - `user:Chris`
- structural grounding record:
  - `decision:interpretive-memory-sovereignty`
- occurrence grounding record:
  - `chat_c062_live`
  - `msg_c062live00000000000000000000001`

## Exact Host Outcomes

### SillyTavern

Live proof IDs:

- interpretation:
  - `interp_c062_live_stb`
- parent revision:
  - `interprev_c062_live_stb_v1`
- child revision:
  - `interprev_c062_live_stb_v2`

Observed behavior:

- missing-token disposition attempt returned `403`
- participant disposition: `APPROVE`
- subject disposition: `APPROVE_WITH_EDIT`
- child revision created with `revisionReason = SUBJECT_EDIT`
- final subject disposition: `GRANTED`

Final parent state:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`
- `childRevisionIds = [interprev_c062_live_stb_v2]`

Final child state:

- `parentRevisionId = interprev_c062_live_stb_v1`
- `revisionReason = SUBJECT_EDIT`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Review summary:

- request count: `2`
- dispositions:
  - `APPROVE_WITH_EDIT`
  - `APPROVE`
- statuses:
  - `APPROVE_WITH_EDIT`
  - `APPROVED`

### SillyBunny

Live proof IDs:

- interpretation:
  - `interp_c062_live_sbb`
- parent revision:
  - `interprev_c062_live_sbb_v1`
- child revision:
  - `interprev_c062_live_sbb_v2`

Observed behavior:

- missing-token disposition attempt returned `403`
- participant disposition: `APPROVE`
- subject disposition: `APPROVE_WITH_EDIT`
- child revision created with `revisionReason = SUBJECT_EDIT`
- final subject disposition: `GRANTED`

Final parent state:

- `reviewState = COMPLETE`
- `subjectDispositionState = GRANTED`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`
- `childRevisionIds = [interprev_c062_live_sbb_v2]`

Final child state:

- `parentRevisionId = interprev_c062_live_sbb_v1`
- `revisionReason = SUBJECT_EDIT`
- `publicationState = NOT_PUBLISHED`
- `authorityEffect = DESCRIPTIVE_ONLY`

Review summary:

- request count: `2`
- dispositions:
  - `APPROVE`
  - `APPROVE_WITH_EDIT`
- statuses:
  - `APPROVED`
  - `APPROVE_WITH_EDIT`

## Load-Bearing Contract Results

The host proof established all of the following on both runtimes:

- packaged backend route surface available after restart
- CSRF enforcement on governed review submission
- exact-reviewer submission accepted for named reviewer only
- stale no-token request refused
- participant approval did not publish continuity
- subject `APPROVE_WITH_EDIT` created an immutable child revision
- parent revision remained the reviewed historical object
- final subject `GRANTED` disposition remained durable
- final state still reported:
  - `publicationState = NOT_PUBLISHED`
  - `authorityEffect = DESCRIPTIVE_ONLY`

## Deployment Incident Preserved

One deployment incident belongs in the permanent evidence set.

Classification:

```text
STALE_INSTALLED_PLUGIN_PAYLOAD
```

Observed symptom:

- SillyBunny initially served the older interpretive route and capability surface after deployment

Cause:

- stale installed plugin payload remained under:
  - `D:\AI\Projects\SillyBunny\plugins\summary-sharder-memory`

Resolution:

```text
remove installed plugin directory
-> reinstall packaged payload
-> restart host
-> re-verify capabilities and governed review routes
```

Product impact:

- none after reinstall

Interpretation:

- repo implementation was correct
- the host proof exposed an installation-state mismatch, not a contract defect

## Jurisdiction Boundary Reconfirmed

`C0.6.2` remained inside interpretive pre-publication jurisdiction.

Observed on both hosts:

- no continuity publication route
- no continuity activation side effect
- no structural-authority mutation
- no promotion-path reuse

The final valid closeout state remained:

```text
reviewState: COMPLETE
subjectDispositionState: GRANTED
publicationState: NOT_PUBLISHED
authorityEffect: DESCRIPTIVE_ONLY
```

## Verdict

`C0.6.2` is host-verified.

The governed interpretive completion path is now proven to be:

- reviewer-bound
- envelope-bound
- immutable under edit
- subject-final for continuity disposition
- durable across Node and Bun hosts
- still separate from continuity publication
- still separate from structural authority
