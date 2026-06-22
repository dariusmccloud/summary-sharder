/**
 * Sharder pipeline: generate, parse, sanitize, validate.
 */

import { getSharderPrompts } from '../summarization/prompts.js';
import {
    NARRATIVE_PROFILE,
    getSharderSectionRegistry,
    parseExtractionResponse,
    reconstructExtraction,
    parseSceneCodes,
} from '../summarization/sharder-pipeline.js';
import { callSillyTavernAPI, callExternalAPI } from '../api/api-client.js';
import { callConnectionProfileAPI } from '../api/connection-profile-api.js';
import { getAbortSignal, throwIfAborted } from '../api/abort-controller.js';
import { getFeatureApiSettings } from '../api/feature-api-config.js';
import { sanitizeSinglePassSections } from './canonical-sanitizer.js';
import { validateSinglePassOutput, getSinglePassSeverity } from './fidelity-validator.js';
import { checkSinglePassEvidence } from './evidence-checker.js';
import { checkRelationshipCoherence } from './relationship-guard.js';

/**
 * @param {Object} settings
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callSharderApi(settings, systemPrompt, userPrompt) {
    const effective = await getFeatureApiSettings(settings, 'sharder');
    const options = {
        temperature: effective.temperature,
        topP: effective.topP,
        maxTokens: effective.maxTokens,
        signal: getAbortSignal(),
        messageFormat: effective.messageFormat,
        removeStopStrings: effective.removeStopStrings === true,
    };

    if (effective.useSillyTavernAPI) {
        return await callSillyTavernAPI(systemPrompt, userPrompt, options);
    }

    if (effective.useConnectionProfile) {
        return await callConnectionProfileAPI(effective.connectionProfileId, systemPrompt, userPrompt, options);
    }

    return await callExternalAPI(effective, systemPrompt, userPrompt, options);
}

/**
 * Parse optional KEYWORDS line from LLM output.
 * @param {string} response
 * @returns {{summary:string, keywords:string[]}}
 */
function parseSummaryResponse(response) {
    const text = String(response || '').trimEnd();
    const keywordsMatch = text.match(/\nKEYWORDS:\s*(.+)$/i);
    if (!keywordsMatch) {
        return { summary: response, keywords: [] };
    }

    const keywords = keywordsMatch[1]
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);
    const summary = text.replace(/\nKEYWORDS:\s*.+$/i, '').trim();
    return { summary, keywords };
}

function buildSharderUserPrompt(chatText, context) {
    const existingShards = (Array.isArray(context?.existingShards) ? context.existingShards : [])
        .filter(shard => {
            // Exclude shards whose content is already in the chat text range
            if (Number.isFinite(shard?.messageRangeStart)
                && shard.messageRangeStart >= context.startIndex
                && shard.messageRangeStart <= context.endIndex) {
                return false;
            }
            return true;
        });

    const keywordInstruction = context.extractKeywords
        ? `\n\n---\nAfter your Memory Shard, on a new line at the very end, provide exactly 5 keywords that capture the key characters, locations, events, or topics from this content. Format as:\nKEYWORDS: keyword1, keyword2, keyword3, keyword4, keyword5`
        : '';

    if (!existingShards.length) {
        return `sharder CONTEXT:\n- Message Range: ${context.startIndex} to ${context.endIndex}\n- Scene Code Prefix: S${context.startIndex}\n\nCHAT CONTENT:\n\n${chatText}${keywordInstruction}`;
    }

    const sortedShards = [...existingShards].sort((a, b) => {
        const av = Number.isFinite(a?.messageRangeStart) ? a.messageRangeStart : -1;
        const bv = Number.isFinite(b?.messageRangeStart) ? b.messageRangeStart : -1;
        return bv - av;
    });

    const shardBlocks = sortedShards
        .map((shard, idx) => {
            const label = String(shard?.identifier || `Selected Shard ${idx + 1}`);
            const content = String(shard?.content || '').trim();
            return `--- SHARD: ${label} ---\n${content}`;
        })
        .filter(Boolean)
        .join('\n\n');

    return `sharder CONTEXT:\n- Message Range: ${context.startIndex} to ${context.endIndex}\n- Scene Code Prefix: S${context.startIndex}\n\n===== EXISTING SHARD(S) =====\n\n${shardBlocks}\n\n===== NEW CHAT CONTENT =====\n\n${chatText}${keywordInstruction}`;
}

