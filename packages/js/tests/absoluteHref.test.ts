// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { absoluteHref, absoluteUrl } from '../src/tracing/utils';

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

    // A hash-history href has no leading slash, so it only resolves correctly against the current
    // page. origin + href alone would give a URL with no path.
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

    // Callers use undefined to mean "leave the url attribute alone". A bad href must become
    // undefined, not a wrong url.
    it('returns undefined rather than a wrong url', () => {
        expect(absoluteHref('http://[')).toBeUndefined();
        expect(absoluteHref(undefined)).toBeUndefined();
        expect(absoluteHref(null)).toBeUndefined();
    });
});

describe('absoluteUrl', () => {
    it('returns a URL, so the caller gets href and pathname without parsing twice', () => {
        const url = absoluteUrl('/product/p01?tab=specs');
        expect(url?.href).toBe(`${window.location.origin}/product/p01?tab=specs`);
        expect(url?.pathname).toBe('/product/p01');
    });

    it('is undefined for an unparseable or absent href, matching absoluteHref', () => {
        expect(absoluteUrl('http://[')).toBeUndefined();
        expect(absoluteUrl(undefined)).toBeUndefined();
        expect(absoluteUrl(null)).toBeUndefined();
    });
});
