import { describe, expect, it } from 'vitest';

import { attributesToOpenTelemetry } from '../src/logging/otel';
import { flatJsonStringify } from '../src/util';
import { MAX_TRAVERSAL_DEPTH, TRUNCATED } from '../src/util/traversalBudget';

/** Shares one child under two keys per level. Not a cycle, so ancestor-path detection never fires. */
function sharedGraph(depth: number): unknown {
    let node: unknown = { leaf: 1 };
    for (let i = 0; i < depth; i++) {
        node = { a: node, b: node };
    }
    return node;
}

describe('attribute traversal is bounded', () => {
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
});
