/**
 * Sharder core module - Shared parsing and shard discovery helpers
 */

import { loadWorldInfo } from '../../../../../world-info.js';
import { log } from '../logger.js';
import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
    getSharderContentSections,
    getSharderSectionRegistry,
} from './sharder-section-registry.js';
import {
    parseArchitecturalExtractionResponse,
    reconstructArchitecturalExtraction,
} from './architectural-sharder-format.js';
import {
    SAVED_SHARD_CLASSIFICATIONS,
    classifySavedShardText,
} from './saved-shard-identity.js';
import { getArchitecturalProjectionMetadataForSavedItem } from './architectural-authority-runtime.js';
export {
    ARCHITECTURAL_DISPLAY_NAME,
    ARCHITECTURAL_PROFILE,
    ARCHITECTURAL_PROFILE_MARKER,
    ARCHITECTURAL_SCHEMA_MARKER,
    ARCHITECTURAL_SCHEMA_VERSION,
    ARCHITECTURAL_SHARDER_REGISTRY,
    FREEFORM_SECTIONS,
    NARRATIVE_DISPLAY_NAME,
    NARRATIVE_PROFILE,
    NARRATIVE_SHARDER_REGISTRY,
    SHARDER_METADATA_SECTIONS,
    SHARDER_SECTIONS,
    getSharderContentSections,
    getSharderFreeformSectionKeys,
    getSharderMetadataSections,
    getSharderSectionRegistry,
    normalizeSharderProfile,
} from './sharder-section-registry.js';

/**
 * Event weight definitions for the weight selector UI
 */
export const EVENT_WEIGHTS = [
    { emoji: '🔴', name: 'critical', value: 5 },
    { emoji: '🟠', name: 'major', value: 4 },
    { emoji: '🟡', name: 'moderate', value: 3 },
    { emoji: '🟢', name: 'minor', value: 2 },
    { emoji: '⚪', name: 'trivial', value: 1 }
];

/**
 * O(1) weight lookups - created once for performance
 */
const WEIGHT_BY_EMOJI = new Map(EVENT_WEIGHTS.map(w => [w.emoji, w.value]));
const WEIGHT_BY_NAME = new Map(EVENT_WEIGHTS.map(w => [w.name, w.value]));
const EMOJI_BY_VALUE = new Map(EVENT_WEIGHTS.map(w => [w.value, w.emoji]));

/**
 * Normalize common AI output variations in extraction responses
 * Fixes inconsistencies without losing information
 * @param {string} response - Raw LLM response
 * @returns {string} Normalized response
 */
export function normalizeExtractionResponse(response, registryOrProfile = NARRATIVE_PROFILE) {
    if (!response) return response;

    const contentSections = getSharderContentSections(registryOrProfile);
    let normalized = response;

    // Strip ===END=== terminator if present
    normalized = normalized.replace(/\n*===END===\s*$/i, '');

    // Normalize [BRACKET] format headers: [TONE] → ### 🎨 TONE
    contentSections.forEach(section => {
        // Match [SECTION_NAME] on its own line
        const bracketPattern = new RegExp(
            `^\\[${section.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*$`, 'gim'
        );
        normalized = normalized.replace(bracketPattern, `### ${section.emoji} ${section.name}`);

        // Also match legacy alt names in bracket format: [CHARACTER NOTES] → ### 👤 CHARACTERS
        if (section.altNames) {
            section.altNames.forEach(alt => {
                const altBracket = new RegExp(
                    `^\\[${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\]\\s*$`, 'gim'
                );
                normalized = normalized.replace(altBracket, `### ${section.emoji} ${section.name}`);
            });
        }
    });

    // Normalize [KEY] metadata header (not a content section)
    normalized = normalized.replace(/^\[KEY\]\s*$/gim, '### 🔑 KEY');

    // Normalize emoji-header format variations: "## 📍 TIMELINE" or "📍 Timeline" → ### 📍 TIMELINE
    contentSections.forEach(section => {
        const headerVariants = new RegExp(
            `^(#{1,4})\\s*${section.emoji}\\s*${section.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\s*(?:\\([^)]*\\))?\\s*$`,
            'gim'
        );
        normalized = normalized.replace(headerVariants, `### ${section.emoji} ${section.name}`);

        // Also handle legacy alt names in emoji-header format
        if (section.altNames) {
            section.altNames.forEach(alt => {
                const altHeader = new RegExp(
                    `^(#{1,4})\\s*${section.emoji}\\s*${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\s*(?:\\([^)]*\\))?\\s*$`,
                    'gim'
                );
                normalized = normalized.replace(altHeader, `### ${section.emoji} ${section.name}`);
            });
        }
    });

    // Normalize bullet points: convert various formats to standard dash
    normalized = normalized.replace(/^(\s*)(?:[-–—]|•|∙|◦|▪|▸|►|→)\s*/gm, '$1- ');

    // Normalize scene code formats: [S31-1] or (S31:1) → [S31:1]
    normalized = normalized.replace(/\[S(\d+)[-.](\d+)\]/g, '[S$1:$2]');
    normalized = normalized.replace(/\(S(\d+):(\d+)\)/g, '[S$1:$2]');

    // Normalize weight emoji variations (some fonts render differently)
    normalized = normalized.replace(/🔵/g, '🔴'); // Sometimes AI uses blue for critical
    normalized = normalized.replace(/🟤/g, '🟠'); // Brown for major

    return normalized;
}

