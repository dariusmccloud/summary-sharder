export const ARCHITECTURAL_SOURCE_REF_PATTERN = /^S\d+:\d+$/;
const ARCHITECTURAL_WRAPPED_SOURCE_REF_PATTERN = /^(?:\[(S\d+:\d+)\]|\((S\d+:\d+)\))$/;

export const ARCHITECTURAL_DECISION_FIELDS = Object.freeze([
    'ID',
    'TYPE',
    'DECISION',
    'WHY',
    'SCOPE',
    'STATUS',
    'EVIDENCE',
    'PROBLEM',
    'RULED-OUT',
    'CHANGED',
    'ANCHOR',
    'SUPERSEDES',
    'SUPERSEDED-BY',
]);

export const ARCHITECTURAL_THREAD_FIELDS = Object.freeze([
    'status',
    'intro',
    'last',
]);

export const ARCHITECTURAL_WEIGHT_BY_EMOJI = Object.freeze({
    '🔴': 5,
    '🟠': 4,
    '🟡': 3,
    '🟢': 2,
    '⚪': 1,
});

function createBaseResult(raw) {
    return {
        ok: true,
        raw: String(raw || ''),
        sourceRef: null,
        sourceRefRaw: null,
        weight: null,
        weightRaw: null,
        fields: {},
        fieldOrder: [],
        rawFields: [],
        unknownFields: [],
        duplicateFields: [],
        malformedSegments: [],
        errors: [],
        warnings: [],
    };
}

function pushError(result, code, message, extra = {}) {
    result.ok = false;
    result.errors.push({ code, message, ...extra });
}

function pushWarning(result, code, message, extra = {}) {
    result.warnings.push({ code, message, ...extra });
}

function unescapeArchitecturalFieldValue(value) {
    let out = '';
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '\\' && next !== undefined) {
            if (next === '\\' || next === '|' || next === '"' || next === ':') {
                out += next;
                i++;
                continue;
            }
        }

        out += ch;
    }
    return out;
}

export function escapeArchitecturalFieldValue(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|');
}

function findTopLevelIndex(text, target) {
    let inQuote = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === '\\') {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inQuote = !inQuote;
            continue;
        }
        if (!inQuote && ch === target) {
            return i;
        }
    }

    return -1;
}

function findClosingQuote(text, startIndex = 0) {
    let escapeNext = false;

    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === '\\') {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            return i;
        }
    }

    return -1;
}

function parseFieldSegments(text) {
    const segments = [];
    const errors = [];
    let current = '';
    let inQuote = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escapeNext) {
            current += ch;
            escapeNext = false;
            continue;
        }

        if (ch === '\\') {
            current += ch;
            escapeNext = true;
            continue;
        }

        if (ch === '"') {
            current += ch;
            inQuote = !inQuote;
            continue;
        }

        if (!inQuote && ch === '|') {
            segments.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }

    segments.push(current.trim());

    if (inQuote) {
        errors.push({
            code: 'UNMATCHED_QUOTE',
            message: 'Unmatched quotation mark in pipe-delimited record.',
        });
    }

    return { segments, errors };
}

