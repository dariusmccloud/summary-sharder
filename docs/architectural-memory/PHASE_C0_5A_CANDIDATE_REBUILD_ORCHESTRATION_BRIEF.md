# Phase C0.5A: Candidate Rebuild Orchestration Brief

## Status

This is the active executable contract for `C0.5A`.

`C0.25` is complete.

`C0.5A` is the next boundary and is limited to candidate rebuild orchestration only.

It does not authorize:

- promotion
- startup adoption from candidate state
- live authority mutation
- corpus normalization
- metadata adoption
- model-assisted interpretation
- compilation of lower evidence tiers

## Governing Flow

`C0.5A` must prove this chain:

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

## Core Constraints

1. Corpus discovery is read-only.
2. No chat normalization occurs during the run.
3. No metadata adoption occurs during the run.
4. No native host save is triggered by reconstruction.
5. No live authority mutation is permitted.
6. No live DB, live snapshot, live state marker, live WAL, or live SHM may be mutated by reconstruction code.
7. A mixed-time corpus view is invalid.
8. Content integrity and prompt exposure remain independent dimensions.
9. Candidate failure fails closed.
10. `C0.5A` contains no promotion path.
11. `C0.5A` performs no LLM or model calls.

## Historical / Current Document Disposition

- [PHASE_C0_C0_5_OPERATIONAL_DB_AND_REBUILD_BRIEF.md](C:\Users\chris\OneDrive\Documents\Personal\Projects\summary-sharder\docs\architectural-memory\PHASE_C0_C0_5_OPERATIONAL_DB_AND_REBUILD_BRIEF.md)
  - historical substrate and recovery rationale
  - completed `C0` evidence
  - governing negative findings from `1B0`
- `PHASE_C0_5A_CANDIDATE_REBUILD_ORCHESTRATION_BRIEF.md`
  - current active `C0.5A` implementation contract

## Admission Scope

The first compiler input is intentionally narrow.

Admit only artifacts that satisfy all of the following:

- structured Architectural shard artifact
- parser/schema version supported
- artifact message has immutable identity
- source manifest is valid
- every required covered source has immutable identity
- evidence policy is `include` or absent-with-legacy-default
- content health is `INTACT`
- required provenance is complete

Block:

- `STALE`
- `DEGRADED`
- `ORPHANED`
- `CONFLICTED`

Exposure health is independent:

- any valid exposure state is reportable
- double inclusion is reportable and does not automatically block intact evidence
- unknown legacy visibility policy is reportable and must not rewrite the corpus

Admission is artifact-level.

A chat may be globally `identity-partial` while a particular artifact is admissible.

Rule:

> Admit the artifact when every identity required by that artifact is complete, while reporting the chat’s broader partial state.

## Frozen Input Manifest

Freeze the reconstruction view before compilation begins.

Use separate physical-file and artifact entries.

Minimum schema:

```js
{
  schemaVersion: 1,
  protocolVersion: 'architectural-rebuild-protocol/v1',
  reconstructionRunId: 'rebuild_...',
  memoryScopeId: 'scope_...',
  createdAt: 1782144000000,
  corpusFiles: [
    {
      corpusFileId: 'file_...',
      sourceLocator: {
        hostFamily: 'sillytavern|sillybunny',
        userRoot: 'default-user',
        relativePath: 'chats/Jeep/chat.jsonl',
      },
      chatInstanceId: 'chat_...',
      physicalFileHash: 'sha256:...',
      physicalFileBytes: 12345,
      schemaVersion: 2,
      headerVersion: 1,
      messageCount: 250,
      identityStatus: 'identity-complete|identity-partial|identity-conflicted',
      frozenAt: 1782144000000,
    },
  ],
  artifacts: [
    {
      sourceId: 'src_...',
      corpusFileId: 'file_...',
      artifactMessageId: 'msg_...',
      outputUid: '...',
      sourceManifestId: 'manifest_...',
      artifactKind: 'architectural-shard',
      semanticSourceHash: 'sha256:...',
      shardManifestCount: 3,
      contentHealth: 'INTACT|STALE|DEGRADED|ORPHANED|CONFLICTED',
      exposureHealth: 'EXPOSURE_OK|SOURCE_AND_ARTIFACT_VISIBLE|SOURCE_VISIBLE_ARTIFACT_HIDDEN|SOURCE_HIDDEN_ARTIFACT_HIDDEN|VISIBILITY_POLICY_UNKNOWN',
      evidencePolicy: 'include|exclude|legacy-default-include',
      admissionStatus: 'admitted|excluded|blocked',
      admissionReason: '...',
    },
  ],
}
```

