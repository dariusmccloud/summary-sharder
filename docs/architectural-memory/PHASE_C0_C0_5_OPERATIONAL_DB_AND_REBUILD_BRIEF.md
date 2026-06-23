# Phase C0 and C0.5: Operational Database and Self-Healing Rebuild Brief

## Status

This brief replaces the abandoned ordinary-chat receipt direction proven unsafe by `1B0`.

It defines the bounded implementation target for:

- `Phase C0`: server-side operational database
- `Phase C0.5`: self-healing rebuild engine and interpretation protocol

It does not authorize:

- Phase C1 authority/projection runtime expansion
- Phase C2 archive movement, stable windows, or reference indexing
- any return to out-of-band ordinary-chat receipt writes

## C0 Outcome

Phase C0 is now complete.

The operational SQLite substrate was implemented and live-smoked on both hosts:

- SillyTavern using `Node v24.16.0` and `node:sqlite`
- SillyBunny using `Bun 1.3.14` and `bun:sqlite`

Confirmed outcome:

- per-user operational DB works on both hosts
- managed snapshot and fail-closed recovery behavior work
- architectural authority adoption occurs only after confirmed host save
- failed host save does not update authority state
- full-user backup captures the operational DB, snapshot, and state marker
- extracted backups preserve readable authority state
- built-in SillyBunny ZIP import restores portable corpus but does not replace `data/default-user/summary-sharder`
- Narrative save flow remains isolated from architectural authority state

This means the storage substrate is no longer the blocker.

The next correct boundary is:

- `C0.25` for corpus identity, archive semantics, and shard/source integrity

not:

- broader authority expansion
- archive movement
- vector retrieval
- reconstruction-first work on mutable positional source identity

See `C0_COMPLETION_REPORT.md` for the detailed closeout evidence.

## Governing Result from 1B0

The `1B0` feasibility spike established a negative substrate fact that now governs all subsequent storage design:

- ordinary chat files are host-owned
- host save paths perform blind full-file rewrites from in-memory state
- a plugin write made out of band to an ordinary chat file can be silently erased by a later host save
- therefore ordinary-chat receipts cannot be authoritative
- no server plugin endpoint may patch ordinary chat files

That evidence remains valid and must be preserved as a regression constraint.

## Verified Host Facts

The following facts were re-verified from live source inspection and runtime probes.

### 1. Authenticated per-user filesystem root exists on both hosts

Both hosts derive per-user directories from `globalThis.DATA_ROOT`, `handle`, and `USER_DIRECTORY_TEMPLATE`.

Confirmed in:

- `D:\AI\Projects\SillyTavern\src\users.js`
- `D:\AI\Projects\SillyBunny\src\users.js`

Key implementation:

```js
directories[key] = path.join(globalThis.DATA_ROOT, handle, USER_DIRECTORY_TEMPLATE[key]);
```

In the current test hosts, the authenticated default-user root is:

- `D:\AI\Projects\SillyTavern\data\default-user`
- `D:\AI\Projects\SillyBunny\data\default-user`

This root already contains `chats/`, `backups/`, `settings.json`, `extensions/`, `vectors/`, and other persistent user data.

### 2. Full user backup archives the whole user root

Both hosts expose `POST /backup` through `users-private.js`, which calls `createBackupArchive(handle, response)`.

In both hosts, `createBackupArchive()` zips:

```js
archive.glob('**/*', {
    cwd: directories.root,
    follow: false,
    stat: true,
    dot: true,
    ignore,
});
```

This means any database stored under:

```text
<authenticated-user-root>/summary-sharder/
```

is included in the host’s full user-data backup archive.

Important distinction:

- this applies to full user backup
- it does not apply to single-chat export
- it does not apply to per-chat backup snapshots under `backups/`

### 3. Server plugins load from host `plugins/` and mount under `/api/plugins/<id>`

Confirmed in:

- `D:\AI\Projects\SillyTavern\src\plugin-loader.js`
- `D:\AI\Projects\SillyBunny\src\plugin-loader.js`

Both hosts mount plugin routers with:

```js
app.use(`/api/plugins/${id}`, router);
```

This validates the companion plugin model:

- plugin id: `summary-sharder-memory`
- API base: `/api/plugins/summary-sharder-memory`

