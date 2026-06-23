# C0 Completion Report

## Status

Phase C0 is complete.

This report captures the implemented substrate, the live runtime evidence, and the boundary conditions that now govern subsequent work.

Evidence commit:

- `5a36068f714a7173ae742d66e928a047de7829aa` - `docs: preserve 1B0 substrate evidence`

Implementation commit:

- `05fc5fd68f954a2eb840663a1b7d718ed6c9a028` - `feat: add c0 architectural authority backend`

Current repo head during closeout:

- `bb169d869c7e`

## Scope Completed

C0 delivered:

- companion server plugin backend
- per-user operational SQLite storage
- Node and Bun runtime adapters
- schema initialization and manifest handling
- managed snapshot creation and verification
- primary corruption quarantine
- snapshot fallback restore
- fail-closed rebuild-required behavior
- browser-store migration and demotion
- authority adoption after confirmed host save
- scope and decision compare-before-write protection
- chat binding conflict protection
- Narrative-path isolation

C0 did not deliver:

- message-level immutable identity
- corpus reconstruction compiler
- archive movement
- reference indexing as an authoritative layer
- vector retrieval
- live cross-host synchronization

## Runtime Versions

- SillyTavern runtime: `Node v24.16.0`
- SillyBunny runtime: `Bun 1.3.14`

## Operational Database

Schema and service:

- service version: `c0`
- schema version: `1`
- journal mode: `WAL`

Per-user database paths:

- SillyTavern:
  - `D:\AI\Projects\SillyTavern\data\default-user\summary-sharder\architectural-memory.db`
  - `D:\AI\Projects\SillyTavern\data\default-user\summary-sharder\architectural-memory.snapshot.db`
  - `D:\AI\Projects\SillyTavern\data\default-user\summary-sharder\architectural-memory.state.json`
- SillyBunny:
  - `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.db`
  - `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.snapshot.db`
  - `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.state.json`

## Adapter Selection

- SillyTavern uses `node:sqlite`
- SillyBunny uses `bun:sqlite`

The logical schema and transaction rules are shared across both hosts.

## Snapshot and Failure Strategy

Managed snapshot behavior:

- operational writes commit to the primary DB
- managed snapshots are written to `architectural-memory.snapshot.db`
- snapshots are verified before acceptance
- corrupt primary DBs are quarantined
- verified snapshots are used for fallback restore
- if both primary and snapshot copies are unavailable or invalid, the backend fails closed and requires rebuild

Observed state markers after live adoption:

- SillyTavern `architectural-memory.state.json`:
  - `runtimeAdapter: "node"`
  - `journalMode: "WAL"`
- SillyBunny `architectural-memory.state.json`:
  - `runtimeAdapter: "bun"`
  - `journalMode: "WAL"`

## Browser-Store Migration

The previous browser-local authority store is no longer authoritative.

C0 behavior:

- migrate legacy browser data when present
- validate migration payload before commit
- persist authoritative state to the server backend
- record migration outcome in chat metadata
- treat browser-local state as migration/cache input only

## Diagnostics Added or Exercised

- `ARCH_SCOPE_VERSION_CONFLICT`
- `ARCH_DECISION_VERSION_CONFLICT`
- `ARCH_UNPROVEN_DECISION_COLLISION`
- `ARCH_CHAT_INSTANCE_CONFLICT`
- `ARCH_CHAT_LOCATOR_CONFLICT`
- `ARCH_REBUILD_REQUIRED`
- `ARCH_SNAPSHOT_VERIFICATION_FAILED`
- `ARCH_SCHEMA_VERSION_UNSUPPORTED`
- `ARCH_SERVER_REQUEST_FAILED`
- `ARCH_AUTHORITY_MISSING_CHAT_ID`

## Test Results

Automated:

- committed backend test suite: `183` passing tests
- targeted integration test:
  - `core/summarization/architectural-authority-integration.test.mjs` passed

## Live Host Smoke Results

### Architectural save ordering

Confirmed on SillyTavern:

- host shard save succeeds
- authority adoption begins only after host save confirmation
- committed authority state advances

Confirmed on SillyBunny:

- host shard save succeeds
- authority adoption begins only after host save confirmation
- committed authority state advances

### Failed host save ordering

Confirmed on both hosts:

- injected failed host save stops the path at host save failure
- no authority adoption occurs afterward
- DB scope state does not advance

