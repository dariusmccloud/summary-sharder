import {
    ARCHITECTURAL_TERMINATOR,
    buildArchitecturalKeyLines,
    countStandaloneArchitecturalTerminators,
    normalizeArchitecturalResponse,
} from './architectural-sharder-shell.js';
import {
    escapeArchitecturalFieldValue,
    parseArchitecturalDecisionRecord,
    parseArchitecturalEventRecord,
    parseArchitecturalThreadRecord,
} from './architectural-record-parser.js';

const WEIGHT_BY_EMOJI = new Map([
    ['🔴', 5],
    ['🟠', 4],
    ['🟡', 3],
    ['🟢', 2],
    ['⚪', 1],
]);

const WEIGHT_BY_NAME = new Map([
    ['critical', 5],
    ['major', 4],
    ['moderate', 3],
    ['minor', 2],
    ['trivial', 1],
]);

function isEmptyContent(content) {
    const lower = String(content || '').toLowerCase().trim();
    return lower === 'none' ||
           lower === '(none)' ||
           lower === '-' ||
           lower === '--' ||
           lower.startsWith('none present') ||
           lower.startsWith('none new') ||
           lower === 'n/a';
}

function isEmptyItem(content) {
    const trimmed = String(content || '').trim();
    const lower = trimmed.toLowerCase();

    return !trimmed ||
           trimmed === '---' ||
           trimmed === '--' ||
           trimmed === '-' ||
           trimmed === '—' ||
           trimmed === '–' ||
           lower === 'none' ||
           lower === '(none)' ||
           lower === 'none.' ||
           lower === 'n/a' ||
           lower === 'na' ||
           lower.startsWith('none present') ||
           lower.startsWith('none new') ||
           (lower.startsWith('no ') && lower.length < 25);
}

function parseSceneCodes(text) {
    if (!text) return [];
    const regex = /(?:\[(S(\d+):(\d+))\]|\((S(\d+):(\d+))\))/g;
    const codes = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const normalized = match[1] || match[4];
        const startMsg = match[2] || match[5];
        const sceneNum = match[3] || match[6];
        codes.push({
            code: `[${normalized}]`,
            startMsg: parseInt(startMsg, 10),
            sceneNum: parseInt(sceneNum, 10),
        });
    }
    return codes;
}

function parseWeightFromLine(line) {
    for (const [emoji, value] of WEIGHT_BY_EMOJI) {
        if (line.includes(emoji)) return value;
    }
    const weightMatch = line.match(/\b(critical|major|moderate|minor|trivial)\b/i);
    if (weightMatch) return WEIGHT_BY_NAME.get(weightMatch[1].toLowerCase()) ?? 3;
    return 3;
}

function parseArchitecturalSectionItems(content, sectionKey) {
    if (sectionKey === 'current') {
        const currentContent = String(content || '').trim();
        if (!currentContent || isEmptyItem(currentContent)) {
            return [];
        }
        return [{
            id: `${sectionKey}-0`,
            content: currentContent,
            weight: 3,
            selected: true,
            edited: false,
            sceneCodes: parseSceneCodes(currentContent),
        }];
    }

    const items = [];
    const lines = String(content || '').split('\n');
    let currentItem = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '--' || trimmed.startsWith('---')) continue;

        const isBullet = /^[-•*–—]\s/.test(trimmed);
        const isNumbered = /^\d+\.\s/.test(trimmed);
        const isSceneCodeStart = /^(?:\[(?:S\d+:\d+)\]|\((?:S\d+:\d+)\))/.test(trimmed);
        const isNewItem = isBullet || isNumbered || isSceneCodeStart;

        if (isNewItem) {
            if (currentItem && !isEmptyItem(currentItem.content)) {
                items.push(currentItem);
            }

            let itemContent = trimmed;
            if (isBullet) {
                itemContent = trimmed.replace(/^[-•*–—]+\s*/, '');
            } else if (isNumbered) {
                itemContent = trimmed.replace(/^\d+\.\s*/, '');
            }

            currentItem = {
                id: `${sectionKey}-${items.length}`,
                content: itemContent,
                weight: sectionKey === 'events' ? parseWeightFromLine(trimmed) : 3,
                selected: true,
                edited: false,
                sceneCodes: parseSceneCodes(trimmed),
            };
        } else if (currentItem) {
            currentItem.content += '\n' + trimmed;
            currentItem.sceneCodes = parseSceneCodes(currentItem.content);
        } else {
            currentItem = {
                id: `${sectionKey}-${items.length}`,
                content: trimmed,
                weight: 3,
                selected: true,
                edited: false,
                sceneCodes: parseSceneCodes(trimmed),
            };
        }
    }

    if (currentItem && !isEmptyItem(currentItem.content)) {
        items.push(currentItem);
    }
    return items;
}