### 4. CSRF behavior is host-managed and compatible with plugin routes

Confirmed in:

- `D:\AI\Projects\SillyTavern\src\server-main.js`
- `D:\AI\Projects\SillyBunny\src\server-main.js`

When CSRF protection is enabled, both hosts:

- expose `GET /csrf-token`
- expect the token in `x-csrf-token`
- apply the CSRF middleware globally

When launched with `--disableCsrf`, both hosts return:

```json
{ "token": "disabled" }
```

Implication for C0:

- the frontend must not hardcode `--disableCsrf`
- the companion adapter must fetch `/csrf-token` when needed
- all write routes must work with the host’s normal authenticated session and CSRF regime

### 5. Current `1B0` plugin is live on both hosts

Live HTTP probes confirmed:

- `http://127.0.0.1:8000/api/plugins/summary-sharder-memory/health`
- `http://127.0.0.1:4444/api/plugins/summary-sharder-memory/health`

Both returned:

```json
{
  "ok": true,
  "pluginId": "summary-sharder-memory",
  "prototypeVersion": "1B0"
}
```

This proves the installation surface and authenticated plugin route shape remain viable after the architecture change.

### 6. Browser REPL verification completed in this Codex session

The governing instruction requested browser REPL verification. That verification is now partially complete with live browser evidence on both hosts.

Confirmed through `agent-browser`:

- host UI opened successfully at `http://localhost:8000/` with title `SillyTavern`
- host UI opened successfully at `http://localhost:4444/` with title `SillyBunny`
- same-origin plugin route opened successfully in a browser session on both hosts:
  - `http://localhost:8000/api/plugins/summary-sharder-memory/health`
  - `http://localhost:4444/api/plugins/summary-sharder-memory/health`
- browser-visible plugin response on both hosts:

```json
{"ok":true,"pluginId":"summary-sharder-memory","prototypeVersion":"1B0"}
```

- same-origin CSRF endpoint opened successfully in a browser session on both hosts:
  - `http://localhost:8000/csrf-token`
  - `http://localhost:4444/csrf-token`
- current live host response on both hosts:

```json
{"token":"disabled"}
```

What that proves:

- the frontend can reach same-origin companion-plugin routes under the host session origin
- the host-owned CSRF token endpoint is reachable from the same browser context
- the current local host launches are running with CSRF disabled, so same-origin write calls are not blocked by missing token handling in this specific test environment

What remains deferred to the C0 implementation smoke:

- frontend extension detection behavior before and after plugin availability
- same-origin authenticated write-path behavior on a CSRF-enabled host launch
- live host-save confirmation wiring before backend authority commit
- branch/import effects on chat identity and saved projection metadata
- assembled model-context verification for planned recovery metadata exclusion

This is no longer a browser-access blocker. The remaining items are implementation smoke checks.

## Selected Database Technology

## Choice

Use one SQLite database file per authenticated user:

```text
<authenticated-user-root>/summary-sharder/architectural-memory.db
```

with runtime-specific adapters:

- SillyTavern / Node: `node:sqlite`
- SillyBunny / Bun: `bun:sqlite`

The logical schema, migration tables, and transaction rules remain identical across both hosts.

## Runtime minimums

### SillyTavern / Node

`node:sqlite` first exists in Node `v22.5.0`, but it remained behind the experimental SQLite flag until Node `v22.13.0`.

Practical C0 minimum for SillyTavern is therefore:

```text
Node >= 22.13.0
```

Current verified host runtime:

```text
Node v24.16.0
```

### SillyBunny / Bun

Current verified host runtime:

```text
Bun 1.3.14
```

C0 does not require a separate third-party SQLite package on Bun.

## Compatibility Evidence

### Node / SillyTavern

Probe result:

- `node:sqlite` imports successfully
- transactional write/update/rollback succeeded
- compare-before-write semantics succeeded through version-predicate updates

Observed probe result:

- `PRAGMA journal_mode=WAL` returned `wal`
- update with expected version changed 1 row
- stale update changed 0 rows
- rollback preserved database integrity

### Bun / SillyBunny

Probe result:

- `bun:sqlite` imports successfully
- transactional write/update/rollback succeeded
- compare-before-write semantics succeeded through version-predicate updates

Observed probe result:

- `PRAGMA journal_mode=WAL` returned `wal`
- update with expected version changed 1 row
- stale update changed 0 rows
- rollback preserved database integrity

### Cross-runtime file compatibility

The same `.db` file was created with Node and read successfully with Bun.

The same `.db` file was created with Bun and read successfully with Node.

That is sufficient evidence to select SQLite as one logical artifact with two thin runtime adapters rather than two independent storage technologies.

## Shared Node/Bun adapter contract

Both runtime adapters must implement the same minimal service contract:

- `openDatabase(dbPath)`
- `closeDatabase()`
- `getManifest()`
- `applyMigrations(targetSchemaVersion)`
- `beginImmediate()`
- `commit()`
- `rollback()`
- `exec(sql)`
- `prepare(sql)`
- `getJournalMode()`
- `createManagedSnapshot(snapshotPath)`
- `restoreFromSnapshot(snapshotPath, restoreMode)`
- `verifyDatabaseIntegrity()`
- `quarantineCorruptDatabase(reason)`

The rest of the plugin must depend on this contract, not on runtime-specific APIs directly.

## Rejected Alternatives

### 1. Browser `localStorage`

Rejected because:

- browser-local only
- not shared across browsers connected to the same host
- not part of server-side authenticated storage
- vulnerable to browser clear/reset
- cannot be the authoritative runtime substrate for multi-chat scope state

### 2. Ordinary chat receipts or hidden chat-file records

Rejected because:

- proven unsafe by `1B0`
- host save can erase plugin-written records silently
- violates the no-out-of-band ordinary-chat patch rule

### 3. Flat JSON or JSONL custom operational files

Rejected because:

- no built-in transactions
- custom locking and recovery burden
- higher risk of torn writes and ad hoc migration code
- compare-before-write semantics would be hand-rolled

This is precisely the class of problem SQLite is already built to solve.

### 4. Third-party SQLite bindings such as `better-sqlite3`

Rejected for C0 because:

- not installed on either host runtime
- adds native dependency burden
- unnecessary because built-in adapters already exist

## Physical Storage Path

## Selected path

Create and own:

```text
<authenticated-user-root>/summary-sharder/
```

with the initial artifact:

```text
<authenticated-user-root>/summary-sharder/architectural-memory.db
```

Permitted adjacent managed files:

- `architectural-memory.db-wal`
- `architectural-memory.db-shm`
- temporary migration files
- bounded recovery snapshots
- manifest files owned by the plugin

## Why this path

It satisfies the governing constraints:

- beneath authenticated host user root
- outside `chats/`
- outside extension source tree
- survives extension upgrade
- survives browser clear
- survives host restart
- included in full user-data backup

## Explicitly rejected storage locations

- anywhere under `chats/`
- anywhere under the extension repo
- anywhere browser-only
- anywhere requiring per-chat manual file management

## Server Plugin Installation Model

## Companion plugin

Plugin id:

```text
summary-sharder-memory
```

Host route base:

```text
/api/plugins/summary-sharder-memory
```

## Installation model

### SillyTavern

- plugin code is installed into host `plugins/summary-sharder-memory`
- installation is performed explicitly by the user or installer script
- no browser code may self-install executable backend files

### SillyBunny

- same installation model
- same plugin id
- same route base
- Bun runtime selected automatically by host execution

## Installer responsibility

The installer may:

- copy or sync plugin files into the host plugin directory
- verify plugin presence
- report version
- explain restart requirements

The installer must not:

- write arbitrary host files outside the plugin destination
- alter ordinary chat files
- conceal that backend code is being installed

## Exact API Contract for Phase C0

## Baseline endpoints

### `GET /health`

Purpose:

- liveness
- adapter runtime id
- DB reachability
- migration state summary

Response shape:

```json
{
  "ok": true,
  "pluginId": "summary-sharder-memory",
  "serviceVersion": "c0",
  "runtime": "node" ,
  "db": {
    "healthy": true,
    "schemaVersion": 1,
    "migrationState": "ready"
  }
}
```

### `GET /capabilities`

Purpose:

- advertise enabled feature boundary
- declare runtime adapter
- declare rebuild availability
- report whether migration from browser-local store is supported

### `POST /init`

Purpose:

- ensure the per-user `summary-sharder/` directory exists
- open or create the SQLite DB
- apply pending migrations
- initialize manifest rows
- return service manifest