### Narrative isolation

Confirmed on both hosts:

- Narrative `handleSummaryResult(...)` saved successfully to system output
- architectural authority path did not run
- trace recorded only gate evaluation with `isArchitecturalAuthorityRun: false`
- operational authority counters remained unchanged

## Backup and Restore Evidence

### Full-user backup

Confirmed on both hosts using the real host backup route:

- `POST /api/users/backup`
- session cookies + `X-CSRF-Token`

Observed result:

- both hosts produced full-user ZIP backups successfully
- both backups included:
  - `summary-sharder/architectural-memory.db`
  - `summary-sharder/architectural-memory.snapshot.db`
  - `summary-sharder/architectural-memory.state.json`
  - the full `chats/` corpus

### Clean extraction

Both backup ZIPs were extracted into clean temporary directories.

Confirmed:

- authority files remained intact after extraction
- restored chat JSONL still contained:
  - `architecturalProjectionRegistry`
  - `architecturalMemoryBinding`

### Extracted database readability

Confirmed from extracted DB copies:

- SillyTavern restored scopes:
  - `scope.c0.st` at `current_scope_run = 4`, `scope_version = 5`
- SillyBunny restored scopes:
  - `81d1773b-4432-4fa7-a182-efe3e8a70009` at `current_scope_run = 2`, `scope_version = 3`
  - `scope.c0.sb` at `current_scope_run = 3`, `scope_version = 4`

## Cross-Host Import Finding

This finding applies specifically to SillyBunny's built-in ZIP import route, not to manual archive extraction.

Verified source path on SillyTavern:

- `D:\AI\Projects\SillyTavern\data\default-user\summary-sharder`

Verified ZIP paths present in the SillyTavern backup:

- `summary-sharder/architectural-memory.db`
- `summary-sharder/architectural-memory.snapshot.db`
- `summary-sharder/architectural-memory.state.json`

Verified destination checked after Bun-host import:

- `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.db`
- `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.snapshot.db`
- `D:\AI\Projects\SillyBunny\data\default-user\summary-sharder\architectural-memory.state.json`

Observed behavior:

- SillyBunny `POST /api/users/import-sillytavern/zip` imported the SillyTavern backup corpus successfully
- the Bun host did not replace `data/default-user/summary-sharder` from the ZIP import
- Bun-side operational DB state remained host-local

Interpretation:

- built-in cross-host ZIP import currently restores portable corpus
- it does not adopt operational authority state from another host's user-data ZIP

This is consistent with the newer governing architecture where:

- the portable corpus is authoritative
- SQLite is operational, rebuildable state

### Clarification on non-user paths

The following host-level paths were not expected to transfer as part of user-data ZIP import:

- `D:\AI\Projects\SillyTavern\plugins\summary-sharder-memory`
- `D:\AI\Projects\SillyTavern\public\scripts\extensions\third-party\summary-sharder`

Reason:

- host backup/import operates on the authenticated user root under `data/default-user`
- those plugin and frontend deployment paths live outside that user-data subtree

## Important Behavioral Nuances

1. Full-user backup includes operational authority state.
2. Single-chat export does not imply preservation of shared architectural scope state.
3. Host ZIP import behavior is not the same thing as raw archive extraction behavior.
4. Cross-host corpus transfer currently works independently of operational DB transfer.
5. Narrative save behavior remained isolated from architectural authority.

## Known Limitations at C0 Closeout

- each host still owns a separate operational DB
- no live cross-host synchronization exists
- cross-host ZIP import does not currently transfer `data/default-user/summary-sharder`
- message-level immutable identity is not implemented
- mutable message positions remain unsafe as durable source identity
- no corpus reconstruction compiler exists yet
- no archive semantics exist yet
- no vector layer is required or enabled for architectural correctness

## Post-C0 Direction

The next correct boundary is `C0.25`.

That phase should establish:

- immutable message identity
- partial identity healing
- archive and restore semantics
- identity-backed shard coverage
- corpus and shard integrity validation
- safe repair boundaries

Only after that should the reconstruction compiler (`C0.5`) be expanded further.

## Verdict

C0 is complete.

The operational SQLite substrate is proven on both hosts, full-user backup captures the operational state, cross-host corpus import is proven, and Narrative save behavior remains isolated.

The next governing step is `C0.25`, not archive movement, vector retrieval, or wider authority expansion.
