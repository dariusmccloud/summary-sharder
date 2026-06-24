# C0.25D Load Profiling Evidence

## Scope

This note captures the first live profiling pass for the C0.25D metadata-budget and load-cost review.

Host under test:

- SillyTavern clone at `D:\AI\Projects\SillyTavern`
- chat: `Jeep - 2026-05-25@18h35m36s079ms - Checkpoint`

Measured stages:

1. server file read
2. server JSONL parse
3. browser fetch and response parse
4. base chat-state installation
5. message rendering
6. `CHAT_CHANGED` load completion path
7. Summary Sharder message-identity scan
8. archive-presentation sync
9. shard-integrity validation

## File Shape

Current full metadata on disk before normalization:

- total JSONL bytes: `1,595,992`
- header bytes: `11,590`
- `summary_sharder` bytes: `11,142`
- persisted `shardIntegrity` bytes: `6,081`
- persisted `architecturalProjectionRegistry` bytes: `2,199`

Those two derived structures account for about `74%` of the `summary_sharder` header payload in the bloated case.

## Controlled Variant Sizes

Fresh copies created from the same source chat:

| Case | Header bytes | `summary_sharder` bytes |
|---|---:|---:|
| Full | 11,628 | 11,180 |
| No `shardIntegrity` | 5,542 | 5,094 |
| No `architecturalProjectionRegistry` | 9,410 | 8,962 |
| Both removed | 3,313 | 2,865 |

## Live Timing Results

### A. Current full metadata

Measured on a fresh SillyTavern session loading the current checkpoint file as-is.

| Metric | Value |
|---|---:|
| Total chat-ready time | 16,575 ms |
| Server read | 72.857 ms |
| Server parse | 12.159 ms |
| Server total | 98.661 ms |
| Browser fetch stage | 302.4 ms |
| Browser response parse | 69.8 ms |
| Base state install | 0.5 ms |
| Message rendering | 8,095.7 ms |
| `CHAT_CHANGED` path | 8,105.0 ms |
| Extension total | 822.3 ms |
| Identity scan | 681.6 ms |
| Archive sync | 131.1 ms |
| Integrity validation | 8.6 ms |
| Automatic save during load | yes (`identitySaveKind=metadata`) |
| Validation passes observed | 1 |

### B. Fresh copy with no `shardIntegrity`

| Metric | Value |
|---|---:|
| Total chat-ready time | 13,180 ms |
| Server read | 24.721 ms |
| Server parse | 26.201 ms |
| Server total | 62.349 ms |
| Browser fetch stage | 294.2 ms |
| Browser response parse | 119.6 ms |
| Base state install | 1.2 ms |
| Message rendering | 5,624.0 ms |
| `CHAT_CHANGED` path | 7,138.1 ms |
| Extension total | 1,811.8 ms |
| Identity scan | 784.1 ms |
| Archive sync | 170.6 ms |
| Integrity validation | 855.5 ms |
| Automatic save during load | yes (`identitySaveKind=metadata`, `integritySaveKind=metadata`) |
| Manifest backfill | yes (`manifestsAdded=3`) |
| Validation passes observed | 1 |

### C. Fresh copy with no `architecturalProjectionRegistry`

| Metric | Value |
|---|---:|
| Total chat-ready time | 11,123 ms |
| Server read | 8.669 ms |
| Server parse | 7.291 ms |
| Server total | 20.991 ms |
| Browser fetch stage | 83.9 ms |
| Browser response parse | 42.7 ms |
| Base state install | 0.9 ms |
| Message rendering | 4,779.1 ms |
| `CHAT_CHANGED` path | 6,214.2 ms |
| Extension total | 1,327.8 ms |
| Identity scan | 674.2 ms |
| Archive sync | 115.8 ms |
| Integrity validation | 536.9 ms |
| Automatic save during load | yes (`identitySaveKind=metadata`, `integritySaveKind=metadata`) |
| Manifest backfill | yes (`manifestsAdded=3`) |
| Validation passes observed | 1 |

### D. Fresh compact copy with both derived structures removed

