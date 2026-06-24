# C0.5A Completion Report

## Status

Final status: `C0.5A COMPLETE`

`C0.5A` established and verified the isolated candidate rebuild boundary:

```text
discover corpus
→ freeze input manifest
→ create isolated candidate DB
→ compile tier-1 structured evidence
→ validate candidate
→ emit report
→ stop before promotion
```

This report closes the implementation phase and records the proof points that now govern the next reconstruction step.

## Implementation Commits

- `db9e1e1` - `feat: add c0.5a candidate rebuild orchestration`
- `303530c` - `feat: harden c0.5a self-contained plugin delivery`

## Phase Result

C0.5A is complete at the verified orchestration boundary.

Delivered:

- read-only corpus discovery
- frozen reconstruction input manifest
- isolated operational-shaped candidate database
- tier-1 structured Architectural shard compilation
- candidate validation and deterministic reporting
- candidate report retrieval
- candidate pinning and cleanup
- deterministic fresh-candidate comparison
- self-contained packaged backend plugin payload

Explicitly not delivered:

- raw-dialogue interpretation
- lorebook compilation
- model calls
- candidate promotion
- live authority adoption
- startup promotion fallback

## Cross-Runtime Canonical Candidate Proof

The same admitted structured corpus compiled under both runtimes produced the same canonical candidate hash:

- Node / SillyTavern: `sha256:1c35a0e77d71cd2ee06ad5a04907a37d6cdfcb5d61afa3593a137b75307fb015`
- Bun / SillyBunny: `sha256:1c35a0e77d71cd2ee06ad5a04907a37d6cdfcb5d61afa3593a137b75307fb015`

This proof was rerun after packaging the backend as a self-contained installed artifact and after restarting both hosts from that installed payload.

## Self-Contained Payload Proof

The `summary-sharder-memory` server plugin now resolves runtime imports entirely from the installed plugin payload:

- packaged root: `plugins/summary-sharder-memory/`
- packaged shared modules: `plugins/summary-sharder-memory/lib/core/...`
- packaged manifests:
  - `payload-manifest.json`
  - `lib/packaged-shared-manifest.json`

Verified constraints:

- no junctions or symlinks required
- no absolute development paths
- no `NODE_PATH` dependency
- no runtime dependency on the OneDrive checkout
- no `../../../core/...` repository-parent runtime import dependency

The isolated-install tests staged only the declared payload into a temporary plugin root and proved:

- Node staged payload load succeeds
- Bun staged payload load succeeds
- candidate init/run/report succeed
- relative runtime import resolution does not escape the staged plugin root

## Live-Authority Immutability Proof

Candidate lifecycle operations were verified to leave live authority unchanged on both hosts.

Verified unchanged across tokened candidate init/run/report:

- live operational DB
- live snapshot DB
- live state marker
- admitted source corpus files

The candidate routes write only under the isolated candidate area:

- `summary-sharder/candidates/architectural-memory.candidate.<run-id>.db`
- matching manifest and report sidecars

The final hardening fix in `A-2` also stopped read-only candidate access from rewriting `architectural-memory.state.json`. The state marker now remains stable unless its substantive content changes.

## No-Promotion Proof

`C0.5A` remains promotion-free by contract and by runtime surface.

Verified:

- capability reports `promotionAvailable: false`
- no promote helper was added to the runtime path
- `POST /rebuild/candidate/promote` returns `404`
- no startup adoption path exists
- no live-read fallback consults candidate state

## Deployment Activation Note

The frontend extension and the backend companion plugin have different activation behavior.

Frontend:

- copying into `public/scripts/extensions/third-party/summary-sharder`
- browser reload is sufficient for discovery

Backend:

- copying into `plugins/summary-sharder-memory`
- server restart is required for activation
- plugin routes mount during host startup plugin loading
- folder presence on disk is not the same as backend activation in the running process

Practical states the frontend should distinguish:

- `FRONTEND_ONLY`
- `BACKEND_FILES_PRESENT_RESTART_REQUIRED`
- `BACKEND_ACTIVE`
- `SERVER_PLUGINS_DISABLED`
- `BACKEND_VERSION_MISMATCH`

## Restart-Required Closeout Note

The self-contained payload proof required restarting both clone hosts after reinstall.

That restart was not incidental. It was the activation step required by the host startup-loaded server-plugin model. The final cross-runtime verification was rerun only after that restart so the proof reflects the actually installed payload rather than a previously loaded in-memory plugin instance.

## Final Boundary

`C0.5A` is closed.

This phase proved that the reconstruction chamber exists, is isolated, is deterministic across Node and Bun, travels as a self-contained install artifact, and leaves live authority untouched.

## Next Phase

The next phase is `C0.5B: Evidence Expansion and Reconstruction Interpretation`.

Next evidence tier:

- Tier 1: structured Architectural shards
  - complete in `C0.5A`
- Tier 2: explicit decisions, corrections, supersessions, and unresolved commitments in raw dialogue
  - next bounded reconstruction class

The `C0.5B` opening boundary should remain:

```text
discover Tier-2 evidence
→ extract candidate claims
→ reconcile against Tier 1
→ validate provenance and conflicts
→ emit expanded candidate report
→ stop before promotion
```

`C0.5B` should still write only to isolated candidate databases. Promotion remains a separate phase and a separate authorization decision.
