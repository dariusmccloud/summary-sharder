# Phase C0 and C0.5: Operational Database and Self-Healing Rebuild Brief

## Status

This document is now historical substrate and recovery rationale.

It preserves:

- the completed `C0` operational-database substrate
- the governing negative findings from `1B0`
- the recovery and portability facts that still constrain later reconstruction work

The active executable reconstruction contract now lives in:

- [PHASE_C0_5A_CANDIDATE_REBUILD_ORCHESTRATION_BRIEF.md](C:\Users\chris\OneDrive\Documents\Personal\Projects\summary-sharder\docs\architectural-memory\PHASE_C0_5A_CANDIDATE_REBUILD_ORCHESTRATION_BRIEF.md)

This historical document must not be used as the sole implementation brief for new work.

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

- `POST /rebuild/candidate/init`
- `POST /rebuild/candidate/run`
- `GET /rebuild/candidate/report/:jobId`

These belong to `C0.5A` but live in the same plugin.

No promote or candidate-to-live swap route may exist in `C0.5A`.

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
5. emit candidate report and stop before promotion

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

## Phase C0.5A: Candidate Rebuild Orchestration

`C0.5A` is the first bounded reconstruction slice.

It must prove that the system can:

```text
discover corpus
→ freeze input manifest
→ create isolated candidate DB
→ compile one bounded source class
→ validate candidate
→ emit report
→ stop before promotion
```

Successful `C0.5A` completion means:

```text
candidate built
candidate validated
report emitted
live authority untouched
promotion unavailable
```

## C0.5A Governing Constraints

1. Corpus discovery is read-only.
2. No chat normalization occurs during reconstruction discovery.
3. No metadata adoption occurs during reconstruction discovery.
4. No native host save is triggered by reconstruction.
5. No live authority mutation is permitted.
6. A mixed-time corpus view is invalid.
7. Content integrity and prompt exposure remain independent dimensions.
8. Exposure-only problems must not automatically invalidate semantically intact evidence.
9. Candidate failure fails closed.
10. `C0.5A` contains no promotion path.

## C0.5A Admission Scope

The first compiler input is intentionally narrow.

Admit only:

- valid identity-backed Architectural shard artifacts
- valid saved shard/source manifests
- admitted evidence-policy state
- non-conflicted content integrity

Exclude or block:

- structurally invalid shard artifacts
- conflicted content integrity
- unsupported schema versions
- incomplete required provenance
- sources whose frozen file hash changes during the run

Prompt-exposure diagnostics remain reportable, but exposure-only problems do not by themselves make semantically intact shard evidence inadmissible.

## C0.5A Input Manifest

Freeze a reconstruction input manifest before compilation begins.

Minimum schema:

```js
{
  schemaVersion: 1,
  protocolVersion: 'architectural-rebuild-protocol/v1',
  reconstructionRunId: 'rebuild_...',
  memoryScopeId: 'scope_...',
  createdAt: 1782144000000,
  sources: [
    {
      sourceId: 'src_...',
      sourceClass: 'architectural-shard',
      sourceLocator: {
        hostFamily: 'sillytavern|sillybunny',
        userRoot: 'default-user',
        relativePath: 'chats/Jeep/...jsonl',
        messageId: 'msg_...',
        outputUid: '...',
      },
      chatInstanceId: 'chat_...',
      sourceFileHash: 'sha256:...',
      sourceFileBytes: 12345,
      schemaVersion: 2,
      headerVersion: 1,
      messageCount: 250,
      identityStatus: 'identity-complete|identity-partial|identity-conflicted',
      shardManifestCount: 3,
      contentHealth: 'INTACT|STALE|DEGRADED|ORPHANED|CONFLICTED',
      exposureHealth: 'EXPOSURE_OK|SOURCE_AND_ARTIFACT_VISIBLE|SOURCE_VISIBLE_ARTIFACT_HIDDEN|SOURCE_HIDDEN_ARTIFACT_HIDDEN|VISIBILITY_POLICY_UNKNOWN',
      admissionStatus: 'admitted|excluded|blocked',
      admissionReason: '...',
      frozenAt: 1782144000000,
    },
  ],
}
```

Rules:

- every admitted source must be frozen with a stable file hash before compilation
- admitted-source mutation after freeze invalidates the candidate run
- excluded and blocked sources still appear in the manifest with explicit reasons
- manifest freeze is itself read-only and must not rewrite corpus files

## C0.5A Candidate Database Boundary

Candidate reconstruction must write to a physically separate database.

Requirements:

- do not write to the live C0 operational DB
- do not overwrite the live snapshot DB
- do not overwrite the live state marker
- use an explicit candidate filename tied to the reconstruction run ID
- ordinary authority reads must never consult the candidate DB

Candidate path shape:

```text
<user-root>/summary-sharder/candidates/architectural-memory.candidate.<reconstructionRunId>.db
```

Related artifacts may include:

```text
architectural-memory.candidate.<reconstructionRunId>.report.json
architectural-memory.candidate.<reconstructionRunId>.manifest.json
```

