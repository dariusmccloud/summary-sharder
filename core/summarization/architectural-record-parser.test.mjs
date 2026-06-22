import assert from 'node:assert/strict';
import test from 'node:test';

import {
    escapeArchitecturalFieldValue,
    parseArchitecturalDecisionRecord,
    parseArchitecturalDialogueRecord,
    parseArchitecturalEventRecord,
    parseArchitecturalSourceReference,
    parseArchitecturalThreadRecord,
    splitArchitecturalPipeFields,
} from './architectural-record-parser.js';

test('shared field parser handles quoted and escaped pipes with preserved order', () => {
    const parsed = splitArchitecturalPipeFields('A:one|B:"two | three"|C:four \\| five|D:six:seven');

    assert.deepEqual(parsed.segments, [
        'A:one',
        'B:"two | three"',
        'C:four \\| five',
        'D:six:seven',
    ]);
    assert.deepEqual(parsed.fieldOrder, ['A', 'B', 'C', 'D']);
    assert.equal(parsed.fields.A, 'one');
    assert.equal(parsed.fields.B, '"two | three"');
    assert.equal(parsed.fields.C, 'four | five');
    assert.equal(parsed.fields.D, 'six:seven');
});

test('shared field parser reports unmatched quote, malformed segment, and duplicate field', () => {
    const parsed = splitArchitecturalPipeFields('A:one|bad segment|A:two|"broken');

    assert.equal(parsed.errors.some((entry) => entry.code === 'UNMATCHED_QUOTE'), true);
    assert.equal(parsed.errors.some((entry) => entry.code === 'MALFORMED_SEGMENT'), true);
    assert.equal(parsed.errors.some((entry) => entry.code === 'DUPLICATE_FIELD'), true);
});

test('field escaping round-trips deterministic literal pipes', () => {
    const original = 'input | output \\ review';
    const escaped = escapeArchitecturalFieldValue(original);
    const parsed = splitArchitecturalPipeFields(`WHY:${escaped}`);

    assert.equal(escaped, 'input \\| output \\\\ review');
    assert.equal(parsed.fields.WHY, original);
});

test('source reference parser accepts bracket and paren forms and rejects malformed refs', () => {
    assert.deepEqual(parseArchitecturalSourceReference('(S0:1)'), {
        ok: true,
        raw: '(S0:1)',
        normalized: 'S0:1',
        error: null,
    });
    assert.equal(parseArchitecturalSourceReference('[S10:2]').normalized, 'S10:2');
    assert.equal(parseArchitecturalSourceReference('S10:2').ok, false);
});

test('decision parser preserves raw data and parses structured fields', () => {
    const record = parseArchitecturalDecisionRecord(
        '[S10:2] 🔴 ID:pipe-escape-proof | TYPE:IMPLEMENTATION,PROCEDURE | DECISION:Escaped pipes remain literal field content during parsing | WHY:input \\| output must survive parsing without data loss | SCOPE:Architectural parser | STATUS:SEALED | EVIDENCE:"Quoted A | B remains one field"'
    );

    assert.equal(record.sourceRef, 'S10:2');
    assert.equal(record.weight, 5);
    assert.equal(record.decisionId, 'pipe-escape-proof');
    assert.deepEqual(record.typeValues, ['IMPLEMENTATION', 'PROCEDURE']);
    assert.equal(record.fields.WHY, 'input | output must survive parsing without data loss');
    assert.equal(record.fields.EVIDENCE, '"Quoted A | B remains one field"');
});

test('decision parser reports duplicate fields and preserves unknown field names', () => {
    const record = parseArchitecturalDecisionRecord(
        '[S10:2] 🔴 ID:test | TYPE:GOVERNANCE | TYPE:PROCEDURE | DECISION:X | WHY:unstated | SCOPE:Y | STATUS:ACCEPTED | EVIDENCE:"z" | EXTRA:nope'
    );

    assert.equal(record.duplicateFields.includes('TYPE'), true);
    assert.equal(record.unknownFields.includes('EXTRA'), true);
});

test('event parser captures description and multiple DEC references', () => {
    const record = parseArchitecturalEventRecord(
        '[S5:3] 🟠 decision superseded by replacement record | DEC:decision-sealed | DEC:decision-sealed-replacement'
    );

    assert.equal(record.sourceRef, 'S5:3');
    assert.equal(record.weight, 4);
    assert.equal(record.description, 'decision superseded by replacement record');
    assert.deepEqual(record.decisionRefs, ['decision-sealed', 'decision-sealed-replacement']);
});

test('dialogue parser enforces quote, speaker, context, and line count structure', () => {
    const valid = parseArchitecturalDialogueRecord('[S1:1] "Exact quote" --Speaker | structural context');
    const invalid = parseArchitecturalDialogueRecord('[S1:1] "Exact quote"\nline2\nline3');

    assert.equal(valid.quote, 'Exact quote');
    assert.equal(valid.speaker, 'Speaker');
    assert.equal(valid.context, 'structural context');
    assert.equal(invalid.errors.some((entry) => entry.code === 'MISSING_SPEAKER'), true);
    assert.equal(invalid.lineCount, 3);
});

test('thread parser extracts canonical named fields and notes', () => {
    const record = parseArchitecturalThreadRecord(
        '[S2:1] parser-hardening | status:ACTIVE | intro:S2:1 | last:S2:2 | Notes include quoted "A | B" and escaped literal \\| content'
    );

    assert.equal(record.sourceRef, 'S2:1');
    assert.equal(record.subject, 'parser-hardening');
    assert.equal(record.status, 'ACTIVE');
    assert.equal(record.intro, 'S2:1');
    assert.equal(record.last, 'S2:2');
    assert.equal(record.notes, 'Notes include quoted "A | B" and escaped literal | content');
});
