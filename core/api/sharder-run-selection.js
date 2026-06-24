function getCandidateRange(item) {
    const start = Number.isFinite(item?.startIndex)
        ? item.startIndex
        : (Number.isFinite(item?.messageRangeStart) ? item.messageRangeStart : null);
    const end = Number.isFinite(item?.endIndex)
        ? item.endIndex
        : (Number.isFinite(item?.messageRangeEnd) ? item.messageRangeEnd : start);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
    }

    return { start, end };
}

export function annotateShardSelectionCandidates(items, startIndex, endIndex) {
    return (Array.isArray(items) ? items : []).map((item) => {
        const range = getCandidateRange(item);
        const overlapsCurrentRange = range
            ? range.start <= endIndex && range.end >= startIndex
            : (Number.isFinite(item?.messageRangeStart)
                && item.messageRangeStart >= startIndex
                && item.messageRangeStart <= endIndex);

        return {
            ...item,
            startIndex: range?.start ?? item?.startIndex ?? item?.messageRangeStart ?? null,
            endIndex: range?.end ?? item?.endIndex ?? item?.messageRangeEnd ?? item?.messageRangeStart ?? null,
            overlapsCurrentRange,
            selectionEligible: overlapsCurrentRange !== true,
            selectionDisabledReason: overlapsCurrentRange === true
                ? 'Overlaps the current run range. Shown for reference only and unavailable in this run. Go back and revise the message range to use it as a baseline.'
                : null,
        };
    });
}

export async function resolveSelectedShardsForRun(startIndex, endIndex, settings, selectedShards, deps) {
    if (Array.isArray(selectedShards)) {
        return {
            confirmed: true,
            selectedShards,
            mode: 'provided',
        };
    }

    const {
        shouldBypassShardSelectionForRag,
        getActiveSharderProfile,
        findSavedExtractions,
        isSavedShardCompatibleWithProfile,
        parseSelectedShards,
        openShardSelectionModal,
    } = deps;

    if (shouldBypassShardSelectionForRag(settings)) {
        return {
            confirmed: true,
            selectedShards: [],
            mode: 'rag-bypass',
        };
    }

    const activeProfile = getActiveSharderProfile(settings);
    const discoveredItems = await findSavedExtractions(settings, settings?.lorebookSelection || null);
    const compatibleItems = (Array.isArray(discoveredItems) ? discoveredItems : [])
        .filter((item) => isSavedShardCompatibleWithProfile(item, activeProfile));
    const annotatedItems = annotateShardSelectionCandidates(compatibleItems, startIndex, endIndex);
    const eligibleItems = annotatedItems.filter((item) => item.selectionEligible !== false);
    const overlappingItems = annotatedItems.filter((item) => item.overlapsCurrentRange === true);

    if (annotatedItems.length === 0) {
        return {
            confirmed: true,
            selectedShards: [],
            mode: 'no-compatible',
        };
    }

    if (settings?.autoIncludeShards === true) {
        return {
            confirmed: true,
            selectedShards: parseSelectedShards(eligibleItems, settings),
            mode: overlappingItems.length > 0 ? 'auto-include-overlap-filtered' : 'auto-include',
            excludedOverlapCount: overlappingItems.length,
        };
    }

    const selection = await openShardSelectionModal(settings, annotatedItems, {
        startIndex,
        endIndex,
        overlappingCount: overlappingItems.length,
        eligibleCount: eligibleItems.length,
    });
    return {
        confirmed: selection?.confirmed === true,
        selectedShards: Array.isArray(selection?.selectedShards) ? selection.selectedShards : [],
        mode: overlappingItems.length > 0 ? 'manual-overlap-aware' : 'manual',
        excludedOverlapCount: overlappingItems.length,
    };
}