/**
 * Validate extraction completeness and return warnings
 * @param {Object} sections - Parsed extraction sections
 * @param {number} expectedScenePrefix - Expected scene code prefix
 * @returns {{valid: boolean, warnings: string[], stats: Object}}
 */
export function validateExtractionQuality(sections, context = {}) {
    const warnings = [];
    const stats = {
        totalItems: 0,
        sectionsPopulated: 0,
        criticalEvents: 0,
        majorEvents: 0,
        nsfwPreserved: 0,
        sceneCodesValid: true,
        relationshipsTracked: 0
    };

    // Count populated sections
    getSharderContentSections(context.sectionRegistry || context.profile || NARRATIVE_PROFILE).forEach(section => {
        const items = sections[section.key] || [];
        if (items.length > 0 && items.some(i => i.selected)) {
            stats.sectionsPopulated++;
            stats.totalItems += items.filter(i => i.selected).length;
        }
    });

    // Analyze events by weight
    const events = sections.events || [];
    events.forEach(e => {
        if (e.weight === 5) stats.criticalEvents++;
        if (e.weight === 4) stats.majorEvents++;
    });

    // Check critical requirements
    if (stats.sectionsPopulated < 3) {
        warnings.push({
            level: 'warning',
            message: 'Low extraction density - only ${stats.sectionsPopulated} sections populated'
        });
    }

    // Validate scene codes if context provides expected prefix
    if (context.startIndex !== undefined) {
        const sceneBreaks = sections.sceneBreaks || [];
        const invalidCodes = [];
        
        sceneBreaks.forEach(item => {
            const codes = parseSceneCodes(item.content);
            codes.forEach(c => {
                if (c.startMsg !== context.startIndex) {
                    invalidCodes.push(c.code);
                }
            });
        });
        
        if (invalidCodes.length > 0) {
            stats.sceneCodesValid = false;
            warnings.push({
                level: 'error',
                message: `Invalid scene code prefixes: ${invalidCodes.join(', ')} (expected S${context.startIndex}:N)`
            });
        }
    }

    // Check NSFW is preserved if character states suggest explicit content
    const states = sections.characterStates || [];
    const nsfw = sections.nsfwContent || [];
    const statesWithIntimacy = states.filter(p =>
        /\b(lust|desire|arousal|passion|intimate)\b/i.test(p.content)
    );

    if (statesWithIntimacy.length > 0 && nsfw.length === 0) {
        warnings.push({
            level: 'warning',
            message: 'Character states suggest intimate content but NSFW section is empty'
        });
    }

    stats.nsfwPreserved = nsfw.length;
    stats.relationshipsTracked = (sections.relationshipShifts || []).length;

    return { warnings, stats };
}