export function splitArchitecturalPipeFields(text) {
    const raw = String(text || '').trim();
    const result = {
        raw,
        segments: [],
        fieldOrder: [],
        rawFields: [],
        fields: {},
        duplicateFields: [],
        malformedSegments: [],
        errors: [],
        warnings: [],
    };

    const parsed = parseFieldSegments(raw);
    result.segments = parsed.segments;
    result.errors.push(...parsed.errors);

    for (const segment of parsed.segments) {
        if (!segment) {
            continue;
        }

        const colonIndex = findTopLevelIndex(segment, ':');
        if (colonIndex < 0) {
            result.malformedSegments.push(segment);
            continue;
        }

        const fieldName = segment.slice(0, colonIndex).trim();
        const rawValue = segment.slice(colonIndex + 1).trim();
        const normalizedFieldName = fieldName.toUpperCase();

        if (!fieldName) {
            result.malformedSegments.push(segment);
            continue;
        }

        result.fieldOrder.push(normalizedFieldName);
        result.rawFields.push({
            field: normalizedFieldName,
            rawField: fieldName,
            value: rawValue,
            raw: segment,
        });

        if (fieldName !== normalizedFieldName) {
            result.warnings.push({
                code: 'NONCANONICAL_FIELD_CASE',
                message: `Field name "${fieldName}" was normalized to "${normalizedFieldName}".`,
                field: normalizedFieldName,
                rawField: fieldName,
            });
        }

        if (Object.prototype.hasOwnProperty.call(result.fields, normalizedFieldName)) {
            result.duplicateFields.push(normalizedFieldName);
        }

        if (Object.prototype.hasOwnProperty.call(result.fields, normalizedFieldName)) {
            const prior = result.fields[normalizedFieldName];
            if (Array.isArray(prior)) {
                prior.push(unescapeArchitecturalFieldValue(rawValue));
            } else {
                result.fields[normalizedFieldName] = [prior, unescapeArchitecturalFieldValue(rawValue)];
            }
        } else {
            result.fields[normalizedFieldName] = unescapeArchitecturalFieldValue(rawValue);
        }
    }

    if (result.malformedSegments.length > 0) {
        result.errors.push({
            code: 'MALFORMED_SEGMENT',
            message: 'One or more pipe-delimited segments were missing a field name.',
            segments: [...result.malformedSegments],
        });
    }

    if (result.duplicateFields.length > 0) {
        result.errors.push({
            code: 'DUPLICATE_FIELD',
            message: 'Duplicate field names were detected in the record.',
            fields: [...new Set(result.duplicateFields)],
        });
    }

    return result;
}

export function parseArchitecturalSourceReference(text) {
    const raw = String(text || '').trim();
    const match = raw.match(ARCHITECTURAL_WRAPPED_SOURCE_REF_PATTERN);
    if (!match) {
        return {
            ok: false,
            raw,
            normalized: null,
            error: {
                code: 'INVALID_SOURCE_REF',
                message: 'Malformed source reference.',
            },
        };
    }

    return {
        ok: true,
        raw,
        normalized: match[1] || match[2],
        error: null,
    };
}

function extractLeadingSourceReference(text, result) {
    const match = String(text || '').trim().match(/^((?:\[(?:S\d+:\d+)\]|\((?:S\d+:\d+)\)))\s*(.*)$/s);
    if (!match) {
        pushError(result, 'MISSING_SOURCE_REF', 'Missing required leading source reference.');
        return { rest: String(text || '').trim() };
    }

    const parsedRef = parseArchitecturalSourceReference(match[1]);
    result.sourceRefRaw = parsedRef.raw;
    result.sourceRef = parsedRef.normalized;

    if (!parsedRef.ok) {
        pushError(result, parsedRef.error.code, parsedRef.error.message);
    }

    return { rest: match[2].trim() };
}

function extractLeadingWeight(text, result) {
    const match = String(text || '').match(/^(🔴|🟠|🟡|🟢|⚪)\s*(.*)$/s);
    if (!match) {
        return { rest: String(text || '').trim() };
    }

    result.weightRaw = match[1];
    result.weight = ARCHITECTURAL_WEIGHT_BY_EMOJI[match[1]] ?? null;
    return { rest: match[2].trim() };
}

function firstFieldValue(rawValue) {
    return Array.isArray(rawValue) ? rawValue[0] : rawValue;
}

function normalizeDecisionFields(splitResult, result) {
    for (const entry of splitResult.rawFields) {
        result.rawFields.push({
            field: entry.field,
            rawField: entry.rawField,
            value: entry.value,
            raw: entry.raw,
        });
        result.fieldOrder.push(entry.field);
    }

    result.duplicateFields = [...splitResult.duplicateFields];
    result.malformedSegments = [...splitResult.malformedSegments];
    splitResult.errors.forEach((error) => pushError(result, error.code, error.message, { segments: error.segments, fields: error.fields }));
    splitResult.warnings.forEach((warning) => pushWarning(result, warning.code, warning.message, { field: warning.field, rawField: warning.rawField }));

    Object.entries(splitResult.fields).forEach(([fieldName, value]) => {
        result.fields[fieldName] = Array.isArray(value)
            ? value.map((entry) => String(entry))
            : String(value);
        if (!ARCHITECTURAL_DECISION_FIELDS.includes(fieldName)) {
            result.unknownFields.push(fieldName);
        }
    });
}

