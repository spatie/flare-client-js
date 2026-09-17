// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { hashRouteBase, normalizeRouteBase, routeName, stripBasename } from '../src/instrumentation/navigation';

afterEach(() => {
    window.history.replaceState({}, '', '/');
});

describe('normalizeRouteBase', () => {
    it.each([
        [undefined, ''],
        ['', ''],
        ['/', ''],
        ['/app', '/app'],
        ['/app/', '/app'],
        ['/app//', '/app'],
        ['/agent/certificates/#', '/agent/certificates/#'],
        ['/agent/certificates/#/', '/agent/certificates/#'],
        ['/agent/certificates/?tab=1#', '/agent/certificates/#'],
        ['/#', '/#'],
        ['#', '#'],
        ['/agent/#/certificates/', '/agent/#/certificates'],
    ])('%j gives %j', (base, expected) => {
        expect(normalizeRouteBase(base)).toBe(expected);
    });
});

describe('hashRouteBase', () => {
    it('uses the page path in front of the #', () => {
        window.history.replaceState({}, '', '/agent/certificates/?tab=1#/abc');
        expect(normalizeRouteBase(hashRouteBase())).toBe('/agent/certificates/#');
    });

    it('adds the basename after the #', () => {
        window.history.replaceState({}, '', '/agent/#/certificates/abc');
        expect(normalizeRouteBase(hashRouteBase('/certificates/'))).toBe('/agent/#/certificates');
    });
});

describe('routeName with a base', () => {
    it.each([
        ['', '/product/:id', '/product/:id'],
        ['/app', '/product/:id', '/app/product/:id'],
        ['/app', '/', '/app/'],
        ['/app', 'product/:id', '/app/product/:id'],
        ['/agent/certificates/#', '/:certificateId', '/agent/certificates/#/:certificateId'],
    ])('base %j and template %j give %j', (base, template, expected) => {
        expect(routeName(() => template, '/unused', undefined, base)).toEqual({ name: expected, source: 'route' });
    });

    it('puts the base in front of the fallback path too', () => {
        expect(routeName(() => undefined, '/nope', undefined, '/app')).toEqual({ name: '/app/nope', source: 'url' });
    });

    it('keeps the name unchanged without a base', () => {
        expect(routeName(() => '/product/:id', '/product/p01')).toEqual({ name: '/product/:id', source: 'route' });
    });
});

describe('stripBasename', () => {
    it.each([
        ['/app/product/p01', '/app', '/product/p01'],
        ['/app/product/p01', '/app/', '/product/p01'],
        ['/app', '/app', '/'],
        ['/app/', '/app', '/'],
        ['/application/x', '/app', '/application/x'],
        ['/product/p01', '/app', '/product/p01'],
        ['/product/p01', '/', '/product/p01'],
        ['/product/p01', undefined, '/product/p01'],
    ])('%j without %j gives %j', (pathname, basename, expected) => {
        expect(stripBasename(pathname, basename)).toBe(expected);
    });
});