This endpoint must be idempotent.

### `GET /manifest`

Purpose:

- return current DB manifest and compatibility state
- expose schema versions and migration health
- expose plugin and runtime version info

## Required Phase C0 operational endpoints

The initial C0 backend also needs:

### manifest and migration

- `POST /migrate-browser-store`
- `POST /validate-browser-migration`

### scope bootstrap

- `POST /scopes/ensure`
- `GET /scopes/:memoryScopeId`
- `POST /scopes/:memoryScopeId/bind-chat`

### authority reads

- `GET /scopes/:memoryScopeId/decisions/current`
- `GET /scopes/:memoryScopeId/decisions/:decisionId`
- `GET /scopes/:memoryScopeId/projections/:chatInstanceId`

### authority writes

- `POST /scopes/:memoryScopeId/commit`

This is the server-side replacement for browser-authoritative `commitArchitecturalScopeAuthorityUpdate()`.

### database health and maintenance

- `POST /rebuild/prepare`
- `POST /rebuild/execute`
- `GET /rebuild/status/:jobId`
- `POST /rebuild/promote`
- `POST /rebuild/quarantine-current`

These belong to C0.5 but live in the same plugin.

## API hard rules

All routes must:

- use authenticated `request.user` context
- never accept arbitrary filesystem paths
- sanitize identifiers
- validate schema version and payload shape server-side
- enforce request-size limits
- reject path traversal outright
- reject writes when DB health is degraded
- never silently fall back to browser authority

## Database Schema Outline

The schema remains bounded to C0 and C0.5.

## Core tables

### `manifest`

One row per user DB.

Fields:

- `schema_version`
- `service_version`
- `runtime_adapter`
- `created_at`
- `updated_at`
- `migration_state`
- `rebuild_state`
- `last_successful_rebuild_at`

### `memory_scopes`

Fields:

- `memory_scope_id` primary key
- `scope_alias`
- `scope_version`
- `current_scope_run`
- `created_at`
- `updated_at`

### `chat_bindings`

Fields:

- `chat_instance_id` primary key
- `memory_scope_id`
- `branched_from_chat_instance_id`
- `source_chat_locator`
- `binding_state`
- `bound_at`
- `updated_at`

### `decision_records`

Immutable authoritative records.

Fields:

- `memory_scope_id`
- `decision_id`
- `record_version`
- `canonical_hash`
- `canonical_hash_version`
- `hash_algorithm`
- `semantic_payload_json`
- `status`
- `prior_version`
- `source_chat_instance_id`
- `last_updating_chat_instance_id`
- `created_at`
- `updated_at`

Primary key:

```text
(memory_scope_id, decision_id, record_version)
```

### `current_decision_pointers`

Fields:

- `memory_scope_id`
- `decision_id`
- `current_record_version`
- `canonical_hash`
- `authority_location`
- `archive_pointer_json`
- `stub_pointer_json`
- `updated_at`

Primary key:

```text
(memory_scope_id, decision_id)
```

### `decision_provenance`

One row per provenance occurrence, not one row per semantic claim.

Fields:

- `memory_scope_id`
- `decision_id`
- `record_version`
- `chat_instance_id`
- `collection_id`
- `source_ref`
- `source_kind`

### `projection_registry`

Projection metadata loaded from host-saved shards and lorebook entries.

Fields:

- `memory_scope_id`
- `chat_instance_id`
- `projection_key`
- `source_kind`
- `output_uid`
- `start_index`
- `end_index`
- `projection_state_json`
- `stale`
- `updated_at`

### `rebuild_jobs`

Candidate rebuild tracking.

Fields:

- `job_id`
- `memory_scope_id`
- `status`
- `candidate_db_path`
- `source_hash_manifest_json`
- `report_json`
- `created_at`
- `updated_at`

### `migration_audit`

For browser-local migration and later repair history.

Fields:

- `migration_id`
- `migration_kind`
- `source_kind`
- `status`
- `summary_json`
- `created_at`

## Locking and Transaction Model

Use SQLite transactions with runtime adapter wrappers.

### Core rules

- WAL mode
- `BEGIN IMMEDIATE` for write transactions
- compare-before-write on scope and record versions
- stale writes fail explicitly
- no last-write-wins overwrite

