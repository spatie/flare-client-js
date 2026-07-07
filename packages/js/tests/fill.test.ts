import { describe, expect, it } from 'vitest';

import { fill, unfill } from '../src/tracing/fill';

describe('fill', () => {
    it('wraps a function and exposes the original', () => {
        const obj: { fn: (x: number) => number } = { fn: (x) => x + 1 };
        fill(obj, 'fn', (orig) => (x: number) => (orig as (x: number) => number)(x) * 2);

        expect(obj.fn(3)).toBe(8); // (3 + 1) * 2
        expect((obj.fn as { __flare_original__?: unknown }).__flare_original__).toBeTypeOf('function');
    });

    it('is idempotent: a second fill is ignored', () => {
        const obj: { fn: (x: number) => number } = { fn: (x) => x + 1 };
        fill(obj, 'fn', (orig) => (x: number) => (orig as (x: number) => number)(x) * 2);
        fill(obj, 'fn', () => () => 0);

        expect(obj.fn(3)).toBe(8); // still the first wrapper
    });

    it('unfill restores the original', () => {
        const obj: { fn: (x: number) => number } = { fn: (x) => x + 1 };
        fill(obj, 'fn', (orig) => (x: number) => (orig as (x: number) => number)(x) * 2);
        unfill(obj, 'fn');

        expect(obj.fn(3)).toBe(4);
        expect((obj.fn as { __flare_original__?: unknown }).__flare_original__).toBeUndefined();
    });

    it('ignores non-function targets', () => {
        const obj: { fn?: number } = { fn: 1 };
        fill(obj as unknown as Record<string, unknown>, 'fn', () => () => 0);
        expect(obj.fn).toBe(1);
    });
});
