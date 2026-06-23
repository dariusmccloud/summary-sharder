import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCHITECTURAL_CURRENT_POINTER_ARCHIVE,
    bindChatToArchitecturalMemoryScope,
    buildArchitecturalDecisionAuthorityInput,
    buildArchitecturalDecisionCanonicalHash,
    buildArchitecturalImportedProjectionDiagnostic,
    commitArchitecturalScopeAuthorityUpdate,
    createInMemoryArchitecturalAuthorityBackend,
    ensureArchitecturalScopeRegistry,
    exportLegacyArchitecturalAuthorityPayload,
    loadArchitecturalCurrentAuthority,
    loadArchitecturalReferenceIndexSnapshot,
    loadArchitecturalScopeRegistry,
    hasLegacyArchitecturalAuthorityData,
    materializeArchivedCurrentPointer,
    persistArchitecturalReferenceIndexSnapshot,
    persistArchitecturalStubRecord,
    resolveProjectionAuthoritySet,
    resetArchitecturalAuthorityBackend,
    setArchitecturalAuthorityBackend,
    validateArchitecturalAuthorityState,
} from './architectural-authority-store.js';

function decisionContent(id, overrides = {}) {
    const fields = {
        TYPE: 'GOVERNANCE',
        DECISION: `Decision ${id}`,
        WHY: 'Explicit reason',
        SCOPE: 'architectural test surface',
        STATUS: 'SEALED',
        EVIDENCE: '"quoted evidence"',
        ...overrides,
    };

    const fieldText = [
        `TYPE: ${fields.TYPE}`,
        `DECISION: ${fields.DECISION}`,
        `WHY: ${fields.WHY}`,
        `SCOPE: ${fields.SCOPE}`,
        `STATUS: ${fields.STATUS}`,
        ...(fields.SUPERSEDES ? [`SUPERSEDES: ${fields.SUPERSEDES}`] : []),
        ...(fields['SUPERSEDED-BY'] ? [`SUPERSEDED-BY: ${fields['SUPERSEDED-BY']}`] : []),
        `EVIDENCE: ${fields.EVIDENCE}`,
    ].join(' | ');

    return `[S1:1] 🔴 ID: ${id} | ${fieldText}`;
}

test.beforeEach(() => {
    resetArchitecturalAuthorityBackend();
    setArchitecturalAuthorityBackend(createInMemoryArchitecturalAuthorityBackend());
});

test.after(() => {
    resetArchitecturalAuthorityBackend();
});

test('canonical formatting changes do not alter the semantic hash', async () => {
    const a = await buildArchitecturalDecisionAuthorityInput(
        '[S1:1] 🔴 ID: alpha | TYPE:GOVERNANCE, IMPLEMENTATION | DECISION: Example | WHY: Explicit reason | SCOPE: test | STATUS: SEALED | EVIDENCE: "x"'
    );
    const b = await buildArchitecturalDecisionAuthorityInput(
        '[S1:1] 🔴 id: alpha | type: implementation,governance | decision: Example | why: Explicit reason | scope: test | status: SEALED | evidence: "x"'
    );

    assert.equal(a.canonicalHash, b.canonicalHash);
    assert.equal(a.canonicalHashVersion, 1);
    assert.equal(a.hashAlgorithm, 'SHA-256');
});

test('same expected version update succeeds and increments scope run once', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    const updated = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        expectedScopeVersion: created.registry.scopeVersion,
        expectedDecisionVersionsById: { alpha: 1 },
        decisions: [decisionContent('alpha', { WHY: 'Updated reason' })],
        sourceChatId: 'chat-a',
    });

    assert.equal(updated.registry.currentScopeRun, 2);
    assert.equal(updated.projectionState.alpha.currentRecordVersion, 2);
});

test('stale expected version blocks authority overwrite', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        expectedScopeVersion: created.registry.scopeVersion,
        expectedDecisionVersionsById: { alpha: 1 },
        decisions: [decisionContent('alpha', { WHY: 'Fresh reason' })],
        sourceChatId: 'chat-a',
    });

    await assert.rejects(
        commitArchitecturalScopeAuthorityUpdate({
            memoryScopeId: 'scope-a',
            expectedScopeVersion: 2,
            expectedDecisionVersionsById: { alpha: 1 },
            decisions: [decisionContent('alpha', { WHY: 'Stale writer' })],
            sourceChatId: 'chat-b',
        }),
        /version conflict/i
    );
});

