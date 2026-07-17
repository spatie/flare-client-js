// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { absoluteHref } from '../src/tracing/absoluteHref';

beforeEach(() => {
    window.history.replaceState({}, '', '/');
});

describe('absoluteHref', () => {
    it('resolves a root-relative href against the current origin', () => {
        expect(absoluteHref('/product/p01')).toBe(`${window.location.origin}/product/p01`);
    });

    it('keeps a base path the router already applied', () => {
        expect(absoluteHref('/app/product/p01')).toBe(`${window.location.origin}/app/product/p01`);
    });

    // The href a hash-history router hands us has no leading slash, so it only resolves correctly
    // against the current page. Building it as origin + href would give a URL with no path at all.
    it('resolves a hash-history href against the current page', () => {
        window.history.replaceState({}, '', '/index.html');
        expect(absoluteHref('#/product/p01')).toBe(`${window.location.origin}/index.html#/product/p01`);
    });

    it('passes an already absolute href through', () => {
        expect(absoluteHref('https://other.example/x')).toBe('https://other.example/x');
    });

    it('keeps the query string', () => {
        expect(absoluteHref('/product/p01?tab=specs')).toBe(`${window.location.origin}/product/p01?tab=specs`);
    });

    // Callers use undefined to mean "leave the url attribute alone", so a bad href must not become
    // a url that is merely wrong.
    it('returns undefined rather than a wrong url', () => {
        expect(absoluteHref('http://[')).toBeUndefined();
        expect(absoluteHref(undefined)).toBeUndefined();
        expect(absoluteHref(null)).toBeUndefined();
    });
});