| Metric | Value |
|---|---:|
| Total chat-ready time | 13,787 ms |
| Server read | 11.467 ms |
| Server parse | 9.684 ms |
| Server total | 28.208 ms |
| Browser fetch stage | 114.9 ms |
| Browser response parse | 32.3 ms |
| Base state install | 1.0 ms |
| Message rendering | 6,003.4 ms |
| `CHAT_CHANGED` path | 7,634.0 ms |
| Extension total | 2,064.1 ms |
| Identity scan | 1,049.4 ms |
| Archive sync | 132.2 ms |
| Integrity validation | 881.8 ms |
| Automatic save during load | yes (`identitySaveKind=metadata`, `integritySaveKind=metadata`) |
| Manifest backfill | yes (`manifestsAdded=3`) |
| Validation passes observed | 1 |

### E. Steady-state compacted file after first-load normalization

Once a bloated copy was loaded under the current runtime, the extension rewrote it to a compact manifest-only header:

- header bytes fell from `11,627` to about `3,034`
- `summary_sharder` bytes fell from `11,179` to about `2,586`

Steady-state reload on that normalized file:

| Metric | Value |
|---|---:|
| Total chat-ready time | 4,940 ms |
| Server total | 15.826 ms |
| Browser response parse | 16.0 ms |
| Message rendering | 2,271.4 ms |
| `CHAT_CHANGED` path | 2,582.2 ms |
| Extension total | 336.5 ms |
| Identity scan | 286.6 ms |
| Archive sync | 45.5 ms |
| Integrity validation | 4.1 ms |

## Controlled Bypass

A guarded profiling bypass is now available for measurement only.

- localStorage key: `summarySharderProfilingBypass`
- query parameter: `ss_profile_bypass`
- behavior: the frontend extension still loads normally, but the deferred `CHAT_CHANGED` Summary Sharder processing path exits after visibility-observer setup
- logging: when active, the runtime emits:
  - `[SummarySharder] Profiling bypass active. CHAT_CHANGED load processing will be skipped for measurement.`

This is a development-only measurement switch, not an end-user disable feature.

## SillyBunny Passive-Load Write Finding

Subsequent live SillyBunny investigation established a separate but related load-path constraint.

Observed behavior:

- intermittent Windows `EPERM` rename fallback during chat load
- failures appeared on both tiny and moderate files
- failures did not correlate reliably with raw file size
- first-pass evidence showed some failures were triggered by Summary Sharder message-identity reconciliation during `chat-changed` or equivalent passive-load phases

Targeted tracing then established:

1. SillyBunny emits a `MESSAGE_RECEIVED(..., 'first_message')` event when loading a historical one-message chat.
   - treating that as a true new-message event caused an unnecessary Summary Sharder reconciliation/save path
2. message-identity passive-load persistence, including deferred retry, was still unsafe on SillyBunny because it required a full chat rewrite through the host save path
3. remaining intermittent host saves could be traced independently from Summary Sharder and were not explained by metadata size alone

Corrected runtime rule:

> Passive chat load may reconcile message identity and integrity in memory, but it must not force a full chat-file rewrite.

Applied runtime changes:

- ignore SillyBunny `first_message` load hydration as a true new-message persistence trigger
- guard host-event subscriptions for events that may be absent on a given ST/SB host
- suppress Summary Sharder message-identity full-chat persistence during passive-load phases:
  - `chat-changed`
  - `initial-load`
- leave adopted identity state in memory and persist it on the next ordinary host save path instead

Result:

- a dozen-file SillyBunny smoke pass completed without reproduced rename failures after passive-load write suppression
- the governing conclusion is not "small files are safe" or "large files are unsafe"
- the governing conclusion is that passive-load full-file rewrites are not a valid steady-state operation boundary for SillyBunny

## Debug and Profiling Surfaces

The useful load-timing surfaces remain available.

Normal use should stay quiet.

### Always-available profiling data

- extension-side load traces:
  - `window.summarySharderLoadProfiler.getTraces()`
- host-side load traces:
  - `window.summarySharderHostLoadProfile`

These remain available without enabling noisy tracing.

### Optional debug tracing

When deeper save/load tracing is needed, enable:

```js
localStorage.setItem('summarySharderDebugTracing', '1');
location.reload();
```

Disable with:

