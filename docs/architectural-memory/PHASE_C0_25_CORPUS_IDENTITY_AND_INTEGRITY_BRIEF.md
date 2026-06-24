# Phase C0.25: Corpus Identity and Integrity Brief

## Status

This brief defines the bounded phase that must land between:

- `C0`: operational SQLite substrate
- `C0.5`: self-healing reconstruction compiler

It exists because the source corpus is mutable, the portable corpus is authoritative, and the host-visible message numbers in SillyTavern and SillyBunny are positional locators rather than durable identity.

`C0.25` establishes:

- immutable message identity
- legacy adoption and partial identity healing
- archive and restore semantics
- identity-backed shard coverage
- corpus and shard integrity validation
- conservative repair boundaries

It does not implement:

- canonical Architectural reconstruction
- authority promotion from corpus back into SQLite
- archive movement of decisions
- vector retrieval
- broader authority expansion

## Governing Result

The portable corpus remains authoritative.

The authority chain is:

1. mutable portable corpus
2. canonical memory reconstructed from that corpus
3. SQLite operational projection
4. FTS and vector retrieval projections
5. prompt-context assembly

This means:

- SQLite may be deleted and rebuilt
- vectors may be deleted and rebuilt
- neither may hold the only surviving copy of companion memory

## Why C0.25 Exists

Live host testing established that displayed message numbers are array positions, not historical IDs.

If an earlier message is deleted, later displayed numbers shift and begin referring to different content.

Therefore:

- positional message numbers cannot be durable provenance
- positional shard ranges cannot be authoritative source coverage
- reconstruction must not proceed on mutable positional identity alone

`C0.25` is the identity and integrity boundary that makes later rebuild work trustworthy.

## Scope

Included in `C0.25`:

1. metadata survival proof on SillyTavern and SillyBunny
2. immutable message identity schema
3. legacy adoption for untagged chats
4. partial-ID healing for mixed chats
5. speaker and entity binding
6. swipe-aware revision handling
7. reversible archive and restore semantics
8. deletion tombstones
9. identity-backed shard coverage
10. shard health classifications
11. corpus and shard validator modes
12. safe repair planning and execution boundary
13. prompt-exposure and token-load diagnostics for active, hidden, and archived content

Excluded from `C0.25`:

- canonical memory reconstruction
- candidate rebuild promotion
- decision archive movement
- semantic RAG or vector indexing
- automatic forgetting logic
- semantic classification for memory evidence exclusion
- live cross-host synchronization
- repository visibility or fork-topology changes

## Non-Negotiable Invariants

1. the portable corpus is authoritative
2. message position is a locator, never identity
3. `chatInstanceId + messageId` identifies one message occurrence
4. message IDs are immutable and never reused
5. the native absolute timestamp belongs in bootstrap evidence
6. edits change revision state, not message identity
7. archive is not delete
8. delete is not automatically forget
9. hidden is not evidence exclusion
10. shard coverage must not silently drift onto new content
11. ambiguity must be surfaced rather than guessed
12. semantic similarity must never replace lifecycle or provenance rules
13. the native host save path must persist corpus truth before SQLite projection updates
14. C0.25 may rebuild only mechanically derived identity and integrity projections

## Independent Message Dimensions

Prompt visibility, archive state, and evidence policy are independent dimensions.

They must not be collapsed into one shared enum.

### Native prompt visibility

Prompt visibility already exists in SillyTavern and SillyBunny through the native open or closed eye control.

- `shown`:
  - visible in the transcript
  - eligible for prompt assembly
  - included in the evidence chain by default
- `hidden`:
  - visible in the transcript
  - excluded from prompt assembly
  - still included in the evidence chain by default

Summary Sharder must observe and validate the native host field rather than creating a competing prompt-hidden state.

### Summary Sharder archive state

Archive is a new Summary Sharder feature.

- `archived`:
  - retained in the JSONL
  - hidden from ordinary chat rendering
  - excluded from prompt assembly
  - included in the evidence chain by default
  - reversible
  - chronology and immutable identity preserved

Archive must preserve the message's prior native prompt visibility so restore can return that state accurately.

Suggested namespaced metadata:

```json
{
  "extra": {
    "summary_sharder": {
      "archive": {
        "isArchived": true,
        "archivedAt": "2026-06-23T00:00:00.000Z",
        "promptVisibilityBeforeArchive": "hidden"
      }
    }
  }
}
```

