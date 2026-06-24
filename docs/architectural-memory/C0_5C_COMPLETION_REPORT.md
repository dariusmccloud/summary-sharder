# C0.5C Completion Report

## Status

Final status: `C0.5C COMPLETE`

`C0.5C` closed the Tier-1 structural collision problem exposed by `C0.5B`.

It now classifies same-version occurrence groups mechanically, derives canonical Tier-1 identities deterministically, evaluates version and supersession lifecycle structures independently, remaps Tier-2 associations onto canonical Tier-1 targets, replaces the old generic collision blocker path, and proves equivalent finalized candidate identity on Node and Bun.

## Implementation Commits

- `10ad53e46c8518032b8219f8ff1a73724315545e` - `feat: add c0.5c1 tier-1 collision classification`
- `6e3a7ecd0e63a7eafd467fb8bd600ce5533541cf` - `fix: stabilize c0.5c persisted candidate hashing`

## Phase Result

`C0.5C` is complete at the bounded deterministic collision-classification and candidate-validity-recovery boundary.

Delivered:

- deterministic same-version occurrence grouping by `memoryScopeId + decisionId + recordVersion`
- run-independent occurrence evidence-group identity
- derived canonical Tier-1 record identity instead of choosing one raw source member as the survivor
- no canonical authority row for incompatible same-version structured records
- separate occurrence, version-lifecycle, and supersession-lifecycle classification
- deterministic Tier-2 remapping after canonicalization
- precise structural blocker replacement for the former generic collision path
- persisted-state canonical candidate hashing shared by runtime reporting and proof verification
- explicit final versus non-final hash state
- cross-runtime proof that finalized persisted candidate state hashes identically on Node and Bun

Explicitly not delivered:

- raw-dialogue interpretation beyond the already bounded deterministic Tier-2 path
- lorebook or lower-tier evidence recovery
- model-assisted interpretation
- candidate promotion
- live authority adoption
- corpus mutation

## Collision Classification Scope

`C0.5C` remained mechanical only.

Occurrence classifications implemented:

- `NONE`
- `DUPLICATE_OCCURRENCE`
- `BRANCH_LINEAGE_DUPLICATE`
- `CORROBORATING_PROVENANCE`
- `GENERATED_ID_COLLISION`
- `UNRESOLVED_SEMANTIC_CONFLICT`
- `MALFORMED_STRUCTURED_RECORD`

Version lifecycle classifications implemented:

- `SINGLE_VERSION`
- `VALID_VERSION_CHAIN`
- `FORKED_VERSION_CHAIN`
- `INCOMPLETE_VERSION_CHAIN`

Supersession lifecycle classifications implemented:

- `NO_SUPERSESSION`
- `VALID_SUPERSESSION_CHAIN`
- `INCOMPLETE_SUPERSESSION_CHAIN`
- `CYCLIC_SUPERSESSION_CHAIN`
- `NOT_APPLICABLE`

No part of `C0.5C` introduced:

- model calls
- semantic freeform interpretation
- promotion behavior
- corpus repair or rewrite

## Canonical Identity and Blocker Recovery

`C0.5C-1` established the classifier itself.

Proven behaviors:

- same frozen evidence yields the same `collisionEvidenceGroupId`
- duplicate copied evidence collapses without duplicating authority
- malformed same-version members block canonicalization while preserving evidence
- valid version chains and valid supersession chains are evaluated independently from occurrence classification
- Tier-2 links remap to canonical Tier-1 identities after duplicate occurrence reconciliation
- historical reports without `C0.5C` arrays continue loading without reinterpretation

Most importantly, the former generic blocker path is now replaced.

The system no longer treats all structured same-version collisions as:

- `REBUILD_DECISION_COLLISION`

It now emits the precise structural blocker implied by the evidence, or proves that no blocker is required.

## Persisted-State Hash Correction

`C0.5C-2` corrected the remaining determinism/reporting defect.

Before the fix:

- persisted candidate DB state already matched across runtimes
- independently verified normalized persisted-state hashes already matched across runtimes
- route-reported `canonicalCandidateHash` did not match the persisted-state hash

Root cause:

- the report path was not reliably reflecting finalized persisted candidate state
- live host proof was additionally vulnerable to stale server processes when an on-disk payload update had not actually replaced the serving process

Implemented correction:

```text
open persisted candidate DB
-> governed table allowlist
-> governed ignored-column allowlist
-> deterministic row ordering
-> canonical scalar/JSON normalization
-> canonical byte stream
-> SHA-256
-> final report persistence
```

