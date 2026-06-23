# Commit 1B0: Host-Substrate Feasibility Brief

## Status

This brief defines the bounded feasibility spike approved for the next Architectural Memory storage step.

It does not implement production authority semantics.

It exists to prove, on real SillyTavern and SillyBunny hosts, whether the scope-anchor journal direction is operationally sound before productionizing it.

## Governing Boundary

Commit `1B0` proves host behavior only.

Included:

- one app-managed scope anchor artifact per `memoryScopeId`
- append-style immutable prototype records
- immutable origin-chat receipts
- stable per-chat identity
- cross-chat read/write access
- deterministic compare-and-swap conflict behavior
- backup/restore portability
- exact replay and deduplication from receipts

Excluded:

- production `AUTHORITY_PROPOSED` / `AUTHORITY_COMMITTED`
- production authority migration from commit `9a7142090e77c2af2076965345b047bb383f7930`
- reference indexing
- archival movement
- stable-window policy
- RAG behavior
- semantic reconciliation
- final self-repair workflow

## Host Findings Already Confirmed

The feasibility design is anchored to actual host behavior, not assumptions.

### Plugin loading

Observed in `D:\AI\Projects\SillyTavern\src\plugin-loader.js`:

- server plugins load from the host `plugins` directory
- a plugin may be a directory with `package.json` or `index.js` / `index.cjs` / `index.mjs`
- plugins register an Express router
- routes mount under:

```text
/api/plugins/<plugin-id>
```

This is sufficient for a small companion plugin:

```text
summary-sharder-memory
```

All plugin path resolution for `1B0` must use the authenticated host request context.

Do not hardcode `default-user`.
Do not derive user paths from a client-supplied handle.
Every anchor and receipt path must be verified to remain beneath the authenticated user's chat root.

### Chat persistence substrate

Observed in `D:\AI\Projects\SillyTavern\src\endpoints\chats.js` and mirrored data roots:

- ordinary chats live under:

```text
<user-root>/chats/<character>/<chat>.jsonl
```

- group chats live under:

```text
<user-root>/group chats/<id>.jsonl
```

- chat files are JSONL
- line 1 is a header object carrying `chat_metadata`
- normal chat save rewrites the whole file
- chat rename is implemented as copy + delete
- JSONL import creates a new chat file rather than mutating an existing one
- backup files are written under:

```text
<user-root>/backups/
```

Implication: production authority cannot rely on browser-local cache, and any app-owned records written into ordinary chats must be coordinated with full-file host saves.

`1B0` must also verify that ordinary host tooling does not mis-handle the anchor artifact simply because it lives under the normal chat tree.

## Feasibility Questions to Answer

`1B0` must answer these with evidence:

1. Can one app-managed anchor artifact be created and rediscovered reliably on both hosts?
2. Which host-supported surface best preserves immutable app-owned records:
   - dedicated anchor chat file
   - ordinary chat hidden receipt records
   - `chat_metadata`
3. Do unknown app-owned fields survive save, reload, restart, rename, branch, import, and backup/restore?
4. Can two clients perform deterministic CAS against the same anchor head without silent overwrite?
5. Can an originating chat receive a receipt while an ordinary host save happens nearby, without either write erasing the other?
6. Can replay from anchor records and deduplicated receipts reproduce identical canonical hashes?
7. Can anchor discovery remain unambiguous under rename, malformed headers, unrelated files, and duplicate-claim conditions?
8. Can the host keep anchor and receipt records out of model-visible context in real assembled prompts, not just out of the UI?
9. Can ordinary host save paths and prototype receipt writes coexist without silent lost updates across multiple operation orderings?

If any answer is no on either host, stop and report. Do not force the design through.

## Prototype Architecture Under Test

### 1. Scope anchor artifact

Each `memoryScopeId` gets one dedicated app-managed anchor chat file.

Proposed prototype location:

```text
<user-root>/chats/Summary Sharder System/__summary_sharder_scope__<memoryScopeId>.jsonl
```

This location is provisional. `1B0` may revise the exact folder/name if host behavior shows a safer substrate.

The anchor must be:

- excluded from model-visible generation context
- hidden from ordinary chat choice where feasible
- clearly marked as app-owned
- easy to detect if missing
- included in standard host backup

Anchor identity is not the filename.

Discovery must validate the artifact header:

- `kind`
- `schemaVersion`
- `prototypeVersion`
- `memoryScopeId`

Multiple valid anchors claiming the same `memoryScopeId` are a blocking ambiguity.
`1B0` must not pick one by filename order, modification time, or directory enumeration order.

### 2. Anchor record shape

The anchor is JSONL.

Record 1 identifies the artifact:

```json
{
  "summarySharderArtifact": {
    "kind": "architectural-authority-journal",
    "schemaVersion": 1,
    "prototypeVersion": "1B0",
    "memoryScopeId": "scope_01j...",
    "createdAt": 1782144000000
  }
}
```

Subsequent records are immutable prototype events:

```json
{
  "summarySharderEvent": {
    "eventId": "evt_01j...",
    "memoryScopeId": "scope_01j...",
    "decisionId": "gain-modulation-boundary",
    "expectedHead": "sha256:...",
    "canonicalHash": "sha256:...",
    "canonicalHashVersion": 1,
    "hashAlgorithm": "SHA-256",
    "payload": {
      "recordType": "prototype-decision-event",
      "recordVersion": 1,
      "canonicalRecord": {}
    },
    "originChatInstanceId": "chat_01j...",
    "originShardId": "shard_01j...",
    "createdAt": 1782144000000
  }
}
```

These are prototype envelopes only. They exist to test preservation, ordering, replay, and conflict behavior.

### 3. Origin-chat receipt shape

Each originating ordinary chat receives immutable receipts for prototype events.

Prototype receipt:

```json
{
  "summarySharderReceipt": {
    "receiptSchemaVersion": 1,
    "eventId": "evt_01j...",
    "memoryScopeId": "scope_01j...",
    "decisionId": "gain-modulation-boundary",
    "expectedHead": "sha256:...",
    "canonicalHash": "sha256:...",
    "canonicalHashVersion": 1,
    "hashAlgorithm": "SHA-256",
    "originChatInstanceId": "chat_01j...",
    "originShardId": "shard_01j...",
    "canonicalRecord": {},
    "createdAt": 1782144000000
  }
}
```

`1B0` must test two candidate receipt surfaces:

1. hidden app-owned JSONL records inside the ordinary chat file
2. app-owned `chat_metadata` entries

The pass criterion is preservation quality, not aesthetic preference.

## Stable Identity Contract for the Prototype

Each participating chat receives immutable app-owned metadata:

```json
{
  "summarySharderRuntime": {
    "chatInstanceId": "chat_01j...",
    "memoryScopeId": "scope_01j...",
    "branchedFromChatInstanceId": "chat_01j_parent..."
  }
}
```

Rules under test:

- rename preserves `chatInstanceId`
- branch gets a new `chatInstanceId`
- branch keeps `branchedFromChatInstanceId`
- copied historical receipts retain original `eventId` and `originChatInstanceId`
- copied receipts do not become new authority mutations

## Minimal Plugin Surface for 1B0

Plugin ID:

```text
summary-sharder-memory
```

Base route:

```text
/api/plugins/summary-sharder-memory
```

Prototype endpoints:

```text
GET  /health
POST /prototype/init-scope
GET  /prototype/load-anchor
POST /prototype/append-anchor-event
POST /prototype/write-receipt
POST /prototype/verify-replay
POST /prototype/simulate-conflict
POST /prototype/scan-chat-runtime
```

Purpose:

- create/find anchor
- append immutable prototype events
- write receipts into an originating chat
- enforce expected-head CAS
- verify exact replay
- inspect chat identity and receipt preservation

No arbitrary filesystem path endpoint is allowed.

All endpoints must resolve the authenticated user's real chat root from the host request context.

## Feasibility Test Matrix

### A. Preservation

1. Create scope anchor and rediscover it after host restart.
2. Append multiple immutable prototype events and verify order is preserved.
3. Persist origin receipts and verify they survive reload.
4. Verify app-owned fields survive browser refresh, reload, and restart.
5. Verify anchor discovery handles:
   - expected anchor found
   - renamed filename with valid header
   - malformed anchor header
   - unrelated files in the anchor directory
   - duplicate valid anchors for one scope
   - filename scope and header scope disagreement

### B. Identity

6. Rename ordinary chat and confirm `chatInstanceId` is unchanged.
7. Branch ordinary chat and confirm:
   - new `chatInstanceId`
   - preserved `branchedFromChatInstanceId`
   - copied receipts deduplicate by `eventId`
8. Full backup restore preserves existing `chatInstanceId`, scope identities, and event identities.
9. Ordinary chat import does not silently create two live writable chats sharing one `chatInstanceId`.
   - either assign a new `chatInstanceId` plus `importedFromChatInstanceId`
   - or block pending reconciliation

### C. Save-race behavior

10. Use identifiable revisions and test:
    - `R then M`
    - `M then R`
    - overlapping `R` and `M`
    - retry after detected revision conflict
11. Reload after each ordering and confirm:
    - conversational update still exists
    - receipt still exists
    - no app-owned fields were reverted
    - otherwise one side received an explicit retryable conflict

### D. Cross-chat access

12. With chat A active, append to the anchor for a shared scope.
13. Switch to chat B bound to the same scope and confirm the same anchor is loaded.
14. Where the host supports multiple users, verify per-user isolation using authenticated user roots.

### E. CAS behavior

15. Two clients attempt the same expected-head append.
16. Confirm exactly one success and one conflict.
17. Confirm no last-write-wins overwrite.

### F. Backup/restore