Legacy default:

- no archive metadata means not archived

### Evidence policy

The former `memory_excluded` concept is replaced with an evidence policy:

```text
evidencePolicy: include | exclude
```

Meaning:

- `include`: the message may participate in companion-memory evidence
- `exclude`: the message remains in the transcript but must not participate in memory compilation, provenance support, or memory retrieval

For `C0.25`:

- define and reserve the schema
- default legacy and new messages to `include`
- preserve and validate the field when present
- do not infer `exclude` automatically
- do not introduce semantic classification logic to decide exclusions

This policy is independent of native prompt visibility and independent of archive state.

## Message Identity Contract

### Primary key

Every message occurrence must be identified by:

```text
chatInstanceId + messageId
```

`chatId` and displayed message number remain locators only.

### Namespaced metadata

Prefer nested metadata under the Summary Sharder namespace:

```json
{
  "extra": {
    "summary_sharder": {
      "messageIdentity": {
        "schemaVersion": 1,
        "messageId": "msg_550e8400e29b41d4a716446655440000",
        "initFingerprint": "sha256:...",
        "revisionHash": "sha256:..."
      }
    }
  }
}
```

The full path provides semantic context:

- `extra.summary_sharder.messageIdentity.messageId`
- `extra.summary_sharder.messageIdentity.initFingerprint`
- `extra.summary_sharder.messageIdentity.revisionHash`

This avoids collision if the host later adds a native `messageId`.

If nested metadata fails host-preservation testing, use clearly prefixed flat names beneath an app-owned namespace. Do not add unprefixed generic fields to the message record.

### Message ID format

Use an opaque random UUIDv4 or GUID represented as 32 lowercase hexadecimal characters, optionally prefixed with `msg_` for readability in logs.

Example:

```text
msg_550e8400e29b41d4a716446655440000
```

Message IDs are:

- assigned once
- immutable
- never reused
- independent of array position, timestamp, text, or swipe selection

## Initialization Fingerprint and Revision State

`initFingerprint` is deterministic matching evidence created when a message is first adopted by Summary Sharder.

It is not the primary ID.

The cross-chat initialization fingerprint must be based on canonicalized:

- native absolute timestamp
- stable speaker identity
- speaker role or source type
- exact stored initial text

Do not include `chatInstanceId` in the cross-chat fingerprint, because copied branch ancestry and duplicate imports may need to recognize the same original occurrence evidence across chats.

Durable occurrence identity remains:

```text
chatInstanceId + messageId
```

A matching `initFingerprint` is evidence of likely shared ancestry or duplication. It must never independently authorize an automatic merge.

Import, branch lineage, neighboring anchors, and other provenance must support any cross-chat equivalence decision.

`revisionHash` identifies the current persisted semantic message state.

When a message is edited:

- `messageId` remains unchanged
- `initFingerprint` remains unchanged
- `revisionHash` changes

Prompt visibility, archive state, and evidence policy are tracked independently rather than falsely treated as message-text revision.

## Speaker and Entity Identity

Messages from direct chats and group chats must bind to the actual speaking entity.

The durable hierarchy is:

```text
memoryScopeId
-> speakerEntityId
-> chatInstanceId
-> messageId
```

Requirements:

- use the host's stable entity or instance identifier where available
- do not rely on display name alone
- preserve readable names and paths for filtering, sorting, reporting, and diagnostics
- retain the speaker's identity even when the source is a group chat
- group interviews must bind each Character's messages to that Character, not merely to the group-chat container

Suggested structure:

```json
{
  "extra": {
    "summary_sharder": {
      "speakerIdentity": {
        "speakerEntityId": "character-instance-value",
        "speakerPathAtInit": "Household / Jeep",
        "displayNameAtInit": "Jeep",
        "sourceType": "character"
      }
    }
  }
}
```

Equivalent namespaced identities must exist for user and system-originated records where necessary.

## Branch Contract

Branch behavior is explicit:

- a branch receives a new `chatInstanceId`
- `branchedFromChatInstanceId` points to the parent chat
- copied ancestral messages preserve existing Summary Sharder `messageId` values
- new branch-tail messages receive new IDs
- one occurrence is addressed through `chatInstanceId + messageId`

For legacy branches created before message IDs existed:

- matching timestamp, speaker identity, role, and exact text establish ancestry candidates
- branch metadata strengthens the match
- ambiguity must be reported rather than silently resolved
- no unsupported ancestry claim may be promoted as fact