test('stale chat projection loads current scope authority and is marked stale', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        expectedScopeVersion: created.registry.scopeVersion,
        expectedDecisionVersionsById: { alpha: 1 },
        decisions: [decisionContent('alpha', { WHY: 'Changed after projection' })],
        sourceChatId: 'chat-b',
    });

    const resolved = await resolveProjectionAuthoritySet('scope-a', {
        alpha: {
            decisionId: 'alpha',
            currentRecordVersion: 1,
            canonicalHash: created.projectionState.alpha.canonicalHash,
        },
    });

    assert.equal(resolved.projectionState.alpha.stale, true);
    assert.match(resolved.diagnostics[0].code, /ARCH_SCOPE_PROJECTION_STALE/);
});

test('active current pointer resolves correctly', async () => {
    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    const authority = await loadArchitecturalCurrentAuthority('scope-a', 'alpha');
    assert.equal(authority.pointer.authorityLocation, 'active');
    assert.equal(authority.record.decisionId, 'alpha');
});

test('archived current pointer plus stub resolves correctly', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    await persistArchitecturalStubRecord({
        memoryScopeId: 'scope-a',
        decisionId: 'alpha',
        status: 'SUPERSEDED',
        archivePointer: { memoryScopeId: 'scope-a', decisionId: 'alpha', recordVersion: 1 },
    });

    await materializeArchivedCurrentPointer({
        memoryScopeId: 'scope-a',
        decisionId: 'alpha',
        recordVersion: created.projectionState.alpha.currentRecordVersion,
        canonicalHash: created.projectionState.alpha.canonicalHash,
        archivePointer: { memoryScopeId: 'scope-a', decisionId: 'alpha', recordVersion: 1 },
        stubRecord: {
            memoryScopeId: 'scope-a',
            decisionId: 'alpha',
            status: 'SUPERSEDED',
            archivePointer: { memoryScopeId: 'scope-a', decisionId: 'alpha', recordVersion: 1 },
        },
    });

    const authority = await loadArchitecturalCurrentAuthority('scope-a', 'alpha');
    assert.equal(authority.pointer.authorityLocation, ARCHITECTURAL_CURRENT_POINTER_ARCHIVE);
    assert.equal(authority.stub.status, 'SUPERSEDED');
});

test('immutable prior versions remain readable but are not current authority', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    const updated = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        expectedScopeVersion: created.registry.scopeVersion,
        expectedDecisionVersionsById: { alpha: 1 },
        decisions: [decisionContent('alpha', { WHY: 'Second version' })],
        sourceChatId: 'chat-a',
    });

    const current = await loadArchitecturalCurrentAuthority('scope-a', 'alpha');
    assert.equal(current.pointer.currentRecordVersion, 2);
    assert.equal(updated.projectionState.alpha.currentRecordVersion, 2);
});

test('memory-scope reassignment remains blocked', async () => {
    const root = {};
    await bindChatToArchitecturalMemoryScope(root, {
        chatId: 'chat-a',
        requestedScopeId: 'scope-a',
    });

    await assert.rejects(
        bindChatToArchitecturalMemoryScope(root, {
            chatId: 'chat-a',
            requestedScopeId: 'scope-b',
        }),
        /reassignment is blocked/i
    );
});

test('chat binding creates a stable chat instance id and branches on chat id change', async () => {
    const root = {};
    const first = await bindChatToArchitecturalMemoryScope(root, {
        chatId: 'chat-a',
        requestedScopeId: 'scope-a',
    });
    const second = await bindChatToArchitecturalMemoryScope(root, {
        chatId: 'chat-b',
        requestedScopeId: 'scope-a',
    });

    assert.equal(first.memoryScopeId, 'scope-a');
    assert.equal(typeof first.chatInstanceId, 'string');
    assert.notEqual(second.chatInstanceId, first.chatInstanceId);
    assert.equal(second.branchedFromChatInstanceId, first.chatInstanceId);
});

