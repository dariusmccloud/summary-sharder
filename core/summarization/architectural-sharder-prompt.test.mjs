import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { DEFAULT_ARCHITECTURAL_SHARDER_PROMPT } from './architectural-sharder-prompt.js';

const EXPECTED_PROMPT_SHA256 = 'f54e739dabc5dbe952fd1435f3aff65dd22d9dc06be42e79530a6d0f1e6ddccc';
const CANONICAL_TYPES = [
    'GOVERNANCE',
    'JURISDICTION',
    'HIERARCHY',
    'CORRECTION',
    'REPLACEMENT',
    'RENAME',
    'SCOPE',
    'DIAGNOSTIC',
    'IMPLEMENTATION',
    'STRATEGY',
    'COMMITMENT',
    'PROCEDURE',
];

test('sealed architectural prompt digest remains unchanged', () => {
    const digest = crypto.createHash('sha256')
        .update(DEFAULT_ARCHITECTURAL_SHARDER_PROMPT, 'utf8')
        .digest('hex');

    assert.equal(digest, EXPECTED_PROMPT_SHA256);
});

test('sealed architectural prompt contains the canonical TYPE vocabulary exactly once each', () => {
    const typeValuesMatch = DEFAULT_ARCHITECTURAL_SHARDER_PROMPT.match(/TYPE values:\r?\n\r?\n`([^`]+)`/);

    assert.ok(typeValuesMatch, 'TYPE values list not found in prompt');

    const values = typeValuesMatch[1].split('|').map((entry) => entry.trim()).filter(Boolean);

    assert.deepEqual(values, CANONICAL_TYPES);

    for (const type of CANONICAL_TYPES) {
        assert.equal(values.filter((value) => value === type).length, 1, `TYPE ${type} should appear exactly once`);
    }
});

test('sealed architectural prompt documents repeated DEC fields for multi-reference events', () => {
    assert.equal(
        DEFAULT_ARCHITECTURAL_SHARDER_PROMPT.includes('When one EVENT references multiple decisions, repeat the pipe-delimited DEC field once per stable ID. Never comma-separate DEC references.'),
        true,
    );
    assert.equal(
        DEFAULT_ARCHITECTURAL_SHARDER_PROMPT.includes('`| DEC:first-id | DEC:second-id`'),
        true,
    );
});