## Swipe Behavior

One persisted logical message keeps one immutable `messageId`.

A swipe selection or generated alternative does not create a new message identity.

When the selected swipe changes:

- `messageId` remains unchanged
- `revisionHash` changes
- selected swipe metadata participates in current revision state

Use existing native swipe metadata where available.

The revision contract should account for:

- selected swipe ID or index
- selected message text
- other fields that materially affect prompt or memory meaning

If changes to the full alternate-swipe set must be detectable, define a separate `swipeSetHash`. Do not encode swipe selection into the permanent message ID.

## Chat-Level Identity Status

Persist adoption status beneath the existing Summary Sharder chat metadata namespace.

Suggested structure:

```json
{
  "chat_metadata": {
    "summary_sharder": {
      "messageIdentity": {
        "schemaVersion": 1,
        "status": "IDENTITY_COMPLETE",
        "identifiedCount": 208,
        "unidentifiedCount": 0,
        "lastReconciledAt": 1782210204120,
        "corpusRevisionHash": "sha256:..."
      }
    }
  }
}
```

Supported statuses remain:

- `IDENTITY_COMPLETE`
- `IDENTITY_PARTIAL`
- `IDENTITY_AMBIGUOUS`
- `IDENTITY_UNRECOVERABLE`

This block is derived bookkeeping and must not replace message-level identity authority.

## Identity Adoption and Healing

`C0.25` must support the following chat identity states:

- `IDENTITY_COMPLETE`
- `IDENTITY_PARTIAL`
- `IDENTITY_AMBIGUOUS`
- `IDENTITY_UNRECOVERABLE`

Healing rules:

1. existing valid IDs are immutable anchors
2. untagged trailing messages receive new IDs
3. untagged interior messages between anchors receive new IDs while preserving anchors
4. matching may use timestamp, speaker identity, role, exact text, neighboring IDs, branch ancestry, and known shard coverage
5. ambiguity must be reported rather than silently resolved

Correct boundary for extension-disabled periods:

> Messages that survive an extension-disabled period may be adopted without disturbing anchored IDs. A message created and physically deleted while the extension was absent is detectable only when prior evidence survives through an existing ID, shard manifest, branch, tombstone, operational projection, or other authoritative artifact. Otherwise its former existence is unrecoverable from the final corpus.

## Mandatory Host-Save Ordering

Keep the existing post-save authority principle and make it explicit for all `C0.25` corpus mutations.

Required sequence:

1. prepare the mutation in the host frontend's active chat state
2. verify that the loaded chat revision is still current
3. save through the native SillyTavern or SillyBunny host-save path
4. wait for host-save confirmation
5. reread, reload, or otherwise verify the persisted state
6. confirm message identity, archive state, and hashes survived
7. update the SQLite operational projection only after successful persistence verification

The server plugin must not patch ordinary chat JSONL directly out of band.

Purpose:

- prevent JSONL and SQLite from recording contradictory realities
- prevent a later native host save from overwriting server-side edits made against stale frontend state
- ensure the portable corpus receives truth before the rebuildable projection does

## Archive, Delete, and Forget Semantics

Define three distinct operations.

### Archive

Archive is the recommended normal cleanup operation.

- content retained
- reversible
- hidden from ordinary UI
- excluded from prompt
- evidence retained by default
- message ID and chronology preserved

Archive requires:

- an archive icon consistent with the native message-control aesthetic
- an Archive action
- a Restore action
- a Show Archived filter, drawer, or equivalent view
- visible archived-message count where appropriate
- range or batch archive support where practical
- persistence through the native host save path
- validation that archived messages cannot leak into prompt assembly

### Delete source content

Delete Source Content is an advanced correction operation intended for:

- duplicate messages
- broken or malformed output
- accidental sends
- failed-generation debris
- imported corruption

Behavior:

- source payload removed
- minimal tombstone retained
- dependent shards and memory support reevaluated
- not normally reversible from the chat alone

### Destructively Forget

Destructively Forget is a deeply gated, intentionally irreversible operation.

Behavior:

- source removed
- tombstone removed
- dependent memory and provenance reviewed for removal
- recovery guarantee explicitly surrendered
- external backups may remain the only possible recovery source

The exact UI label should be:

```text
Destructively Forget
```

It must not appear as an easy or reflexive ordinary toolbar action.

It must require a strong confirmation flow that explains affected dependencies and irreversibility.