test('archive records survive backend reload', async () => {
    const backend = createInMemoryArchitecturalAuthorityBackend();
    setArchitecturalAuthorityBackend(backend);

    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    setArchitecturalAuthorityBackend(backend);
    const authority = await loadArchitecturalCurrentAuthority('scope-a', 'alpha');
    assert.equal(authority.record.decisionId, 'alpha');
});

test('multiple chat projections do not count as duplicate authorities', async () => {
    const created = await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    const projectionA = { alpha: created.projectionState.alpha };
    const projectionB = { alpha: created.projectionState.alpha };
    const resolvedA = await resolveProjectionAuthoritySet('scope-a', projectionA);
    const resolvedB = await resolveProjectionAuthoritySet('scope-a', projectionB);
    const diagnostics = await validateArchitecturalAuthorityState('scope-a');

    assert.equal(resolvedA.projectionState.alpha.stale, false);
    assert.equal(resolvedB.projectionState.alpha.stale, false);
    assert.equal(diagnostics.length, 0);
});

test('imported chat projection with missing scope registry requires reconciliation', async () => {
    const diagnostic = buildArchitecturalImportedProjectionDiagnostic(
        { memoryScopeId: 'scope-missing' },
        null
    );

    assert.equal(diagnostic.code, 'ARCH_IMPORTED_SCOPE_RECONCILIATION_REQUIRED');
});

test('scope registry persists current scope run and bindings', async () => {
    await ensureArchitecturalScopeRegistry('scope-a', 'jeep-architectural');
    const registry = await loadArchitecturalScopeRegistry('scope-a');

    assert.equal(registry.memoryScopeId, 'scope-a');
    assert.equal(registry.currentScopeRun, 0);
});

test('legacy authority payload export groups persisted records by type', async () => {
    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    const hasLegacy = await hasLegacyArchitecturalAuthorityData();
    const payload = await exportLegacyArchitecturalAuthorityPayload();

    assert.equal(hasLegacy, true);
    assert.equal(payload.registries.length, 1);
    assert.equal(payload.currentPointers.length, 1);
    assert.equal(payload.decisionRecords.length, 1);
});

test('reference index snapshots persist as rebuildable cache metadata', async () => {
    await persistArchitecturalReferenceIndexSnapshot({
        memoryScopeId: 'scope-a',
        referenceEpoch: 3,
        contributingChats: ['chat-a', 'chat-b'],
        completeness: 'complete',
        indexSchemaVersion: 1,
    });

    const snapshot = await loadArchitecturalReferenceIndexSnapshot('scope-a');
    assert.equal(snapshot.referenceEpoch, 3);
    assert.deepEqual(snapshot.contributingChats, ['chat-a', 'chat-b']);
});

test('unproven same-id collision is blocked when no expected version is supplied', async () => {
    await commitArchitecturalScopeAuthorityUpdate({
        memoryScopeId: 'scope-a',
        decisions: [decisionContent('alpha')],
        sourceChatId: 'chat-a',
    });

    await assert.rejects(
        commitArchitecturalScopeAuthorityUpdate({
            memoryScopeId: 'scope-a',
            decisions: [decisionContent('alpha', { WHY: 'Different semantic content' })],
            sourceChatId: 'chat-b',
        }),
        /unproven/i
    );
});

test('current authority is distinct from hash helper payload normalization', async () => {
    const a = await buildArchitecturalDecisionCanonicalHash({
        id: 'alpha',
        type: 'IMPLEMENTATION, GOVERNANCE',
        decision: 'Example',
        why: 'Reason',
        scope: 'test',
        status: 'SEALED',
        evidence: '"x"',
    });
    const b = await buildArchitecturalDecisionCanonicalHash({
        ID: 'alpha',
        TYPE: 'GOVERNANCE,IMPLEMENTATION',
        DECISION: 'Example',
        WHY: 'Reason',
        SCOPE: 'test',
        STATUS: 'SEALED',
        EVIDENCE: '"x"',
    });

    assert.equal(a.canonicalHash, b.canonicalHash);
});
