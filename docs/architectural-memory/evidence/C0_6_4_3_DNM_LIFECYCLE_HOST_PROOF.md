# C0.6.4-3 DNM Lifecycle Host Proof

## Status

Final status: `LIVE-PROVEN`

This report preserves the live host proof for `C0.6.4-3`.

It verifies that published Developmental Narrative Memory can now move through governed lifecycle transitions without losing lineage, current-active determinism, replayability, or CSRF protection:

```text
first publication
-> second publication for the same target remains DELTA_PENDING
-> explicit supersession promotes the replacement to ACTIVE
-> delta review records without mutating continuity
-> explicit withdrawal removes current-active continuity
-> restart-stable replay preserves the same lifecycle state
-> stale lifecycle reapplication is refused
```

This slice still does not cover publication UI, generalized delete or purge, or structural authority mutation.

## Proofed Implementation Revision

Live proof was executed against:

- base commit: `4788ed2` - `docs: define c0.6.4.3 dnm lifecycle governance contract`
- plus local uncommitted `C0.6.4-3` implementation changes in the working tree

The proof harness for this slice is:

- `tools/server-plugin/prove-c0-6-4-3.ps1`

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

## Proof Harness

Live proof command:

```text
powershell -ExecutionPolicy Bypass -File tools/server-plugin/prove-c0-6-4-3.ps1 -InstallPayload -RestartHosts
```

Observed final summary:

- `ok = true`
- `c0_6_4CapabilitiesEqual = true`
- `lifecycleCapabilitiesAdvertised = true`
- `noTokenStatusesEqual = true`
- `policyHashesEqual = true`
- `routeLifecycleSemanticsEqual = true`
- `persistedLifecycleSemanticsEqual = true`
- `routeMatchesPersistedBeforeRestart = true`
- `routeStableAcrossRestart = true`
- `persistedLifecycleStableAcrossRestart = true`
- `structuralCountsRemainZero = true`
- `staleActionsRejectedEverywhere = true`
- `withdrawalLeavesNoActiveRecord = true`

## Verified Route Surface

Observed on both hosts:

- `GET /api/plugins/summary-sharder-memory/interpretive/publication/records`
- `GET /api/plugins/summary-sharder-memory/interpretive/publication/targets/:continuityTargetId/current`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/supersede`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/withdraw`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/delta-reviews`

Verified behavior:

- first published DNM record begins as `ACTIVE`
- second published DNM record for the same continuity target begins as `DELTA_PENDING`
- explicit supersession changes:
  - prior record -> `SUPERSEDED`
  - replacement record -> `ACTIVE`
- delta review records:
  - `deltaReviewState = PENDING`
  - active continuity remains unchanged
- explicit withdrawal changes:
  - active record -> `WITHDRAWN`
  - current active record -> `null`
- stale reapplication is refused:
  - second supersede -> `409` / `ARCH_DNM_SUPERSESSION_STALE`
  - second withdrawal -> `409` / `ARCH_DNM_WITHDRAWAL_STALE`
- route readback after restart remains semantically identical

## CSRF Boundary

Observed on both hosts:

- supersede without token:
  - `403`
- delta review without token:
  - `403`
- withdraw without token:
  - `403`

This confirms the new lifecycle write routes remain protected by the host CSRF boundary.

## Observed Lifecycle Result

Observed on both hosts:

- first interpretation revision:
  - `interprev_c0643_v1`
- second interpretation revision:
  - `interprev_c0643_v2`

Lifecycle sequence:

```text
interprev_c0643_v1
-> ACTIVE
-> SUPERSEDED

interprev_c0643_v2
-> DELTA_PENDING
-> ACTIVE
-> WITHDRAWN
```

Observed lifecycle counts before restart:

- `dnm_publication_records = 2`
- `dnm_publication_lifecycle_metadata = 2`
- `dnm_delta_reviews = 1`

Observed final continuity state:

- current active record:
  - `null`
- second record delta review state:
  - `PENDING`

## Structural Separation Preserved

Observed on both hosts before and after restart:

- `memory_scopes = 0`
- `chat_bindings = 0`
- `decision_records = 0`
- `current_decisions = 0`

This proves DNM lifecycle events remained inside interpretive continuity jurisdiction and did not mutate structural authority tables.

## Important Proof Notes

### 1. Host-local lifecycle ids are expected

Cross-host raw identifiers differ legitimately:

- `dnmRecordId`
- `deltaReviewId`

These are generated independently on each host.

Cross-host comparison for this proof therefore keys lifecycle semantics by:

- `sourceInterpretationRevisionId`

What must match across hosts is:

- lifecycle state sequence
- current-active resolution
- refusal behavior
- CSRF behavior
- replay semantics

Those matched.

### 2. Route-to-projection mismatch was a harness normalization issue, not a product defect

The first harness revision initially reported a route-versus-persisted mismatch.

Root cause:

```text
route projection exposes detailed lifecycle reason/commentary under lifecycleMetadata
while the DB probe flattened those fields directly
```

Classification:

```text
PROOF_HARNESS_NORMALIZATION_DEFECT
```

Resolution:

- normalize both route and persisted views into the same semantic lifecycle shape before comparing them

Product impact:

- none

### 3. Withdrawal preserves prior delta-review evidence

One direct test failure during implementation showed that withdrawal was clearing `deltaReviewState`.

That behavior was corrected before host proof.

The final live proof confirms:

```text
delta review remains historical lifecycle evidence
even after the affected active record is withdrawn
```

## What C0.6.4-3 Now Proves

`C0.6.4-3` is now live-proven to enforce:

- deterministic current-active DNM resolution
- explicit supersession lineage
- explicit withdrawal lineage
- delta review recording without silent continuity mutation
- restart-stable replay of complete DNM lifecycle state
- stale lifecycle refusal after state change
- CSRF protection on lifecycle write routes
- continued separation from structural authority tables

## Boundary Still Not Crossed

This proof does not yet cover:

- publication UI
- subject-facing lifecycle controls
- generalized delete or purge operations
- structural authority mutation
- later delta-resolution publication flows
- DNM lifecycle bulk operations