```js
localStorage.removeItem('summarySharderDebugTracing');
location.reload();
```

Equivalent query parameter:

```text
?ss_debug_tracing=1
```

Debug tracing is intended for temporary diagnosis only. It enables:

- browser `CHAT_LOADED` console markers
- host-side save-origin console tracing
- server-side save-correlation logs when diagnostic headers are present

## Repeated Normalized Steady-State Runs

Controlled comparison on the same normalized checkpoint file:

- case: `Jeep - 2026-05-25@18h35m36s079ms - Checkpoint - Perf Full`
- host: SillyTavern clone at `D:\AI\Projects\SillyTavern`
- runs per case: `3`
- state labeling:
  - enabled run A: colder browser/runtime state
  - enabled runs B-C: warm browser/runtime state
  - bypass runs: warm browser/runtime state

### F. Normalized steady-state with Summary Sharder enabled

| Run | Host total | `CHAT_CHANGED` host stage | Handler total | Integrity total | Automatic saves |
|---|---:|---:|---:|---:|---|
| A (colder) | 13,171.2 ms | 7,294.0 ms | 3,316.3 ms | 1,391.0 ms | `identitySaveKind=metadata`, `integritySaveKind=none` |
| B (warm) | 12,892.2 ms | 5,540.8 ms | 3,259.1 ms | 1,298.4 ms | `identitySaveKind=metadata`, `integritySaveKind=none` |
| C (warm) | 13,204.8 ms | 5,262.8 ms | 4,114.9 ms | 1,681.3 ms | `identitySaveKind=metadata`, `integritySaveKind=none` |
| Median | 13,171.2 ms | - | 3,316.3 ms | 1,391.0 ms | identity metadata save every run |
| Worst | 13,204.8 ms | - | 4,114.9 ms | 1,681.3 ms | identity metadata save every run |

Observed:

- normalized steady-state did **not** produce manifest backfill in these runs
- normalized steady-state did **not** produce integrity metadata saves in these runs
- normalized steady-state still produced an identity metadata save in every measured run

That means the current runtime does **not** yet satisfy the desired steady-state invariant of zero automatic saves after normalization.

### G. Normalized steady-state with profiling bypass enabled

| Run | Host total | `CHAT_CHANGED` host stage | Handler total | Automatic saves |
|---|---:|---:|---:|---|
| 1 (warm) | 10,830.1 ms | 4,573.4 ms | 0.0 ms | none observed |
| 2 (warm) | 11,262.0 ms | 5,373.1 ms | 0.0 ms | none observed |
| 3 (warm) | 11,913.1 ms | 5,371.3 ms | 0.2 ms | none observed |
| Median | 11,262.0 ms | - | 0.0 ms | none observed |
| Worst | 11,913.1 ms | - | 0.2 ms | none observed |

Observed:

- bypass runs still include normal host initialization and message rendering
- bypass runs skip Summary Sharder deferred `CHAT_CHANGED` work after visibility-observer setup
- enabled versus bypass on the same normalized file shows a meaningful steady-state gap, but render-stage variance remains large enough that causal claims should stay conservative
- the evidence supports deeper isolation of `CHAT_CHANGED` work, not a claim that header bytes alone caused the full delay

### H. Post-fix steady-state validation

After preserving `lastReconciledAt` when the semantic identity state is unchanged, a live SillyTavern reload of:

- `Jeep - 2026-05-25@18h35m36s079ms - Checkpoint - Perf Full`

produced:

- `identitySaveKind: none`
- `integritySaveKind: none`
- `manifestsAdded: 0`
- `manifestCount: 3`
- `message-identity-scan.changed: false`
- `message-identity-scan.metadataChanged: false`
- `message-identity-scan.messagesChanged: false`

The same trace also showed:

- `chat-changed-handler.durationMs: 6711.8 ms`
- `apply-visibility-settings: 6178.4 ms`
- `reconcile-corpus-integrity.durationMs: 531.6 ms`
- `message-identity-scan.durationMs: 125.7 ms`
- `archive-presentation-sync.durationMs: 388.0 ms`
- `shard-integrity-validation.durationMs: 16.4 ms`

This confirms the current normalized steady-state path can now complete with zero automatic metadata saves in SillyTavern.

