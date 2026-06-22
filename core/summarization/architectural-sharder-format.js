import {
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
} from './sharder-section-registry.js';

const ARCHITECTURAL_TERMINATOR = '===END===';

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

function normalizeArchitecturalResponse(response) {
    if (!response) return '';
    return String(response)
        .replace(/\r\n/g, '\n')
        .replace(/\n*===END===\s*$/gi, '')
        .trim();
}

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
    const regex = /[\[(]S(\d+):(\d+)[\])]/g;
    const codes = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        codes.push({
            code: `[S${match[1]}:${match[2]}]`,
            startMsg: parseInt(match[1], 10),
            sceneNum: parseInt(match[2], 10),
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
    const items = [];
    const lines = String(content || '').split('\n');
    let currentItem = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '--' || trimmed.startsWith('---')) continue;

        const isBullet = /^[-•*–—]\s/.test(trimmed);
        const isNumbered = /^\d+\.\s/.test(trimmed);
        const isSceneCodeStart = /^[\[(]S\d+:\d+[\])]/.test(trimmed);
        const isPipeDelimited = /\|/.test(trimmed);
        const isNewItem = isBullet || isNumbered || isSceneCodeStart || isPipeDelimited;

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
        terminatorCount: (String(response || '').match(/===END===/g) || []).length,
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
    const rawKeyLines = Array.isArray(sections?._metadata?.keyLines)
        ? sections._metadata.keyLines
        : [];
    const extraKeyLines = rawKeyLines.filter((line) => {
        return !/^Profile\s*:/i.test(line) && !/^Schema\s*:/i.test(line);
    });

    lines.push('[KEY]');
    lines.push(`Profile: ${ARCHITECTURAL_PROFILE_MARKER}`);
    lines.push(`Schema: ${ARCHITECTURAL_SCHEMA_MARKER}`);
    extraKeyLines.forEach((line) => lines.push(line));
    lines.push('');

    registry.contentSections.forEach((section) => {
        lines.push(`[${section.name}]`);
        const items = Array.isArray(sections?.[section.key]) ? sections[section.key] : [];
        items
            .filter((item) => item?.selected !== false)
            .forEach((item) => lines.push(String(item?.content || '').trim()));
        lines.push('');
    });

    lines.push(registry.terminator || ARCHITECTURAL_TERMINATOR);
    return lines.join('\n').trim();
}
