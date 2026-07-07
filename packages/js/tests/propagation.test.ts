import { describe, expect, it } from 'vitest';

import { safeAbsolute } from '../src/tracing/httpRequestSpan';
import { mergeTraceparentHeader, shouldPropagate } from '../src/tracing/propagation';

const ORIGIN = 'https://app.example';

describe('shouldPropagate', () => {
    it('allows same-origin and relative URLs by default', () => {
        expect(
            shouldPropagate('https://app.example/api', safeAbsolute('https://app.example/api', ORIGIN), ORIGIN),
        ).toBe(true);
        expect(shouldPropagate('/api/products', safeAbsolute('/api/products', ORIGIN), ORIGIN)).toBe(true);
    });

    it('blocks cross-origin URLs by default', () => {
        expect(
            shouldPropagate('https://other.example/api', safeAbsolute('https://other.example/api', ORIGIN), ORIGIN),
        ).toBe(false);
    });

    it('honors an explicit allow-list (string includes + RegExp)', () => {
        expect(
            shouldPropagate('https://other.example/api', safeAbsolute('https://other.example/api', ORIGIN), ORIGIN, [
                'other.example',
            ]),
        ).toBe(true);
        expect(
            shouldPropagate(
                'https://other.example/graphql',
                safeAbsolute('https://other.example/graphql', ORIGIN),
                ORIGIN,
                [/\/graphql$/],
            ),
        ).toBe(true);
        expect(
            shouldPropagate('https://other.example/api', safeAbsolute('https://other.example/api', ORIGIN), ORIGIN, [
                /\/graphql$/,
            ]),
        ).toBe(false);
    });

    it('empty allow-list disables all injection, including same-origin', () => {
        expect(
            shouldPropagate('https://app.example/api', safeAbsolute('https://app.example/api', ORIGIN), ORIGIN, []),
        ).toBe(false);
    });
});

describe('mergeTraceparentHeader', () => {
    const TP = '00-abc-def-01';

    it('synthesizes an init when the caller passed none', () => {
        const init = mergeTraceparentHeader('https://app.example/x', undefined, TP);
        expect((init.headers as Record<string, string>).traceparent).toBe(TP);
    });

    it('merges into a plain-object headers init', () => {
        const init = mergeTraceparentHeader('https://app.example/x', { headers: { a: '1' } }, TP);
        expect(init.headers).toEqual({ a: '1', traceparent: TP });
    });

    it('merges into an array-of-tuples headers init', () => {
        const init = mergeTraceparentHeader('https://app.example/x', { headers: [['a', '1']] }, TP);
        expect(init.headers).toEqual([
            ['a', '1'],
            ['traceparent', TP],
        ]);
    });

    it('clones a Headers instance without mutating the original', () => {
        const original = new Headers({ a: '1' });
        const init = mergeTraceparentHeader('https://app.example/x', { headers: original }, TP);
        expect((init.headers as Headers).get('traceparent')).toBe(TP);
        expect(original.get('traceparent')).toBeNull(); // not mutated
    });

    it('reads headers from a Request input without mutating it', () => {
        const req = new Request('https://app.example/x', { headers: { a: '1' } });
        const init = mergeTraceparentHeader(req, undefined, TP);
        expect((init.headers as Headers).get('traceparent')).toBe(TP);
        expect((init.headers as Headers).get('a')).toBe('1');
        expect(req.headers.get('traceparent')).toBeNull(); // caller's Request untouched
    });

    it('replaces a caller-supplied traceparent in an array init (no duplicate on the wire)', () => {
        const init = mergeTraceparentHeader('https://app.example/x', { headers: [['traceparent', 'old']] }, TP);
        expect(init.headers).toEqual([['traceparent', TP]]);
    });

    it('merges into a Map headers init without dropping caller headers', () => {
        const headers = new Map([
            ['authorization', 'Bearer token'],
            ['a', '1'],
        ]);
        const init = mergeTraceparentHeader(
            'https://app.example/x',
            { headers: headers as unknown as HeadersInit },
            TP,
        );
        expect(init.headers).toEqual([
            ['authorization', 'Bearer token'],
            ['a', '1'],
            ['traceparent', TP],
        ]);
    });

    it('does not mutate the caller-supplied Map', () => {
        const headers = new Map([['a', '1']]);
        mergeTraceparentHeader('https://app.example/x', { headers: headers as unknown as HeadersInit }, TP);
        expect([...headers]).toEqual([['a', '1']]);
    });

    it('replaces a case-variant traceparent in a Map init (no duplicate on the wire)', () => {
        const headers = new Map([
            ['TraceParent', 'old'],
            ['a', '1'],
        ]);
        const init = mergeTraceparentHeader(
            'https://app.example/x',
            { headers: headers as unknown as HeadersInit },
            TP,
        );
        expect(init.headers).toEqual([
            ['a', '1'],
            ['traceparent', TP],
        ]);
    });

    it('merges into a URLSearchParams-shaped iterable init', () => {
        const headers = new URLSearchParams({ a: '1' });
        const init = mergeTraceparentHeader(
            'https://app.example/x',
            { headers: headers as unknown as HeadersInit },
            TP,
        );
        expect(init.headers).toEqual([
            ['a', '1'],
            ['traceparent', TP],
        ]);
    });

    it('passes a throwing iterable through untouched instead of throwing out of fetch', () => {
        const headers: Iterable<unknown> = {
            *[Symbol.iterator]() {
                yield ['a', '1'];
                throw new Error('broken iterable');
            },
        };
        const init = mergeTraceparentHeader('https://app.example/x', { headers: headers as HeadersInit }, TP);
        expect(init.headers).toBe(headers);
    });

    it('passes an iterable with malformed pairs through untouched', () => {
        const headers = new Map<string, string>([['a', '1']]);
        const malformed: Iterable<unknown> = {
            *[Symbol.iterator]() {
                yield* headers;
                yield ['too', 'many', 'parts'];
            },
        };
        const init = mergeTraceparentHeader('https://app.example/x', { headers: malformed as HeadersInit }, TP);
        expect(init.headers).toBe(malformed);
    });

    it('replaces a case-variant traceparent in an object init', () => {
        const init = mergeTraceparentHeader('https://app.example/x', { headers: { TraceParent: 'old', a: '1' } }, TP);
        expect(init.headers).toEqual({ a: '1', traceparent: TP });
    });

    it('preserves duplex for a stream-bodied Request so fetch does not throw', () => {
        const body = new ReadableStream();
        const req = new Request('https://app.example/x', {
            method: 'POST',
            body,
            duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        const init = mergeTraceparentHeader(req, undefined, TP);
        expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
    });

    it('leaves duplex untouched for a bodyless Request', () => {
        const req = new Request('https://app.example/x');
        const init = mergeTraceparentHeader(req, undefined, TP);
        expect((init as RequestInit & { duplex?: string }).duplex).toBeUndefined();
    });
});
