export async function resolveSelectedShardsForRun(settings, selectedShards, deps) {
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

    if (compatibleItems.length === 0) {
        return {
            confirmed: true,
            selectedShards: [],
            mode: 'no-compatible',
        };
    }

    if (settings?.autoIncludeShards === true) {
        return {
            confirmed: true,
            selectedShards: parseSelectedShards(compatibleItems, settings),
            mode: 'auto-include',
        };
    }

    const selection = await openShardSelectionModal(settings, compatibleItems);
    return {
        confirmed: selection?.confirmed === true,
        selectedShards: Array.isArray(selection?.selectedShards) ? selection.selectedShards : [],
        mode: 'manual',
    };
}

export async function prepareSharderHeadlessRun(startIndex, endIndex, settings, selectedShards, deps) {
    const selection = await resolveSelectedShardsForRun(settings, selectedShards, deps);
    if (!selection.confirmed) {
        return {
            confirmed: false,
            selectedShards: [],
            mode: selection.mode,
            headless: null,
        };
    }

    const headless = await deps.runSharderHeadless(startIndex, endIndex, settings, selection.selectedShards);
    return {
        confirmed: true,
        selectedShards: selection.selectedShards,
        mode: selection.mode,
        headless,
    };
}
