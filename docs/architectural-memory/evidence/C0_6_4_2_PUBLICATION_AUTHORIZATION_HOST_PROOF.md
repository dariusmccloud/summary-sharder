# C0.6.4-2 One-Time Publication Authorization Host Proof

## Status

Final status: `LIVE-PROVEN`

This report preserves the live host proof for `C0.6.4-2`.

It verifies that an approved interpretive revision can now move through governed publication authorization into a published Developmental Narrative Memory record without bypassing review, subject disposition, or CSRF boundaries:

```text
approved child revision
-> publication qualification
-> one-time publication authorization
-> atomic publication execution
-> portable DNM ledger append
-> disposable projection update
-> restart-stable readback
-> second execution refused
```

This slice still does not cover supersession, withdrawal, delta review, or publication UI.

## Proofed Implementation Commit

- `7f83193` - `feat: add c0.6.4 one-time dnm publication authorization`

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
powershell -ExecutionPolicy Bypass -File tools/server-plugin/prove-c0-6-4-2.ps1 -RestartHosts
```

Observed final summary:

- `ok = true`
- `c0_6_4CapabilitiesEqual = true`
- `noTokenStatusesEqual = true`
- `activePolicyHashesEqual = true`
- `revokedPolicyHashesEqual = true`
- `qualificationSemanticsEqual = true`
- `authorizationSemanticsEqual = true`
- `publishedRecordSemanticsEqual = true`
- `candidateSemanticsEqual = true`
- `persistedDbStateSemanticsEqual = true`
- `persistedDbStateStableAcrossRestart = true`
- `structuralCountsRemainZero = true`
- `secondExecuteRejectedEverywhere = true`

## Verified Route Surface

Observed on both hosts:

- `POST /api/plugins/summary-sharder-memory/interpretive/publication/policies`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/policies/:publicationPolicyId/revoke`
- `POST /api/plugins/summary-sharder-memory/interpretive/candidates/:interpretationRevisionId/publication-qualifications`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/authorizations`
- `POST /api/plugins/summary-sharder-memory/interpretive/publication/execute`
- `GET /api/plugins/summary-sharder-memory/interpretive/candidates/:interpretationRevisionId`

Verified behavior:

- active publication policy creation succeeds
- revoked policy remains listed with `policyState = REVOKED`
- publication qualification persists one eligible qualification
- publication authorization persists one authorized record
- publication execution creates one DNM publication record
- the child interpretation moves to:
  - `publicationState = PUBLISHED`
  - `authorityEffect = DEVELOPMENTAL_MEMORY`
- replayed readback after restart remains semantically identical
- second execution of the same authorization is refused with `409`

## CSRF Boundary

Observed on both hosts:

- policy create without token:
  - `403`
- policy revoke without token:
  - `403`
- publication authorization without token:
  - `403`
- publication execute without token:
  - `403`

This confirms governed publication writes remain protected by the same host CSRF surface as other write routes.

## Published Result

Observed final published child revision on both hosts:

- interpretation revision:
  - `interprev_c064_publication_v2`
- interpretation id:
  - `interp_c064_publication`
- continuity target:
  - `character:jeep.png`
- statement:
  - `Jeep evolved into the primary architectural authority over continuity and memory requirements within a shared architecture with Chris.`
- review state:
  - `COMPLETE`
- subject disposition state:
  - `GRANTED`
- publication state:
  - `PUBLISHED`
- authority effect:
  - `DEVELOPMENTAL_MEMORY`
- grounding binding mode:
  - `DERIVED_REVISION_GROUNDING`
- publication policy:
  - `dnm-publication-v1`

## Structural Separation Preserved

Observed on both hosts before and after restart:

- `memory_scopes = 0`
- `chat_bindings = 0`
- `decision_records = 0`
- `current_decisions = 0`

This proves the publication flow did not mutate structural authority tables and remained inside interpretive jurisdiction.

## Important Proof Notes

### 1. Lineage-bound hashes are host-local

The live proof initially appeared to show a Node/Bun parity defect because child candidate and publication hashes differed across hosts.

Root cause:

```text
createdFromDispositionId
and
subjectDispositionRecordId
```

are generated independently on each host and are part of the child-lineage and publication binding chain.

That means these host-local values legitimately change:

- child `proposalContentHash`
- child `reviewEnvelopeHash`
- derived grounding envelope hashes for the child
- qualification binding hashes
- published-record hashes that depend on those bindings

What must match across independently enacted hosts is the semantic publication result, policy binding, refusal behavior, and replay behavior. Those matched.

### 2. SQLite file hash changed across restart while authority state remained stable

Observed on both hosts:

- ledger hashes remained stable
- semantic database state remained stable
- the main SQLite file hash changed across restart

This is acceptable for this proof because the restart check is semantic, not byte-for-byte filesystem identity. The authoritative result is that replayed route state and inspected DB state remained equivalent after restart.

### 3. Proof harness defect corrected

The first harness revision queried a nonexistent `subject_disposition_id` column from `interpretation_subject_dispositions`.

Classification:

```text
PROOF_HARNESS_QUERY_DEFECT
```

Resolution:

- derive the subject-disposition record id from `interpretation_action_provenance`
- keep the proof focused on persisted semantics rather than nonexistent DB columns

Product impact:

- none

## What C0.6.4-2 Now Proves

`C0.6.4-2` is now live-proven to enforce:

- policy-gated publication qualification
- one-time publication authorization
- replayable publication ledger append
- published DNM projection creation
- restart-stable publication readback
- consumed-authorization refusal on re-execution
- CSRF protection on all publication writes
- continued separation from structural authority tables

## Boundary Still Not Crossed

This proof does not yet cover:

- publication UI
- supersession
- withdrawal
- delta review
- publication reauthorization after drift
- continuity conflict management across multiple published records

Those remain for later `C0.6.4` slices.