18. Create anchor plus receipts.
19. Run standard full-user backup on host.
20. Inspect backup and confirm anchor and originating chats are present.
21. Restore into clean host copy on the same host family.
22. Verify anchor rediscovery, receipt preservation, and exact replay hash equality.
23. Test cross-host portability:
    - SillyTavern backup or data into SillyBunny
    - SillyBunny backup or data into SillyTavern
24. Verify:
    - anchor discovery
    - receipt preservation
    - stable identities
    - append order
    - replay hashes
    - no host-specific authority rewrite

### G. Reconstruction

25. Delete materialized prototype state.
26. Rebuild from anchor alone.
27. Delete anchor.
28. Rebuild from deduplicated receipts.
29. Emit a replay coverage report including:
    - anchor event count
    - unique receipt event count
    - duplicate receipt count
    - missing event IDs or version gaps
    - competing children of the same expected head
    - unavailable origin chats
    - final reconstructed head and hash
30. Classify replay result as:
    - `exact`
    - `incomplete`
    - `conflicted`
    - `invalid`
31. Confirm canonical hashes match the original replay result only for `exact`.

### H. Tooling and prompt exclusion

32. Verify the anchor does not break or pollute:
    - ordinary chat enumeration
    - recent-chat lists
    - chat previews
    - host search, where applicable
    - data-maintenance or integrity checks
    - backup creation
    - character/chat deletion workflows
33. Capture or inspect the assembled model context on both hosts and prove that:
    - anchor records do not enter model-visible context
    - receipt records do not enter model-visible context
    - app-owned identity metadata does not enter model-visible context
34. Do not infer prompt exclusion from UI hiding alone.

## Pass/Fail Gates

### Pass

Proceed to `1B1` only if both SillyTavern and SillyBunny demonstrate:

- per-user isolation
- unambiguous anchor discovery
- no host-tooling disruption
- anchor creation and rediscovery
- unknown-field preservation
- append-order preservation
- receipt preservation
- actual prompt exclusion
- safe interaction with normal chat save across tested orderings
- deterministic CAS conflict
- exact replay from anchor
- exact replay from deduplicated receipts with complete coverage
- branch-aware receipt deduplication
- successful backup/restore round trip
- import identity correctness
- cross-host restore

### Conditional pass

Allowed only if host differences can be hidden behind one adapter contract without changing authority semantics.

### Fail

Stop the anchor approach if either host:

- strips or rewrites required fields
- cannot preserve append order
- cannot coordinate with normal chat save
- leaks records into model context
- breaks receipts on branch/restore
- cannot reproduce identical hashes
- requires invasive host-core patching

## Production Guidance This Spike Should Produce

If `1B0` passes, it should resolve:

1. exact anchor file placement
2. exact receipt surface
3. exact CAS head token shape
4. whether ordinary chat hidden records are viable
5. whether `chat_metadata` is acceptable only for identity pointers
6. exact adapter contract shared by Node and Bun hosts
7. duplicate-anchor handling
8. import-collision policy
9. replay coverage requirements

## Treatment of Existing Commit `9a71420`

The committed browser-local authority work remains a prototype/reference only.

`1B0` does not extend that backend.

Use it only as:

- data-contract reference
- canonical-hash reference
- migration-input reference for later work

Do not rely on `localStorage` for any authoritative result in `1B0`.

## Host Verification Procedure

Primary host roots:

- `D:\AI\Projects\SillyTavern`
- `D:\AI\Projects\SillyBunny`

Confirmed prerequisites:

- both expose `data/default-user/chats`
- both have server plugins enabled

Run order:

1. prove behavior on SillyTavern
2. mirror the same prototype on SillyBunny
3. compare differences
4. only then decide whether to promote to `1B1`

## Bounded Deliverables for 1B0

Code:

- companion prototype plugin
- frontend prototype adapter
- targeted test helpers

Evidence:

- tested anchor shape
- tested receipt surface
- save-race result
- CAS result
- backup/restore result
- replay/hash result
- Node/Bun difference report

Report verdict:

- `pass`
- `conditional pass`
- `fail`

The `1B0` completion report must additionally include:

- anchor discovery algorithm
- duplicate-anchor behavior
- import identity result
- receipt coverage report shape
- prompt-exclusion evidence
- all tested normal-save orderings
- cross-host restore results
- prototype cleanup procedure

## Non-Goals Reminder

Do not let this spike drift into:

- final authority protocol
- archival movement
- reference indexing
- RAG integration
- semantic merge policy
- automatic repair beyond deterministic replay checks

The only correct output of `1B0` is host truth.

## Backup Scope Clarification

The guarantee for `1B0` applies to the host's full user-data backup.

A single ordinary chat export does not imply preservation of:

- the scope anchor
- receipts originating in other chats
- the complete shared architectural scope

`1B0` must document that distinction explicitly.

## Cleanup Constraint

All prototype artifacts must be unmistakably marked:

```text
prototypeVersion: 1B0
```

The spike must provide a cleanup path that removes only verified `1B0` prototype artifacts.

It must not:

- migrate production-like authority
- create production authority state
- alter Narrative behavior
- leave ambiguous prototype anchors that later code could misread as production journals
