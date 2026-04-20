import { describe, expect, test } from 'vitest';

import { serializeProps } from '../src/serializeProps';

describe('serializeProps', () => {
    test('passes primitives through unchanged', () => {
        expect(
            serializeProps(
                {
                    str: 'hello',
                    num: 42,
                    bool: true,
                    nul: null,
                    undef: undefined,
                },
                2
            )
        ).toEqual({
            str: 'hello',
            num: 42,
            bool: true,
            nul: null,
            undef: undefined,
        });
    });

    test('replaces functions with "[Function]"', () => {
        expect(serializeProps({ fn: () => 1 }, 2)).toEqual({ fn: '[Function]' });
    });

    test('replaces symbols with "[Symbol]"', () => {
        expect(serializeProps({ sym: Symbol('x') }, 2)).toEqual({ sym: '[Symbol]' });
    });

    test('serializes bigint as a JSON-safe string', () => {
        expect(serializeProps({ big: 10n, huge: 12345678901234567890n }, 2)).toEqual({
            big: '10',
            huge: '12345678901234567890',
        });
    });

    test('recurses into plain objects up to maxDepth', () => {
        expect(serializeProps({ a: { b: { c: 1 } } }, 2)).toEqual({ a: { b: { c: 1 } } });
    });

    test('replaces plain objects at maxDepth with "[Object]"', () => {
        expect(serializeProps({ a: { b: { c: { d: 1 } } } }, 2)).toEqual({ a: { b: { c: '[Object]' } } });
    });

    test('recurses into plain arrays up to maxDepth', () => {
        expect(serializeProps({ a: [1, [2, [3]]] }, 3)).toEqual({ a: [1, [2, [3]]] });
    });

    test('replaces plain arrays at maxDepth with "[Array]"', () => {
        expect(serializeProps({ a: [[[[1]]]] }, 2)).toEqual({ a: [['[Array]']] });
    });

    test('serializes top-level values at depth 1 with maxDepth 0', () => {
        expect(serializeProps({ obj: { a: 1 }, arr: [1, 2] }, 0)).toEqual({ obj: '[Object]', arr: '[Array]' });
    });

    test('keeps primitives at any maxDepth, including 0', () => {
        expect(serializeProps({ a: 1, b: 'x' }, 0)).toEqual({ a: 1, b: 'x' });
    });

    test('marks direct self-reference as "[Circular]"', () => {
        const input: Record<string, unknown> = { name: 'loop' };
        input.self = input;

        expect(serializeProps(input, 5)).toEqual({ name: 'loop', self: '[Circular]' });
    });

    test('marks indirect circular reference as "[Circular]"', () => {
        const a: Record<string, unknown> = { label: 'a' };
        const b: Record<string, unknown> = { label: 'b' };
        a.next = b;
        b.next = a;

        expect(serializeProps({ a }, 10)).toEqual({ a: { label: 'a', next: { label: 'b', next: '[Circular]' } } });
    });

    test('does not mark diamond shapes (non-circular repeats) as circular', () => {
        const shared = { id: 1 };

        expect(serializeProps({ left: shared, right: shared }, 3)).toEqual({
            left: { id: 1 },
            right: { id: 1 },
        });
    });

    test('collapses Date to "[Object]"', () => {
        expect(serializeProps({ d: new Date(0) }, 5)).toEqual({ d: '[Object]' });
    });

    test('collapses RegExp to "[Object]"', () => {
        expect(serializeProps({ re: /abc/ }, 5)).toEqual({ re: '[Object]' });
    });

    test('collapses Map to "[Object]"', () => {
        expect(serializeProps({ m: new Map([['a', 1]]) }, 5)).toEqual({ m: '[Object]' });
    });

    test('collapses Set to "[Object]"', () => {
        expect(serializeProps({ s: new Set([1, 2]) }, 5)).toEqual({ s: '[Object]' });
    });

    test('collapses class instances to "[Object]"', () => {
        class Widget {
            constructor(public name: string) {}
        }

        expect(serializeProps({ w: new Widget('x') }, 5)).toEqual({ w: '[Object]' });
    });

    test('treats Object.create(null) as a plain object', () => {
        const bare = Object.create(null);
        bare.a = 1;

        expect(serializeProps({ bare }, 5)).toEqual({ bare: { a: 1 } });
    });

    test('ignores symbol-keyed properties on input', () => {
        const sym = Symbol('hidden');
        const input: Record<string | symbol, unknown> = { a: 1 };
        input[sym] = 'secret';

        expect(serializeProps(input as Record<string, unknown>, 2)).toEqual({ a: 1 });
    });

    test('serializes a mixed tree correctly', () => {
        const obj = {
            user: { id: 1, name: 'x', meta: { createdAt: new Date(0), tags: ['a', 'b'] } },
            callback: () => 0,
            id: Symbol('id'),
            items: [{ a: 1 }, { b: 2 }],
        };

        expect(serializeProps(obj, 2)).toEqual({
            user: { id: 1, name: 'x', meta: { createdAt: '[Object]', tags: '[Array]' } },
            callback: '[Function]',
            id: '[Symbol]',
            items: [{ a: 1 }, { b: 2 }],
        });
    });
});
