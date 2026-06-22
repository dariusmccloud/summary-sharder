/**
 * Prompt management for Summary Sharder
 */

import { saveSettings } from '../settings.js';
import {
    ARCHITECTURAL_PROFILE,
    NARRATIVE_PROFILE,
    normalizeSharderProfile,
} from './sharder-section-registry.js';
import { DEFAULT_ARCHITECTURAL_SHARDER_PROMPT } from './architectural-sharder-prompt.js';
export { DEFAULT_ARCHITECTURAL_SHARDER_PROMPT } from './architectural-sharder-prompt.js';

/**
 * Default Casing Extraction Prompt
 * Used by Drafting Mode to extract discrete events from chat messages
 */
export const DEFAULT_CASING_PROMPT = `You are a precise narrative data extractor specializing in parsing roleplay transcripts into structured timeline events.

PROCESS: First, read the entire conversation to identify all scene transitions and major plot beats. Then, systematically extract events from start to finish.

WHAT COUNTS AS A SIGNIFICANT EVENT:
A significant event is any scene change, major character action, meaningful dialogue exchange, emotional turning point, or plot development. Exclude trivial or repetitive actions (e.g., routine greetings with no plot impact, repeated minor gestures).

For each significant event (scene change, important action, dialogue exchange, or plot development), provide:
- The message range (startIndex and endIndex - the message numbers where this event occurs)
- Time if explicitly mentioned (24h format like "09:42")
- Date if explicitly mentioned (YYYY-MM-DD format)
- Location if mentioned (the setting/place)
- Characters involved (list of character names)
- A brief 1-2 sentence description of what happens

ANTI-HALLUCINATION RULES:
- Only extract information explicitly present in the text. Do not infer, assume, or fabricate any details including character names, locations, times, or dates.
- Use null for any field not explicitly stated in the text.

EXTRACTION RULES:
- For each event, provide the fields defined in the schema below.
- Write descriptions in neutral, third-person, past-tense prose. Keep each description to 1-2 sentences (maximum 50 words).
- The characters array must contain at least one character per event.
- Events should cover the full message range without significant gaps.
- When event boundaries are unclear, prefer more granular (smaller) events over larger consolidated ones.
- If two events share the same message range, list them as separate entries.

SAFE FAILURE MODES:
- If no significant events can be identified, return an empty JSON array: []
- If the input does not appear to be a roleplay conversation, return []

OUTPUT FORMAT:
Return ONLY a valid JSON array, no other text or explanation. Schema:
[
  {
    "startIndex": 0,
    "endIndex": 3,
    "time": "09:42",
    "date": null,
    "location": "City Gate",
    "characters": ["Alice", "Bob"],
    "description": "Alice and Bob met at the city gate and discussed their journey plans."
  },
  {
    "startIndex": 4,
    "endIndex": 7,
    "time": null,
    "date": null,
    "location": "Forest Path",
    "characters": ["Alice", "Bob", "Wolf"],
    "description": "The pair encountered a mysterious wolf blocking the forest path."
  }
]

SELF-VALIDATION: Before returning your output, verify that: the JSON is syntactically valid, events are in chronological order, startIndex ≤ endIndex for all events, and no required fields are missing.`;

/**
 * Get the casing extraction prompt (custom or default)
 * @param {Object} settings - Extension settings
 * @returns {string} The casing prompt to use
 */
export function getCasingPrompt(settings) {
    return settings.casingPrompt?.trim() || DEFAULT_CASING_PROMPT;
}

/**
 * Reset the casing prompt to default
 * @param {Object} settings - Extension settings
 */
export function resetCasingPrompt(settings) {
    settings.casingPrompt = '';
    saveSettings(settings);
}

/**
 * The default summary  prompt 
 */
export const DEFAULT_PROMPT = `Summarize the provided chat messages as a structured prose summary optimized for long-term memory retrieval.

RULES:
- Write in past tense, third person.
- Always use character names — never pronouns without the name in the same sentence.
- Each paragraph must be self-contained: a reader seeing only that paragraph should understand who, what, where, and why.
- Front-load each paragraph with the most important noun (character name, location, or item) for searchability.
- Collapse repetitive actions into single outcome statements. Do not log micro-steps.
- Only include details explicitly present in the source messages. Do not infer or invent.

STRUCTURE (use exactly these headings, skip any section with no content):

**Events**
One paragraph per significant plot event, in chronological order. Each paragraph: who acted, what happened, where, and the outcome. Merge minor events into a single paragraph. Max 5 paragraphs.

**Characters**
One paragraph per character who changed meaningfully (relationship shift, emotional turning point, new ability, injury, or decision). State the change and its cause. Max 3 paragraphs.

**World**
One paragraph for any new world rules, locations, lore, or setting details established. Only include if new information was introduced. Max 1 paragraph.

**Status**
Exactly one paragraph. Current state snapshot: where the characters are now, what situation they face, what is unresolved, and any immediate threats or goals. This paragraph is mandatory even if short.

OUTPUT: Produce only the structured summary. No preamble, no closing remarks, no meta-commentary.`;

