import { describe, expect, test } from 'vitest';

import { getRouteContext } from '../src/getRouteContext';

function createMockRouter(route: Record<string, unknown>) {
    return { currentRoute: { value: route } };
}

describe('getRouteContext', () => {
    test('returns null when router is null', () => {
        expect(getRouteContext(null)).toBeNull();
    });

    test('returns null when router is undefined', () => {
        expect(getRouteContext(undefined)).toBeNull();
    });

    test('returns null when router is not an object', () => {
        expect(getRouteContext('string')).toBeNull();
        expect(getRouteContext(42)).toBeNull();
    });

    test('returns null when router has no currentRoute', () => {
        expect(getRouteContext({})).toBeNull();
    });

    test('returns null when currentRoute has no value', () => {
        expect(getRouteContext({ currentRoute: {} })).toBeNull();
    });

    test('returns null when currentRoute.value is null', () => {
        expect(getRouteContext({ currentRoute: { value: null } })).toBeNull();
    });

    test('extracts route context from a valid router', () => {
        const router = createMockRouter({
            name: 'user-profile',
            path: '/users/42',
            fullPath: '/users/42?tab=settings',
            params: { id: '42' },
            query: { tab: 'settings' },
            hash: '',
            matched: [{ name: 'AppLayout' }, { name: 'UserProfile' }],
        });

        expect(getRouteContext(router)).toEqual({
            name: 'user-profile',
            path: '/users/42',
            fullPath: '/users/42?tab=settings',
            params: { id: '42' },
            query: { tab: 'settings' },
            hash: '',
            matched: ['AppLayout', 'UserProfile'],
        });
    });

    test('returns null name when route name is not a string or symbol', () => {
        const router = createMockRouter({
            name: undefined,
            path: '/',
            fullPath: '/',
            params: {},
            query: {},
            hash: '',
            matched: [],
        });

        expect(getRouteContext(router)!.name).toBeNull();
    });

    test('converts symbol route name to string', () => {
        const sym = Symbol('my-route');
        const router = createMockRouter({
            name: sym,
            path: '/',
            fullPath: '/',
            params: {},
            query: {},
            hash: '',
            matched: [],
        });

        expect(getRouteContext(router)!.name).toBe(sym.toString());
    });

    test('converts symbol matched record names to string', () => {
        const sym = Symbol('layout');
        const router = createMockRouter({
            name: 'home',
            path: '/',
            fullPath: '/',
            params: {},
            query: {},
            hash: '',
            matched: [{ name: sym }, { name: 'Home' }],
        });

        expect(getRouteContext(router)!.matched).toEqual([sym.toString(), 'Home']);
    });

    test('uses "unknown" for matched records without a name', () => {
        const router = createMockRouter({
            name: 'home',
            path: '/',
            fullPath: '/',
            params: {},
            query: {},
            hash: '',
            matched: [{ name: undefined }, {}],
        });

        expect(getRouteContext(router)!.matched).toEqual(['unknown', 'unknown']);
    });

    test('defaults to empty values when route properties are missing', () => {
        const router = createMockRouter({});

        expect(getRouteContext(router)).toEqual({
            name: null,
            path: '',
            fullPath: '',
            params: {},
            query: {},
            hash: '',
            matched: [],
        });
    });

    test('handles route with hash and query params', () => {
        const router = createMockRouter({
            name: 'docs',
            path: '/docs',
            fullPath: '/docs?version=3#api',
            params: {},
            query: { version: '3' },
            hash: '#api',
            matched: [{ name: 'Docs' }],
        });

        const result = getRouteContext(router)!;
        expect(result.hash).toBe('#api');
        expect(result.query).toEqual({ version: '3' });
        expect(result.fullPath).toBe('/docs?version=3#api');
    });
});
