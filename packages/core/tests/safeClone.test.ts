import { describe, expect, it } from 'vitest';

import { safeClone } from '../src/util/safeClone';

const DISPLAY = {
    mode: 'display',
    maxDepth: 2,
    arrayCap: 100,
    objectKeyCap: 100,
    stringCap: 1000,
    denylist: /secret/i,
} as const;

describe('safeClone json mode', () => {
    it('replaces cycles with [Circular]', () => {
        const a: Record<string, unknown> = {};
        a.self = a;
        expect(safeClone(a, { mode: 'json' })).toEqual({ self: '[Circular]' });
    });

    it('coerces BigInt to its decimal string', () => {
        expect(safeClone({ n: 10n }, { mode: 'json' })).toEqual({ n: '10' });
    });

    it('replaces a throwing getter with [Getter threw]', () => {
        const o = {
            get boom() {
                throw new Error('x');
            },
            safe: 1,
        };
        expect(safeClone(o, { mode: 'json' })).toEqual({ boom: '[Getter threw]', safe: 1 });
    });

    it('passes a Date through so JSON.stringify can call toJSON', () => {
        const d = new Date('2020-01-01T00:00:00.000Z');
        const cloned = safeClone({ d }, { mode: 'json' }) as { d: Date };
        expect(cloned.d).toBe(d);
        expect(JSON.stringify(cloned)).toBe('{"d":"2020-01-01T00:00:00.000Z"}');
    });

    it('passes a function through so JSON.stringify drops it', () => {
        expect(JSON.stringify(safeClone({ fn: () => 1, x: 2 }, { mode: 'json' }))).toBe('{"x":2}');
    });
});

describe('safeClone display mode', () => {
    it('replaces functions, symbols, and non-plain objects with placeholders', () => {
        const out = safeClone({ fn: () => 1, sym: Symbol('s'), date: new Date() }, DISPLAY);
        expect(out).toEqual({ fn: '[Function]', sym: '[Symbol]', date: '[Object]' });
    });

    it('redacts denylisted keys and truncates over-depth', () => {
        const out = safeClone({ secret: 'abc', deep: { a: { b: { c: 1 } } } }, DISPLAY) as Record<string, unknown>;
        expect(out.secret).toBe('[redacted]');
        expect(out.deep).toEqual({ a: { b: '[Object]' } });
    });

    it('caps arrays and object keys', () => {
        const arr = safeClone(
            Array.from({ length: 101 }, (_, i) => i),
            { ...DISPLAY, arrayCap: 2 },
        ) as unknown[];
        expect(arr).toEqual([0, 1, '[… 99 more items]']);
    });
});