export function parseArchitecturalExtractionResponse(response, registry) {
    const sections = {};
    const metadata = {
        keyLines: [],
        keyPresent: false,
        terminatorCount: countStandaloneArchitecturalTerminators(response),
        unknownSectionHeaders: [],
    };
    const contentSections = registry.contentSections;
    const allowedNames = new Set([
        ...registry.metadataSections.map((section) => section.name),
        ...contentSections.map((section) => section.name),
    ]);
    const sectionByName = new Map(contentSections.map((section) => [section.name, section]));

    contentSections.forEach((section) => {
        sections[section.key] = [];
    });

    const normalized = normalizeArchitecturalResponse(response);
    const headerRegex = /^\[([A-Z][A-Z0-9 _-]*)\]\s*$/gm;
    const headers = [];
    let match;
    while ((match = headerRegex.exec(normalized)) !== null) {
        const name = match[1].trim().toUpperCase();
        headers.push({ name, index: match.index, end: headerRegex.lastIndex });
        if (!allowedNames.has(name)) {
            metadata.unknownSectionHeaders.push(name);
        }
    }

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const next = headers[i + 1];
        const content = normalized.slice(header.end, next ? next.index : normalized.length).trim();
        if (header.name === 'KEY') {
            metadata.keyPresent = true;
            metadata.keyLines = content.split('\n').map((line) => line.trim()).filter(Boolean);
            continue;
        }
        const section = sectionByName.get(header.name);
        if (!section || !content || isEmptyContent(content)) continue;
        sections[section.key] = parseArchitecturalSectionItems(content, section.key);
    }

    sections._metadata = {
        ...(sections._metadata || {}),
        keyLines: metadata.keyLines,
        architectural: {
            keyPresent: metadata.keyPresent,
            terminatorCount: metadata.terminatorCount,
            unknownSectionHeaders: [...new Set(metadata.unknownSectionHeaders)],
        },
    };

    return sections;
}

export function reconstructArchitecturalExtraction(sections, registry) {
    const lines = [];
    const keyLines = buildArchitecturalKeyLines(sections?._metadata?.keyLines);

    lines.push('[KEY]');
    keyLines.forEach((line) => lines.push(line));
    lines.push('');

    registry.contentSections.forEach((section) => {
        lines.push(`[${section.name}]`);
        const items = Array.isArray(sections?.[section.key]) ? sections[section.key] : [];
        items
            .filter((item) => item?.selected !== false)
            .forEach((item) => lines.push(reconstructArchitecturalItemContent(section.key, item)));
        lines.push('');
    });

    lines.push(registry.terminator || ARCHITECTURAL_TERMINATOR);
    return lines.join('\n').trim();
}

function reconstructArchitecturalItemContent(sectionKey, item) {
    const raw = String(item?.content || '').trim();
    if (!raw) {
        return raw;
    }

    if (sectionKey === 'decisions') {
        return reconstructArchitecturalDecisionContent(raw);
    }
    if (sectionKey === 'events') {
        return reconstructArchitecturalEventContent(raw);
    }
    if (sectionKey === 'threads') {
        return reconstructArchitecturalThreadContent(raw);
    }
    if (sectionKey === 'developments') {
        return reconstructArchitecturalDevelopmentContent(raw);
    }
    if (sectionKey === 'current') {
        return reconstructArchitecturalCurrentContent(raw);
    }

    return raw;
}

function splitPipeCells(text) {
    const cells = [];
    let current = '';
    let inQuote = false;
    let escapeNext = false;

    for (const ch of String(text || '')) {
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
            cells.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }

    cells.push(current.trim());
    return cells;
}

