# Phase C0.5B: Evidence Expansion and Reconstruction Interpretation Brief

## Status

STATUS: IMPLEMENTED AND VERIFIED

`C0.5B` is closed.

This document remains the governing record of the deterministic Tier-2 reconstruction boundary.

`C0.5B` expanded candidate reconstruction beyond already-structured Architectural shards and into explicit Tier-2 dialogue evidence, while remaining fully isolated from live authority.

Implementation closeout is recorded in:

- [C0_5B_COMPLETION_REPORT.md](C:\Users\chris\OneDrive\Documents\Personal\Projects\summary-sharder\docs\architectural-memory\C0_5B_COMPLETION_REPORT.md)

The next implementation boundary is:

- [PHASE_C0_5C_TIER_1_COLLISION_CLASSIFICATION_AND_CANDIDATE_VALIDITY_RECOVERY_BRIEF.md](C:\Users\chris\OneDrive\Documents\Personal\Projects\summary-sharder\docs\architectural-memory\PHASE_C0_5C_TIER_1_COLLISION_CLASSIFICATION_AND_CANDIDATE_VALIDITY_RECOVERY_BRIEF.md)

It does not authorize:

- candidate promotion
- startup adoption from candidate state
- live authority mutation
- corpus normalization
- metadata adoption
- silent authority creation from model output
- direct compilation of lower evidence tiers beyond the Tier-2 boundary defined here

## Governing Flow

`C0.5B` must prove this chain:

```text
discover Tier-2 evidence
→ extract candidate claims
→ reconcile against Tier 1
→ validate provenance and conflicts
→ emit expanded candidate report
→ stop before promotion
```

Successful `C0.5B` completion means:

```text
candidate built
Tier-1 and Tier-2 evidence reported separately
conflicts and ambiguities surfaced explicitly
live authority untouched
promotion unavailable
```

## Carry-Forward Constraints

All `C0.5A` safety constraints remain in force:

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

`C0.5B` adds these non-negotiable rules:

12. Explicit wording alone does not establish authority.
13. Claim class and claim lifecycle state are separate dimensions.
14. Mentioned content must not be compiled as asserted claims.
15. `C0.5B-1` is deterministic extraction only.
16. Model output may help propose candidate interpretations only in a later reviewed sub-slice and never establishes authority by itself.

## Internal Phase Boundary

### `C0.5B-1`

Deterministic, self-contained explicit claims only.

`C0.5B-1` must perform:

- no LLM calls
- no model-assisted phase flag
- no semantic similarity reconciliation
- no freeform interpretation
- no bounded dialogue-pair interpretation

### `C0.5B-2`

Reserved for a later reviewed slice covering bounded contextual claims and/or model-assisted review proposals.

`C0.5B-2` is not part of this implementation boundary.

## Evidence Hierarchy in Scope

### Tier 1

- structured Architectural shards
- already implemented in `C0.5A`
- remains the highest-confidence compiled evidence class

### Tier 2

- explicit decisions stated in raw dialogue
- explicit corrections in raw dialogue
- explicit supersession statements in raw dialogue
- explicit unresolved commitments stated in raw dialogue

`C0.5B-1` compiles Tier 2 only when its evidence satisfies the bounded rules in this brief.

### Still Out of Scope

- lorebooks as reconstruction authority inputs
- diffuse semantic implication without explicit claim structure
- broad “project theme” inference
- automatic interpretation of deletion as forgetting
- full lower-tier freeform recovery from ordinary conversational drift
- context-dependent acceptance resolution
- pronoun-only or reference-only claim completion

## Claim Schema

Each candidate claim must preserve at least:

```text
claimClass:
- DECISION
- CORRECTION
- SUPERSESSION
- UNRESOLVED_COMMITMENT

claimState:
- PROPOSED
- ACCEPTED
- SEALED
- SUPERSEDED
- UNRESOLVED
```

Rule:

> An explicit proposal is not automatically an accepted decision.

Example:

```text
"We should keep browser-local state non-authoritative."
→ claimClass=DECISION
→ claimState=PROPOSED
```

The extraction path must not compile brainstorming language as accepted canon without bounded acceptance evidence.

## Speaker Authority and Jurisdiction

Every claim must retain:

- `speakerEntityId`
- `speakerRole`
- `authorityClass`
- `authorityBasis`

Required machine-readable authority classes:

- `USER_AUTHORITY`
- `CHARACTER_SELF_AUTHORITY`
- `SYSTEM_GOVERNANCE_AUTHORITY`
- `ASSISTANT_PROPOSAL`
- `UNKNOWN_AUTHORITY`

Recommended machine shape:

```js
{
  speakerEntityId: 'character:jeep.png',
  speakerRole: 'assistant',
  authorityClass: 'ASSISTANT_PROPOSAL',
  authorityBasis: 'speaker_role_default',
  jurisdictionScope: 'companion_behavior',
}
```

### Authority and Jurisdiction Matrix

| authorityClass | Default claimState ceiling in `C0.5B-1` | Jurisdiction rule |
| --- | --- | --- |
| `USER_AUTHORITY` | `ACCEPTED` when the message is an explicit governing/approval statement | Governs user-owned architectural and workflow decisions within the current memory scope |
| `CHARACTER_SELF_AUTHORITY` | `ACCEPTED` only within explicitly bounded self-jurisdiction | May be authoritative about the character's own state, preferences, or commitments when explicitly scoped |
| `SYSTEM_GOVERNANCE_AUTHORITY` | `ACCEPTED` or `SEALED` only when explicitly governed by system artifact rules | Applies to system-level schema, policy, or governance text explicitly recognized by reconstruction rules |
| `ASSISTANT_PROPOSAL` | `PROPOSED` only | Recommendations remain proposals unless separately accepted by higher authority |
| `UNKNOWN_AUTHORITY` | `PROPOSED` or blocked | Never silently escalates to accepted canon |

Rules:

1. Assistant recommendations remain proposals unless separately accepted.
2. Character statements may be authoritative only within their own valid jurisdiction.
3. Explicit wording alone does not establish authority.
4. Jurisdiction over architectural canon defaults to review if the authority basis is unclear.

## Asserted Content Versus Mentioned Content

Deterministic extraction must distinguish message assertions from content merely quoted, pasted, demonstrated, rejected, or attributed.

### Non-admitted mention zones

Exclude from automatic admission by default:

- fenced code blocks
- inline code
- Markdown blockquotes
- quoted reports or dialogue
- JSON or log payloads
- example sections
- hypothetical examples
- rejected alternatives
- text explicitly attributed to another speaker or system

Detected claim-like text in these zones may be reported as non-admitted mentions, but must not become candidate authority claims.

### Claim-zone classifications

Each detected claim-like occurrence must retain:

- `claimZoneClass`
- `extractionRuleId`
- `extractionRuleVersion`
- `normalizationVersion`
- `sourceRevisionHash`

Required zone classes:

- `ASSERTED_BODY`
- `MENTION_CODE`
- `MENTION_QUOTE`
- `MENTION_LOG`
- `MENTION_EXAMPLE`
- `MENTION_REJECTED_ALTERNATIVE`
- `MENTION_ATTRIBUTED`

### Mention handling rules

1. Only `ASSERTED_BODY` is automatically admissible in `C0.5B-1`.
2. Mention zones may produce `NON_ADMITTED_MENTION` report items.
3. A quoted or pasted earlier decision is not a new decision occurrence unless the surrounding asserted body explicitly reasserts it.

## Self-Contained Versus Context-Dependent Claims

`C0.5B-1` compiles only self-contained explicit claims.

Messages such as:

- “Agree.”
- “That works.”
- “Do that.”
- numbered acceptance lists without explicit referent resolution
- “replace the earlier one”
- pronoun-only corrections

must be reported as `CONTEXT_DEPENDENT_CANDIDATE` or equivalent, not admitted automatically.

Bounded dialogue-pair interpretation belongs to a later reviewed sub-slice.

## Tier-2 Eligibility Rules

Tier-2 admission must be exact enough to be reproducible and conservative enough to avoid inventing authority.

Admit a Tier-2 candidate claim only when all required conditions hold:

1. The source message has immutable message identity.
2. The source chat has a valid `chatInstanceId` and `memoryScopeId`.
3. The source message is present in the frozen corpus view.
4. The source message is not excluded by explicit `evidencePolicy`.
5. The source message content is available in exact frozen form.
6. The detected claim lies in `ASSERTED_BODY`.
7. The claim is explicit, not merely implied.
8. The claim is self-contained, not context-dependent.
9. The claim can be anchored to a bounded claim span or exact message occurrence.
10. The extraction path can explain why the claim was admitted.
11. The resulting candidate record retains full provenance to the originating message.
12. Claim class, claim state, and authority class are all deterministically derived.

