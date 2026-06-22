import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCHITECTURAL_PROFILE,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import {
    buildArchitecturalKeyLines,
    isWarmArchiveEligible,
    validateArchitecturalShellSections,
} from './architectural-sharder-shell.js';

const registry = getSharderSectionRegistry(ARCHITECTURAL_PROFILE);

function buildSections(overrides = {}) {
    const sections = {
        _metadata: {
            keyLines: buildArchitecturalKeyLines(['Sources: Messages 1-4']),
            architectural: {
                keyPresent: true,
                terminatorCount: 1,
                unknownSectionHeaders: [],
            },
        },
        current: [{ content: 'Project|State|Focus|Pending|Blocked|Next', selected: true }],
    };

    registry.contentSections.forEach((section) => {
        if (!Array.isArray(sections[section.key])) {
            sections[section.key] = section.key === 'current'
                ? sections.current
                : [];
        }
    });

    return {
        ...sections,
        ...overrides,
        _metadata: {
            ...sections._metadata,
            ...(overrides._metadata || {}),
            architectural: {
                ...sections._metadata.architectural,
                ...(overrides._metadata?.architectural || {}),
            },
        },
    };
}

function getCodes(diagnostics) {
    return diagnostics.map((entry) => entry.code);
}

test('architectural shell validator warns when KEY is missing', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({
        _metadata: { architectural: { keyPresent: false } },
    }));

    assert.equal(getCodes(diagnostics).includes('ARCH_KEY_RECOVERED'), true);
});

test('architectural shell validator warns when Profile marker is missing or invalid', () => {
    const missing = validateArchitecturalShellSections(buildSections({
        _metadata: { keyLines: ['Schema: architectural-memory/v1'] },
    }));
    const invalid = validateArchitecturalShellSections(buildSections({
        _metadata: { keyLines: ['Profile: wrong', 'Schema: architectural-memory/v1'] },
    }));

    assert.equal(getCodes(missing).includes('ARCH_KEY_PROFILE_RECOVERED'), true);
    assert.equal(getCodes(invalid).includes('ARCH_KEY_PROFILE_RECOVERED'), true);
});

test('architectural shell validator warns when Schema marker is missing or invalid', () => {
    const missing = validateArchitecturalShellSections(buildSections({
        _metadata: { keyLines: ['Profile: architectural-memory'] },
    }));
    const invalid = validateArchitecturalShellSections(buildSections({
        _metadata: { keyLines: ['Profile: architectural-memory', 'Schema: wrong'] },
    }));

    assert.equal(getCodes(missing).includes('ARCH_KEY_SCHEMA_RECOVERED'), true);
    assert.equal(getCodes(invalid).includes('ARCH_KEY_SCHEMA_RECOVERED'), true);
});

test('architectural shell validator errors when CURRENT is missing', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({ current: [] }));
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_MISSING'), true);
});

test('architectural shell validator errors when zero CURRENT rows are selected', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({
        current: [{ content: 'Project|State|Focus|Pending|Blocked|Next', selected: false }],
    }));
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_EMPTY'), true);
});

test('architectural shell validator errors when multiple CURRENT rows are selected', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({
        current: [
            { content: 'Project|State|Focus|Pending|Blocked|Next', selected: true },
            { content: 'Project 2|State|Focus|Pending|Blocked|Next', selected: true },
        ],
    }));
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_MULTIPLE'), true);
});

test('architectural shell validator passes when exactly one CURRENT row is selected', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections());
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_MISSING'), false);
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_EMPTY'), false);
    assert.equal(getCodes(diagnostics).includes('ARCH_CURRENT_MULTIPLE'), false);
});

test('architectural shell validator allows optional empty sections', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({
        timeline: [],
        decisions: [],
        events: [],
        developments: [],
        dialogue: [],
        threads: [],
    }));
    assert.equal(diagnostics.some((entry) => entry.level === 'error'), false);
});

test('architectural shell validator warns on unsupported headers', () => {
    const diagnostics = validateArchitecturalShellSections(buildSections({
        _metadata: { architectural: { unknownSectionHeaders: ['WORLD'] } },
    }));
    assert.equal(getCodes(diagnostics).includes('ARCH_UNKNOWN_SECTION_IGNORED'), true);
});

test('architectural shell validator warns on missing or duplicate terminators', () => {
    const missing = validateArchitecturalShellSections(buildSections({
        _metadata: { architectural: { terminatorCount: 0 } },
    }));
    const duplicate = validateArchitecturalShellSections(buildSections({
        _metadata: { architectural: { terminatorCount: 2 } },
    }));

    assert.equal(getCodes(missing).includes('ARCH_TERMINATOR_RECOVERED'), true);
    assert.equal(getCodes(duplicate).includes('ARCH_TERMINATOR_RECOVERED'), true);
});

test('warm archive eligibility stays disabled for architectural profile and enabled for narrative when RAG is on', () => {
    assert.equal(isWarmArchiveEligible(ARCHITECTURAL_PROFILE, true), false);
    assert.equal(isWarmArchiveEligible('narrative', true), true);
    assert.equal(isWarmArchiveEligible('narrative', false), false);
});
