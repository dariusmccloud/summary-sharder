# C0.75-3 Promotion and Recovery Host Proof

## Status

Final status: `VERIFIED`

This report preserves the live host proof for `C0.75-3`.

It verifies that the committed structural-authority promotion path works on both safe clone hosts as a packaged plugin payload, survives host restart, enforces evidence-bound manual authorization, preserves unrelated scopes during scope-local promotion, and recovers deterministically from interrupted transaction states.

This proof does not publish interpretive memory.

`C0.75` remains strictly structural-authority jurisdiction.

## Proof Tooling Commit

- `80c9b8d0d21ca39626b1ea3898bf4d130606b8d1` - `test: add c0.75 cross-host promotion proof`

Proof tooling:

- `tools/server-plugin/prove-c0-75-3.ps1`
- `tools/server-plugin/stage-c0-75-proof-fixtures.mjs`

## Implementation Commits Under Proof

- `51ec8a38ba892b2673b78e6c919d8ce8f801daf7` - `feat: add c0.75.1 candidate qualification evidence`
- `7159343ba69375af3bbfea3591bffa7e2caacee6` - `feat: add c0.75.2 scoped promotion transition`
- `f7de0e31e9ec30ec5d56b554019b375340403878` - `feat: add c0.75.3 promotion recovery checks`

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

## Commands Executed

Regression coverage from the committed revision:

```text
node --test tools/server-plugin/summary-sharder-memory/promotion.test.mjs
node --test tools/server-plugin/summary-sharder-memory/index.test.mjs tools/server-plugin/summary-sharder-memory/rebuild.test.mjs tools/server-plugin/summary-sharder-memory/core.test.mjs tools/server-plugin/summary-sharder-memory/package.test.mjs
```

Results:

- promotion suite: `6 passed`, `0 failed`
- supporting suites: `41 passed`, `0 failed`

Live host proof from the committed revision:

```text
powershell -ExecutionPolicy Bypass -File tools/server-plugin/prove-c0-75-3.ps1 -InstallPayload -RestartHosts
```

## Fixture Scope Set

The proof staged these scope-local corpora on both hosts:

- `scope.c0.75.seed`
- `scope.c0.75.target`
- `scope.c0.75.stale`
- `scope.c0.75.recovery.prepared`
- `scope.c0.75.recovery.valid`
- `scope.c0.75.recovery.invalid`

All proof chats were written beneath:

```text
data/default-user/chats/Promotion Proof/
```

## Capability Posture Observed on Both Hosts

The live capability payload exposed the intended split:

### `c0_75_1`

- `candidateQualification: true`
- `boundPromotionEvidence: true`
- `candidateLiveDiff: true`
- `rollbackPlanningEvidence: true`
- `promotionAvailable: false`
- `liveAuthorityMutation: false`
- `readOnlyOnly: true`

### `c0_75_2`

- `manualAuthorization: true`
- `atomicGenerationTransition: true`
- `globalTransitionLock: true`
- `fullGenerationMerge: true`
- `promotionAvailable: true`
- `automaticPromotion: false`
- `liveAuthorityMutation: true`

This matters:

- governed manual structural promotion is available
- automatic promotion remains unavailable
- interpretive publication remains outside `C0.75` jurisdiction

## Load-Bearing Results

The host proof established all of the following on both runtimes:

- packaged backend installation under the host plugin root
- restart-required activation on both hosts
- first live generation publication from absent live authority
- second-scope promotion without erasing the first scope
- one-time authorization enforcement
- stale authorization refusal after live drift
- committed promotion surviving restart
- deterministic recovery from `PREPARED`
- deterministic recovery from `VERIFYING`
- rollback restoring a valid prior live generation
- Node/Bun parity for candidate, promoted, and recovery hashes
- corpus files unchanged by promotion execution and recovery
- candidate-only reconstruction tables excluded from live authority
- CSRF enforcement on the live promotion surface

## Exact Proof Outcomes

### Route and authorization behavior

Observed identically on both hosts:

- missing-token promotion authorization attempt: `403`
- second execution of the same authorization: `ARCH_PROMOTION_NONCE_CONSUMED`
- execution after authorized-live drift: `ARCH_PROMOTION_LIVE_STATE_DRIFT`

### Recovery behavior

Observed identically on both hosts:

- forced `PREPARED` recovery result: `FAILED`
- forced valid `VERIFYING` recovery result: `COMMITTED`
- forced invalid `VERIFYING` recovery result: `ROLLED_BACK`

### Restart behavior

Observed identically on both hosts after committed promotion:

- host process replaced on restart: `true`
- live generation remained stable across restart: `true`
- live authority hash remained stable across restart: `true`
- committed seed scope remained stable across restart: `true`
- committed target scope remained stable across restart: `true`

### Corpus and scope-preservation behavior

Observed identically on both hosts:

- staged corpus unchanged by proof: `true`
- target scope matched the promoted candidate exactly: `true`
- first-scope preservation proved by:
  - `parentNonTargetAggregateHash == stagedNonTargetAggregateHash`
  - value: `sha256:acf2a4cc7d6632f3bf6edbf6cb0203ad527e9e08b1ebfa707c95d60ed37ad806`

## Cross-Runtime Hash Parity

The following values matched exactly between Node and Bun:

### Candidate hashes

- seed candidate hash:
  - `sha256:71667de26abc431920efc2ad9800997d0572912717253eeaaab67406d17d79e3`
- target candidate hash:
  - `sha256:1f4e2eb04f11ed0b2a06da542a3d73d075d85f72241ded8525f185595dd8150e`

### Promoted full-generation hashes

- seed full-authority hash:
  - `sha256:acf2a4cc7d6632f3bf6edbf6cb0203ad527e9e08b1ebfa707c95d60ed37ad806`
- target full-authority hash:
  - `sha256:6eda592eaa88ce02f298043300010eb8f56e92f0f1906d14febeb499f574673d`
- valid-recovery committed full-authority hash:
  - `sha256:f93632627ca702d47a95e2f6ed116bd8054e2e7af0e66d7a077aad06b858a35e`
- invalid-recovery staged full-authority hash before rollback:
  - `sha256:4bf2168bb85ececb682129e3054b71673bb8aa5cbc85063361f1b8396b6f7e80`

All comparison booleans emitted by the proof harness were `true`:

- `seedCandidateHashesEqual`
- `targetCandidateHashesEqual`
- `seedFullAuthorityHashesEqual`
- `targetFullAuthorityHashesEqual`
- `preparedFullAuthorityHashesEqual`
- `validFullAuthorityHashesEqual`
- `invalidFullAuthorityHashesEqual`
- `preparedRecoveryStatesEqual`
- `validRecoveryStatesEqual`
- `invalidRecoveryStatesEqual`
- `staleFailureCodesEqual`

## Live Authority Table Surface

Observed live table set on both hosts after proof:

- `chat_bindings`
- `current_decisions`
- `decision_records`
- `decision_stubs`
- `manifest`
- `memory_scopes`
- `migration_audit`
- `movement_records`
- `reference_index_snapshots`

No `reconstruction_*` table was present in live authority.

## BOM Harness Incident

This incident belongs in the permanent evidence set.

Classification:

```text
PROOF_HARNESS_ENCODING_DEFECT
```

Product impact:

```text
none
```

Cause:

```text
UTF-8 BOM introduced into a rewritten architectural-memory.state.json marker by the proof harness.
```

Observed runtime behavior:

- the plugin treated the malformed marker as unreadable
- the runtime did not attempt to interpret it generously
- the runtime failed closed and rebuilt only the minimal base marker shape

Resolution:

```text
BOM-free UTF-8 emission in the proof harness
```

Interpretation:

- the defect was in the harness, not the product code
- the runtime’s refusal to accept malformed transition state was correct

## Final Clone State Clarification

The proof intentionally ended on a rollback exercise.

This is not an incomplete deployment state.

It is a valid terminal transaction result.

Both hosts ended with:

- `promotionJournal.lastState = ROLLED_BACK`
- a resolvable authoritative generation pointer
- a verified surviving live generation

Final observed live hashes:

- SillyTavern:
  - generation: `livegen_7f4c6bd281884eb494432648872cbc5e`
  - live authority hash: `sha256:a7b4156a7c592f71f5fc4a3ba28b7cfdce64a1ef8b71953855e42b0ca658f0be`
- SillyBunny:
  - generation: `livegen_475900bdae9947208a2facedc814b48b`
  - live authority hash: `sha256:a7b4156a7c592f71f5fc4a3ba28b7cfdce64a1ef8b71953855e42b0ca658f0be`

The matching final full-authority hash is therefore:

```text
sha256:a7b4156a7c592f71f5fc4a3ba28b7cfdce64a1ef8b71953855e42b0ca658f0be
```

## Verdict

`C0.75-3` is verified.

The structural-authority transition path is now proven to be:

- evidence-bound
- scope-local within a full-generation merge
- globally serialized
- atomically published
- restart recoverable
- rollback recoverable
- cross-runtime consistent
- corpus-preserving

This closes the proof boundary for `C0.75`.