### Hash Semantics

`physicalFileHash`

- exact bytes on disk
- used to detect any corpus mutation during the run

`semanticSourceHash`

- canonical identity/revision state relevant to the admitted artifact
- used for cross-run semantic equivalence and determinism

Rules:

- physical files are hashed once
- artifacts reference the containing physical file
- admitted-source mutation after freeze invalidates the run
- excluded and blocked artifacts still appear in the manifest with explicit reasons
- manifest freeze is read-only and must not rewrite corpus files

## Candidate Database Boundary

The candidate DB must be physically separate from live authority.

Requirements:

- do not write to the live C0 DB
- do not update the live manifest
- do not update `last_successful_rebuild_at`
- do not write rebuild-job state into the live DB
- do not overwrite the live snapshot or state marker
- do not add candidate tables to the live DB
- do not open the live DB through a writable reconstruction connection
- normal authority reads must never consult candidate artifacts

Candidate path shape:

```text
<user-root>/summary-sharder/candidates/architectural-memory.candidate.<reconstructionRunId>.db
```

Sidecars:

```text
architectural-memory.candidate.<reconstructionRunId>.manifest.json
architectural-memory.candidate.<reconstructionRunId>.report.json
```

## Candidate Schema

The candidate DB must be operational-schema-shaped.

That means:

- create the candidate from a clean copy of the current operational schema
- reconstruct authority into the same logical authority tables used operationally
- add reconstruction audit tables alongside them
- provide no swap, rename, promote, or adoption path in `C0.5A`

### Operational Schema in Candidate

At minimum, the candidate must contain the logical operational authority tables needed to prove that the rebuilt artifact could later become live authority, including:

- decision records
- current decision pointers
- provenance
- bindings

Use the existing operational schema shape already established by `C0`.

### Candidate-Only Audit Tables

Add audit/run tables only inside the candidate DB:

```js
{
  reconstruction_runs: [
    'reconstruction_run_id',
    'memory_scope_id',
    'protocol_version',
    'status',
    'request_key',
    'started_at',
    'finished_at',
    'failure_reason',
  ],
  reconstruction_manifest_files: [
    'reconstruction_run_id',
    'corpus_file_id',
    'relative_path',
    'chat_instance_id',
    'physical_file_hash',
    'physical_file_bytes',
    'schema_version',
    'header_version',
    'message_count',
    'identity_status',
  ],
  reconstruction_manifest_artifacts: [
    'reconstruction_run_id',
    'source_id',
    'corpus_file_id',
    'artifact_message_id',
    'output_uid',
    'source_manifest_id',
    'artifact_kind',
    'semantic_source_hash',
    'content_health',
    'exposure_health',
    'evidence_policy',
    'admission_status',
    'admission_reason',
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
  reconstruction_candidate_provenance: [
    'reconstruction_run_id',
    'provenance_id',
    'record_id',
    'memory_scope_id',
    'speaker_entity_id',
    'chat_instance_id',
    'artifact_message_id',
    'source_manifest_id',
    'source_revision_hash',
    'source_identity_hash',
  ],
  reconstruction_candidate_provenance_sources: [
    'reconstruction_run_id',
    'provenance_id',
    'covered_source_message_id',
  ],
}
```

Use relational provenance rows for covered source message IDs.