Archive should be the default recommendation when a user attempts ordinary cleanup.

## Deletion Tombstones

When an identified message is physically deleted while the extension is active, retain a minimal namespaced tombstone.

Minimum fields:

```json
{
  "messageId": "msg_...",
  "deletedAt": "2026-06-23T00:00:00.000Z",
  "lastRevisionHash": "sha256:...",
  "deletionMode": "source_content_deleted"
}
```

The tombstone does not preserve deleted text.

Its purposes are:

- prove that the immutable message identity once existed
- prevent ID reuse
- distinguish deliberate deletion from unexplained corpus loss
- prevent positional slide-back onto replacement content
- let shard coverage degrade precisely
- trigger review of dependent memory and provenance

If the extension was absent and no independent evidence survives, a created-and-deleted message may be unrecoverable. State this as a hard information boundary.

## Canonical Hash Specifications

Define exact canonical byte inputs and versioned algorithms for:

- `initFingerprintV1`
- `revisionHashV1`
- `sourceCoverageHashV1`
- any optional `swipeSetHashV1`

Every definition must specify:

- version prefix
- UTF-8 encoding
- canonical timestamp representation
- deterministic field ordering
- unambiguous separators
- exact stored text rather than rendered HTML
- treatment of null, absent, and empty values
- treatment of line endings
- which fields are immutable evidence and which represent current revision state

Conceptual distinction:

- `initFingerprintV1`: original adopted occurrence evidence
- `revisionHashV1`: current persisted semantic message state
- `sourceCoverageHashV1`: ordered `messageId + revisionHash` pairs for all shard sources

## Shard Coverage Migration

Current positional coverage is insufficient:

```json
{
  "start": 103,
  "end": 203
}
```

Future authoritative coverage must be identity-backed:

```json
{
  "shardId": "shard_...",
  "sourceStartPositionAtCreation": 103,
  "sourceEndPositionAtCreation": 203,
  "sourceMessageIds": [
    "msg_A",
    "msg_B",
    "msg_C"
  ],
  "sourceCoverageHash": "sha256:...",
  "replacementPolicy": "replace"
}
```

The numeric range remains useful for:

- display
- human diagnostics
- historical debugging

The authoritative source definition becomes:

- immutable source message IDs
- source coverage hash

### Shard health states

`C0.25` should introduce explicit health classification:

- `INTACT`
- `VISIBILITY_CHANGED`
- `DEGRADED`
- `STALE`
- `ORPHANED`
- `CONFLICTED`

Deletion or mutation of a covered source must never silently remap the shard to new content.

## Validator and Repair Boundary

The validator must support three modes.

### `check`

Read-only diagnostics only.

### `repair-safe`

Mechanically provable and reversible changes only.

Examples:

- rebuild identity lookup indexes
- rebuild archive indexes
- rebuild shard manifests
- rebuild validation diagnostics
- rebuild prompt-exposure calculations
- rebuild derived counts
- repair host visibility when archive intent is unambiguous
- normalize deterministic derived metadata
- mark shards degraded or stale

Every safe repair requires:

1. backup or snapshot precondition
2. before and after diff
3. revalidation
4. rollback if post-validation fails

### `repair-reviewed`

Explicit user confirmation is required for interpretive or potentially destructive changes.

Examples:

- regenerate shard content
- replace or delete conflicting ranges
- choose among overlapping shards
- invalidate canonical memory
- interpret the meaning of physical deletion

## Diagnostic Families

`C0.25` should introduce a deterministic diagnostic surface covering at least:

- `JSONL_PARSE_ERROR`
- `JSONL_HEADER_INVALID`
- `MESSAGE_RECORD_INVALID`
- `MESSAGE_IDENTITY_PARTIAL`
- `MESSAGE_IDENTITY_AMBIGUOUS`
- `MESSAGE_BOOTSTRAP_COLLISION`
- `MESSAGE_SOURCE_MISSING`
- `SHARD_RANGE_OUT_OF_BOUNDS`
- `SHARD_RANGE_REVERSED`
- `SHARD_ORPHANED`
- `SHARD_LABEL_RANGE_MISMATCH`
- `SHARD_SOURCE_HASH_MISMATCH`
- `SHARD_POSITIONAL_RANGE_DRIFT`
- `SHARD_OVERLAP_UNEXPLAINED`
- `SHARD_GAP_UNEXPLAINED`
- `SHARD_VISIBILITY_CONFLICT`
- `DOUBLE_CONTEXT_INCLUSION`
- `RUNTIME_METADATA_STALE`
- `PROMPT_SIZE_WARNING`
- `PROMPT_SIZE_BLOCKED`
- `PROJECTION_SOURCE_MISSING`
- `PROJECTION_HASH_MISMATCH`
- `PROJECTION_MANIFEST_DRIFT`

