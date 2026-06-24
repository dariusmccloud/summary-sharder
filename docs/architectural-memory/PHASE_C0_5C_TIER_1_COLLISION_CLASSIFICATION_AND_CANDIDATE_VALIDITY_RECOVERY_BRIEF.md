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

Not every same-version occurrence collision is a semantic conflict.

Some groups may be mechanically provable duplicates, lineage copies, or corroborating provenance.

After same-version reconciliation, the resulting canonical records may also participate in valid or invalid lifecycle chains.

Others may remain unresolved and must continue blocking candidate validity.

## Governing Flow

`C0.5C` must prove this chain:

```text
compile raw Tier-1 candidate rows
-> partition same-version occurrence groups
-> freeze collision evidence
-> classify and reconcile occurrence groups
-> produce canonical Tier-1 candidate records
-> evaluate version and supersession lifecycle graphs
-> remap Tier-2 links to canonical Tier-1 identities
-> recalculate structural blockers
-> recalculate candidate validity
-> validate candidate
-> stop before promotion
```

Successful `C0.5C` completion means:

```text
same-version occurrence groups frozen
occurrence groups classified deterministically
mechanically proven non-conflicts reconciled
lifecycle graphs classified deterministically
unresolved blockers preserved explicitly
candidate rebuilt from canonical Tier-1 records
candidate validity reflects occurrence and lifecycle evidence
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
18. Occurrence classification and lifecycle classification are separate dimensions and must not be collapsed into one overloaded category.

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

identify same-version occurrence groups
- freeze collision evidence
- classify each occurrence group using bounded mechanical rules
- reconcile only mechanically proven non-conflicts
- evaluate resulting lifecycle graphs deterministically
- preserve unresolved groups and invalid lifecycle graphs as explicit blockers

### Later Slice

Any broader interpretive recovery remains out of scope for `C0.5C-1`.

If a future reviewed slice is needed for borderline cases, it must be proposed separately and may not reuse this deterministic boundary implicitly.

## Atomic Grouping Contract

`C0.5C` must split same-version occurrence analysis from lifecycle analysis.

### Same-version occurrence group

Partition raw Tier-1 candidate rows by:

```text
memoryScopeId + decisionId + recordVersion
```

This is the atomic occurrence-classification unit.

It may contain:

- one occurrence
- exact duplicates
- branch/import lineage copies
- independent corroborating copies
- malformed members
- incompatible same-version records

### Version-chain evaluation

Version-chain evaluation occurs only after same-version occurrence reconciliation produces canonical Tier-1 candidate records.

It evaluates canonicalized records for the same:

```text
memoryScopeId + decisionId
```

across versions.

### Supersession-chain evaluation

Supersession-chain evaluation may span multiple decision IDs.

It must use a separate relationship graph rather than being forced into one same-decision occurrence group.

Rule:

> Same-version occurrence reconciliation comes first. Lifecycle evaluation comes second.

## Occurrence Classification

Each same-version occurrence group must classify into exactly one occurrence classification:

- `NONE`
- `DUPLICATE_OCCURRENCE`
- `BRANCH_LINEAGE_DUPLICATE`
- `CORROBORATING_PROVENANCE`
- `GENERATED_ID_COLLISION`
- `UNRESOLVED_SEMANTIC_CONFLICT`
- `MALFORMED_STRUCTURED_RECORD`

Rules:

1. Occurrence classification applies only to a same-version occurrence group.
2. Classification must be stable for the same frozen evidence.
3. The classification must be derived from recorded evidence, not inferred from reviewer intuition.
4. `UNRESOLVED_SEMANTIC_CONFLICT` remains blocking.
5. `MALFORMED_STRUCTURED_RECORD` remains blocking until separately repaired or excluded.

## Lifecycle Classification

After occurrence reconciliation, the resulting canonical Tier-1 candidate records must classify into lifecycle states separately from occurrence classification.

Supported lifecycle classifications:

- `SINGLE_VERSION`
- `VALID_VERSION_CHAIN`
- `FORKED_VERSION_CHAIN`
- `INCOMPLETE_VERSION_CHAIN`
- `VALID_SUPERSESSION_CHAIN`
- `INCOMPLETE_SUPERSESSION_CHAIN`
- `CYCLIC_SUPERSESSION_CHAIN`
- `NOT_APPLICABLE`

Rules:

1. Lifecycle classification is evaluated only after same-version occurrence reconciliation.
2. Version-chain evaluation uses canonicalized records for one `memoryScopeId + decisionId`.
3. Supersession-chain evaluation uses explicit relationship graphs and may span multiple decision IDs.
4. Candidate validity must incorporate both occurrence classification and lifecycle classification.
5. A decision history may simultaneously have a non-trivial occurrence classification at one version and a valid lifecycle classification across versions.

## Evidence Independence Contract

Each same-version occurrence group must additionally carry:

```text
evidenceIndependence:
- PROVEN_INDEPENDENT
- SHARED_LINEAGE
- NOT_PROVEN
- UNKNOWN
```

Rules:

1. Only positive independence proof may classify evidence as `CORROBORATING_PROVENANCE`.
2. Equivalent records with `UNKNOWN` or `NOT_PROVEN` independence may be coalesced as duplicate authority occurrences when mechanically safe.
3. Unknown or unproven independence must not gain corroboration weight.
4. Shared ancestry, branch ancestry, or import-copy evidence forces `SHARED_LINEAGE`.

## Occurrence Classification Precedence

Within a same-version occurrence group, classification must use an ordered mechanical precedence table so overlapping evidence cannot produce runtime-dependent results.

Required minimum precedence:

| Order | Rule ID | Condition | Result |
| --- | --- | --- | --- |
| 1 | `OCC-MALFORMED-001` | One or more members are malformed and equivalence/conflict cannot be resolved mechanically from valid surviving fields | `MALFORMED_STRUCTURED_RECORD` |
| 2 | `OCC-GENID-001` | Stable IDs or generated identities collide in a way that defeats deterministic lineage/equivalence proof | `GENERATED_ID_COLLISION` |
| 3 | `OCC-HASH-001` | Members share `memoryScopeId + decisionId + recordVersion` but have incompatible same-version canonical hashes | `UNRESOLVED_SEMANTIC_CONFLICT` |
| 4 | `OCC-DUP-001` | Members are exact semantic duplicates with no independence proof and no lineage distinction requiring separate handling | `DUPLICATE_OCCURRENCE` |
| 5 | `OCC-BRANCH-001` | Members are semantically equivalent and proven to share branch/import lineage | `BRANCH_LINEAGE_DUPLICATE` |
| 6 | `OCC-CORR-001` | Members are semantically equivalent and proven independent | `CORROBORATING_PROVENANCE` |
| 7 | `OCC-NONE-001` | Group contains one valid member and no collision remains after partitioning | `NONE` |

Rules:

1. The first matching rule wins.
2. The exact `occurrenceRuleId` must be recorded.
3. `classificationBasis` must record the evidence used by the winning rule.
4. Precedence must be deterministic and versioned.

## Stable Collision Evidence-Group Identity

Same-version occurrence groups must have a stable versioned identity independent of run-local rows and input order.

Required specification:

```text
collisionEvidenceGroupIdV1 =
SHA-256(
  memoryScopeId
  + decisionId
  + recordVersion
  + sorted stable member evidence identities
)
```

Rules:

1. Do not depend on run-local candidate IDs.
2. Do not depend on row insertion order.
3. Do not depend on source-file enumeration order.
4. `classifierVersion` changes must not change `collisionEvidenceGroupIdV1`.
5. Classifier output must be stored separately from group identity.

Required classifier-output fields:

- `classifierVersion`
- `classificationRuleId`
- `classificationBasis`
- `reconciliationResult`
- `blockingState`

## Deterministic Canonical Row Selection

When a same-version occurrence group is reconciled, the authority-shaped candidate surface must choose a canonical Tier-1 record deterministically.

It must not choose a survivor using:

- insertion order
- source-file order
- first-seen order
- timestamps
- host enumeration order

Required rule:

> Canonical row selection must be derived from stable semantic fields and versioned deterministic selection rules.

All original collision members must remain preserved in candidate-only audit and provenance rows even when one canonical Tier-1 row represents the reconciled surface.

## Mechanical Reconciliation Rules

Only mechanically proven non-conflicts may reconcile automatically.

Allowed automatic outcomes:

- merge exact duplicate occurrences into one canonical authority row while preserving all member provenance
- coalesce branch-lineage duplicates into one canonical authority row while preserving lineage evidence
- preserve corroborating provenance as one canonical authority row with distinct corroborating evidence retained
- preserve valid version chains as lifecycle continuity rather than conflict
- preserve valid supersession chains as lifecycle continuity rather than conflict

Blocked outcomes:

- unresolved semantic conflict
- generated ID collision without deterministic lineage proof
- malformed structured record
- any case where classification depends on contextual or model-assisted interpretation

Rule:

> Prefer an explicit unresolved blocker over a false merge.

## Tier-2 Remapping Rule

After same-version occurrence reconciliation and canonical Tier-1 row selection:

- Tier-2 links
- Tier-2 conflicts
- Tier-2 review items

must be remapped to canonical Tier-1 identities.

They must not remain attached to duplicate Tier-1 candidate rows removed from the authority-shaped candidate surface.

Rule:

> Tier-2 associations follow canonical Tier-1 record identity after reconciliation, while audit tables preserve the original member-level attachment history.

## Detailed Collision Result Contract

`C0.5C` must stop reporting collisions only as aggregate counts such as:

```text
REBUILD_DECISION_COLLISION x2
```

Each detailed collision result must include at least:

- `collisionEvidenceGroupId`
- `memoryScopeId`
- `decisionId`
- `recordVersion`
- `memberEvidenceIds`
- `occurrenceClassification`
- `occurrenceRuleId`
- `evidenceIndependence`
- `canonicalRecordId`
- `reconciliationResult`
- `lifecycleClassification`
- `lifecycleRuleId`
- `blocking`
- `unresolvedReason`

Recommended machine shape:

```js
{
  collisionEvidenceGroupId: 'sha256:...',
  memoryScopeId: 'scope_...',
  decisionId: 'gain-modulation-boundary',
  recordVersion: 3,
  memberEvidenceIds: ['evidence_1', 'evidence_2'],
  occurrenceClassification: 'CORROBORATING_PROVENANCE',
  occurrenceRuleId: 'OCC-CORR-001',
  evidenceIndependence: 'PROVEN_INDEPENDENT',
  reconciliationResult: 'MERGED_PROVENANCE',
  canonicalRecordId: 'canonical_...',
  lifecycleClassification: 'VALID_VERSION_CHAIN',
  lifecycleRuleId: 'LIFECYCLE-VERSION-001',
  blocking: false,
  unresolvedReason: null,
}
```

This must be sufficient to prove whether two hosts are seeing the same structural collision or merely the same count.

## Lifecycle Classification Rules

Lifecycle evaluation must run only after occurrence reconciliation.

Minimum required lifecycle rule families:

- `LIFECYCLE-SINGLE-001`
  - one canonical version only
  - result: `SINGLE_VERSION`
- `LIFECYCLE-VERSION-001`
  - explicit or deterministic prior-version continuity with no forks
  - result: `VALID_VERSION_CHAIN`
- `LIFECYCLE-VERSION-002`
  - multiple competing next versions from one prior canonical record
  - result: `FORKED_VERSION_CHAIN`
- `LIFECYCLE-VERSION-003`
  - missing required version continuity evidence
  - result: `INCOMPLETE_VERSION_CHAIN`
- `LIFECYCLE-SUPERSEDE-001`
  - explicit complete supersession links with no cycle
  - result: `VALID_SUPERSESSION_CHAIN`
- `LIFECYCLE-SUPERSEDE-002`
  - missing required supersession partner/link
  - result: `INCOMPLETE_SUPERSESSION_CHAIN`
- `LIFECYCLE-SUPERSEDE-003`
  - supersession graph contains a cycle
  - result: `CYCLIC_SUPERSESSION_CHAIN`
- `LIFECYCLE-NA-001`
  - lifecycle evaluation does not apply to the record/set
  - result: `NOT_APPLICABLE`

## Freeze and Determinism Requirements

Occurrence and lifecycle evidence must be frozen before classification.

Required inputs for an evidence group must come from the same immutable candidate run evidence:

- frozen manifest entries
- admitted artifact rows
- reconstructed candidate records
- provenance rows
- lineage metadata
- structural validation results

Rules:

1. The classifier must read the same frozen evidence on repeated runs.
2. The same frozen evidence must produce the same occurrence classifications, lifecycle classifications, and reconciliation outcomes.
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

## Malformed-Record Scope

Malformed evidence must be handled conservatively.

Default rules:

- retain malformed evidence
- preserve valid siblings
- do not reconcile automatically unless equivalence remains provable without interpreting malformed content
- keep a precise blocker where uncertainty remains

Malformed scope must be reported explicitly:

- blocks only the malformed occurrence
- blocks the same-version occurrence group
- blocks the broader decision history

The default should be the narrowest mechanically defensible blocker scope, not automatic escalation to whole-history invalidation.

## Candidate Validity Rules

`C0.5C` must keep execution success separate from candidate validity.

A run may:

- complete collision discovery successfully
- complete deterministic classification successfully
- still leave the candidate invalid because unresolved or malformed groups remain

The report must therefore distinguish at least:

- execution success of the collision-classification pass
- execution success of lifecycle classification
- candidate validity after reconciliation
- reconciled non-conflict groups
- unresolved blocking groups
- malformed blocking groups

## Report Requirements

The report must expose both compact and detailed collision views.

### Ordinary report

The ordinary report should foreground:

- number of occurrence groups discovered
- count by occurrence classification
- count by lifecycle classification
- number reconciled automatically
- number still blocking validity
- candidate validity before classification
- candidate validity after classification

### Detailed report

The detailed report must preserve:

- one row per occurrence evidence group
- stable evidence-group identity
- occurrence classification basis
- lifecycle classification basis where applicable
- reconciliation action
- blocker reason where unresolved

Compact and detailed counts must derive from the same immutable evidence-group rows and reconcile exactly.

Required count reconciliation:

```text
original occurrence groups
=
automatically reconciled groups
+ unresolved blocking groups
+ malformed blocking groups
```

## Validation Requirements

`C0.5C` must validate:

- occurrence-group determinism
- lifecycle-classification determinism
- classification coverage for every detected occurrence group
- no silent drop of an occurrence group during reconciliation
- provenance completeness after reconciliation
- Tier-2 link remapping to canonical Tier-1 identities
- candidate validity recalculation after reconciliation
- generic blocker replacement and exact reconciliation counts
- continued proof that live DB, snapshot, state marker, corpus files, and host chat state remain unchanged
- continued proof that promotion remains unavailable

## Blocker Replacement Rules

Existing generic `REBUILD_DECISION_COLLISION` blockers must be deterministically:

- resolved when the occurrence group is a proven non-conflict
- replaced with a precise blocking code when unresolved
- retained only when classification itself fails

Rules:

1. Do not leave stale generic blockers beside new classification results.
2. Candidate validity must be recalculated from the reconciled and unreconciled evidence groups.
3. Replaced blockers must point to specific occurrence or lifecycle failure classes, not aggregate ambiguity.

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
- lifecycle graph evaluation helpers
- provenance-preserving reconciliation helpers
- Tier-2 remapping to canonical Tier-1 identities
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

1. duplicate occurrence inside a valid version chain
2. branch duplicate inside a valid version chain
3. mixed duplicate and corroborating occurrences within one decision history
4. forked version chain
5. incomplete prior-version chain
6. cyclic supersession chain
7. Tier-2 link remapping after duplicate reconciliation
8. stable group IDs under randomized input order
9. classifier-version changes do not change evidence-group IDs
10. unknown independence does not become corroboration
11. generic blocker replacement and exact count reconciliation
12. malformed member with valid siblings
13. same generated ID with incompatible semantics classifies as `GENERATED_ID_COLLISION`
14. incompatible same-version canonical hashes classify as `UNRESOLVED_SEMANTIC_CONFLICT`
15. automatically reconciled non-conflicts reduce candidate blockers without mutating corpus
16. unresolved semantic conflicts remain blockers
17. compact and detailed reports reconcile exactly
18. Node and Bun emit equivalent occurrence and lifecycle classifications for the same frozen corpus
19. live authority artifacts remain unchanged across success, failure, and invalidation paths
20. no promotion surface exists

## Stop-Before-Code Condition

Do not begin implementation until this brief is reviewed and accepted as the active `C0.5C` contract.
