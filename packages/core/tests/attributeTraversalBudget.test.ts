import { describe, expect, it } from 'vitest';

import { attributesToOpenTelemetry } from '../src/logging/otel';
import { flatJsonStringify, safeClone } from '../src/util';
import { MAX_TRAVERSAL_DEPTH, MAX_TRAVERSAL_NODES, TRUNCATED } from '../src/util/traversalBudget';

// Shares one child under two keys per level. Not a cycle, so ancestor-path detection never fires.
function sharedGraph(depth: number): unknown {
    let node: unknown = { leaf: 1 };
    for (let i = 0; i < depth; i++) {
        node = { a: node, b: node };
    }
    return node;
}

// The same shape over a wide primitive leaf. Every 2^depth path re-walks all `width` strings, so this
// stays bounded only if primitives are charged against the budget.
function sharedGraphOverWideLeaf(depth: number, width: number): unknown {
    const leaf = Array.from({ length: width }, (_, i) => `v${i}`);
    let node: unknown = leaf;
    for (let i = 0; i < depth; i++) {
        node = { a: node, b: node };
    }
    return node;
}

// Counts output nodes, giving up early so a runaway result is not fully materialized into a count.
function countNodes(value: unknown, limit: number): number {
    let count = 0;
    const stack: unknown[] = [value];
    while (stack.length > 0 && count <= limit) {
        const current = stack.pop();
        count++;
        if (Array.isArray(current)) {
            stack.push(...current);
        } else if (current !== null && typeof current === 'object') {
            stack.push(...Object.values(current));
        }
    }
    return count;
}

function hasTruncation(value: unknown): boolean {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === TRUNCATED) {
            return true;
        }
        if (Array.isArray(current)) {
            stack.push(...current);
        } else if (current !== null && typeof current === 'object') {
            stack.push(...Object.values(current));
        }
    }
    return false;
}

describe('attribute traversal is bounded', () => {
    it('truncates a shared graph whose primitive leaves blow past the budget', () => {
        // 2^6 arrays x 1000 strings = 64k leaf visits. Under the old budget these were free, so nothing truncated.
        const converted = attributesToOpenTelemetry({ payload: sharedGraphOverWideLeaf(6, 1000) as never });

        expect(hasTruncation(converted)).toBe(true);
    });

    it('safeClone truncates the same shape in json mode', () => {
        expect(hasTruncation(safeClone(sharedGraphOverWideLeaf(6, 1000), { mode: 'json' }))).toBe(true);
    });

    it('keeps the output bounded for a graph that used to exhaust the heap', () => {
        // The reported input: 15 shared objects over 1000 strings. It produced ~50M output nodes.
        const converted = attributesToOpenTelemetry({ payload: sharedGraphOverWideLeaf(15, 1000) as never });

        expect(countNodes(converted, MAX_TRAVERSAL_NODES * 4)).toBeLessThanOrEqual(MAX_TRAVERSAL_NODES * 4);
    });

    it('shares one budget across every attribute of a span', () => {
        const wide = () => Array.from({ length: 20_000 }, (_, i) => i);
        const converted = attributesToOpenTelemetry({ a: wide(), b: wide(), c: wide() });

        expect(hasTruncation(converted.find((entry) => entry.key === 'a'))).toBe(false);
        expect(hasTruncation(converted.find((entry) => entry.key === 'c'))).toBe(true);
    });

    it('a deep shared graph converts in bounded time instead of 2^depth', () => {
        const start = performance.now();
        attributesToOpenTelemetry({ graph: sharedGraph(30) as never });
        expect(performance.now() - start).toBeLessThan(300);
    });

    it('flatJsonStringify survives the same shape', () => {
        const start = performance.now();
        const json = flatJsonStringify({ graph: sharedGraph(30) });
        expect(performance.now() - start).toBeLessThan(300);
        expect(json).toContain(TRUNCATED);
    });

    it('marks where it stopped rather than silently dropping branches', () => {
        let node: unknown = { leaf: 1 };
        for (let i = 0; i < MAX_TRAVERSAL_DEPTH + 5; i++) {
            node = { next: node };
        }
        expect(JSON.stringify(attributesToOpenTelemetry({ deep: node as never }))).toContain(TRUNCATED);
    });

    it('leaves a payload of ordinary size untouched', () => {
        const value = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, tags: ['a', 'b'] })) };
        const converted = JSON.stringify(attributesToOpenTelemetry({ value: value as never }));
        expect(converted).not.toContain(TRUNCATED);
    });

    it('does not truncate a realistic error report payload', () => {
        // Charging primitives makes the cap bite sooner, so guard the shape real hosts actually send.
        const payload = {
            user: { id: 4211, name: 'Ada Lovelace', email: 'ada@example.com', roles: ['admin', 'editor'] },
            request: {
                url: 'https://shop.example.com/checkout?step=payment',
                method: 'POST',
                headers: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`x-header-${i}`, `value-${i}`])),
                body: { cart: Array.from({ length: 20 }, (_, i) => ({ sku: `sku-${i}`, qty: i, price: i * 1.5 })) },
            },
            breadcrumbs: Array.from({ length: 30 }, (_, i) => ({
                message: `step ${i}`,
                level: 'info',
                time: 1_700_000_000 + i,
                meta: { route: '/checkout', attempt: i },
            })),
            env: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`FLAG_${i}`, i % 2 === 0])),
        };

        expect(countNodes(payload, 5000)).toBeLessThan(1000);
        expect(hasTruncation(attributesToOpenTelemetry({ context: payload as never }))).toBe(false);
        expect(hasTruncation(safeClone(payload, { mode: 'json' }))).toBe(false);
    });
});