/**
 * Auto-fix common extraction issues
 */
export function autoFixExtraction(sections, context = {}) {
    const fixes = [];
    const fixed = JSON.parse(JSON.stringify(sections)); // Deep clone

    // Fix scene code prefixes
    if (context.startIndex !== undefined) {
        Object.keys(fixed).forEach(key => {
            if (key.startsWith('_')) return;
            const items = fixed[key] || [];
            
            items.forEach(item => {
                // Find and fix wrong prefixes
                const wrongPrefixRegex = /\[S(\d+):(\d+)\]/g;
                let match;
                let newContent = item.content;
                
                while ((match = wrongPrefixRegex.exec(item.content)) !== null) {
                    const [full, prefix, sceneNum] = match;
                    if (parseInt(prefix) !== context.startIndex) {
                        const correctCode = `[S${context.startIndex}:${sceneNum}]`;
                        newContent = newContent.replace(full, correctCode);
                fixes.push(`Fixed scene code ${full} → ${correctCode}`);
                    }
                }
                
                if (newContent !== item.content) {
                    item.content = newContent;
                    item.edited = true;
                    item.sceneCodes = parseSceneCodes(newContent);
                }
            });
        });
    }

    // Ensure events have weights
    const events = fixed.events || [];
    events.forEach((event, i) => {
        if (!event.weight || event.weight < 1 || event.weight > 5) {
            event.weight = 3; // Default to moderateevent.edited = true;
            fixes.push(`Set default weight for event ${i + 1}`);
        }
    });

    return { fixed, fixes };
}



/**
 * Extract CURRENT STATE fields as structured object
 * Useful for UI display and continuation
 */
export function parseCurrentState(sections) {
    const currentState = sections.currentState || [];
    if (currentState.length === 0) return null;

    const content = currentState.map(i => i.content).join('\n');
    const state = {};

    const fields = [
        'Location', 'Time', 'Present', 'Situation', 
        'Pending', 'Mood', 'Physical'
    ];

    fields.forEach(field => {
        const regex = new RegExp(`\\*?\\*?${field}\\*?\\*?:\\s*(.+?)(?=\\n\\*?\\*?[A-Z]|$)`, 'is');
        const match = content.match(regex);
        if (match) {
            state[field.toLowerCase()] = match[1].trim();
        }
    });

    return state;
}

/**
 * Generate continuation context from Current State
 * Outputs a brief prompt-ready summary
 */
export function generateContinuationContext(currentState) {
    if (!currentState) return '';

    const parts = [];
    
    if (currentState.location) {
        parts.push(`Location: ${currentState.location}`);
    }
    if (currentState.present) {
        parts.push(`Present: ${currentState.present}`);
    }
    if (currentState.situation) {
        parts.push(`Situation: ${currentState.situation}`);
    }
    if (currentState.mood) {
        parts.push(`Mood: ${currentState.mood}`);
    }
    if (currentState.physical) {
        parts.push(`Physical state: ${currentState.physical}`);
    }
    if (currentState.pending) {
        parts.push(`Pending action: ${currentState.pending}`);
    }

    return parts.join('. ') + '.';
}


/**
 * Parse scene codes from text
 * Scene code format: [S{StartMsg}:{SceneNum}]
 * @param {string} text - Text that may contain scene codes
 * @returns {Array<{code: string, startMsg: number, sceneNum: number}>}
 */
export function parseSceneCodes(text) {
    if (!text) return [];
    // Match BOTH formats: [S123:4] and (S123:4)
    const regex = /[\[(]S(\d+):(\d+)[\])]/g;
    const codes = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        codes.push({
            code: `[S${match[1]}:${match[2]}]`, // Normalize to bracket format
            startMsg: parseInt(match[1], 10),
            sceneNum: parseInt(match[2], 10)
        });
    }
    return codes;
}