The same JavaScript implementation now supplies:

- `report.determinism.canonicalCandidateHash`
- direct persisted-state verification
- repeated-run determinism comparison
- Node/Bun proof verification

`determinism` now explicitly reports:

- `hashVersion`
- `basis`
- `canonicalCandidateHash`
- `canonicalHashFinal`
- `canonicalByteLength`
- `tableRowCounts`
- `tableHashes`

Non-final paths such as failed or source-invalidated runs report a non-final hash state instead of a misleading partial value.

## Equality Chain Proof

`C0.5C` required this equality chain:

```text
route-reported canonicalCandidateHash
=
verified persisted-state hash
=
Node hash
=
Bun hash
```

That chain now holds.

Verified synthetic proof scopes:

- `scope.c0.5c2.success`
- `scope.c0.5c2.conflict`
- `scope.c0.5c2.malformed`

For each scope, both runtimes now agree on:

- finalized persisted candidate hash
- occurrence classifications
- canonical Tier-1 record identities
- version lifecycle groups
- supersession components
- precise blocker sets
- candidate validity

## Live SillyTavern and SillyBunny Outcome

Live proof was rerun on both clone hosts after payload sync and verified process restart.

### SillyTavern

Observed:

- `403` on missing CSRF write
- `404` on promote route
- live authority unchanged
- staged corpus unchanged
- source-mutation invalidation remains fail-closed
- `scope.c0.st` rebuild status: `invalid`
- `scope.c0.st` blocker: `REBUILD_UNRESOLVED_SEMANTIC_CONFLICT`
- `scope.c0.st` generic collision blocker absent

### SillyBunny

Observed:

- `403` on missing CSRF write
- `404` on promote route
- live authority unchanged
- staged corpus unchanged
- source-mutation invalidation remains fail-closed
- `scope.c0.st` rebuild status: `invalid`
- `scope.c0.st` blocker: `REBUILD_UNRESOLVED_SEMANTIC_CONFLICT`
- `scope.c0.st` generic collision blocker absent

## What Changed on the Live Scope

The important live-scope proof is not that `scope.c0.st` became valid.

The important proof is that `C0.5C` replaced the generic structural alarm with the precise remaining blocker implied by the evidence.

Previous generic state:

- `REBUILD_DECISION_COLLISION`

Current precise state:

- `REBUILD_UNRESOLVED_SEMANTIC_CONFLICT`

That means the candidate is now invalid for an explicit explained reason, not because the system failed to understand what sort of collision it was seeing.

## Proof Tooling and Restart Guard

`C0.5C-2` also added proof tooling and corrected a deployment-proof weakness.

Added:

- `tools/server-plugin/stage-c0-5c2-proof-fixtures.mjs`
- `tools/server-plugin/prove-c0-5c2.ps1`

The restart proof path now verifies that:

- health returns after restart
- the listening process actually changes
- the proof is not accidentally exercising an older in-memory plugin image

That restart guard was necessary to make the live cross-runtime hash proof trustworthy.

## Regression Coverage

Focused regressions now cover:

- route-reported hash equals direct persisted-state hash
- close/reopen persisted DB preserves hash
- meaningful persisted candidate mutation changes the hash
- invalid-but-completed candidate reports a final persisted-state hash
- failed run reports no misleading final hash
- source-invalidated run reports no misleading final hash
- historical report compatibility remains intact

Packaging and staged-payload smoke still pass under:

- Node
- Bun

## No-Promotion and Live-Authority Proof

`C0.5C` preserved all reconstruction safety boundaries.

Verified:

- no promotion route
- no startup adoption
- no live-read fallback
- no live DB mutation
- no live snapshot mutation
- no live state-marker mutation
- no corpus mutation by reconstruction

Candidate rebuild remains:

- isolated
- deterministic
- promotion-free

## Final Boundary

`C0.5C` is closed.

This phase solved two distinct problems:

1. classify Tier-1 collisions so candidate validity reflects what the evidence actually means
2. ensure the finalized persisted candidate receives the same deterministic identity on both runtimes

`C0.5C` did not make every candidate valid.

It made invalidity precise, deterministic, and auditable.

## Next Phase

The next clean boundary is beyond collision classification.

`C0.5C` has already done the structural recovery work it was chartered to do:

- canonicalize deterministic Tier-1 structure
- classify lifecycle behavior
- remap Tier-2 associations
- stabilize finalized candidate identity across runtimes

Any next phase should build on that repaired structural substrate rather than reopening collision semantics.