function normalizePipeCell(cell) {
    const trimmed = String(cell ?? '').trim();
    if (!trimmed) return trimmed;

    return trimmed.replace(/^([^:|()[\]{}]{1,40}):(?=\S)/, '$1: ');
}

function formatPipeRow(parts) {
    return parts
        .map((part) => String(part ?? '').trim())
        .filter(Boolean)
        .join(' | ');
}

function canonicalizeStructuredFieldValue(fieldName, value) {
    const normalizedValue = String(value ?? '').trim();

    if (fieldName === 'TYPE') {
        return normalizedValue
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .join(', ');
    }

    return normalizedValue;
}

function formatStructuredField(fieldName, value) {
    return `${fieldName}: ${canonicalizeStructuredFieldValue(fieldName, value)}`;
}

function formatThreadField(fieldName, value) {
    return `${fieldName}: ${String(value ?? '').trim()}`;
}

function reconstructArchitecturalDecisionContent(raw) {
    const record = parseArchitecturalDecisionRecord(raw);
    if (!record.sourceRefRaw) {
        return raw;
    }

    const head = [record.sourceRefRaw];
    if (record.weightRaw) {
        head.push(record.weightRaw);
    }

    const fields = record.rawFields.map((field) =>
        formatStructuredField(field.field, field.value)
    );

    return fields.length > 0 ? `${head.join(' ')} ${fields.join(' | ')}` : head.join(' ');
}

function reconstructArchitecturalEventContent(raw) {
    const record = parseArchitecturalEventRecord(raw);
    if (!record.sourceRefRaw || !String(record.description || '').trim()) {
        return raw;
    }

    const head = [record.sourceRefRaw];
    if (record.weightRaw) {
        head.push(record.weightRaw);
    }
    head.push(String(record.description).trim());

    const fields = [];
    for (const field of record.rawFields) {
        if (field.field === 'DEC') continue;
        fields.push(formatStructuredField(field.field, field.value));
    }
    for (const ref of Array.isArray(record.decisionRefs) ? record.decisionRefs : []) {
        fields.push(formatStructuredField('DEC', ref));
    }

    return fields.length > 0 ? formatPipeRow([head.join(' '), ...fields]) : head.join(' ');
}

function reconstructArchitecturalThreadContent(raw) {
    const record = parseArchitecturalThreadRecord(raw);
    if (!record.sourceRefRaw || !String(record.subject || '').trim()) {
        return raw;
    }

    const parts = [`${record.sourceRefRaw} ${String(record.subject).trim()}`];

    for (const fieldName of record.fieldOrder) {
        const value = record.namedFields?.[fieldName];
        if (value === undefined || value === null || String(value).trim() === '') continue;
        parts.push(formatThreadField(fieldName, value));
    }

    if (String(record.notes || '').trim()) {
        parts.push(escapeArchitecturalFieldValue(String(record.notes).trim()));
    }

    return formatPipeRow(parts);
}

function reconstructArchitecturalDevelopmentContent(raw) {
    const text = String(raw || '').trim();
    if (!text) {
        return text;
    }

    const sourceMatch = text.match(/^((?:\[(?:S\d+:\d+)\]|\((?:S\d+:\d+)\)))\s*(.*)$/s);
    const prefix = sourceMatch ? sourceMatch[1] : '';
    const body = sourceMatch ? sourceMatch[2].trim() : text;

    const colonIndex = body.indexOf(':');
    if (colonIndex < 0) {
        return text;
    }

    const subject = body.slice(0, colonIndex).trim();
    const remainder = body.slice(colonIndex + 1).trim();
    if (!subject || !remainder) {
        return text;
    }

    const normalizedRemainder = remainder.replace(/^([^\s(]+)\(/, '$1 (');
    const normalizedBody = `${subject}: ${normalizedRemainder}`;
    return prefix ? `${prefix} ${normalizedBody}` : normalizedBody;
}

function reconstructArchitecturalCurrentContent(raw) {
    const cells = splitPipeCells(raw).map(normalizePipeCell).filter(Boolean);
    return formatPipeRow(cells);
}