/**
 * Validate scene codes in extraction match the expected start index
 * @param {Object} sections - Parsed extraction sections
 * @param {number} startIndex - Expected start message index
 * @returns {{valid: boolean, errors: string[], sceneCount: number}}
 */
export function validateSceneCodes(sections, startIndex) {
    const errors = [];
    const seenScenes = new Set();

    Object.keys(sections).forEach(key => {
        if (key.startsWith('_')) return;
        const items = sections[key] || [];
        items.forEach(item => {
            const codes = parseSceneCodes(item.content);
            codes.forEach(c => {
                // Validate startMsg matches extraction start
                if (c.startMsg !== startIndex) {
                    errors.push(`${c.code} has wrong prefix (expected S${startIndex})`);
                }
                seenScenes.add(c.sceneNum);
            });
        });
    });

    return {
        valid: errors.length === 0,
        errors,
        sceneCount: seenScenes.size
    };
}

/**
 * Markers used to identify extractions
 */
export const EXTRACTION_MARKERS = [
    '📍 TIMELINE', '⚖️ EVENTS', '🔞 NSFW', '💬 DIALOGUE',
    // Legacy markers for backward compatibility
    '📍 SCENE BREAKS', '🔞 NSFW CONTENT', '💬 KEY DIALOGUE'
];

/**
 * Markers used to identify memory shards (supports legacy consolidated header)
 */
export const CONSOLIDATION_MARKERS = ['# MEMORY SHARD', '# CONSOLIDATED MEMORY SHARD'];

/**
 * Check if text is an extraction
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains extraction markers
 */
export function isExtraction(text) {
    if (!text) return false;
    // Must have extraction markers but NOT be a consolidated shard
    return EXTRACTION_MARKERS.some(marker => text.includes(marker)) && !isConsolidatedShard(text);
}

/**
 * Check if text is a consolidated shard (consolidation output)
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains consolidation markers
 */
export function isConsolidatedShard(text) {
    if (!text) return false;
    return CONSOLIDATION_MARKERS.some(marker => text.includes(marker));
}

/**
 * Extract weight from an event line
 * @param {string} line - Event line text
 * @returns {number} Weight value (1-5), defaults to 3 (moderate)
 */
function parseWeightFromLine(line) {
    // O(1) emoji lookup - check each weight emoji
    for (const [emoji, value] of WEIGHT_BY_EMOJI) {
        if (line.includes(emoji)) {
            return value;
        }
    }
    // O(1) text weight lookup
    const weightMatch = line.match(/\b(critical|major|moderate|minor|trivial)\b/i);
    if (weightMatch) {
        return WEIGHT_BY_NAME.get(weightMatch[1].toLowerCase()) ?? 3;
    }
    return 3; // Default moderate
}

/**
 * Get weight emoji from value - O(1) lookup
 * @param {number} value - Weight value (1-5)
 * @returns {string} Weight emoji
 */
export function getWeightEmoji(value) {
    return EMOJI_BY_VALUE.get(value) ?? '🟡';
}

/**
 * Parse extraction response into structured sections
 * @param {string} response - Raw LLM response with emoji headers
 * @param {Object} options
 * @returns {Object} Parsed sections with items
 */
