import { describe, expect, it } from 'vitest';

import { mergeTraceparentHeader, shouldPropagate } from '../src/tracing/propagation';

const ORIGIN = 'https://app.example';

describe('shouldPropagate', () => {
    it('allows same-origin and relative URLs by default', () => {
        expect(shouldPropagate('https://app.example/api', ORIGIN)).toBe(true);
        expect(shouldPropagate('/api/products', ORIGIN)).toBe(true);
    });

    it('blocks cross-origin URLs by default', () => {
        expect(shouldPropagate('https://other.example/api', ORIGIN)).toBe(false);
    });

    it('honors an explicit allow-list (string includes + RegExp)', () => {
        expect(shouldPropagate('https://other.example/api', ORIGIN, ['other.example'])).toBe(true);
        expect(shouldPropagate('https://other.example/graphql', ORIGIN, [/\/graphql$/])).toBe(true);
        expect(shouldPropagate('https://other.example/api', ORIGIN, [/\/graphql$/])).toBe(false);
    });

    it('empty allow-list disables all injection, including same-origin', () => {
        expect(shouldPropagate('https://app.example/api', ORIGIN, [])).toBe(false);
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
});