Do not rely on a single `covered_source_ids_json` field as the only candidate representation.

## Provenance Minimum

Every reconstructed candidate record must retain provenance back to:

- memory scope
- speaker entity
- chat instance
- artifact message ID
- source manifest
- covered source identities
- source hashes
- reconstruction run

Incomplete required provenance is a validation failure.

## Validation Requirements

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

Failure conditions include:

- corpus mutation after freeze
- validation failure
- unsupported schema
- incomplete required provenance
- report emission failure

On failure:

- candidate status becomes failed, invalid, or invalidated
- live authority remains untouched
- if possible, emit a failure report rather than failing silently

## Deterministic Comparison Specification

Determinism must be mechanical, not narrative.

The algorithm must:

1. list candidate tables included in comparison
2. omit only explicitly variable columns
3. sort rows by declared primary key
4. canonicalize JSON fields recursively
5. normalize absent versus null according to schema
6. serialize using UTF-8 and fixed separators
7. hash the canonical dump
8. compare both:
   - canonical candidate hash
   - row-level diff on mismatch

Ignore only named variable fields such as:

- `reconstruction_run_id`
- `started_at`
- `finished_at`
- candidate path

SQLite row IDs, insertion order, and object-key order must not create false nondeterminism.

## Candidate Lifecycle and Concurrency

Use this state machine:

```text
INITIALIZED
→ MANIFEST_FROZEN
→ COMPILING
→ VALIDATING
→ SUCCEEDED
```

Failure states:

```text
FAILED
INVALID
INVALIDATED_SOURCE_MUTATION
```

Rules:

- one active candidate run per memory scope
- repeated `init` is idempotent when supplied the same request key
- `run` cannot execute before manifest freeze
- completed runs cannot be silently resumed
- failed candidates never become ordinary authority inputs

## Candidate Retention Policy

Candidate artifacts live under the user root and will travel with full-user backups, so retention must be bounded.

Retain:

- latest successful candidate per scope
- latest failed or invalid candidate per scope
- any explicitly pinned candidate if internal support is added

Remove:

- older unpinned candidates beyond the bounded count or age policy

Cleanup must never touch:

- live DB
- live snapshot
- live state marker
- corpus files

No cleanup UI is required in `C0.5A`.

## Report Schema

Emit both a compact human-readable summary and a machine-readable report.

Frontend-facing reports should prefer:

- `candidateArtifactId`
- `candidateRelativePath`

Do not expose absolute filesystem paths in ordinary reports.

Minimum machine-readable schema:

```js
{
  schemaVersion: 1,
  protocolVersion: 'architectural-rebuild-protocol/v1',
  reconstructionRunId: 'rebuild_...',
  memoryScopeId: 'scope_...',
  status: 'success|failed|invalid|invalidated_source_mutation',
  candidateArtifactId: 'candidate_...',
  candidateRelativePath: 'summary-sharder/candidates/architectural-memory.candidate.rebuild_x.db',
  manifestRelativePath: 'summary-sharder/candidates/architectural-memory.candidate.rebuild_x.manifest.json',
  reportRelativePath: 'summary-sharder/candidates/architectural-memory.candidate.rebuild_x.report.json',
  liveAuthorityChanged: false,
  promotionAvailable: false,
  inputSummary: {
    totalFiles: 4,
    totalArtifacts: 12,
    admittedArtifacts: 8,
    excludedArtifacts: 2,
    blockedArtifacts: 2,
  },
  outputSummary: {
    candidateAuthorityRecordCount: 42,
    candidateIssueCount: 5,
  },
  coverage: {
    exact: { attempted: true, count: 10 },
    corroborated: { attempted: false, count: null },
    deltaRecovered: { attempted: false, count: null },
    reconstructed: { attempted: false, count: null },
    conflicted: { attempted: true, count: 2 },
    partial: { attempted: true, count: 1 },
  },
  exclusions: [
    { sourceId: 'src_...', reason: 'unsupported_schema' },
  ],
  conflicts: [
    { sourceId: 'src_...', code: 'SHARD_MANIFEST_INVALID' },
  ],
  unresolvedEvidence: [
    { sourceId: 'src_...', reason: 'identity_partial_outside_artifact_scope' },
  ],
  promotionBlockers: [
    'promotion path intentionally unavailable in C0.5A',
  ],
  determinism: {
    attempted: true,
    equivalent: true,
    canonicalCandidateHash: 'sha256:...',
    differingFieldsIgnored: ['reconstruction_run_id', 'started_at', 'finished_at', 'candidateRelativePath'],
    unexplainedDifferences: [],
  },
}
```

