import assert from 'node:assert/strict';
import test from 'node:test';

import { getFabActionVisibility, renderFabActionButton } from './fab-action-state.js';

function escapeForInnerHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

global.document = {
    createElement() {
        let textValue = '';
        return {
            set textContent(value) {
                textValue = value;
            },
            get innerHTML() {
                return escapeForInnerHtml(textValue);
            },
        };
    },
};

test('FAB action visibility exposes stop during generation in sharder mode', () => {
    const actions = getFabActionVisibility(true, false, true);

    assert.equal(actions.singlePass, true);
    assert.equal(actions.stop, true);
    assert.equal(actions.summarize, false);
});

test('FAB run button markup renders disabled state', () => {
    const markup = renderFabActionButton('single-pass', 'fa-bolt', 'Run Sharder', '', true);

    assert.match(markup, /data-action="single-pass"[^>]*disabled aria-disabled="true"/);
});

test('FAB batch button markup remains enabled when not explicitly disabled', () => {
    const markup = renderFabActionButton('batch-sharder', 'fa-layer-group', 'Batch Sharder');

    assert.doesNotMatch(markup, /disabled aria-disabled="true"/);
});