Block Tier-2 admission when any of the following apply:

- message identity missing or ambiguous
- source revision changed after manifest freeze
- claim lies only in a non-admitted mention zone
- claim depends on non-local semantic guesswork
- claim depends on merging multiple ambiguous occurrences without a deterministic rule
- claim conflicts with a higher-tier structured record and the precedence rule is unresolved
- source message is explicitly `evidencePolicy=exclude`
- source content is malformed, truncated, or unavailable
- authority basis is insufficient for the proposed lifecycle state
- claim is context-dependent without deterministic referent resolution

### Archive and evidence policy

Archive state and evidence policy remain independent:

```text
archived + evidencePolicy=include
→ eligible if all other requirements pass

evidencePolicy=exclude
→ blocked regardless of archive state
```

### Explicitness standard

For `C0.5B-1`, “explicit” means the message directly states one of:

- a decision
- a correction to a prior decision or fact
- a supersession relationship
- an unresolved commitment or planned action

Examples of admissible claim shapes:

- “We should keep browser-local state non-authoritative.”
- “That earlier decision was wrong; the DB is operational only.”
- “Decision X replaces decision Y.”
- “We still need to validate import collision handling.”

Examples that remain out of scope or review-only:

- vague preference or mood
- indirect implication from tone
- broad paraphrase requiring semantic interpretation
- cluster-based inference across many messages without explicit anchor text
- context-only acceptance or rejection

## Deterministic Extraction Rules

`C0.5B-1` permits deterministic extraction only.

Required properties:

- fixed rule set
- fixed normalization
- no model judgment
- no semantic similarity matching
- no context-window interpretation outside the extracted explicit span

The extraction result must retain:

- `extractionRuleId`
- `extractionRuleVersion`
- `normalizationVersion`
- `claimZoneClass`
- `sourceRevisionHash`

Changing extraction rules must not silently change the meaning of an existing candidate claim without appearing in determinism or report output.

## Claim Identity Specification

Claim IDs must be stable across unchanged runs.

Define a versioned deterministic identity:

```text
claimIdV1 = SHA-256(
  memoryScopeId
  + sourceMessageId
  + claimSpan
  + claimClass
  + claimState
  + extractionRuleId
  + extractionRuleVersion
  + normalizedClaimPayload
)
```

Rules:

1. Do not use random IDs for deterministic candidate claims.
2. When no explicit decision ID exists, use a stable provisional occurrence-derived record ID.
3. Do not invent a semantic slug and treat it as established identity.
4. Equivalent unchanged runs must yield the same `claimIdV1`.

Recommended machine shape:

```js
{
  claimId: 'claimv1:sha256:...',
  claimIdVersion: 1,
  normalizedClaimPayloadHash: 'sha256:...',
}
```

## Claim-Span Offset Contract

Claim span offsets must use one canonical representation across Node and Bun.

Governed unit for `C0.5B-1`:

- Unicode code-point offsets

Normalization rules:

1. Normalize line endings to `\n` before computing offsets.
2. Preserve source text content exactly apart from governed line-ending normalization.
3. Use the same Unicode normalization strategy in both runtimes and report its version through `normalizationVersion`.
4. Determinism tests must fail if runtime-specific offset calculations diverge.

## Branch Evidence Lineage

Distinguish:

```text
source occurrence:
chatInstanceId + messageId

evidence lineage:
the same ancestral message copied through branch or import lineage
```

Rules:

1. Retain every source locator.
2. Do not count copied branch ancestors as independent corroboration.
3. A branch copy is additional provenance, not additional evidentiary weight.
4. Equivalent branch-copied occurrences should resolve to one lineage group plus multiple locators.

Recommended machine shape:

```js
{
  evidenceLineageId: 'lineagev1:sha256:...',
  sourceOccurrences: [
    { chatInstanceId: 'chat_a', messageId: 'msg_1' },
    { chatInstanceId: 'chat_b', messageId: 'msg_1_copy' },
  ],
}
```

## Claim Classes and Lifecycle States

Required claim classes:

- `DECISION`
- `CORRECTION`
- `SUPERSESSION`
- `UNRESOLVED_COMMITMENT`

Required claim states:

- `PROPOSED`
- `ACCEPTED`
- `SEALED`
- `SUPERSEDED`
- `UNRESOLVED`