## Selected journal mode

The selected SQLite journal mode for C0 is:

```text
WAL
```

This was verified on both hosts during runtime probes.

### Logical write pattern

1. read manifest and scope state
2. validate expected scope version
3. validate expected decision versions
4. insert immutable record rows as needed
5. update current pointer rows
6. update scope run/version
7. commit transaction

If any validation fails, the transaction rolls back.

### Concurrency rule

Application semantics remain:

- same ID + no expected version = unproven collision
- stale expected version = conflict
- same canonical hash + same loaded version = inherited/no-op

## Crash-Recovery Behavior

The DB is operational state, not the only semantic copy.

### Normal crash model

- SQLite WAL provides transaction integrity
- incomplete transactions are rolled back by SQLite
- manifest health check must report whether the DB opens cleanly

## Managed snapshot strategy

C0 maintains one live operational DB plus one verified managed snapshot.

Selected snapshot methods:

### Node snapshot creation method

Use `DatabaseSync#serialize()` from `node:sqlite` to produce a consistent SQLite image, then write that image atomically to the managed snapshot path.

### Bun snapshot creation method

Use `Database#serialize()` from `bun:sqlite` to produce a consistent SQLite image, then write that image atomically to the managed snapshot path.

Snapshot target shape:

```text
<authenticated-user-root>/summary-sharder/architectural-memory.snapshot.db
```

Bounded managed files may therefore include:

- `architectural-memory.db`
- `architectural-memory.db-wal`
- `architectural-memory.db-shm`
- `architectural-memory.snapshot.db`
- temporary replacement files used for atomic rename

Snapshot creation occurs only after a successful committed write and integrity verification.

## Restore selection and quarantine rules

Restore precedence is:

1. current operational DB, if integrity check passes
2. verified managed snapshot, if current DB fails integrity
3. C0.5 rebuild boundary, if both DB copies are unavailable or invalid

Quarantine rules:

- a corrupt operational DB is renamed into a quarantined path and never overwritten in place
- a corrupt snapshot is also quarantined and is never selected as a restore candidate
- quarantine records must preserve timestamp, reason, and original file name
- if both copies fail, C0 must stop cleanly at the rebuild boundary rather than guessing

Restore selection is deterministic:

- prefer the operational DB when valid
- otherwise prefer the newest snapshot that passed integrity verification and schema-version compatibility
- never restore from an unverified file
- never merge two damaged copies heuristically inside C0

### Recovery model

If the DB is missing, corrupt, or inconsistent:

1. quarantine the current DB file
2. discover recovery corpus
3. build candidate DB separately
4. validate candidate DB
5. atomically promote candidate DB

The current DB must never be mutated progressively during rebuild.

## Browser-Local Migration Plan

The existing commit `9a7142090e77c2af2076965345b047bb383f7930` localStorage backend becomes migration input only.

## One-time migration flow

1. frontend detects legacy browser-local authority store
2. companion plugin reports healthy DB and ready migration state
3. frontend exports legacy browser records as a bounded payload
4. server validates:
   - IDs
   - scope membership
   - canonical hashes
   - record versions
   - pointer consistency
5. server writes imported rows into DB in a migration transaction
6. server reads them back and computes exact equivalence report
7. frontend displays success or conflict report
8. browser-local data remains untouched until equivalence is confirmed
9. after success, browser-local store is marked migrated and becomes cache-only

Missing browser-local data after server activation is not loss.

## Phase C0 File-by-File Plan

## New plugin files

### `tools/server-plugin/summary-sharder-memory/index.js`

Refactor from prototype routes to production C0 route surface:

- keep `/health`
- add `/capabilities`
- add `/init`
- add `/manifest`
- remove ordinary-chat receipt write routes from production path
- add migration and commit endpoints
- no production route may patch ordinary chat files

### `tools/server-plugin/summary-sharder-memory/core.js`

Split substrate helpers from `1B0` prototype logic.

Production responsibilities:

- user-root resolution
- plugin service manifest
- runtime adapter selection
- identifier sanitization
- schema validation

### `tools/server-plugin/summary-sharder-memory/sqlite-node.js`

Node adapter using `node:sqlite`.

### `tools/server-plugin/summary-sharder-memory/sqlite-bun.js`

Bun adapter using `bun:sqlite`.