export function parseArchitecturalDecisionRecord(text) {
    const result = createBaseResult(text);
    const afterRef = extractLeadingSourceReference(text, result);
    const afterWeight = extractLeadingWeight(afterRef.rest, result);
    const splitResult = splitArchitecturalPipeFields(afterWeight.rest);

    normalizeDecisionFields(splitResult, result);

    result.decisionId = typeof result.fields.ID === 'string' ? result.fields.ID : firstFieldValue(result.fields.ID);
    result.status = typeof result.fields.STATUS === 'string' ? result.fields.STATUS : firstFieldValue(result.fields.STATUS);
    result.typeValues = typeof result.fields.TYPE === 'string'
        ? result.fields.TYPE.split(',').map((entry) => entry.trim()).filter(Boolean)
        : [];

    return result;
}

export function parseArchitecturalEventRecord(text) {
    const result = createBaseResult(text);
    const afterRef = extractLeadingSourceReference(text, result);
    const afterWeight = extractLeadingWeight(afterRef.rest, result);
    const splitResult = splitArchitecturalPipeFields(afterWeight.rest);

    const segments = [...splitResult.segments];
    result.description = segments.shift() || '';
    result.rawFields = [];
    result.fieldOrder = [];
    result.duplicateFields = [];
    result.malformedSegments = [];
    result.decisionRefs = [];
    result.normalizedDecList = false;

    const valuesByField = {};
    for (const segment of segments) {
        if (!segment) continue;
        const colonIndex = findTopLevelIndex(segment, ':');
        if (colonIndex < 0) {
            result.malformedSegments.push(segment);
            continue;
        }

        const fieldName = segment.slice(0, colonIndex).trim().toUpperCase();
        const rawValue = segment.slice(colonIndex + 1).trim();
        const value = unescapeArchitecturalFieldValue(rawValue);
        result.fieldOrder.push(fieldName);
        result.rawFields.push({ field: fieldName, value: rawValue, raw: segment });

        if (!Object.prototype.hasOwnProperty.call(valuesByField, fieldName)) {
            valuesByField[fieldName] = [];
        }
        valuesByField[fieldName].push(value);
    }

    if (result.malformedSegments.length > 0) {
        pushError(result, 'MALFORMED_SEGMENT', 'One or more pipe-delimited segments were missing a field name.', {
            segments: [...result.malformedSegments],
        });
    }

    Object.entries(valuesByField).forEach(([fieldName, values]) => {
        if (fieldName === 'DEC') {
            const normalizedRefs = [];
            let normalizedList = false;

            for (const entry of values) {
                const parts = String(entry)
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean);

                if (parts.length <= 1) {
                    normalizedRefs.push(String(entry));
                    continue;
                }

                const safeParts = parts.map((part, index) => {
                    const match = part.match(/^(?:DEC:)?([a-z0-9]+(?:-[a-z0-9]+)*)$/);
                    if (!match) {
                        return null;
                    }
                    if (index > 0 && !part.startsWith('DEC:')) {
                        return null;
                    }
                    return match[1];
                });

                if (safeParts.every(Boolean)) {
                    normalizedRefs.push(...safeParts);
                    normalizedList = true;
                    continue;
                }

                normalizedRefs.push(String(entry));
            }

            result.fields.DEC = normalizedRefs;
            result.decisionRefs = normalizedRefs.map((entry) => String(entry));
            result.normalizedDecList = normalizedList;
            if (normalizedList) {
                pushWarning(
                    result,
                    'DEC_LIST_NORMALIZED',
                    'Comma-delimited DEC reference list was normalized to repeated DEC fields.',
                    { field: 'DEC' },
                );
            }
            return;
        }

        if (values.length > 1) {
            result.duplicateFields.push(fieldName);
        }
        result.fields[fieldName] = values.length > 1 ? values : values[0];
        result.unknownFields.push(fieldName);
    });

    if (result.duplicateFields.length > 0) {
        pushError(result, 'DUPLICATE_FIELD', 'Duplicate field names were detected in the record.', {
            fields: [...new Set(result.duplicateFields)],
        });
    }

    return result;
}