## Findings

1. Metadata size is not the primary bottleneck.
   - Server read and parse remain well under `100 ms` even for the bloated 1.6 MB file.
   - The expensive stages are downstream: DOM rendering and the `CHAT_CHANGED` completion path.

2. Persisted derived metadata materially expands the corpus and triggers additional normalization, validation, and save work.
   - Removing `shardIntegrity` and `architecturalProjectionRegistry` shrinks the header substantially.
   - Compact normalized state is associated with substantially faster steady-state loading, but the individual cost contributions still require deeper stage isolation.

3. First-load normalization is a distinct cost center.
   - Fresh reduced copies that still require manifest backfill incur expensive integrity-validation work and an automatic metadata save.
   - This means `first load of a migrated or partially compact file` and `steady-state reload of a normalized file` must be treated as separate performance cases.

4. Repeated full-corpus work is still visible.
   - `message-identity-scan` walks all `254` messages and currently persists a large `cachedSnapshot` structure.
   - The `CHAT_CHANGED` path remains larger than any server-side parsing stage and needs deeper instrumentation.
   - On the normalized steady-state file, Summary Sharder enabled versus bypassed differs by about `1.9 s` at the median host total (`13,171.2 ms` vs `11,262.0 ms`), but that gap still sits alongside material render-stage variance.

5. The current runtime is already self-compacting.
   - Loading a bloated copy rewrites it into a smaller authoritative form.
   - That supports the design direction: compact persisted manifests, lazy derived diagnostics.

6. The current persistence boundary is still too eager.
   - Earlier normalized steady-state runs triggered an identity metadata save on every measured enabled run.
   - That behavior was traced to unconditional `lastReconciledAt` churn and has now been corrected for the SillyTavern path.
   - This still needs matching live confirmation on SillyBunny before the persistence-boundary decision is fully closed.

## What This Proves

The profiling evidence supports the C0.25D invariant:

> Normal chat loading must not require repeated full-corpus scans, one full scan per manifest, or eager expansion of detailed integrity reports. Persisted corpus metadata must remain compact and authoritative; expanded operational diagnostics must be generated or queried lazily.

## Remaining Gaps

1. The controlled bypass comparison is now available, but the fully isolated disabled case is still incomplete.
   - Physically removing the Summary Sharder extension directory was rejected as an invalid measurement path because it interfered with normal host initialization.
   - The guarded profiling bypass is the correct first comparison and is now implemented.
   - A deeper “extension loaded but all profiling-relevant subscribers inert” case may still be useful later, but is not required before the current persistence-boundary decision.

2. SillyBunny live stage timings are not yet captured in this note.
   - File-level inspection shows the SillyBunny clone already has a much smaller header for the same checkpoint:
     - total bytes: `1,540,837`
     - header bytes: `3,536`
     - `summary_sharder` bytes: `3,162`
   - Live browser-stage timings should still be captured once the SB browser run is stable.
   - Current harness behavior is inconsistent:
     - `agent-browser` can reach the page title (`SillyBunny`)
     - network traces show the host serving the full frontend bundle
     - the rendered screenshot still lands in a `Not connected to API!` state
     - `window.summarySharderLoadProfiler` is therefore not yet available in that browser session

3. `CHAT_CHANGED` needs finer-grained breakdown.
   - The current host trace proves this is one of the dominant stages.
   - It does not yet split itemized prompt rebuild, post-render handlers, or other subscribers deeply enough.

4. The metadata-authority audit is still open.
   - The current measurements support compact manifests and lazy derived diagnostics.
   - They do not yet finalize which persisted fields remain authoritative, which are normalized caches, and which should be generated only on demand.

## Immediate Next Actions

1. Explain or eliminate the repeated identity metadata save on normalized steady-state loads.
2. Stop persisting expanded derived `shardIntegrity` reports in chat metadata.
3. Keep persisted shard manifests compact and authoritative.
4. Audit `architecturalProjectionRegistry` so only compact authority pointers survive in the portable corpus.
5. Add deeper instrumentation inside the `CHAT_CHANGED` path and any post-load save triggers.
6. Retry SillyBunny live timing capture once the browser-control path is stable.