### `tools/server-plugin/summary-sharder-memory/schema.js`

DDL and migration definitions.

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

C0.5 candidate rebuild orchestration.

### `tools/server-plugin/summary-sharder-memory/core.test.mjs`

Retain and repurpose current tests to preserve negative `1B0` evidence where relevant.

Add adapter-neutral DB tests here or split into:

- `sqlite-adapter.test.mjs`
- `rebuild.test.mjs`
- `migration.test.mjs`

## Extension files

### `core/summarization/architectural-authority-store.js`

Refactor from browser-authoritative storage to:

- semantic hashing helpers
- payload normalization helpers
- client-side API request layer only where still needed

Direct localStorage backend ownership must be removed from the authoritative path.

### `core/summarization/architectural-authority-runtime.js`

Refactor to:

- detect backend availability
- call plugin commit/read routes
- retain chat projection metadata handling
- stop treating local browser state as authoritative

### `core/summarization/architectural-prototype-adapter.js`

Quarantine from production imports.

Allowed dispositions:

- rename to explicit negative fixture
- move under a test/experimental path
- or leave unimported with clear prototype-only comments

It must not remain on the production call path if it writes out-of-band ordinary-chat receipts.

## Production prohibition carried forward from 1B0

No production code in C0 may patch ordinary chat files out of band.

Allowed Architectural persistence surfaces remain:

- host-owned saved shards
- lorebook saves already handled by the host path
- the per-user operational SQLite database

Prohibited production behavior remains:

- direct server-plugin writes into ordinary chat JSONL files
- post-save receipt patching of chat files
- browser-side authority that silently diverges from host-owned saves

### `core/summarization/output.js`

Keep host-owned shard save behavior.

Change Architectural post-save authority update to:

- confirm saved projection metadata
- then call companion plugin commit/bootstrap routes

### `ui/...`

Add backend readiness and migration status UI only as needed for C0.

Do not start archive browsing or C1/C2 runtime affordances here.

## Phase C0.5 File-by-File Plan

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

Candidate rebuild pipeline:

- corpus discovery
- source hashing
- checkpoint parse
- coverage map build
- delta interpretation
- dedup classification
- validation
- candidate promotion

### `core/summarization/architectural-rebuild-protocol.js`

Versioned interpretation and evidence contract shared between frontend and plugin.

### `core/summarization/architectural-rebuild-protocol.test.mjs`

Protocol and classification tests.

### `core/summarization/saved-shard-identity.js`

Reuse existing saved-shard identity helpers as recovery-corpus inputs.

### `core/summarization/architectural-record-parser.js`

Remains the structured parser for checkpoint records and decision payload reconstruction.

## Rebuild Interpretation Protocol Outline

Protocol version:

```text
architectural-rebuild-protocol/v1
```

## Evidence hierarchy

Authority order:

1. valid structured Architectural shard
2. explicit correction or decision in raw dialogue
3. character or lorebook canon
4. effective settings and enabled extension behavior
5. strongly implied raw-message evidence
6. semantic inference

Rules:

- higher tier wins for the same temporal scope
- later lower-tier evidence may create a correction or delta candidate
- later lower-tier evidence must not silently rewrite an earlier checkpoint
- inference cannot re-seal authority on its own

## Semantic handling classes

### ignored outright

- chatter
- praise
- duplicate filler
- formatting-only noise
- host metadata not tied to architectural meaning

### metadata-only

- source chat locator
- branch/import lineage
- saved output uid
- message span
- checkpoint hash
- creation timestamps

### semantically interpreted

- structured Architectural shard sections
- explicit decision/correction statements
- checkpointed CURRENT state
- explicit supersession chains
- explicit unresolved threads

## Checkpoint coverage requirements

Each checkpoint must expose or allow reconstruction of:

- source chat identity
- first covered message
- last covered message
- source collection or branch
- checkpoint creation position
- covered-span hash where practical

## Recovery statuses

- `EXACT`
- `CORROBORATED`
- `DELTA_RECOVERED`
- `RECONSTRUCTED`
- `CONFLICTED`
- `PARTIAL`

These apply to recovered records and to overall rebuild result reporting.

## Deduplication Rules

Governing rule:

```text
Deduplicate occurrences, not meaning.
```

Occurrence classes:

- `DUPLICATE`
- `CORROBORATION`
- `PROGRESSION`
- `CORRECTION`
- `CONFLICT`
- `DISTINCT`

Automatic merge is allowed only for deterministic equivalents:

- exact duplicate files
- same stable ID plus same canonical semantic hash
- exact structured equivalents
- explicit alias/migration mappings

Automatic merge is not allowed for:

- near-duplicate prose similarity
- same theme with different stable IDs
- “probably the same decision” guesses

False splits are preferred over false merges.

## Runtime Smoke Plan

These checks belong immediately after C0/C0.5 implementation.

### Host integration

1. extension detects plugin healthy state
2. extension detects missing plugin cleanly
3. plugin init succeeds on ST
4. plugin init succeeds on SB
5. CSRF-enabled host flow succeeds with fetched token
6. CSRF-disabled host flow succeeds with `disabled`

### Save path

7. save Architectural shard through normal host path
8. projection metadata remains discoverable after refresh
9. backend authority commit occurs only after save confirmation
10. no direct ordinary-chat patch route is used

### Migration

11. legacy local browser records migrate exactly
12. stale or conflicting browser records produce explicit report
13. browser-local data remains until verification completes

### Rebuild

14. remove DB and rebuild from corpus
15. rebuild produces candidate DB first
16. candidate promotion is atomic
17. rebuilt DB matches expected canonical hashes for exact recoverables

## Test Matrix

### C0

1. Node adapter opens DB and applies schema
2. Bun adapter opens DB and applies schema
3. Node-created DB reads on Bun
4. Bun-created DB reads on Node
5. Node-created managed snapshot restores on Node
6. Bun-created managed snapshot restores on Bun
7. Node-created snapshot reads on Bun
8. Bun-created snapshot reads on Node
9. compare-before-write conflict blocks stale update
10. transaction rollback preserves integrity
11. manifest init is idempotent
12. path resolution stays under authenticated user root
13. route validation rejects traversal input
14. browser migration exact equivalence succeeds
15. browser migration conflict is reported
16. no silent fallback to localStorage authority

### C0.5

17. rebuild candidate DB is separate from active DB
18. corrupt DB is quarantined
19. exact checkpoint reconstruction yields `EXACT`
20. lower-tier later evidence yields delta candidate, not silent rewrite
21. duplicate stable ID plus equal canonical hash deduplicates
22. similar content with different IDs does not merge
23. unresolved coverage emits audit finding
24. missing project files emit audit finding
25. incomplete scope membership emits audit finding
26. rebuild report classifies all spans

### Regression

27. `1B0` negative race remains documented and testable
28. Narrative Memory behavior unchanged
29. existing Architectural save/review behavior unchanged outside backend authority routing

## Treatment of Uncommitted 1B0 Files

## Bounded 1B0 evidence commit contents

The bounded evidence commit should contain only:

- `docs/architectural-memory/COMMIT_1B0_HOST_SUBSTRATE_FEASIBILITY_BRIEF.md`
- `docs/architectural-memory/PHASE_C0_C0_5_OPERATIONAL_DB_AND_REBUILD_BRIEF.md`
- `tools/server-plugin/install-summary-sharder-memory.ps1`
- `tools/server-plugin/summary-sharder-memory/index.js`
- `tools/server-plugin/summary-sharder-memory/core.js`
- `tools/server-plugin/summary-sharder-memory/core.test.mjs`
- `tools/server-plugin/summary-sharder-memory/package.json`
- `tools/server-plugin/summary-sharder-memory/README.md`
- any negative race or duplicate-identity test helpers already inside that bounded plugin scaffold

That commit must not:

- activate a production authority backend
- install receipt patching on a live production path
- alter Narrative behavior
- add C0.5 extraction logic

### Keep as useful evidence / scaffolding

- `docs/architectural-memory/COMMIT_1B0_HOST_SUBSTRATE_FEASIBILITY_BRIEF.md`
- `tools/server-plugin/install-summary-sharder-memory.ps1`
- `tools/server-plugin/summary-sharder-memory/index.js`
- `tools/server-plugin/summary-sharder-memory/core.js`
- `tools/server-plugin/summary-sharder-memory/core.test.mjs`
- `tools/server-plugin/summary-sharder-memory/package.json`
- `tools/server-plugin/summary-sharder-memory/README.md`