export function parseArchitecturalDialogueRecord(text) {
    const result = createBaseResult(text);
    const afterRef = extractLeadingSourceReference(text, result);
    const rest = afterRef.rest;
    const lineCount = String(rest || '').split(/\r?\n/).length;
    result.lineCount = lineCount;

    const firstQuote = rest.indexOf('"');
    if (firstQuote < 0) {
        pushError(result, 'MISSING_QUOTE', 'Dialogue entry requires a quoted exact line.');
        result.remainder = rest;
        return result;
    }

    const quoteClose = findClosingQuote(rest, firstQuote + 1);
    if (quoteClose < 0) {
        pushError(result, 'UNMATCHED_QUOTE', 'Dialogue entry has an unmatched quotation mark.');
        result.remainder = rest;
        return result;
    }

    const absoluteClose = quoteClose;
    const quoteText = rest.slice(firstQuote + 1, absoluteClose);
    result.quote = quoteText;

    if (!quoteText.trim()) {
        pushError(result, 'EMPTY_QUOTE', 'Dialogue quote cannot be empty.');
    }

    const afterQuote = rest.slice(absoluteClose + 1).trim();
    const speakerIndex = afterQuote.indexOf('--');
    if (speakerIndex < 0) {
        pushError(result, 'MISSING_SPEAKER', 'Dialogue entry requires a speaker after --.');
        result.remainder = afterQuote;
        return result;
    }

    const speakerAndContext = afterQuote.slice(speakerIndex + 2).trim();
    const pipeIndex = findTopLevelIndex(speakerAndContext, '|');
    if (pipeIndex < 0) {
        result.speaker = speakerAndContext.trim();
        result.context = '';
        if (!result.speaker) {
            pushError(result, 'EMPTY_SPEAKER', 'Dialogue speaker cannot be empty.');
        }
        return result;
    }

    result.speaker = speakerAndContext.slice(0, pipeIndex).trim();
    result.context = speakerAndContext.slice(pipeIndex + 1).trim();
    if (!result.speaker) {
        pushError(result, 'EMPTY_SPEAKER', 'Dialogue speaker cannot be empty.');
    }
    if (!result.context) {
        pushError(result, 'MISSING_CONTEXT', 'Dialogue entry requires structural context after |.');
    }

    return result;
}

export function parseArchitecturalThreadRecord(text) {
    const result = createBaseResult(text);
    const afterRef = extractLeadingSourceReference(text, result);
    const splitResult = splitArchitecturalPipeFields(afterRef.rest);
    const segments = [...splitResult.segments];

    result.subject = segments.shift() || '';
    result.notes = '';
    result.namedFields = {};
    result.fieldOrder = [];
    result.rawFields = [];
    result.duplicateFields = [];
    result.malformedSegments = [];

    if (!result.subject.trim()) {
        pushError(result, 'MISSING_THREAD_SUBJECT', 'Thread entry requires a non-empty subject before the first |.');
    }

    let notesCaptured = false;
    for (const segment of segments) {
        if (!segment) continue;
        const colonIndex = findTopLevelIndex(segment, ':');
        const fieldName = colonIndex > 0 ? segment.slice(0, colonIndex).trim() : '';
        if (colonIndex > 0 && ARCHITECTURAL_THREAD_FIELDS.includes(fieldName)) {
            const rawValue = segment.slice(colonIndex + 1).trim();
            result.fieldOrder.push(fieldName);
            result.rawFields.push({ field: fieldName, value: rawValue, raw: segment });

            if (Object.prototype.hasOwnProperty.call(result.namedFields, fieldName)) {
                result.duplicateFields.push(fieldName);
            }

            result.namedFields[fieldName] = unescapeArchitecturalFieldValue(rawValue);
            continue;
        }

        if (colonIndex > 0
            && !ARCHITECTURAL_THREAD_FIELDS.includes(fieldName)
            && /^[a-z][a-z-]*$/i.test(fieldName)
            && !notesCaptured) {
            result.unknownFields.push(fieldName);
        }

        if (!notesCaptured) {
            result.notes = unescapeArchitecturalFieldValue(segment);
            notesCaptured = true;
            continue;
        }

        result.malformedSegments.push(segment);
    }

    if (result.duplicateFields.length > 0) {
        pushError(result, 'DUPLICATE_FIELD', 'Duplicate thread fields were detected.', {
            fields: [...new Set(result.duplicateFields)],
        });
    }

    if (result.malformedSegments.length > 0) {
        pushError(result, 'MALFORMED_SEGMENT', 'Malformed thread segments were detected.', {
            segments: [...result.malformedSegments],
        });
    }

    result.fields = { ...result.namedFields };
    result.status = result.namedFields.status ?? null;
    result.intro = result.namedFields.intro ?? null;
    result.last = result.namedFields.last ?? null;

    return result;
}