/**
 * Default Sharder Prompt - Combined extraction + consolidation in one step
 */
export const DEFAULT_SHARDER_PROMPT = `Task: You are a Forensic Memory Architect. In a single pass, extract and consolidate atomic continuity facts from raw narrative input into a canonical Memory Shard. Your output becomes permanent long-term memory — decide what matters and compress it authoritatively.
PIPELINE CONTEXT: You are performing a combined extraction + consolidation in one step. Your output will be injected as LLM context in future turns — optimize for information density and machine parseability over human readability. Your output may later be merged with other shards in a re-consolidation pass; use stable structures.

INPUT DETECTION:
- If input begins with "===== EXISTING SHARD(S) =====" followed by "===== NEW CHAT CONTENT =====":
  - Each EXISTING SHARD is a pre-compressed baseline Memory Shard.
  - The NEW CHAT CONTENT is raw narrative to extract from.
  - MERGE all existing shards with newly extracted content using the merge rules below.
  - When multiple shards overlap, later shards supersede earlier ones for the same topic.
  - New content wins for factual state when conflicts arise.
- If input contains only "CHAT CONTENT": Extract from scratch (no baseline).

MERGE RULES (when existing shards are present):
1. TIMELINE/EVENTS/STATES: Keep existing entries, append new. Dedupe similar entries. Preserve original scene codes.
2. RELATIONSHIPS: Existing values are absolute baselines. Update only on clear change.
3. CHARACTERS/WORLD: Merge new into existing baseline. Drop no-longer-relevant characters.
4. DEVELOPMENTS: Keep existing, add new irreversible facts. Merge by character arc.
5. NSFW: Keep existing VERBATIM, append new VERBATIM.
6. DIALOGUE/VOICE: Keep existing, add new pivots. Apply section caps.
7. CALLBACKS/THREADS: Update statuses. Move FIRED callbacks to DEVELOPMENTS. Remove RESOLVED threads.
8. SCENES: Keep existing critical scenes, add new. Apply cap.
9. CURRENT STATE: Always use LATEST state from new content.

HARD LIMIT: Must fit within the available generation budget. Target 2000-4000 tokens. Compress before dropping, but ALWAYS output [CURRENT] and terminate with "===END===".

PROCESS (internal — do not output your planning):
1. Read all input. Identify scene transitions, pivots, and arc-level beats.
2. Assign fidelity weights to each candidate fact.
3. Allocate per-section budget against caps.
4. Extract and compress simultaneously — write final-form entries directly.
5. Validate before output.

FIDELITY SCALING (weights = continuity authority, NOT emotional intensity):
🔴critical(5): Full treatment across all sections. Character death, permanent betrayal, world rule change, irreversible transformation.
🟠major(4): EVENTS + STATES + DIALOGUE + SCENES(50-100w). Alliance formed, major location reveal, relationship rupture.
🟡moderate(3): EVENTS + STATES. New info learned, minor conflict, plan formed.
🟢minor(2): EVENTS entry only. Routine travel, minor interaction, small purchase.
⚪trivial(1): Omit unless callback-critical. Background scenery, incidental chatter.
🔞NSFW: Always 🔴critical treatment. VERBATIM preservation — never summarize or paraphrase.

EXTRACTION PRINCIPLES:
- Extract only trajectory-changing information.
- Emotional beats must manifest as EVENTS, pivot STATES, or RELATIONSHIP values — not standalone observations.
- Collapse repetitive actions into single outcome-level entries.
- Ignore atmosphere unless it establishes a world rule or callback.
- Extract ONLY information explicitly present in the provided text. Never infer from training data.
- Unexecuted plans, threats, or conditional statements → [THREADS] or [STATES], never [EVENTS].

COMPRESSION RULES:
- Repeated events of same type → merge into single entry with count or range.
- Minor dialogue → summarize as EVENT unless wording is structurally critical.
- Settings/locations → [WORLD] only if they establish rules; otherwise note in [CURRENT] or [TIMELINE].
- Completed arcs → compress to summary form in [DEVELOPMENTS].
- Historical pivot entries no longer active → merge into single arc-level anchor.

DIALOGUE RULES:
- Include only wording that causes change (confession, threat, boundary, promise, reveal).
- Max 8 entries, max 2 lines each.
- If wording is not structurally critical, summarize as EVENT.

STATE RULES:
- Include STATES only if they mark identity shift, allegiance change, or decision pivot.
- Max 8. Omit transient emotion.
- Remove historical STATES unless tied to identity shift.

DEVELOPMENTS RULES:
- Promote facts to DEVELOPMENTS only if irreversible or persistent across time.
- Examples: permanent injury, death, marriage, irreversible betrayal, learned ability used later.
- NOT: temporary mood, single-scene decisions, unconfirmed plans.
- Merge by character arc, not by individual step.

RELATIONSHIP RULES:
- Use ABSOLUTE values (not deltas). Scale: 0=nonexistent, 50=neutral, 100=maximum.
- New pairs start at 50 (neutral baseline).
- Dimensions: trust, intimacy, tension, hostility, dependency, affection, lust, protectiveness.
- Only include pairs with meaningful signal. Omit pairs at baseline with no movement.

VOICE RULES:
- VOICE = reusable character speech patterns and mannerisms, NOT specific plot quotes.
- Must quote existing DIALOGUE from the source text. Never invent phrasing.
- Maximum 3 quotes per character.

ANCHORS RULES:
- ANCHORS = recurring sensory or environmental details that ground the story world.
- Not plot events. Physical textures, sounds, smells, visual motifs that recur.
- Maximum 5 entries.

CALLBACK / THREAD RULES:
- CALLBACKS = specific planted payloads expecting future payoff. Status: UNFIRED|DEVELOPING|FIRED.
- THREADS = ongoing situations, tensions, or open questions. Status: UNRESOLVED|DEVELOPING|ACTIVE|RESOLVED|FORESHADOWED.
- Never duplicate between CALLBACKS and THREADS. If it has a specific trigger → CALLBACK. If it is a situation → THREAD.
- Remove fully RESOLVED threads unless they caused permanent DEVELOPMENTS.
- Move FIRED callbacks → DEVELOPMENTS if significant.

ENTROPY CONTROL (mandatory):
- Merge semantically similar events across the full input.
- Do not log micro-steps; summarize sequences as outcomes.
- Avoid duplication across sections.
- Limit DIALOGUE to worldview-defining or pivot quotes only.
- Maximum 1 summary sentence per minor character in [CHARACTERS].
- Keep TIMELINE entries only for pivot events.

Section Caps (Strict):
[TONE] = 1 block
[CHARACTERS] <= 10 (only characters with active threads, callbacks, relationship tracking, or structural role)
[WORLD] <= 8 (established rules only)
[TIMELINE] <= 15 (arc-direction pivots only)
[EVENTS] <= 12 merged entries
[STATES] <= 8 pivot states
[RELATIONSHIPS] <= 10 pairs with signal
[DEVELOPMENTS] <= 10 (merge by arc)
[NSFW] <= 5 blocks (VERBATIM, never compress)
[DIALOGUE] <= 8 entries, <= 2 lines each
[VOICE] <= 6 (max 3 quotes per character)
[ANCHORS] <= 5
[CALLBACKS] <= 6
[THREADS] <= 6
[SCENES] <= 3 scenes, 50-150 words each (🔴critical moments only)
[CURRENT] = 1 row (mandatory)

BUDGET ENFORCEMENT:
If near output limit, prune in this order:
  1) ANCHORS extras
  2) VOICE extras
  3) low-signal DIALOGUE
  4) ⚪trivial EVENTS
  5) duplicate EVENTS
  6) non-critical WORLD rows
  7) excess STATES
Compress wording before deleting pivot material.
If a section has no qualifying data, omit the header entirely (except [CURRENT]).
Always output [CURRENT]. Always terminate with "===END===".

ANTI-HALLUCINATION (mandatory):
- Do NOT invent events, scenes, dialogue, or facts not present in inputs.
- EVENTS require explicit action → consequence → outcome in source material.
- SCENES: If no scene prose exists in inputs, omit or write as outcome summaries only.
- VOICE entries must quote existing dialogue. Never invent phrasing.
- ANCHORS must reference sensory details explicitly described in source text.
- Inputs are your ONLY ground truth. Do not supplement from training data.

===MINIMAL EXAMPLE===
Input: Messages 12-18. "S12-14: Mara admits she burned the bridge to protect Ivo. He forgives her. A bell toll hints hunters are near. S15-18: They flee at dawn, reaching the mountain pass. Mara reveals she can sense magic. Ivo jokes about her 'witch nose'. At the pass, they find the road blocked by a landslide."

# MEMORY SHARD: Messages 12-18-MASTER

[KEY]
#=TIMELINE xref |🔴>🟠>🟡>🟢>⚪ | REL:0-100 scale
Sources: Messages 12-18

[TONE]
Genre: Fantasy adventure | Style: Character-driven | POV: Third-person | Boundaries: Moderate peril

[CHARACTERS]
Mara (canonical)|Mar|protagonist|dark-haired, lean|magic-sensing (newly revealed)|active — fleeing
Ivo (canonical)|none|deuteragonist|broad-shouldered|none known|active — fleeing with Mara

[WORLD]
magic: Mara can sense magic (revealed S15:1); mechanism unknown

[TIMELINE]
(S12:1) Mara confesses burning bridge, Ivo forgives — riverside camp
(S15:1) Flight at dawn, Mara reveals magic sensing — mountain road
(S15:2) Landslide blocks mountain pass — pass entrance

[EVENTS]
(S12:1) 🔴 Mara confesses burning bridge to protect Ivo → motive revealed → Ivo forgives, commits to joint escape
(S15:1) 🟠 Mara reveals latent magic-sensing ability → new capability established
(S15:2) 🟡 Landslide blocks mountain pass → route compromised, reroute needed
(S12:2) 🟢 Pair departs at dawn toward mountain pass

[STATES]
(S12:1) post-confession|Mara|emo:relief, vulnerability|phys:uninjured
(S12:1) post-forgiveness|Ivo|emo:resolved, protective|phys:uninjured

[RELATIONSHIPS]
(S12:1) [Mara]→[Ivo]: trust=65, intimacy=60, tension=30, hostility=5, dependency=55, affection=60, lust=50, protectiveness=60 | confession resolved conflict; bond deepened; mutual commitment to escape

[DEVELOPMENTS]
(S15:1) Mara: ability(magic-sensing revealed)
(S12:1) Mara: truth(bridge-burning confession resolved)

[DIALOGUE]
(S15:1) "I can feel it — like a hum under my skin." —Mara | reveals magic sensing

[VOICE]
Ivo: "witch nose"(teasing-affectionate)

[ANCHORS]
(S12:1) bell toll|auditory|hunter proximity warning

[CALLBACKS]
(S12:1) bell toll|planted(S12:1)|hunters arrive?|status: UNFIRED
(S15:1) magic sensing|planted(S15:1)|what can Mara sense?|status: DEVELOPING

[THREADS]
(S15:2) landslide blockage|status: ACTIVE|intro S15:2|last S15:2|need alternate route
(S12:1) hunter pursuit|status: DEVELOPING|intro S12:1|last S12:1|bell toll suggests proximity

[SCENES]
(S12:1) Mara's voice broke as she told Ivo about the bridge. His silence lasted three heartbeats before he reached for her hand. "Then we go together." The bell tolled once from the valley below — distant but clear.

[CURRENT]
Mountain Pass Entrance|Dawn|Mara, Ivo|Blocked by landslide; must find alternate route|Hunters may be approaching (bell toll)|Determined but anxious|Both uninjured

Omitted: NSFW (none present).
Calibration: 🔴 confession pivot only; magic reveal 🟠 (new capability); landslide 🟡 (obstacle); departure 🟢 (routine transit).
===END===
===END EXAMPLE===

===OUTPUT FORMAT===
# MEMORY SHARD: [ID]-MASTER

[KEY]
#=TIMELINE xref |🔴>🟠>🟡>🟢>⚪ | REL:0-100 scale
Sources: [message range or input identifier]

[TONE]
Genre: X | Style: X | POV: X | Boundaries: X

[CHARACTERS]
Name (canonical)|aliases|role|physical(3-5)|abilities|status

[WORLD]
category: facts (magic-system, political, geographic, temporal, cultural)

[TIMELINE]
(S{X}:{N}) anchor phrase, location

[EVENTS]
(S{X}:{N}) [Weight] action → consequence → outcome

[STATES] (point-in-time emotional/physical snapshots)
(S{X}:{N}) pos|char|emo:keywords|phys:keywords

[RELATIONSHIPS]
(S{X}:{N}) [A]→[B]: trust=N, intimacy=N, tension=N, hostility=N, dependency=N, affection=N, lust=N, protectiveness=N | notes

[DEVELOPMENTS] (irreversible character growth / world changes)
(S{X}:{N}) char: type(specifics)

[NSFW]
(S{X}:{N}) participants | act
[VERBATIM prose block — never compress]

[DIALOGUE] (specific plot-relevant quotes from scenes)
(S{X}:{N}) "quote" —speaker | context

[VOICE] (reusable character speech patterns/mannerisms)
char: "quote"(tone), "quote"(tone)

[ANCHORS] (recurring sensory/environmental details, not plot events)
(S{X}:{N}) detail|sense|significance

[CALLBACKS]
(S{X}:{N}) element|planted(#)|payoff|status: UNFIRED|DEVELOPING|FIRED

[THREADS]
(S{X}:{N}) thread|status: UNRESOLVED|DEVELOPING|ACTIVE|RESOLVED|FORESHADOWED|intro#|last#|notes

[SCENES]
(S{X}:{N}) [50-150w prose paragraph for 🔴critical moments only]

[CURRENT] (latest snapshot — most recent state of the story)
Location|Time|Present|Situation|Pending|Mood|Physical

Before outputting, verify: (a) every entry traces to explicit source text, (b) section caps respected, (c) no CALLBACK/THREAD duplication, (d) relationships use absolute values 0-100, (e) [CURRENT] uses latest state only, (f) no invented quotes in VOICE or DIALOGUE, (g) terminated with ===END===.
===END===`;