Non-admitted report-only classifications:

- `AMBIGUOUS_CANDIDATE`
- `CONTEXT_DEPENDENT_CANDIDATE`
- `OUT_OF_SCOPE_CANDIDATE`
- `NON_ADMITTED_MENTION`
- `UNSUPPORTED_PATTERN`

## Confidence and Ambiguity Representation

Confidence must be representational, not performative.

Required machine states:

- `EXPLICIT_DETERMINISTIC`
- `AMBIGUOUS`
- `CONFLICTED`
- `OUT_OF_SCOPE`
- `NON_ADMITTED_MENTION`
- `CONTEXT_DEPENDENT`

Recommended machine shape:

```js
{
  extractionMode: 'deterministic',
  confidenceClass: 'EXPLICIT_DETERMINISTIC|AMBIGUOUS|CONFLICTED|OUT_OF_SCOPE|NON_ADMITTED_MENTION|CONTEXT_DEPENDENT',
  ambiguityReasons: [
    'multiple plausible target decisions',
    'insufficient explicit claim boundary',
  ],
}
```

Rule:

> Ambiguity must be surfaced rather than guessed.

## Tier-1 Reconciliation Matrix

Automatic corroboration requires one of:

- explicit Tier-1 record ID
- exact canonical payload match
- governed alias mapping
- uniquely resolved explicit target relationship

Semantic similarity alone must produce a review item such as:

```text
POSSIBLE_CORROBORATION
```

It must not automatically attach provenance or merge records.

### Reconciliation outcomes

| Basis | Outcome | Automatic? |
| --- | --- | --- |
| explicit Tier-1 record ID | corroboration or correction linkage | yes |
| exact canonical payload match | corroboration | yes |
| governed alias mapping | corroboration or targeted linkage | yes |
| uniquely resolved explicit target relationship | correction or supersession linkage | yes |
| semantic similarity only | `POSSIBLE_CORROBORATION` review item | no |
| unresolved contradiction with Tier 1 | conflict | no merge |
| distinct explicit record | separate candidate record | yes if otherwise admissible |

## Correction and Supersession Precedence

Tier-2 claims must reconcile against Tier 1 instead of bypassing it.

Precedence rules:

1. Tier 1 structured Architectural shard remains the stronger evidence class within the same temporal scope.
2. A later Tier-2 correction may create a candidate correction against a Tier-1 record, but it does not silently rewrite that record.
3. A Tier-2 supersession claim must be structurally complete before it becomes a compiled candidate relationship.
4. A Tier-2 correction that contradicts Tier 1 becomes:
   - a candidate conflict
   - or a candidate correction record
   - but never an automatic authority overwrite
5. When chronology is uncertain, prefer conflict surfacing over merge.

Required supersession pair rules remain:

- old record identified
- replacement record identified
- direction explicit
- source message provenance retained

If any part is missing, report the claim as incomplete rather than manufacturing a supersession edge.

## Dialogue Provenance Requirements

Every admitted Tier-2 candidate claim must retain provenance back to:

- reconstruction run ID
- memory scope ID
- host family
- relative source file path
- chat instance ID
- message ID
- message revision hash
- speaker entity ID
- speaker role
- authority class
- authority basis
- source timestamp
- exact claim span or bounded source reference
- claim zone classification
- extraction mode
- extraction rule ID
- extraction rule version
- normalization version

Recommended machine shape:

```js
{
  provenanceId: 'prov_...',
  reconstructionRunId: 'rebuild_...',
  memoryScopeId: 'scope_...',
  chatInstanceId: 'chat_...',
  sourceMessageId: 'msg_...',
  sourceRevisionHash: 'sha256:...',
  sourceTimestamp: '2026-06-24T18:00:05.000Z',
  speakerEntityId: 'character:jeep.png',
  speakerRole: 'assistant',
  authorityClass: 'ASSISTANT_PROPOSAL',
  authorityBasis: 'speaker_role_default',
  sourceLocator: {
    relativePath: 'chats/Jeep/Session A.jsonl',
  },
  claimSpan: {
    mode: 'whole_message|substring',
    offsetUnit: 'unicode_code_point',
    startOffset: 0,
    endOffset: 72,
  },
  claimZoneClass: 'ASSERTED_BODY',
  extractionMode: 'deterministic',
  extractionRuleId: 'tier2-explicit-decision-v1',
  extractionRuleVersion: 1,
  normalizationVersion: 1,
}
```

