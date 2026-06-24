import { isArchivedMessage } from './archive-policy.js';

export function parseIgnoreNames(namesStr) {
    if (!namesStr || typeof namesStr !== 'string') {
        return [];
    }
    return namesStr.split(',')
        .map(name => name.trim().toLowerCase())
        .filter(name => name.length > 0);
}

export function shouldIgnoreMessage(message, ignoreNames) {
    if (!message || !message.name || ignoreNames.length === 0) {
        return false;
    }
    return ignoreNames.includes(message.name.toLowerCase());
}

export function buildDesiredVisibilityState(messages = [], ranges = [], settings = {}) {
    const shouldCollapse = settings.collapseAll || settings.makeAllInvisible;
    const globalNames = parseIgnoreNames(settings.globalIgnoreNames || '');
    const desiredState = messages.map(message => ({
        isSystem: isArchivedMessage(message),
        collapsed: false,
    }));
    const ignoreCollapseSet = new Set();

    for (const range of ranges) {
        if (range.start < 0 || range.end < range.start || range.start >= messages.length) {
            continue;
        }

        const effectiveHidden = range.hidden !== undefined ? range.hidden : settings.hideAllSummarized;
        const rangeNames = parseIgnoreNames(range.ignoreNames || '');
        const allIgnoreNames = [...new Set([...globalNames, ...rangeNames])];
        const rangeIgnoreCollapse = range.ignoreCollapse || false;

        for (let index = range.start; index <= range.end && index < messages.length; index++) {
            const message = messages[index];
            const state = desiredState[index];
            if (!message || !state || isArchivedMessage(message)) {
                continue;
            }

            if (effectiveHidden) {
                state.isSystem = !shouldIgnoreMessage(message, allIgnoreNames);
            } else {
                state.isSystem = false;
            }

            if (rangeIgnoreCollapse) {
                ignoreCollapseSet.add(index);
                state.collapsed = false;
            }
        }
    }

    if (shouldCollapse) {
        for (let index = 0; index < desiredState.length; index++) {
            if (desiredState[index].isSystem && !ignoreCollapseSet.has(index) && !isArchivedMessage(messages[index])) {
                desiredState[index].collapsed = true;
            }
        }
    }

    return desiredState;
}

export function detectHiddenRangesFromMessages(messages = []) {
    const ranges = [];
    let rangeStart = null;

    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (!message) {
            continue;
        }

        const isSummarizedHidden = message.is_system === true && !isArchivedMessage(message);
        if (isSummarizedHidden) {
            if (rangeStart === null) {
                rangeStart = index;
            }
        } else if (rangeStart !== null) {
            ranges.push({
                start: rangeStart,
                end: index - 1,
                hidden: true,
                ignoreCollapse: false,
                ignoreNames: '',
            });
            rangeStart = null;
        }
    }

    if (rangeStart !== null) {
        ranges.push({
            start: rangeStart,
            end: messages.length - 1,
            hidden: true,
            ignoreCollapse: false,
            ignoreNames: '',
        });
    }

    return ranges;
}