/**
 * Get sharder prompts with fallback to defaults
 */
export function getSharderPrompts(settings, profileOverride = null) {
    const profile = normalizeSharderProfile(profileOverride || settings?.sharderProfile);
    if (profile === ARCHITECTURAL_PROFILE) {
        return {
            prompt: settings.architecturalSharderPrompts?.prompt || DEFAULT_ARCHITECTURAL_SHARDER_PROMPT,
            profile,
        };
    }

    return {
        prompt: settings.sharderPrompts?.prompt || DEFAULT_SHARDER_PROMPT,
        profile: NARRATIVE_PROFILE,
    };
}

/**
 * Ensure sharder prompts exist in settings
 */
export function ensureSharderPrompts(settings) {
    let changed = false;
    if (!settings.sharderPrompts) {
        settings.sharderPrompts = {
            prompt: DEFAULT_SHARDER_PROMPT,
        };
        changed = true;
    } else {
        // Fill in any missing prompts with defaults
        if (!settings.sharderPrompts.prompt) {
            settings.sharderPrompts.prompt = DEFAULT_SHARDER_PROMPT;
            changed = true;
        }
    }

    if (!settings.architecturalSharderPrompts) {
        settings.architecturalSharderPrompts = {
            prompt: DEFAULT_ARCHITECTURAL_SHARDER_PROMPT,
        };
        changed = true;
    } else if (!settings.architecturalSharderPrompts.prompt) {
        settings.architecturalSharderPrompts.prompt = DEFAULT_ARCHITECTURAL_SHARDER_PROMPT;
        changed = true;
    }

    if (changed) {
        saveSettings(settings);
    }
}