These candidate artifacts are not authority state.

## C0.5A Candidate Schema Changes

`C0.5A` should add candidate-only tables or their equivalent for:

```js
{
  reconstruction_runs: [
    'reconstruction_run_id',
    'memory_scope_id',
    'protocol_version',
    'status',
    'started_at',
    'finished_at',
    'failure_reason',
  ],
  reconstruction_manifest_sources: [
    'reconstruction_run_id',
    'source_id',
    'source_class',
    'source_locator_json',
    'chat_instance_id',
    'source_file_hash',
    'schema_version',
    'header_version',
    'message_count',
    'identity_status',
    'shard_manifest_count',
    'content_health',
    'exposure_health',
    'admission_status',
    'admission_reason',
  ],
  reconstruction_candidate_records: [
    'reconstruction_run_id',
    'record_id',
    'record_type',
    'canonical_hash',
    'canonical_hash_version',
    'record_version',
    'memory_scope_id',
    'payload_json',
  ],
  reconstruction_candidate_provenance: [
    'reconstruction_run_id',
    'record_id',
    'speaker_entity_id',
    'chat_instance_id',
    'artifact_message_id',
    'source_manifest_id',
    'covered_source_ids_json',
    'source_revision_hash',
    'source_identity_hash',
  ],
  reconstruction_candidate_issues: [
    'reconstruction_run_id',
    'issue_id',
    'severity',
    'code',
    'message',
    'source_id',
    'details_json',
  ],
}
```

These tables live only in the candidate DB for `C0.5A`.

No live authority table should be rewritten, swapped, or consulted through candidate aliases in this slice.

## C0.5A Provenance Minimum

Every candidate row must retain provenance back to:

- memory scope
- speaker entity
- chat instance
- artifact message ID
- source manifest
- covered source identities
- source hashes
- reconstruction run

Incomplete required provenance is a validation failure.

## C0.5A Validation Requirements

Before reporting success, validate:

- schema opens cleanly
- foreign keys hold
- scope consistency holds
- identity uniqueness holds
- provenance completeness holds
- collision handling is explicit
- admitted inputs reconcile to outputs
- exclusions and rejections are explicit
- live authority remained unchanged

If any of the above fail:

- candidate status becomes failed or invalid
- report still emits if possible
- live authority remains untouched

## C0.5A Reconstruction Report Schema

Emit both a compact human-readable summary and a machine-readable report.

Minimum machine-readable schema:

```js
{
  schemaVersion: 1,
  protocolVersion: 'architectural-rebuild-protocol/v1',
  reconstructionRunId: 'rebuild_...',
  memoryScopeId: 'scope_...',
  status: 'success|failed|invalid',
  candidateDbPath: '...',
  manifestPath: '...',
  startedAt: 1782144000000,
  finishedAt: 1782144001234,
  liveAuthorityChanged: false,
  promotionAvailable: false,
  inputSummary: {
    totalSources: 12,
    admittedSources: 8,
    excludedSources: 3,
    blockedSources: 1,
  },
  outputSummary: {
    candidateRecordCount: 42,
    candidateIssueCount: 5,
  },
  coverage: {
    exact: 10,
    corroborated: 0,
    deltaRecovered: 0,
    reconstructed: 0,
    conflicted: 2,
    partial: 1,
  },
  exclusions: [
    { sourceId: 'src_...', reason: 'unsupported_schema' },
  ],
  conflicts: [
    { sourceId: 'src_...', code: 'SHARD_MANIFEST_INVALID' },
  ],
  unresolvedEvidence: [
    { sourceId: 'src_...', reason: 'identity_partial' },
  ],
  promotionBlockers: [
    'promotion path intentionally unavailable in C0.5A',
  ],
  determinism: {
    attempted: true,
    equivalent: true,
    differingFieldsIgnored: ['reconstructionRunId', 'startedAt', 'finishedAt'],
    unexplainedDifferences: [],
  },
}
```

## C0.5A Determinism Proof

Run unchanged admitted corpus twice.

Compare meaningful candidate state while ignoring only explicitly variable operational fields such as:

- reconstruction run ID
- timestamps
- file paths derived only from the run ID

Unexplained differences are a failure.

## C0.5A No-Promotion Proof

`C0.5A` must contain no promotion path.

Explicitly prohibited:

- no automatic swap
- no promote endpoint
- no promote UI
- no startup adoption
- no candidate-to-live fallback

Proof obligations:

- candidate DB path is distinct from live DB path
- live manifest/state marker file hashes do not change during candidate build
- ordinary authority-read code paths do not open candidate artifacts
- route surface exposes build/validate/report only

## Phase C0.5A File-by-File Plan

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

Own `C0.5A` orchestration:

- read-only corpus discovery
- input manifest freeze
- admitted-source mutation recheck
- candidate DB creation
- bounded structured-shard compilation
- candidate validation
- human and machine report emission
- no promotion behavior

### `tools/server-plugin/summary-sharder-memory/schema.js`

Add candidate-only reconstruction tables and migration guards for:

