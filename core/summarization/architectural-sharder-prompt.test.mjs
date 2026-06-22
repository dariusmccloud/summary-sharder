import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { DEFAULT_ARCHITECTURAL_SHARDER_PROMPT } from './architectural-sharder-prompt.js';

const EXPECTED_PROMPT_SHA256 = '33b14ae2361e79d9da7dfc2c88e56b02acf839320caf14850def3a9f9cc2e4fc';
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
