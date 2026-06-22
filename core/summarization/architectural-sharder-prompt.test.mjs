import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { DEFAULT_ARCHITECTURAL_SHARDER_PROMPT } from './architectural-sharder-prompt.js';

const EXPECTED_PROMPT_SHA256 = '6e11115890da82ff21c384b550bf8078af6058cfa60b0df42fe4db0f2287d566';

test('sealed architectural prompt digest remains unchanged', () => {
    const digest = crypto.createHash('sha256')
        .update(DEFAULT_ARCHITECTURAL_SHARDER_PROMPT, 'utf8')
        .digest('hex');

    assert.equal(digest, EXPECTED_PROMPT_SHA256);
});