Missing required provenance is a validation failure.

## Candidate Schema Expansion

`C0.5B-1` should continue using an operational-shaped candidate DB and add only the minimum candidate-only audit structures needed for Tier-2 provenance and extraction traceability.

Proposed additions:

```js
{
  reconstruction_candidate_claims: [
    'reconstruction_run_id',
    'claim_id',
    'claim_id_version',
    'memory_scope_id',
    'claim_class',
    'claim_state',
    'authority_class',
    'authority_basis',
    'claim_zone_class',
    'extraction_mode',
    'extraction_rule_id',
    'extraction_rule_version',
    'normalization_version',
    'confidence_class',
    'admission_status',
    'admission_reason',
    'evidence_lineage_id',
    'source_message_id',
    'chat_instance_id',
    'source_revision_hash',
    'claim_text_excerpt_json',
    'normalized_claim_json',
    'created_at',
  ],
  reconstruction_candidate_claim_links: [
    'reconstruction_run_id',
    'claim_id',
    'related_record_id',
    'relationship_type',
    'reconciliation_basis',
  ],
  reconstruction_candidate_conflicts: [
    'reconstruction_run_id',
    'conflict_id',
    'claim_id',
    'conflict_code',
    'details_json',
  ],
  reconstruction_candidate_review_items: [
    'reconstruction_run_id',
    'review_item_id',
    'claim_id',
    'review_kind',
    'severity',
    'details_json',
  ],
}
```

These remain candidate-only tables.

Live schema bootstrap must still not create them.

## Tier-2 Performance Invariant

`C0.5B-1` must satisfy:

- one bounded linear scan over frozen messages
- no full-corpus rescan per claim
- no eager duplication of full raw messages into reports
- claim text excerpts bounded in ordinary reports
- expanded source text loaded only through detailed review surfaces

## Expanded Report Schema

`C0.5B-1` must emit an expanded candidate report that distinguishes Tier-1 and Tier-2 outcomes.

Minimum additions:

```js
{
  inputSummary: {
    tier1ArtifactsAdmitted: 8,
    tier2MessagesScanned: 240,
    tier2ClaimsDetected: 19,
    tier2ClaimsAdmitted: 7,
    tier2ClaimsAmbiguous: 5,
    tier2ClaimsBlocked: 7,
    tier2MentionsDetected: 4,
    tier2ContextDependent: 3,
  },
  tier2Claims: [
    {
      claimId: 'claimv1:sha256:...',
      claimIdVersion: 1,
      claimClass: 'DECISION',
      claimState: 'PROPOSED',
      authorityClass: 'ASSISTANT_PROPOSAL',
      extractionMode: 'deterministic',
      extractionRuleId: 'tier2-explicit-decision-v1',
      extractionRuleVersion: 1,
      claimZoneClass: 'ASSERTED_BODY',
      confidenceClass: 'EXPLICIT_DETERMINISTIC',
      admissionStatus: 'admitted',
      sourceMessageId: 'msg_...',
      chatInstanceId: 'chat_...',
      relatedRecordIds: ['scope:decision:1'],
    },
  ],
  tier2Conflicts: [
    {
      conflictId: 'conflict_...',
      claimId: 'claimv1:sha256:...',
      code: 'TIER2_CONTRADICTS_TIER1',
    },
  ],
  reviewItems: [
    {
      reviewItemId: 'review_...',
      reviewKind: 'POSSIBLE_CORROBORATION',
      severity: 'warning',
    },
  ],
}
```

The report must preserve:

- admitted claims
- blocked claims
- ambiguous claims
- context-dependent candidates
- non-admitted mentions
- conflicts
- unresolved evidence
- future promotion blockers

## Human Review Surfaces

`C0.5B-1` must surface interpretation risk explicitly.

Required review surfaces:

- admitted Tier-2 claims with provenance
- ambiguous candidate claims
- context-dependent candidate claims
- mention-only detections
- conflicts against Tier 1
- incomplete supersession or correction candidates
- blocked claims with reasons

The report must make it possible for a reviewer to answer:

- what exact message created this candidate claim
- what deterministic rule produced it
- why it was admitted, blocked, or marked ambiguous
- whether it was asserted or merely mentioned
- which Tier-1 record it corroborates, corrects, conflicts with, or leaves unresolved

## Reproducibility Requirements