## No-Promotion Proof

`C0.5A` must contain no promotion path.

Explicitly prohibited:

- no automatic swap
- no promote endpoint
- no promote UI
- no startup adoption
- no candidate-to-live fallback

Proof obligations:

- candidate DB path is distinct from live DB path
- live DB, snapshot, state marker, and manifest hashes do not change during candidate build
- ordinary authority-read code paths do not open candidate artifacts
- route surface exposes build/validate/report only

## File-Level Implementation Plan

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

Own `C0.5A` orchestration:

- read-only corpus discovery
- frozen input manifest creation
- admitted-source mutation recheck
- candidate DB creation from clean operational schema
- bounded structured-shard compilation
- candidate validation
- human and machine report emission
- no promotion behavior

### `tools/server-plugin/summary-sharder-memory/schema.js`

Add:

- clean candidate schema bootstrap using the operational authority schema
- reconstruction audit tables for candidate-only use
- no live-schema mutation for rebuild-run state

### `tools/server-plugin/summary-sharder-memory/core.js`

Add helpers for:

- candidate path derivation
- file hashing
- artifact admission
- live-store immutability checks
- retention cleanup

### `tools/server-plugin/summary-sharder-memory/index.js`

Add bounded rebuild routes only:

- `POST /rebuild/candidate/init`
- `POST /rebuild/candidate/run`
- `GET /rebuild/candidate/report/:jobId`

No promotion route may exist.

### `core/summarization/architectural-rebuild-protocol.js`

Define:

- protocol version
- manifest normalization
- admission enums
- lifecycle enums
- report enums
- determinism comparison rules

### `core/summarization/architectural-rebuild-protocol.test.mjs`

Add tests for:

- manifest normalization
- admission-state validation
- lifecycle transitions
- determinism comparison
- report schema validation

### `core/summarization/saved-shard-identity.js`

Reuse as recovery-corpus locator and provenance helper.

### `core/summarization/architectural-record-parser.js`

Remain the structured parser for Architectural shard payloads.

For `C0.5A`, parse only the highest-confidence structured class.

## Test Matrix

### C0.5A

1. read-only discovery does not trigger host save
2. frozen manifest records admitted, excluded, and blocked artifacts
3. source mutation after freeze invalidates the candidate
4. candidate DB is physically separate from active DB
5. live DB, snapshot, state marker, and manifest hashes remain unchanged
6. unsupported schema artifact is excluded with explicit reason
7. `STALE` artifact is blocked
8. `DEGRADED` artifact is blocked
9. `ORPHANED` artifact is blocked
10. `CONFLICTED` artifact is blocked
11. exposure-only issue remains reportable without forcing semantic exclusion
12. candidate rows retain full required provenance
13. covered source provenance rows validate by foreign key
14. schema and foreign-key validation run before success
15. admitted-input versus output reconciliation is explicit
16. unchanged corpus run twice yields equivalent meaningful candidate state
17. unexplained determinism differences fail the run
18. no route, UI, or startup path can promote a candidate
19. retention cleanup preserves live authority files and corpus files

### Regression

20. `1B0` negative race remains documented and testable
21. Narrative Memory behavior unchanged
22. existing Architectural save/review behavior unchanged outside reconstruction routes

## Implementation Stop Condition

Do not begin `C0.5A` code until this brief is reviewed and accepted.
