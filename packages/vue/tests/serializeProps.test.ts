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

    describe('size caps', () => {
        test('truncates strings longer than the cap', () => {
            const long = 'a'.repeat(1500);

            const result = serializeProps({ body: long }, 2) as { body: string };

            expect(result.body.startsWith('a'.repeat(1000))).toBe(true);
            expect(result.body.endsWith('…[truncated 500 chars]')).toBe(true);
        });

        test('leaves strings at the cap untouched', () => {
            const atLimit = 'a'.repeat(1000);

            expect(serializeProps({ body: atLimit }, 2)).toEqual({ body: atLimit });
        });

        test('caps array length and appends a summary indicator', () => {
            const arr = Array.from({ length: 150 }, (_, i) => i);

            const result = serializeProps({ items: arr }, 3) as { items: unknown[] };

            expect(result.items).toHaveLength(101);
            expect(result.items.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => i));
            expect(result.items[100]).toBe('[… 50 more items]');
        });

        test('does not append an indicator for arrays at or below the cap', () => {
            const arr = Array.from({ length: 100 }, (_, i) => i);

            const result = serializeProps({ items: arr }, 3) as { items: unknown[] };

            expect(result.items).toHaveLength(100);
        });

        test('caps object key count and adds a summary entry', () => {
            const big: Record<string, number> = {};
            for (let i = 0; i < 150; i++) {
                big[`k${i}`] = i;
            }

            const result = serializeProps({ data: big }, 3) as { data: Record<string, unknown> };
            const keys = Object.keys(result.data);

            expect(keys).toHaveLength(101);
            expect(keys.slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => `k${i}`));
            expect(result.data['…']).toBe('[50 more keys]');
        });

        test('does not add a summary for objects at or below the cap', () => {
            const exact: Record<string, number> = {};
            for (let i = 0; i < 100; i++) {
                exact[`k${i}`] = i;
            }

            const result = serializeProps(exact, 3) as Record<string, unknown>;

            expect(Object.keys(result)).toHaveLength(100);
            expect('…' in result).toBe(false);
        });
    });

    describe('denylist', () => {
        test('redacts default sensitive keys regardless of case', () => {
            expect(
                serializeProps(
                    {
                        password: 'hunter2',
                        Token: 'abc',
                        apiKey: 'xyz',
                        api_key: 'xyz',
                        authorization: 'Bearer ...',
                        cookie: 'sid=1',
                        sessionId: 'z',
                        csrfToken: 't',
                        xsrfToken: 't',
                        credentials: { u: 'a' },
                        auth: 'value',
                    },
                    5
                )
            ).toEqual({
                password: '[Redacted]',
                Token: '[Redacted]',
                apiKey: '[Redacted]',
                api_key: '[Redacted]',
                authorization: '[Redacted]',
                cookie: '[Redacted]',
                sessionId: '[Redacted]',
                csrfToken: '[Redacted]',
                xsrfToken: '[Redacted]',
                credentials: '[Redacted]',
                auth: '[Redacted]',
            });
        });

        test('redacts nested keys matched by the default denylist', () => {
            expect(serializeProps({ user: { id: 1, password: 'p', nested: { token: 't' } } }, 5)).toEqual({
                user: { id: 1, password: '[Redacted]', nested: { token: '[Redacted]' } },
            });
        });

        test('passes non-denylisted keys through untouched', () => {
            expect(serializeProps({ username: 'alice', authorName: 'bob' }, 2)).toEqual({
                username: 'alice',
                authorName: 'bob',
            });
        });

        test('does not match "auth" as a substring of unrelated keys', () => {
            expect(serializeProps({ author: 'x', authorship: 'y' }, 2)).toEqual({
                author: 'x',
                authorship: 'y',
            });
        });

        test('accepts a custom denylist that replaces the default', () => {
            expect(serializeProps({ password: 'p', foo: 'x', bar: 'y' }, 2, /^foo$/)).toEqual({
                password: 'p',
                foo: '[Redacted]',
                bar: 'y',
            });
        });

        test('applies a custom denylist at every depth', () => {
            expect(serializeProps({ outer: { inner: { token: 't', safe: 'ok' } } }, 5, /token/i)).toEqual({
                outer: { inner: { token: '[Redacted]', safe: 'ok' } },
            });
        });
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
