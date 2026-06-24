# C0.25 Completion Report

## Status

Phase `C0.25` is complete at the implementation boundary.

This report captures the committed slice history, the live host findings that materially changed the design, and the remaining boundary before `C0.5`.

C0.25 implementation head:

- `eee9ed1` - `feat: add c0.25d shard integrity and load stabilization`

C0.25 closeout documentation head:

- `0e44bd8` - `docs: add c0.25 completion report`

## Commit Series

Implemented in this sequence:

- `7d34e48` - `feat: add c0.25a identity readiness scanner`
- `b9ec99d` - `fix: allow c0.25a group chat scan locators`
- `8cd833a` - `feat: adopt c0.25b message identities`
- `f8bf513` - `feat: add c0.25c message archive controls`
- `eee9ed1` - `feat: add c0.25d shard integrity and load stabilization`
- `0e44bd8` - `docs: add c0.25 completion report`

## Scope Completed

C0.25 delivered:

- read-only identity readiness scanning
- immutable per-message identity assignment
- legacy adoption and partial-identity healing
- branch/import-aware chat identity handling
- swipe-aware revision hashing
- deletion tombstones
- reversible archive and restore support
- archive-aware prompt exclusion handling
- identity-backed shard coverage manifests
- shard health validation and diagnostic surfacing
- compact normalized shard-integrity persistence
- lazy derived integrity summaries
- load profiling surfaces and evidence capture
- passive-load persistence suppression for identity/integrity reconciliation

C0.25 did not deliver:

- semantic Architectural reconstruction
- repair-reviewed automation
- archive movement
- vector retrieval
- cross-host live synchronization

## Governing Runtime Findings

These findings materially shaped the implementation:

1. ST/SB displayed message numbers are positional locators, not durable identity.
2. Ordinary host chat saves are blind full-file rewrites, so out-of-band receipt patching is not safe authority storage.
3. Persisted derived metadata materially expands the corpus and triggers additional normalization, validation, and save work.
4. Compact normalized shard state is compatible with materially faster steady-state loading.
5. SillyBunny can emit a `first_message` hydration event while loading historical one-message chats; that event must not be treated as a new-message mutation.
6. Passive chat load may reconcile identity and integrity in memory, but must not force a chat-file rewrite.

## Implementation Boundary

The implemented C0.25 model is:

- `chatInstanceId + messageId` identifies a message occurrence
- message position remains a display locator only
- edits change revision hash, not message identity
- archive state, native prompt-hidden state, and evidence-policy exclusion remain distinct
- shard source coverage is validated against immutable source message IDs and a coverage hash
- derived integrity summaries are generated lazily from compact persisted manifests
- host save remains the persistence boundary for corpus mutations

## Diagnostics and Health States

C0.25 introduced or materially exercised:

- chat identity states:
  - `identity-complete`
  - `identity-partial`
  - `identity-conflicted`
- shard content-health states:
  - `INTACT`
  - `DEGRADED`
  - `STALE`
  - `ORPHANED`
  - `CONFLICTED`
- shard exposure-health states:
  - `EXPOSURE_OK`
  - `SOURCE_AND_ARTIFACT_VISIBLE`
  - `SOURCE_VISIBLE_ARTIFACT_HIDDEN`
  - `SOURCE_HIDDEN_ARTIFACT_HIDDEN`
  - `VISIBILITY_POLICY_UNKNOWN`

Content integrity and prompt exposure are independent dimensions in the implementation.

The validator now distinguishes source drift, missing covered messages, missing shard outputs, and replace-source exposure conflicts instead of silently accepting positional range drift or treating a visibility problem as degraded semantic evidence.

## Load and Save Stabilization Result

The most consequential late-stage fix was the passive-load persistence boundary:

- identity/integrity reconciliation during `chat-changed` and `initial-load` now stays in memory
- no full chat save is triggered solely by passive load
- explicit save paths remain responsible for durable corpus mutation

Durability now follows this sequence:

- passive load
  - reconcile identity/integrity state in memory
  - do not write the corpus
- next explicit native host save or explicit adoption path
  - persist reconciled identity/integrity metadata
  - verify the write through the normal host save boundary
  - then update the operational projection from the persisted corpus state

This change closed the observed SillyBunny `EPERM` rename/fallback pattern that was being triggered by load-time Summary Sharder saves against chats still under host activity.

## Automated Verification

Targeted automated coverage passed for:

- `core/summarization/message-identity-core.test.mjs`
- `core/summarization/shard-integrity-core.test.mjs`

Verified behaviors include:

- duplicate text with distinct timestamps adopts distinct fingerprints
- legacy adoption preserves anchored IDs
- semantic no-op reconciliation preserves stable timestamps
- deletion tombstones preserve removed anchored IDs without retaining text
- shard manifests validate intact, stale, degraded, orphaned, and replace-source conflict states
- legacy wrapper coverage can be backfilled into normalized manifests

## Live Host Evidence

Live behavior was exercised against both host families:

- SillyTavern clone: `D:\AI\Projects\SillyTavern`
- SillyBunny clone: `D:\AI\Projects\SillyBunny`

Most important live outcomes:

- metadata-bearing extension runtime files were kept aligned across repo and both host clones
- large-chat load profiling isolated expensive work away from raw file read and JSON parsing
- compact normalized metadata variants loaded materially faster than expanded derived-state variants
- after passive-load save suppression, a dozen-file SillyBunny manual smoke pass completed without the earlier rename-fallback noise pattern

Detailed profiling evidence remains in:

- [C0_25D_LOAD_PROFILING_EVIDENCE.md](C0_25D_LOAD_PROFILING_EVIDENCE.md)

## Documentation Updated

C0.25 closeout is governed by:

- [PHASE_C0_25_CORPUS_IDENTITY_AND_INTEGRITY_BRIEF.md](PHASE_C0_25_CORPUS_IDENTITY_AND_INTEGRITY_BRIEF.md)

- [C0_25D_LOAD_PROFILING_EVIDENCE.md](C0_25D_LOAD_PROFILING_EVIDENCE.md)

## Remaining Limits

Still outside C0.25:

- no semantic reconstruction or canonical authority promotion from corpus
- no repair-reviewed destructive or interpretive automation
- no archive movement to a separate long-term store
- no vector retrieval layer
- no assumption that syntactically valid JSONL is runtime-valid without validator review

## Next Boundary

The next correct phase is:

- `C0.5`: self-healing reconstruction compiler operating on validated, identity-backed corpus state

That phase should build candidate reconstructed state separately, validate it, report coverage/conflicts, and only then promote it.