export function parseExtractionResponse(response, options = {}) {
    const registry = getSharderSectionRegistry(options.sectionRegistry || options.profile || NARRATIVE_PROFILE);
    if (registry.profile === ARCHITECTURAL_PROFILE) {
        return parseArchitecturalExtractionResponse(response, registry);
    }

    const contentSections = registry.contentSections;
    const freeformSectionKeys = registry.freeformSectionKeys;
    const sections = {};
    const normalizedResponse = normalizeExtractionResponse(response, registry);

    // Initialize all sections
    contentSections.forEach(section => {
        sections[section.key] = [];
    });

    // Extract header info (supports EXTRACTION + both shard header variants)
    const headerMatch = normalizedResponse.match(/# (?:EXTRACTION|MEMORY SHARD|CONSOLIDATED MEMORY SHARD):\s*(.+)/);
    if (headerMatch) {
        // Strip legacy -MASTER suffix from old prompts that used CONSOLIDATED MEMORY SHARD header
        sections._header = { identifier: headerMatch[1].trim().replace(/-MASTER\s*$/, '') };
    }

    // Parse each section
    for (let i = 0; i < contentSections.length; i++) {
        const section = contentSections[i];
        const nextSection = contentSections[i + 1];

        // Build section-specific regex (matches normalized ### emoji NAME format)
        const startPattern = `###\\s*${section.emoji}\\s*${section.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;

        let endPattern = nextSection 
            ? '(?=###\\s*\\S|---\\s*##\\s*USER EDIT NOTES|$)'
            : '(?=---\\s*##\\s*USER EDIT NOTES|$)';

        const sectionRegex = new RegExp(`${startPattern}[^\\n]*\\n([\\s\\S]*?)${endPattern}`, 'i');
        const match = normalizedResponse.match(sectionRegex);

        if (match && match[1]) {
            const content = match[1].trim();
            if (content && !isEmptyContent(content)) {
                // Handle freeform sections differently
                if (freeformSectionKeys.includes(section.key)) {
                    sections[section.key] = [{
                        id: `${section.key}-0`,
                        content: content,
                        weight: 3,
                        selected: true,
                        edited: false,
                        isFreeform: true
                    }];
                } else {
                    sections[section.key] = parseSectionItems(content, section.key);
                }
            }
        }
    }

    // Parse USER EDIT NOTES
    const notesMatch = normalizedResponse.match(/##\s*USER EDIT NOTES\s*\n([\s\S]*?)(?:---|$)/i);
    if (notesMatch) {
        sections._userNotes = notesMatch[1].trim();
    }

    return sections;
}

/**
 * Check if content is effectively empty
 */
function isEmptyContent(content) {
    const lower = content.toLowerCase().trim();
    return lower ==='none' ||
           lower === '(none)' ||
           lower === '-' ||
           lower === '--' ||
           lower.startsWith('none present') ||
           lower.startsWith('none new') ||
           lower === 'n/a';
}

/**
 * Check if item content is empty or just formatting
 * @param {string} content - Item content
 * @returns {boolean} True if content is empty/formatting
 */
function isEmptyItem(content) {
    if (!content) return true;
    const trimmed = content.trim();
    const lower = trimmed.toLowerCase();

    return trimmed === '---' ||
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

/**
 * Parse section items with improved pattern detection
 * Handles bullets, bold markers, scene codes, and pipe-delimited entries
 */
function parseSectionItems(content, sectionKey) {
    const items = [];
    const lines = content.split('\n');
    let currentItem = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '--' || trimmed.startsWith('---')) continue;

        // Expanded pattern detection for new items
        const isBullet = /^[-•*–—]\s/.test(trimmed);           // Standard bullets (incl. en/em dash)
        const isNumbered = /^\d+\.\s/.test(trimmed);            // Numbered lists: "1. item"
        const isBoldStart = /^\*\*[^*]+\*\*/.test(trimmed);     // Bold text: "**Name** | ..."
        const isSceneCodeStart = /^[\[(]S\d+:\d+[\])]/.test(trimmed);  // Scene codes: "[S0:1]" or "(S0:1)"
        const isPipeDelimited = /\|/.test(trimmed);              // Pipe-separated entries: "Name|role|desc" or "char: type | #"
        const isArrowDelimited = /→/.test(trimmed);              // Arrow-delimited entries: "[A]→[B]: trust=N..."

        // A line is a new item if it matches any structured pattern
        const isNewItem = isBullet || isNumbered || isBoldStart || isSceneCodeStart || isPipeDelimited || isArrowDelimited;

        if (isNewItem) {
            // Save previous item if not empty
            if (currentItem && !isEmptyItem(currentItem.content)) {
                items.push(currentItem);
            }

            // Strip bullet prefix if present (keep content for other formats)
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
                sceneCodes: parseSceneCodes(trimmed)
            };
        } else if (currentItem) {
            // Continuation line - append to current item
            currentItem.content += '\n' + trimmed;
            currentItem.sceneCodes = parseSceneCodes(currentItem.content);
        } else {
            // First unstructured line becomes an item
            currentItem = {
                id: `${sectionKey}-${items.length}`,
                content: trimmed,
                weight: 3,
                selected: true,
                edited: false,
                sceneCodes: parseSceneCodes(trimmed)
            };
        }
    }

    // Save final item if not empty
    if (currentItem && !isEmptyItem(currentItem.content)) {
        items.push(currentItem);
    }
    return items;
}
/**
 * Reconstruct extraction text from edited sections
 * @param {Object} sections - Parsed and edited sections
 * @param {Object} metadata - Optional metadata (startIndex, endIndex, etc.)
 * @returns {string} Formatted extraction text
 */
export function reconstructExtraction(sections, metadata = {}) {
    const registry = getSharderSectionRegistry(metadata.sectionRegistry || metadata.profile || NARRATIVE_PROFILE);
    if (registry.profile === ARCHITECTURAL_PROFILE) {
        return reconstructArchitecturalExtraction(sections, registry);
    }

    const contentSections = registry.contentSections;
    const lines = [];

    // Header
    const identifier = sections._header?.identifier || `Messages ${metadata.startIndex ?? '?'}-${metadata.endIndex ?? '?'}`;
    const headerLabel = metadata.headerType === 'shard' ? 'MEMORY SHARD' : 'EXTRACTION';
    lines.push('---');
    lines.push(`# ${headerLabel}: ${identifier}`);
    if (metadata.tokenCount) {
        lines.push(`## Source: ~${metadata.tokenCount} tokens`);
    }
    lines.push('---');
    lines.push('');

    // Each section
    contentSections.forEach(section => {
        const displayName = section.key === 'currentState' ? 'CURRENT (as of end of extract)' : section.name;
        lines.push(`### ${section.emoji} ${displayName}`);

        const items = sections[section.key] || [];
        const selectedItems = items.filter(item => item.selected);

        if (selectedItems.length === 0) {
            lines.push('(None)');
        } else {
            selectedItems.forEach(item => {
                // For events, ensure weight emoji is included
                if (section.key === 'events') {
                    const weightEmoji = getWeightEmoji(item.weight);
                    // Check if content already has a weight emoji
                    const hasWeightEmoji = EVENT_WEIGHTS.some(w => item.content.includes(w.emoji));
                    if (!hasWeightEmoji) {
                        lines.push(`- ${weightEmoji} | ${item.content}`);
                    } else {
                        lines.push(`- ${item.content}`);
                    }
                } else {
                    lines.push(`- ${item.content}`);
                }
            });
        }
        lines.push('');
    });

    // User notes - only include if user actually edited them
    if (metadata.userNotesEdited && sections._userNotes && sections._userNotes.trim()) {
        lines.push('---');
        lines.push('## USER EDIT NOTES');
        lines.push(sections._userNotes);
        lines.push('---');
    }

    return lines.join('\n');
}

/**
 * Get all saved extractions and consolidated shards from lorebook entries and system messages
 * @param {Object} settings - Extension settings
 * @returns {Promise<Array>} Array of extraction/consolidation objects with type field
 */
/**
 * Parse message range from identifier string
 * @param {string} identifier - Identifier like "Messages 0-10"
 * @returns {number|null} Start message number, or null if unparseable
 */
function parseMessageRangeStart(identifier) {
    if (!identifier) return null;

    // Match patterns like "Messages 0-10", "messages 0-10", etc.
    const match = identifier.match(/messages?\s+(\d+)\s*[-–]\s*\d+/i);
    if (match) {
        return parseInt(match[1], 10);
    }

    return null;
}

/**
 * Find all saved extractions and consolidated shards
 * @param {Object} settings - Extension settings
 * @param {Object} lorebookOverride - Optional lorebook selection override (from modal)
 * @returns {Promise<Array>} Array of extraction objects
 */
export async function findSavedExtractions(settings, lorebookOverride = null) {
    const extractions = [];

    // Get all messages
    const context = SillyTavern.getContext();
    const messages = context?.chat || [];

    // Check messages in chat for extraction markers and consolidated shards
    messages.forEach((msg, index) => {
        const shardInfo = classifySavedShardText(msg?.mes);

        if (isExtraction(msg.mes)) {
            // Extraction
            const headerMatch = msg.mes.match(/# EXTRACTION:\s*(.+)/);
            const identifier = headerMatch ? headerMatch[1].trim() : `System Message ${index}`;
            const messageRangeStart = parseMessageRangeStart(identifier) ?? index;

            extractions.push({
                type: 'extraction',
                source: 'system',
                index,
                messageRangeStart,
                identifier,
                content: msg.mes,
                preview: msg.mes.substring(0, 150).replace(/\n/g, ' ') + '...',
                uid: msg.send_date  // Add UID for tracking
            });
        } else if (isConsolidatedShard(msg.mes) || shardInfo.classification !== SAVED_SHARD_CLASSIFICATIONS.UNKNOWN) {
            // Consolidated shard (consolidation output)
            const identifier = shardInfo.startIndex !== null && shardInfo.endIndex !== null
                ? `Memory Shard ${shardInfo.startIndex}-${shardInfo.endIndex}`
                : `Memory Shard ${index}`;
            const messageRangeStart = shardInfo.startIndex ?? parseMessageRangeStart(identifier) ?? index;

            extractions.push({
                type: 'consolidation',
                source: 'system',
                index,
                messageRangeStart,
                messageRangeEnd: shardInfo.endIndex ?? null,
                startIndex: shardInfo.startIndex ?? null,
                endIndex: shardInfo.endIndex ?? null,
                identifier,
                content: msg.mes,
                parsedBody: shardInfo.body,
                classification: shardInfo.classification,
                shardProfile: shardInfo.profile,
                schemaVersion: shardInfo.schemaVersion,
                contentFormat: shardInfo.contentFormat,
                preview: msg.mes.substring(0, 150).replace(/\n/g, ' ') + '...',
                uid: msg.send_date  // Add UID for tracking
            });
        }
    });

    for (const extraction of extractions) {
        if (extraction?.shardProfile !== ARCHITECTURAL_PROFILE) continue;
        extraction.projectionMetadata = await getArchitecturalProjectionMetadataForSavedItem(extraction);
    }

    // Check lorebook entries if enabled (either via override or settings)
    const shouldScanLorebooks = lorebookOverride
        ? true
        : (settings.outputMode === 'lorebook' || settings?.rag?.includeLorebooksInShardSelection === true);
    if (shouldScanLorebooks) {
        try {
            // Access world info entries through SillyTavern's API
            // Pass the override if provided, otherwise use settings
            const worldInfoEntries = await getWorldInfoEntries(settings, lorebookOverride);

            worldInfoEntries.forEach((entry, index) => {
                const content = entry.content || entry.memo || '';
                const shardInfo = classifySavedShardText(content);

                if (isExtraction(content)) {
                    const headerMatch = content.match(/# EXTRACTION:\s*(.+)/);
                    const identifier = headerMatch
                        ? headerMatch[1].trim()
                        : String(entry.comment ?? `Lorebook Entry ${index}`).trim();
                    const messageRangeStart = parseMessageRangeStart(identifier) ?? 999999;

                    extractions.push({
                        type: 'extraction',
                        source: 'lorebook',
                        index,
                        messageRangeStart,
                        entryId: entry.uid || entry.id,
                        identifier,
                        content,
                        preview: content.substring(0, 150).replace(/\n/g, ' ') + '...',
                        uid: entry.uid || entry.id  // Add UID for tracking
                    });
                } else if (shardInfo.classification !== SAVED_SHARD_CLASSIFICATIONS.UNKNOWN) {
                    const identifier = String(entry.comment ?? `Memory Shard ${index}`).trim();
                    const messageRangeStart = shardInfo.startIndex ?? parseMessageRangeStart(identifier) ?? 999999;

                    extractions.push({
                        type: shardInfo.classification === SAVED_SHARD_CLASSIFICATIONS.NARRATIVE ? 'extraction' : 'consolidation',
                        source: 'lorebook',
                        index,
                        messageRangeStart,
                        messageRangeEnd: shardInfo.endIndex ?? null,
                        startIndex: shardInfo.startIndex ?? null,
                        endIndex: shardInfo.endIndex ?? null,
                        entryId: entry.uid || entry.id,
                        identifier,
                        content,
                        parsedBody: shardInfo.body,
                        classification: shardInfo.classification,
                        shardProfile: shardInfo.profile,
                        schemaVersion: shardInfo.schemaVersion,
                        contentFormat: shardInfo.contentFormat,
                        preview: content.substring(0, 150).replace(/\n/g, ' ') + '...',
                        uid: entry.uid || entry.id  // Add UID for tracking
                    });
                }
            });

            for (const extraction of extractions) {
                if (extraction?.source !== 'lorebook' || extraction?.shardProfile !== ARCHITECTURAL_PROFILE) continue;
                if (extraction.projectionMetadata) continue;
                extraction.projectionMetadata = await getArchitecturalProjectionMetadataForSavedItem(extraction);
            }
        } catch (error) {
            log.warn('Could not scan lorebook entries:', error);
        }
    }

    return extractions;
}

/**
 * Get world info entries from SillyTavern
 * @param {Object} settings - Extension settings
 * @param {Object} lorebookSelectionOverride - Optional lorebook selection override (from modal)
 * @returns {Promise<Array>} Array of world info entries
 */
async function getWorldInfoEntries(settings, lorebookSelectionOverride = null) {
    const entries = [];
    const loadedBooks = new Set();

    try {
        const context = SillyTavern.getContext();

        // Use override if provided, otherwise use settings
        const lorebookSelection = lorebookSelectionOverride || settings.lorebookSelection;

        const addEntriesFromBook = async (bookName) => {
            if (!bookName || loadedBooks.has(bookName)) return false;

            try {
                const worldInfoData = await loadWorldInfo(bookName);
                if (worldInfoData?.entries) {
                    entries.push(...Object.values(worldInfoData.entries));
                    loadedBooks.add(bookName);
                    return true;
                }
            } catch (error) {
                log.warn(`Could not load lorebook "${bookName}":`, error);
            }

            return false;
        };

        // Get character book entries
        if (lorebookSelection?.useCharacterBook) {
            const charData = context.characters?.[context.characterId]?.data;
            const characterWorldName = charData?.extensions?.world;

            // Prefer loading by lorebook name so disabled entries are included too
            const loadedFromWorld = await addEntriesFromBook(characterWorldName);

            // Fallback for embedded character-book data
            if (!loadedFromWorld) {
                const charBook = charData?.character_book?.entries;
                if (charBook) {
                    entries.push(...Object.values(charBook));
                }
            }
        }

        // Get chat-attached world info
        if (lorebookSelection?.useChatBook && context.chatMetadata?.world_info) {
            const chatWorldInfo = context.chatMetadata.world_info;
            const chatWorldName = typeof chatWorldInfo === 'string'
                ? chatWorldInfo
                : chatWorldInfo?.name;

            // Prefer loading by lorebook name so disabled entries are included too
            const loadedFromWorld = await addEntriesFromBook(chatWorldName);

            // Fallback for contexts that provide inline entries
            if (!loadedFromWorld) {
                const chatBook = chatWorldInfo?.entries;
                if (chatBook) {
                    entries.push(...Object.values(chatBook));
                }
            }
        }

        // Get custom world info books
        if (lorebookSelection?.useCustomBooks && lorebookSelection?.customBookNames?.length > 0) {
            for (const bookName of lorebookSelection.customBookNames) {
                await addEntriesFromBook(bookName);
            }
        }
    } catch (error) {
        log.warn('Error getting world info entries:', error);
    }

    return entries;
}

