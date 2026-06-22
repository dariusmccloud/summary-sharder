export function excludeArchitecturalResults(results) {
    return (Array.isArray(results) ? results : []).filter(item =>
        String(item?.metadata?.shardProfile || '').trim() !== 'architectural'
    );
}

export function filterResultsByOriginBoundary(results, origin) {
    const ownCollectionId = String(origin?.ownCollectionId || '').trim();
    const collectionId = String(origin?.collectionId || '').trim();
    const chatId = String(origin?.chatId || '').trim();
    const scoped = !!collectionId && !!ownCollectionId && collectionId !== ownCollectionId;
    const filtered = excludeArchitecturalResults(results);

    if (!scoped) {
        return filtered;
    }

    return filtered.filter(item =>
        String(item?.metadata?.originChatId || '').trim() === chatId
    );
}
