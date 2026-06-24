# Phase C0.5C: Tier-1 Collision Classification and Candidate Validity Recovery Brief

## Status

STATUS: ACTIVE C0.5C IMPLEMENTATION CONTRACT

`C0.5B` is complete.

`C0.5C` is the next reconstruction boundary.

This phase does not expand evidence tiers.

It classifies and reconciles existing Tier-1 structural collisions so that candidate validity reflects what the evidence actually means, not just that two records collided.

It does not authorize:

- Tier-3 or lower evidence recovery
- contextual dialogue interpretation
- model-assisted interpretation
- candidate promotion
- startup adoption from candidate state
- live authority mutation
- corpus normalization
- metadata adoption

## Governing Finding from C0.5B

`C0.5B` proved that deterministic Tier-2 extraction and report compaction can complete successfully while the candidate still remains invalid.

The remaining blocker on the live test scope was:

- `REBUILD_DECISION_COLLISION`

That blocker is not a Tier-2 extraction failure.

It is a Tier-1 structured-evidence meaning problem.

The next phase must therefore answer:

> What does each structural collision actually represent?

Not every collision is a semantic conflict.

Some collisions may be mechanically provable duplicates, lineage copies, corroborating provenance, or valid lifecycle chains.

Others may remain unresolved and must continue blocking candidate validity.

## Governing Flow

`C0.5C` must prove this chain:

```text
discover collision groups
-> freeze collision evidence
-> classify each group mechanically
-> merge provenance-only duplicates
-> preserve valid version and supersession chains
-> block unresolved semantic conflicts
-> rebuild candidate
-> validate candidate
-> stop before promotion
```

Successful `C0.5C` completion means:

```text
collision groups frozen
each group classified deterministically
mechanically proven non-conflicts reconciled
unresolved conflicts preserved explicitly
candidate rebuilt
candidate validity reflects classified evidence
live authority untouched
promotion unavailable
```

## Carry-Forward Constraints

All prior reconstruction safety constraints remain in force:

1. Corpus discovery is read-only.
2. No chat normalization occurs during the run.
3. No metadata adoption occurs during the run.
4. No native host save is triggered by reconstruction.
5. No live authority mutation is permitted.
6. No live DB, live snapshot, live state marker, live WAL, or live SHM may be mutated by reconstruction code.
7. A mixed-time corpus view is invalid.
8. Content integrity and prompt exposure remain independent dimensions.
9. Candidate failure fails closed.
10. Promotion remains unavailable.
11. Candidate builds remain physically separate from live authority artifacts.
12. Tier-2 deterministic extraction remains unchanged in this phase.

`C0.5C` adds these non-negotiable rules:

13. Collision classification is mechanical only.
14. Only mechanically proven non-conflicts may reconcile automatically.
15. Unresolved semantic conflict remains a blocker.
16. Classification may change candidate validity, but must not change the corpus.
17. Provenance expansion must preserve source-level traceability for every reconciled or blocked collision.

## Internal Phase Boundary

### `C0.5C-1`

Deterministic Tier-1 collision classification and candidate-validity recovery only.

`C0.5C-1` must perform:

- no model calls
- no semantic freeform interpretation
- no corpus rewriting
- no lower-tier evidence expansion
- no candidate promotion

It must:

- identify collision groups
- freeze collision evidence
- classify each group using bounded mechanical rules
- reconcile only mechanically proven non-conflicts
- preserve unresolved groups as explicit blockers

### Later Slice

Any broader interpretive recovery remains out of scope for `C0.5C-1`.

If a future reviewed slice is needed for borderline cases, it must be proposed separately and may not reuse this deterministic boundary implicitly.

## Collision Categories

Every collision group must classify into exactly one of these categories:

- `DUPLICATE_OCCURRENCE`
- `BRANCH_LINEAGE_DUPLICATE`
- `CORROBORATING_PROVENANCE`
- `VALID_VERSION_CHAIN`
- `VALID_SUPERSESSION_CHAIN`
- `GENERATED_ID_COLLISION`
- `UNRESOLVED_SEMANTIC_CONFLICT`
- `MALFORMED_STRUCTURED_RECORD`

Rules:

1. A collision count alone is insufficient.
2. Classification must be stable for the same frozen evidence.
3. The category must be derived from recorded evidence, not inferred from reviewer intuition.
4. `UNRESOLVED_SEMANTIC_CONFLICT` remains blocking.
5. `MALFORMED_STRUCTURED_RECORD` remains blocking until separately repaired or excluded.

## Mechanical Reconciliation Rules

Only mechanically proven non-conflicts may reconcile automatically.

Allowed automatic outcomes:

- merge provenance-only duplicates
- coalesce branch-lineage duplicates when record identity and semantic content prove equivalence
- preserve valid version chains as lineage rather than conflict
- preserve valid supersession chains as lifecycle continuity rather than conflict
- retain corroborating provenance without multiplying authority records

Blocked outcomes:

- unresolved semantic conflict
- generated ID collision without deterministic lineage proof
- malformed structured record
- any case where classification depends on contextual or model-assisted interpretation

Rule:

> Prefer an explicit unresolved blocker over a false merge.

## Collision Signature Contract

`C0.5C` must stop reporting collisions only as aggregate counts such as:

```text
REBUILD_DECISION_COLLISION x2
```

Each collision group must instead emit a stable signature containing at least:

- `memoryScopeId`
- `decisionId`
- `candidateRecordIds`
- `canonicalHashes`
- `recordVersions`
- `sourceArtifactMessageIds`
- `sourceManifestIds`
- `chatInstanceIds`
- `branchImportLineage`
- `collisionClassification`
- `reconciliationResult`
- `unresolvedReason`

