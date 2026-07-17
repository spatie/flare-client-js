// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
const registerNavigationSource = vi.hoisted(() => vi.fn(() => nav));
vi.mock('@flareapp/js/browser', async (importOriginal) => ({
    ...(await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
    registerNavigationSource,
}));

import { traceVueRouter } from '../src/traceVueRouter';

type Loc = { path: string; fullPath: string; matched: { path: string }[] };
type Guard = (...a: any[]) => unknown;

function fakeRouter(current: Loc | undefined) {
    let before: Guard[] = [];
    let after: Guard[] = [];
    let error: Guard[] = [];
    return {
        currentRoute: { value: current },
        beforeEach: (g: Guard) => {
            before.push(g);
            return () => {
                before = before.filter((x) => x !== g);
            };
        },
        afterEach: (g: Guard) => {
            after.push(g);
            return () => {
                after = after.filter((x) => x !== g);
            };
        },
        onError: (g: Guard) => {
            error.push(g);
            return () => {
                error = error.filter((x) => x !== g);
            };
        },
        fireBefore: (to: Loc, from: Loc) => before.forEach((g) => g(to, from)),
        fireAfter: (to: Loc, from: Loc, failure?: { type: number }) => after.forEach((g) => g(to, from, failure)),
        fireError: () => error.forEach((g) => g()),
        counts: () => ({ before: before.length, after: after.length, error: error.length }),
    };
}

const home: Loc = { path: '/', fullPath: '/', matched: [{ path: '/' }] };
const product: Loc = { path: '/product/p01', fullPath: '/product/p01', matched: [{ path: '/product/:id' }] };
const cart: Loc = { path: '/cart', fullPath: '/cart', matched: [{ path: '/cart' }] };
const blocked: Loc = { path: '/blocked', fullPath: '/blocked', matched: [{ path: '/blocked' }] };
const START: Loc = { path: '/', fullPath: '/', matched: [] };

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
    registerNavigationSource.mockClear();
});

// Every RouteName now carries the destination url so the root's url.full follows a redirect hop to
// its final target instead of keeping the URL the navigation opened with. Same-origin SPA: origin + fullPath.
const u = (path: string): string => `${window.location.origin}${path}`;

describe('traceVueRouter edge cases', () => {
    it('is inert for a non-router value (no registration, no-op cleanup)', () => {
        const stop = traceVueRouter({});
        expect(registerNavigationSource).not.toHaveBeenCalled();
        expect(() => stop()).not.toThrow();
    });

    it('keeps the held root on a cancelled nav and settles when the successor succeeds', () => {
        const router = fakeRouter(home);
        traceVueRouter(router);
        router.fireBefore(product, home); // open held, name product (inFlight)
        router.fireBefore(cart, home); // superseding nav → re-name cart, no new root
        router.fireAfter(product, home, { type: 8 }); // cancelled → keep
        router.fireAfter(cart, home, undefined); // success → settle cart
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/cart', source: 'route', url: u('/cart') });
    });

    it('tears down prior instrumentation when the same router is re-instrumented (HMR)', () => {
        const router = fakeRouter(home);
        traceVueRouter(router);
        expect(router.counts()).toEqual({ before: 1, after: 1, error: 1 });
        traceVueRouter(router); // re-instrument the SAME router
        expect(router.counts()).toEqual({ before: 1, after: 1, error: 1 }); // prior removed, not doubled
        expect(nav.unregister).toHaveBeenCalledTimes(1); // prior nav source released
    });

    it('falls back to an empty name on onError when there is no current route', () => {
        const router = fakeRouter(undefined); // currentRoute.value is undefined
        traceVueRouter(router); // must not throw on install-time enrichment either
        router.fireBefore(product, home); // client nav (home has matched → not initial): opens held root
        router.fireError();
        // No current route => no destination href, so `url` is omitted and the root keeps the URL it
        // opened with. Re-stamping url.full to something wrong is worse than leaving it alone.
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '', source: 'url' });
    });

    it('keeps a blocked initial navigation in pageload naming until the first success', () => {
        const router = fakeRouter(START); // START_LOCATION-like: empty matched → sawInitial stays false
        traceVueRouter(router);
        router.fireBefore(blocked, START); // treated as pageload naming, no nav root
        router.fireAfter(blocked, START, { type: 4 }); // aborted initial → still no nav root, sawInitial stays false
        router.fireBefore(product, START); // from is still START: aborted nav never committed
        router.fireAfter(product, START, undefined); // success → finalizes the pageload name
        expect(nav.startNavigation).not.toHaveBeenCalled();
        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: '/product/:id',
            source: 'route',
            url: u('/product/p01'),
        });
    });
});
