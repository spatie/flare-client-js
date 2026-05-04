import { describe, expect, test } from 'vitest';

import { flatJsonStringify } from '../src/util/flatJsonStringify';

describe('flatJsonStringify', () => {
    test('preserves shared (non-cyclic) sub-objects on both branches', () => {
        const inner = { x: 1 };
        const obj = { a: inner, b: inner };

        const parsed = JSON.parse(flatJsonStringify(obj));

        expect(parsed).toEqual({ a: { x: 1 }, b: { x: 1 } });
    });

    test('replaces real cycles with a sentinel rather than silently dropping the field', () => {
        const obj: { a: number; self?: unknown } = { a: 1 };
        obj.self = obj;

        const parsed = JSON.parse(flatJsonStringify(obj));

        expect(parsed.a).toBe(1);
        expect(parsed.self).toBe('[Circular]');
    });

    test('does not throw on cyclic structures', () => {
        const obj: { self?: unknown } = {};
        obj.self = obj;

        expect(() => flatJsonStringify(obj)).not.toThrow();
    });
});
