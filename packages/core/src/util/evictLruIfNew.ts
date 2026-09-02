// Insertion order is LRU, so the first key is the one to drop.
// Only evicts when key is new. A set() that overwrites an existing key must not evict something else to
// make room for it.
export function evictLruIfNew<V>(map: Map<string, V>, key: string, cap: number): void {
    if (map.has(key) || map.size < cap) {
        return;
    }
    const lru = map.keys().next().value;
    if (lru !== undefined) {
        map.delete(lru);
    }
}
