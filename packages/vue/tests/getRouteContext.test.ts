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

    describe('serialization of params and query', () => {
        test('redacts access_token in query via the default denylist', () => {
            const router = createMockRouter({
                name: 'oauth',
                path: '/oauth/callback',
                fullPath: '/oauth/callback?access_token=xyz&state=abc',
                params: {},
                query: { access_token: 'xyz', state: 'abc' },
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router)!.query).toEqual({
                access_token: '[Redacted]',
                state: 'abc',
            });
        });

        test('redacts keys matching the denylist in query', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/',
                fullPath: '/',
                params: {},
                query: { token: 'xyz', safe: 'ok' },
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router)!.query).toEqual({ token: '[Redacted]', safe: 'ok' });
        });

        test('redacts keys matching the denylist in params', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/',
                fullPath: '/',
                params: { sessionId: 'z', id: '42' },
                query: {},
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router)!.params).toEqual({ sessionId: '[Redacted]', id: '42' });
        });

        test('accepts a custom denylist', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/',
                fullPath: '/',
                params: {},
                query: { ssn: '123', token: 'kept' },
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router, { denylist: /^ssn$/ })!.query).toEqual({
                ssn: '[Redacted]',
                token: 'kept',
            });
        });
    });

    describe('redaction of fullPath query string', () => {
        test('redacts denylisted keys in fullPath while keeping safe keys intact', () => {
            const router = createMockRouter({
                name: 'user-profile',
                path: '/users/77',
                fullPath: '/users/77?token=sk_secret_123&session_id=sess_abc&tab=public&tag=a&tag=b',
                params: { id: '77' },
                query: {
                    token: 'sk_secret_123',
                    session_id: 'sess_abc',
                    tab: 'public',
                    tag: ['a', 'b'],
                },
                hash: '',
                matched: [{ name: 'user-profile' }],
            });

            expect(getRouteContext(router)!.fullPath).toBe(
                '/users/77?token=[Redacted]&session_id=[Redacted]&tab=public&tag=a&tag=b'
            );
        });

        test('preserves hash when redacting fullPath', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/secure',
                fullPath: '/secure?token=abc&page=2#section',
                params: {},
                query: { token: 'abc', page: '2' },
                hash: '#section',
                matched: [],
            });

            expect(getRouteContext(router)!.fullPath).toBe('/secure?token=[Redacted]&page=2#section');
        });

        test('leaves fullPath untouched when there is no query string', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/about',
                fullPath: '/about#team',
                params: {},
                query: {},
                hash: '#team',
                matched: [],
            });

            expect(getRouteContext(router)!.fullPath).toBe('/about#team');
        });

        test('redacts fullPath using a custom denylist', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/',
                fullPath: '/?ssn=123&token=kept',
                params: {},
                query: { ssn: '123', token: 'kept' },
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router, { denylist: /^ssn$/ })!.fullPath).toBe('/?ssn=[Redacted]&token=kept');
        });

        test('handles keyless query entries without a value', () => {
            const router = createMockRouter({
                name: 'r',
                path: '/',
                fullPath: '/?token&page=1',
                params: {},
                query: { token: null, page: '1' },
                hash: '',
                matched: [],
            });

            expect(getRouteContext(router)!.fullPath).toBe('/?token&page=1');
        });
    });
});