Recommended machine shape:

```js
{
  collisionGroupId: 'collision_...',
  memoryScopeId: 'scope_...',
  decisionId: 'gain-modulation-boundary',
  candidateRecordIds: ['candrec_1', 'candrec_2'],
  canonicalHashes: ['sha256:...', 'sha256:...'],
  recordVersions: [3, 3],
  sourceArtifactMessageIds: ['msg_...', 'msg_...'],
  sourceManifestIds: ['manifest_...', 'manifest_...'],
  chatInstanceIds: ['chat_...', 'chat_...'],
  branchImportLineage: {
    branchedFromChatInstanceIds: ['chat_parent_...'],
    importedFromChatInstanceIds: ['chat_import_...'],
  },
  collisionClassification: 'CORROBORATING_PROVENANCE',
  reconciliationResult: 'MERGED_PROVENANCE',
  unresolvedReason: null,
}
```

This must be sufficient to prove whether two hosts are seeing the same structural collision or merely the same count.

## Freeze and Determinism Requirements

Collision evidence must be frozen before classification.

Required inputs for a collision group must come from the same immutable candidate run evidence:

- frozen manifest entries
- admitted artifact rows
- reconstructed candidate records
- provenance rows
- lineage metadata
- structural validation results

Rules:

1. The classifier must read the same frozen evidence on repeated runs.
2. The same frozen evidence must produce the same collision categories and reconciliation outcomes.
3. If any admitted source changes after freeze, the run invalidates rather than classifying a mixed-time collision.

## Provenance Retention Requirements

Reconciliation must not collapse provenance into ambiguity.

Every reconciled or blocked collision must retain provenance back to:

- memory scope
- decision ID
- candidate record identity
- source artifact message ID
- source manifest ID
- chat instance ID
- branch ancestry where applicable
- import ancestry where applicable
- reconstruction run ID

Rule:

> Reconciliation may reduce duplicate authority rows, but it must not erase why those rows existed.

## Candidate Validity Rules

`C0.5C` must keep execution success separate from candidate validity.

A run may:

- complete collision discovery successfully
- complete deterministic classification successfully
- still leave the candidate invalid because unresolved or malformed groups remain

The report must therefore distinguish at least:

- execution success of the collision-classification pass
- candidate validity after reconciliation
- reconciled non-conflict groups
- unresolved blocking groups
- malformed blocking groups

## Report Requirements

The report must expose both compact and detailed collision views.

### Ordinary report

The ordinary report should foreground:

- number of collision groups discovered
- count by collision classification
- number reconciled automatically
- number still blocking validity
- candidate validity before classification
- candidate validity after classification

### Detailed report

The detailed report must preserve:

- one row per collision group
- stable collision signature
- classification basis
- reconciliation action
- blocker reason where unresolved

Ordinary and detailed collision reporting must reconcile exactly against the same immutable collision-group rows.

## Validation Requirements

`C0.5C` must validate:

- collision-group determinism
- classification coverage for every detected collision group
- no silent drop of a collision group during reconciliation
- provenance completeness after reconciliation
- candidate validity recalculation after reconciliation
- continued proof that live DB, snapshot, state marker, corpus files, and host chat state remain unchanged
- continued proof that promotion remains unavailable

## Excluded

`C0.5C` does not authorize:

- contextual interpretation of dialogue fragments such as `Agree.` or `Do that.`
- model-assisted dispute resolution
- lorebook or lower-tier evidence compilation
- semantic merge based on similarity alone
- corpus mutation to "fix" collisions
- candidate promotion
- live authority adoption

## File-Level Plan

Expected implementation focus:

- collision detection and grouping in candidate rebuild pipeline
- deterministic classification helpers
- provenance-preserving reconciliation helpers
- candidate validity recalculation
- compact and detailed collision reporting
- regression and determinism tests

Expected file surfaces:

- `tools/server-plugin/summary-sharder-memory/rebuild.js`
- `tools/server-plugin/summary-sharder-memory/schema.js`
- `tools/server-plugin/summary-sharder-memory/rebuild*.test.mjs`
- phase documentation and closeout reporting

## Test Matrix

Minimum required coverage:

1. exact duplicate structured records classify as `DUPLICATE_OCCURRENCE`
2. branch-copy duplicate records classify as `BRANCH_LINEAGE_DUPLICATE`
3. same decision with added independent provenance classifies as `CORROBORATING_PROVENANCE`
4. deterministic version-linked records classify as `VALID_VERSION_CHAIN`
5. deterministic supersession-linked records classify as `VALID_SUPERSESSION_CHAIN`
6. same generated ID with incompatible semantics classifies as `GENERATED_ID_COLLISION`
7. incompatible same-decision semantics classify as `UNRESOLVED_SEMANTIC_CONFLICT`
8. malformed structured record collision classifies as `MALFORMED_STRUCTURED_RECORD`
9. automatically reconciled non-conflicts reduce candidate blockers without mutating corpus
10. unresolved semantic conflicts remain blockers
11. detailed collision signatures are stable across repeated runs
12. compact and detailed reports reconcile exactly
13. Node and Bun emit equivalent collision classifications for the same frozen corpus
14. live authority artifacts remain unchanged across success, failure, and invalidation paths
15. no promotion surface exists

## Stop-Before-Code Condition

Do not begin implementation until this brief is reviewed and accepted as the active `C0.5C` contract.