These should be edited, not blindly discarded, because they already prove:

- plugin install model
- route mounting
- cross-host portability harness
- duplicate identity detection
- exact replay scaffolding
- negative race evidence

### Quarantine from production imports

- `core/summarization/architectural-prototype-adapter.js`

Required action:

- remove it from any production import path
- retain only as experimental or negative fixture if it still performs receipt writes

### Retire from production route surface

Receipt-writing prototype endpoints must not survive into the C0 production API:

- `/prototype/write-receipt`
- any route that patches ordinary chat files directly

## Proposed Bounded Commit Sequence

### Commit C0-1

Server plugin substrate and runtime adapters:

- add Node and Bun SQLite adapters
- add manifest/init/health/capabilities routes
- create per-user DB directory and schema bootstrap

### Commit C0-2

Frontend backend integration:

- plugin detection
- init flow
- read/write API client
- remove browser-authoritative production path

### Commit C0-3

One-time browser migration:

- export legacy local records
- server import and verification
- migration audit reporting

### Commit C0.5-1

Recovery protocol and corpus discovery:

- interpretation protocol module
- checkpoint scanning
- coverage map

### Commit C0.5-2

Candidate rebuild engine:

- candidate DB creation
- dedup classification
- validation
- promotion/quarantine flow

### Commit C0.5-3

Smoke and regression completion:

- host integration smoke
- rebuild smoke
- negative `1B0` regression preservation

## Implementation Conclusion

The architecture is no longer blocked on substrate uncertainty.

## Cross-Host Operational Store Semantics

Separate SillyTavern and SillyBunny installations operate against separate user roots and therefore separate operational stores unless the same user-data corpus and `summary-sharder` store are intentionally transferred together.

The operational manifest should reserve or emit the following deployment metadata:

```js
{
  storeInstanceId,
  corpusId,
  lastCompiledCorpusHash,
  lastCompiledAt,
  hostFamily,
  runtimeAdapter,
}
```

`hostFamily` and `runtimeAdapter` are operational-only metadata. They must never alter semantic hashes, decision identity, scope identity, or canonical record comparison.

### Same Corpus Transfer

The user copies or restores the same recovery corpus together with the same operational store between hosts.

Expected behavior:

- `corpusId` remains the same
- semantic hashes remain the same
- scope identities remain the same
- `hostFamily` and `runtimeAdapter` may change
- the receiving host validates and continues the same authority history without semantic drift

### Rebuild on Another Host

The user restores only the recovery corpus on a different host and does not restore the operational store.

Expected C0.5 behavior:

- detect recoverable Architectural corpus
- classify the store as rebuild-required
- preserve or deterministically reconcile `corpusId`
- reconstruct a new operational store from corpus checkpoints
- surface recovery and conflict statuses instead of silently inventing empty authority

### Independent Host Forks

SillyTavern and SillyBunny each continue evolving separate copies of the same corpus or store.

Expected behavior:

- do not imply automatic synchronization
- detect divergent corpus fingerprints when stores are later combined
- surface fork reconciliation explicitly
- never choose a semantic winner from timestamps alone

Remote synchronization is out of scope for C0 and C0.5.

## Fresh Install Versus Lost-Store Boundary

The state marker correctly detects a lost store only when the marker itself survives. C0.5 must also handle the stronger loss boundary:

```text
no DB
no snapshot
no state marker
but Architectural checkpoints exist in corpus
```

That state must not silently initialize an empty authoritative history.

Expected C0.5 behavior:

- detect recoverable Architectural corpus before normal authority writes
- classify the operational store as rebuild-required
- block ordinary authority adoption until reconstruction or explicit user action
- allow empty-store initialization only when no recoverable Architectural corpus exists or the user explicitly starts a new scope

What has been proved:

- authenticated per-user user-root exists on both hosts
- full backup includes that root
- server plugins mount correctly on both hosts
- SQLite is available on both hosts through built-in runtime adapters
- Node and Bun can read each other’s SQLite files
- transaction and stale-write semantics are suitable for compare-before-write authority updates
- ordinary-chat out-of-band receipts are unsafe and must remain prohibited

The remaining browser-specific checks are implementation smoke items, not substrate blockers.

VERDICT: READY TO IMPLEMENT C0