- reconstruction runs
- manifest sources
- candidate records
- candidate provenance
- candidate issues

Do not alter live authority lookup semantics in this slice.

### `tools/server-plugin/summary-sharder-memory/core.js`

Add helpers for:

- candidate path derivation
- manifest file hashing
- read-only source admission
- live-store immutability checks

### `tools/server-plugin/summary-sharder-memory/index.js`

Add bounded rebuild routes only:

- `POST /rebuild/candidate/init`
- `POST /rebuild/candidate/run`
- `GET /rebuild/candidate/report`

No promotion route may exist.

### `core/summarization/architectural-rebuild-protocol.js`

Define:

- protocol version
- input-manifest normalization
- admission enums
- report enums
- determinism comparison rules

### `core/summarization/architectural-rebuild-protocol.test.mjs`

Add tests for:

- manifest normalization
- admission-state validation
- determinism comparison
- report schema validation

### `core/summarization/saved-shard-identity.js`

Reuse as recovery-corpus locator and provenance helper.

### `core/summarization/architectural-record-parser.js`

Remain the structured parser for Architectural shard payloads.

For `C0.5A`, parse only the highest-confidence structured class.

## Rebuild Interpretation Protocol Outline

Protocol version:

```text
architectural-rebuild-protocol/v1
```

## C0.5A Evidence Hierarchy

Authority order remains:

1. valid structured Architectural shard
2. explicit correction or decision in raw dialogue
3. character or lorebook canon
4. effective settings and enabled extension behavior
5. strongly implied raw-message evidence
6. semantic inference

However, `C0.5A` compiles only tier 1 automatically.

Lower tiers remain future input classes for later reconstruction slices and may still appear in the report as unresolved evidence.

## C0.5A Semantic Handling Classes

### admitted and compiled

- structured Architectural shard sections
- explicit shard CURRENT state
- explicit structured supersession chains
- explicit structured unresolved threads

### discovered but not compiled in C0.5A

- raw dialogue corrections
- lorebook canon
- settings-derived evidence
- implied evidence
- semantic inference candidates

### metadata-only

- source chat locator
- branch/import lineage
- saved output uid
- message span
- checkpoint hash
- creation timestamps

## Runtime Smoke Plan

These checks belong immediately after `C0.5A` implementation.

### Host integration

1. extension detects plugin healthy state
2. extension detects missing plugin cleanly
3. plugin init succeeds on ST
4. plugin init succeeds on SB
5. CSRF-enabled host flow succeeds with fetched token
6. CSRF-disabled host flow succeeds with `disabled`

### C0.5A candidate orchestration

7. corpus discovery is read-only
8. frozen manifest is emitted before compile
9. admitted source mutation after freeze invalidates the run
10. candidate DB path is distinct from live DB path
11. live DB, snapshot DB, and state marker remain unchanged
12. only admitted structured shard sources compile
13. candidate validates before success is reported
14. machine-readable report is emitted
15. human-readable summary is emitted
16. promotion remains unavailable

## Test Matrix

### C0.5A

1. read-only discovery does not trigger host save
2. manifest freeze records admitted, excluded, and blocked sources
3. source mutation after freeze invalidates the candidate
4. candidate DB is physically separate from active DB
5. live DB snapshot and state marker hashes remain unchanged
6. unsupported schema source is excluded with explicit reason
7. conflicted content-integrity source is blocked
8. exposure-only issue remains reportable without forcing semantic exclusion
9. candidate rows retain full required provenance
10. schema and foreign-key validation runs before success
11. admitted-input versus output reconciliation is explicit
12. machine-readable report classifies exclusions, conflicts, and unresolved evidence
13. unchanged corpus run twice yields equivalent meaningful candidate state
14. unexplained determinism differences fail the run
15. no route, UI, or startup path can promote a candidate

### Regression

16. `1B0` negative race remains documented and testable
17. Narrative Memory behavior unchanged
18. existing Architectural save/review behavior unchanged outside reconstruction routes

## Treatment of Uncommitted 1B0 Files

## Bounded 1B0 evidence commit contents

The bounded evidence commit should contain only:

- `docs/architectural-memory/COMMIT_1B0_HOST_SUBSTRATE_FEASIBILITY_BRIEF.md`
- `docs/architectural-memory/PHASE_C0_5_OPERATIONAL_DB_AND_REBUILD_BRIEF.md`
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

### Commit C0.5A-1

Candidate rebuild orchestration:

- interpretation protocol module
- read-only corpus discovery
- frozen input manifest
- candidate DB creation
- bounded structured-shard compilation
- validation and reporting
- explicit no-promotion surface

### Commit C0.5A-2

Smoke and determinism completion:

- host integration smoke
- candidate validation smoke
- repeated unchanged-input determinism proof
- negative regression preservation

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

VERDICT: HISTORICAL C0 SUBSTRATE RECORD; ACTIVE C0.5A CONTRACT MOVED TO PHASE_C0_5A_CANDIDATE_REBUILD_ORCHESTRATION_BRIEF.md