/**
 * @param {string} chatText
 * @param {Object} settings
 * @param {{startIndex:number,endIndex:number,extractKeywords?:boolean,existingShards?:Array<{content:string,identifier:string,messageRangeStart?:number}>}} context
 * @returns {Promise<{raw:string,reconstructed:string,sections:Object,diagnostics:Array,severity:string,stats:Object,metadata:Object,extractedKeywords:string[]}>}
 */
export async function runSharderPipeline(chatText, settings, context) {
    const sectionRegistry = getSharderSectionRegistry(context?.sectionRegistry || context?.profile || NARRATIVE_PROFILE);
    const prompts = getSharderPrompts(settings);
    const systemPrompt = prompts.prompt;

    const existingShards = (Array.isArray(context?.existingShards) ? context.existingShards : [])
        .filter(shard => {
            if (Number.isFinite(shard?.messageRangeStart)
                && shard.messageRangeStart >= context.startIndex
                && shard.messageRangeStart <= context.endIndex) {
                return false;
            }
            return true;
        });
    const userPrompt = buildSharderUserPrompt(chatText, context);

    const inheritedPrefixes = new Set();
    for (const shard of existingShards) {
        if (Number.isFinite(shard?.messageRangeStart)) {
            inheritedPrefixes.add(shard.messageRangeStart);
        }
        const content = String(shard?.content || '');
        for (const sc of parseSceneCodes(content)) {
            inheritedPrefixes.add(sc.startMsg);
        }
    }

    const raw = await callSharderApi(settings, systemPrompt, userPrompt);
    throwIfAborted('sharder api');
    const parsedResult = context.extractKeywords ? parseSummaryResponse(raw) : { summary: raw, keywords: [] };
    const cleanedRaw = parsedResult.summary || raw;
    const parsed = parseExtractionResponse(cleanedRaw, { sectionRegistry });
    const {
        sections: sanitizedSections,
        sceneCodeFixes,
        fixedCodes,
    } = sanitizeSinglePassSections(parsed, { ...context, inheritedPrefixes });

    const structure = validateSinglePassOutput(sanitizedSections, { ...context, inheritedPrefixes, sectionRegistry });
    const evidence = checkSinglePassEvidence(sanitizedSections, chatText);
    const relationships = checkRelationshipCoherence(sanitizedSections);

    const diagnostics = [
        ...structure.diagnostics,
        ...evidence.diagnostics,
        ...relationships.diagnostics,
    ];
    if (sceneCodeFixes > 0) {
        diagnostics.push({
            level: 'info',
            code: 'SCENE_PREFIX_AUTOFIX_APPLIED',
            message: `Auto-fixed ${sceneCodeFixes} scene code prefix${sceneCodeFixes === 1 ? '' : 'es'} to S${context.startIndex}.`,
            details: fixedCodes,
        });
    }

    const severity = getSinglePassSeverity(diagnostics);

    const reconstructed = reconstructExtraction(sanitizedSections, {
        startIndex: context.startIndex,
        endIndex: context.endIndex,
        userNotesEdited: false,
        headerType: 'shard',
        sectionRegistry,
    });

    return {
        raw,
        reconstructed,
        sections: sanitizedSections,
        extractedKeywords: parsedResult.keywords,
        diagnostics,
        severity,
        stats: {
            ...structure.stats,
            evidenceChecked: evidence.stats.checked,
            lowEvidence: evidence.stats.lowEvidence,
            relationships: relationships.stats.relationships,
            outOfBoundsRelationships: relationships.stats.outOfBounds,
        },
        metadata: {
            startIndex: context.startIndex,
            endIndex: context.endIndex,
            hasExistingShards: existingShards.length > 0,
            existingShardCount: existingShards.length,
            headerType: 'shard',
            sectionRegistry,
        }
    };
}

