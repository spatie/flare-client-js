import { describe, expect, test } from 'vitest';

import { flatJsonStringify } from '../src/util';

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

    test('serializes a bigint as its string form instead of throwing', () => {
        const obj = { big: 10n, huge: 12345678901234567890n, nested: { deep: 42n } };

        expect(() => flatJsonStringify(obj)).not.toThrow();

        const parsed = JSON.parse(flatJsonStringify(obj));

        expect(parsed).toEqual({ big: '10', huge: '12345678901234567890', nested: { deep: '42' } });
    });

    test('replaces a throwing enumerable getter with a sentinel instead of throwing', () => {
        const obj = {
            safe: 1,
            get boom(): unknown {
                throw new Error('getter blew up');
            },
        };

        expect(() => flatJsonStringify(obj)).not.toThrow();

        const parsed = JSON.parse(flatJsonStringify(obj));

        expect(parsed.safe).toBe(1);
        expect(parsed.boom).toBe('[Getter threw]');
    });
});