## Backward Compatibility Defaults

For legacy records:

- no message identity metadata:
  - eligible for identity adoption
- no archive metadata:
  - not archived
- no evidence policy:
  - `include`
- existing native prompt-hidden state:
  - remains authoritative
- existing positional shard ranges:
  - retained as legacy locators until identity-backed coverage is created and verified

A legacy chat must remain openable and usable before migration.

## SQLite Boundary

`C0.25` may rebuild only mechanically derived identity and integrity projections, such as:

- identity lookup indexes
- archive indexes
- shard manifests
- validation diagnostics
- prompt-exposure calculations
- derived counts
- other non-semantic caches

`C0.25` must not reconstruct or promote canonical Architectural authority from the corpus.

Semantic authority reconstruction remains `C0.5`.

## Implementation Slices

### C0.25A

- metadata survival proof on SillyTavern and SillyBunny
- nested metadata feasibility
- schema freeze
- read-only identity scanner
- no corpus mutation

### C0.25B

- immutable message ID assignment
- legacy adoption
- partial-ID healing
- branch and import behavior
- speaker and entity binding
- swipe-aware revision handling
- deletion tombstones

### C0.25C

- archive and restore metadata
- archive UI icon and actions
- Show Archived behavior
- prompt exclusion enforcement
- legacy compatibility
- range or batch archive where practical

Evidence-policy exclusion remains schema-defined and defaulted to include. Do not introduce automatic semantic exclusion logic.

### C0.25D

- identity-backed shard coverage
- shard health classifications
- corpus and shard validator
- safe repair boundary
- prompt-exposure and token-load diagnostics

## Repository Boundary

Do not change repository visibility or fork topology as part of `C0.25`.

Leave public-fork versus private-repository handling to a separate recommendation based on:

- current branch ancestry
- upstream synchronization requirements
- contribution workflow
- deployment logistics
- privacy posture

No personal corpus, chat data, databases, or Character data may be committed to Git.

## Proof Matrix

Before `C0.25` can be considered complete, prove on both SillyTavern and SillyBunny:

1. nested app-owned message metadata survives save and reload
2. metadata survives edit, hide, archive, restore, branch, export, and import
3. metadata survives SillyTavern to SillyBunny and SillyBunny to SillyTavern round trips
4. duplicate text with distinct timestamps adopts distinct identities
5. identical timestamp and text collisions are surfaced deterministically
6. partial-ID chats heal without disturbing anchored IDs
7. archive state survives host round trip
8. deletion after IDs exist produces explicit missing-source diagnostics
9. messages surviving extension-disabled periods can be adopted without disturbing anchored IDs
10. created-and-deleted messages with no surviving evidence remain honestly unrecoverable
11. positional shard ranges that drift are detected rather than silently accepted
12. archived messages are kept out of prompt assembly by policy
13. native prompt-hidden and evidence-policy exclusion remain distinguishable
14. the native host save path persists message mutations before SQLite projection updates

## Deliverables

`C0.25` should end with:

- immutable message identity support
- partial identity healing
- reversible archive and restore support
- identity-backed shard coverage structures
- validator diagnostics and mode boundaries
- safe repair boundary implementation
- cross-host preservation evidence
- a completion report documenting tested host behavior and unresolved limits

## Exit Criteria

`C0.25` is complete only when:

- message identity is durable across normal host mutations
- shard source coverage no longer depends on mutable message positions alone
- native prompt visibility, archive state, and evidence policy are handled independently
- archive semantics are explicit and reversible
- validator output can distinguish intact, stale, degraded, orphaned, and conflicted source states
- safe repair is bounded to mechanically provable changes
- the system is ready for `C0.5` reconstruction work on validated, identity-aware corpus state

## Next Boundary

After `C0.25`, the next correct phase is:

- `C0.5`: self-healing reconstruction compiler operating on validated identity-backed source material

It is still not correct to jump next to:

- archive movement
- vector retrieval
- broad cross-chat memory daemons
- semantic merge automation