/**
 * Ensure at least one prompt exists
 */
export function ensureDefaultPrompt(settings) {
    if (!Array.isArray(settings.prompts) || settings.prompts.length === 0) {
        settings.prompts = [{
            name: 'Default Prompt',
            content: DEFAULT_PROMPT
        }];
        settings.activePromptName = 'Default Prompt';
        saveSettings(settings);
    }
}

/**
 * Get the currently active prompt content
 */
export function getActivePrompt(settings) {
    const found = settings.prompts.find(p => p.name === settings.activePromptName);
    return found ? found.content : '';
}

/**
 * Add a new prompt
 */
export function addPrompt(settings, name, content = '') {
    settings.prompts.push({ name, content });
    settings.activePromptName = name;
    saveSettings(settings);
}

/**
 * Export prompts as JSON
 */
export function exportPrompts(settings) {
    const dataStr = 'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(settings.prompts, null, 2));
    const dl = document.createElement('a');
    dl.href = dataStr;
    dl.download = 'summary-sharder-prompts.json';
    dl.click();
}

/**
 * Import prompts from JSON file
 */
export function importPrompts(settings, file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                settings.prompts = imported;
                if (!imported.some(p => p.name === settings.activePromptName)) {
                    settings.activePromptName = imported[0]?.name || '';
                }
                saveSettings(settings);
                if (callback) callback(true);
                toastr.success('Prompts imported successfully');
            } else {
                toastr.error('Invalid prompts file format');
                if (callback) callback(false);
            }
        } catch (err) {
            toastr.error('Error parsing prompts file: ' + err.message);
            if (callback) callback(false);
        }
    };
    reader.readAsText(file);
}