Two unchanged runs over the same frozen corpus must produce equivalent meaningful candidate state.

For deterministic extraction:

- same source bytes
- same extraction rules
- same normalized outputs
- same `claimIdV1` values
- same candidate hash

Any unexplained change in claim IDs, offsets, claim states, authority classes, or reconciliation outcomes is a determinism failure.

## No-Promotion Boundary

`C0.5B-1` must still contain no promotion path.

Explicitly prohibited:

- no automatic swap
- no promote endpoint
- no promote UI
- no startup adoption
- no candidate-to-live fallback

`C0.5B-1` may expand candidate reports and candidate review surfaces only.

## File-Level Implementation Plan

### `tools/server-plugin/summary-sharder-memory/rebuild.js`

Extend candidate rebuild orchestration to:

- scan Tier-2 dialogue messages from the frozen manifest
- detect asserted versus mentioned claim zones
- extract deterministic self-contained claims only
- derive claim class, claim state, authority class, and provenance
- reconcile claims against Tier-1 candidate records using deterministic bases only
- emit expanded claim, conflict, and review reporting
- preserve no-promotion behavior

### `tools/server-plugin/summary-sharder-memory/schema.js`

Add candidate-only tables for:

- extracted claims
- claim-to-record links
- Tier-2 conflicts
- review items
- lineage-aware provenance expansion

Do not modify live operational bootstrap to create these tables.

### `core/summarization/architectural-rebuild-protocol.js`

Add:

- Tier-2 claim classes
- claim states
- authority classes
- claim zone classes
- extraction rule versioning fields
- confidence classes
- reconciliation basis enums
- report normalization for expanded candidate reports

### New Tier-2 extraction module

Recommended new module:

```text
core/summarization/architectural-dialogue-claim-extractor.js
```

Own:

- deterministic claim extraction rules
- asserted-versus-mentioned zone filtering
- explicit claim classification
- claim-state derivation
- authority-class derivation
- claim normalization
- ambiguity signaling
- provenance anchoring

### New Tier-2 tests

Recommended:

```text
core/summarization/architectural-dialogue-claim-extractor.test.mjs
tools/server-plugin/summary-sharder-memory/rebuild-tier2.test.mjs
```

## Test Matrix

1. proposal language is classified as `DECISION + PROPOSED`, not accepted canon
2. assistant recommendation remains `PROPOSED` absent acceptance evidence
3. user-authorized explicit decision is classified with the correct authority class and lifecycle state
4. Character self-authority is bounded by jurisdiction and does not exceed that scope
5. explicit correction statement becomes a correction candidate
6. explicit supersession statement becomes a supersession candidate only when structurally complete
7. incomplete supersession statement becomes reviewable but not admitted
8. explicit unresolved commitment becomes an admitted Tier-2 claim
9. vague implication remains out of scope
10. context-only acceptance is reported but not admitted
11. ambiguous target decision becomes `AMBIGUOUS`
12. claim-like text inside fenced code is not admitted
13. inline code, blockquotes, JSON, or logs become mention-only detections, not admitted claims
14. quoted Coder or Archivist reports are not treated as new decisions
15. rejected alternatives do not become claims
16. evidence-policy exclusion blocks admission regardless of archive state
17. archived source with `evidencePolicy=include` remains eligible if otherwise admissible
18. missing message identity blocks admission
19. changed source revision after freeze invalidates the claim
20. exact Tier-1 record ID creates deterministic corroboration or linkage
21. exact canonical payload match creates deterministic corroboration
22. governed alias mapping creates deterministic linkage
23. semantic similarity without exact basis becomes `POSSIBLE_CORROBORATION` review-only
24. Tier-2 contradiction against Tier-1 emits explicit conflict
25. distinct Tier-2 claim creates separate candidate record when admissible
26. branch copies do not count as independent corroboration
27. random candidate ordering does not change `claimIdV1` values or canonical candidate hash
28. deterministic extraction over unchanged corpus yields equivalent candidate state
29. candidate report distinguishes Tier-1 and Tier-2 counts
30. review items are emitted for ambiguity, context dependence, mention-only detections, and incomplete correction or supersession states
31. no candidate promotion route exists
32. live DB, snapshot, state marker, and corpus remain unchanged
33. Narrative behavior remains unchanged

## Implementation Stop Condition

Do not begin `C0.5B-1` code until this brief is reviewed and accepted.
