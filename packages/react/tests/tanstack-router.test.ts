// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', async () => (await import('@flareapp/test-helpers')).browserSeamMock(nav));

import { traceTanStackRouter } from '../src/tanstack-router';
import type { TsrMatch } from '../src/vendor/tanstackRouterTypes';

const PRODUCT_MATCHES: TsrMatch[] = [{ routeId: '__root__' }, { routeId: '/product/$id', fullPath: '/product/$id' }];

function fakeRouter(opts: { matches?: TsrMatch[]; location?: { pathname: string; search: unknown } } = {}) {
    const subs: Record<string, (e: unknown) => void> = {};
    const unsub = { onBeforeLoad: vi.fn(), onResolved: vi.fn() };
    const router = {
        state: { location: opts.location ?? { pathname: '/', search: {} } },
        matchRoutes: vi.fn(() => opts.matches ?? PRODUCT_MATCHES),
        subscribe: vi.fn((type: 'onBeforeLoad' | 'onResolved', cb: (e: unknown) => void) => {
            subs[type] = cb;
            return unsub[type];
        }),
    };
    return { router, unsub, emit: (type: string, e: unknown) => subs[type]?.(e) };
}

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.unregister.mockClear();
});

// Every RouteName now carries the destination url so the root's url.full tracks redirect hops. These
// fakes omit TanStack's `href`, so hrefOf falls back to origin + pathname (the `href` shape is
// pinned separately below).
const u = (path: string): string => `${window.location.origin}${path}`;

describe('traceTanStackRouter', () => {
    it('enriches the pageload root from the current location at registration', () => {
        const { router } = fakeRouter({ location: { pathname: '/product/p01', search: {} } });
        traceTanStackRouter(router);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: '/product/$id',
            source: 'route',
            url: u('/product/p01'),
        });
    });

    it('corrects the pageload name on the initial onResolved (loader redirect), no nav root', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockReturnValue([
            { routeId: '__root__' },
            { routeId: '/login', fullPath: '/login' },
        ]);
        emit('onResolved', { fromLocation: undefined, toLocation: { pathname: '/login', search: {} } });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/login', source: 'route', url: u('/login') });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('starts one navigation root on a real navigation and finalizes on resolve', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        const from = { pathname: '/', search: {}, state: {} };
        const to = { pathname: '/product/p01', search: {}, state: {} };
        emit('onBeforeLoad', { fromLocation: from, toLocation: to });
        expect(nav.startNavigation).toHaveBeenCalledWith({ path: '/product/p01' });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: '/product/$id',
            source: 'route',
            url: u('/product/p01'),
        });
        emit('onResolved', { fromLocation: from, toLocation: to });
        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: '/product/$id',
            source: 'route',
            url: u('/product/p01'),
        });
    });

    it('skips the initial pageload onBeforeLoad', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        emit('onBeforeLoad', { fromLocation: undefined, toLocation: { pathname: '/', search: {} } });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('skips a no-op reload (identical location state)', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        const state = {};
        emit('onBeforeLoad', {
            fromLocation: { pathname: '/x', search: {}, state },
            toLocation: { pathname: '/x', search: {}, state },
        });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('a redirect chain produces exactly one navigation root, renamed per hop', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        const from = { pathname: '/', search: {}, state: {} };
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockReturnValue([
            { routeId: '__root__' },
            { routeId: '/a', fullPath: '/a' },
        ]);
        emit('onBeforeLoad', { fromLocation: from, toLocation: { pathname: '/a', search: {}, state: {} } });
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockReturnValue([
            { routeId: '__root__' },
            { routeId: '/b', fullPath: '/b' },
        ]);
        emit('onBeforeLoad', { fromLocation: from, toLocation: { pathname: '/b', search: {}, state: {} } });
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        emit('onResolved', { fromLocation: from, toLocation: { pathname: '/b', search: {}, state: {} } });
        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/b', source: 'route', url: u('/b') });
    });

    it('falls back to the URL name when only __root__ matches', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockReturnValue([{ routeId: '__root__' }]);
        emit('onBeforeLoad', {
            fromLocation: { pathname: '/', search: {}, state: {} },
            toLocation: { pathname: '/nope', search: {}, state: {} },
        });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/nope', source: 'url', url: u('/nope') });
    });

    it('falls back to routeId when fullPath is empty', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockReturnValue([
            { routeId: '__root__' },
            { routeId: '/layout', fullPath: '' },
        ]);
        emit('onBeforeLoad', {
            fromLocation: { pathname: '/', search: {}, state: {} },
            toLocation: { pathname: '/layout', search: {}, state: {} },
        });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/layout', source: 'route', url: u('/layout') });
    });

    // TanStack's real ParsedLocation.href is pathname + search + hash WITHOUT the origin, so the
    // integration must prepend it. Taking `pathname` instead would silently drop the query string.
    it("builds the url from TanStack's origin-relative href, not the bare pathname", () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        emit('onBeforeLoad', {
            fromLocation: { pathname: '/', search: {}, href: '/', state: {} },
            toLocation: {
                pathname: '/product/p01',
                search: { tab: 'specs' },
                href: '/product/p01?tab=specs',
                state: {},
            },
        });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: '/product/$id',
            source: 'route',
            url: u('/product/p01?tab=specs'),
        });
    });

    it('cleanup unsubscribes and unregisters', () => {
        const { router, unsub } = fakeRouter();
        const stop = traceTanStackRouter(router);
        stop();
        expect(unsub.onBeforeLoad).toHaveBeenCalled();
        expect(unsub.onResolved).toHaveBeenCalled();
        expect(nav.unregister).toHaveBeenCalled();
    });

    it('falls back to the URL name when matchRoutes throws', () => {
        const { router, emit } = fakeRouter();
        traceTanStackRouter(router);
        nav.setActiveRouteName.mockClear();
        (router.matchRoutes as ReturnType<typeof vi.fn>).mockImplementation(() => {
            throw new Error('router boom');
        });
        expect(() =>
            emit('onBeforeLoad', {
                fromLocation: { pathname: '/', search: {}, state: {} },
                toLocation: { pathname: '/kaboom', search: {}, state: {} },
            }),
        ).not.toThrow();
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/kaboom', source: 'url', url: u('/kaboom') });
    });
});
