// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', () => ({ registerNavigationSource: vi.fn(() => nav) }));

import { routeNameFromMatches, traceReactRouter } from '../src/react-router';
import type { RRMatch, RRRouterState } from '../src/vendor/reactRouterTypes';

const PRODUCT_MATCHES: RRMatch[] = [
    { route: { path: '/' }, pathname: '/' },
    { route: { path: 'product/:id' }, pathname: '/product/p01' },
];

function fakeRouter(initial: Partial<RRRouterState> = {}) {
    let cb: ((s: RRRouterState) => void) | null = null;
    const unsub = vi.fn();
    const state: RRRouterState = {
        location: { pathname: '/' },
        matches: [],
        navigation: { state: 'idle' },
        initialized: true,
        ...initial,
    };
    const router = {
        state,
        subscribe: vi.fn((fn: (s: RRRouterState) => void) => {
            cb = fn;
            return unsub;
        }),
    };
    return {
        router,
        unsub,
        // Mutate the shared state object (as RR does) then notify.
        emit: (next: Partial<RRRouterState>) => {
            Object.assign(state, next);
            cb?.(state);
        },
    };
}

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

describe('routeNameFromMatches', () => {
    it('joins nested paths into a parameterized template', () => {
        expect(routeNameFromMatches(PRODUCT_MATCHES)).toBe('/product/:id');
    });
    it('names an index route as its parent path', () => {
        expect(
            routeNameFromMatches([
                { route: { path: '/' }, pathname: '/' },
                { route: { index: true }, pathname: '/' },
            ]),
        ).toBe('/');
    });
    it('keeps splats', () => {
        expect(
            routeNameFromMatches([
                { route: { path: '/' }, pathname: '/' },
                { route: { path: '*' }, pathname: '/x' },
            ]),
        ).toBe('/*');
    });
    it('resets the accumulator on an absolute child path', () => {
        expect(
            routeNameFromMatches([
                { route: { path: '/' }, pathname: '/' },
                { route: { path: '/dashboard' }, pathname: '/dashboard' },
                { route: { path: 'settings' }, pathname: '/dashboard/settings' },
            ]),
        ).toBe('/dashboard/settings');
    });
    it('returns undefined when nothing usable matched', () => {
        expect(routeNameFromMatches([{ route: {}, pathname: '/' }])).toBeUndefined();
        expect(routeNameFromMatches([])).toBeUndefined();
    });
});

describe('traceReactRouter', () => {
    it('names the pageload root from the current matches at registration', () => {
        const { router } = fakeRouter({ matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } });
        traceReactRouter(router);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('defers pageload naming to the settle when matches are empty at registration, opening no nav root', () => {
        const { router, emit } = fakeRouter({ initialized: false, matches: [] });
        traceReactRouter(router);
        expect(nav.setActiveRouteName).not.toHaveBeenCalled();
        emit({ initialized: true, matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } });
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('names the pageload from sync matches at registration (before initialize) and opens no nav root for the settle', () => {
        const { router, emit } = fakeRouter({
            initialized: false,
            matches: PRODUCT_MATCHES,
            location: { pathname: '/product/p01' },
        });
        traceReactRouter(router);
        // Named now from the synchronously-resolved matches, not deferred to a later fire.
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
        nav.setActiveRouteName.mockClear();
        // The initialize settle (same location) may re-name but must open no navigation root.
        emit({ initialized: true, matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('treats an initial-load redirect settle as the pageload, not a navigation', () => {
        const { router, emit } = fakeRouter({ initialized: false, matches: [], location: { pathname: '/old' } });
        traceReactRouter(router);
        // Initial load redirects /old -> /product/p01 and settles: this is the pageload, not a nav.
        emit({
            initialized: true,
            navigation: { state: 'idle' },
            matches: PRODUCT_MATCHES,
            location: { pathname: '/product/p01' },
        });
        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({ name: '/product/:id', source: 'route' });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('opens one held nav root on start and settles it with the route name', () => {
        const { router, emit } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        traceReactRouter(router);
        nav.setActiveRouteName.mockClear();

        emit({ navigation: { state: 'loading', location: { pathname: '/product/p01' } } });
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        const arg = nav.startNavigation.mock.calls[0]![0];
        expect(arg.path).toBe('/product/p01');
        expect(arg.hold).toBe(true);
        expect(arg.url).toContain('/product/p01');

        emit({
            navigation: { state: 'idle' },
            matches: PRODUCT_MATCHES,
            location: { pathname: '/product/p01' },
        });
        expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('detects a loader-less navigation (single idle fire, no loading state) via the committed location', () => {
        const { router, emit } = fakeRouter({
            matches: [{ route: { path: '/' }, pathname: '/' }],
            location: { pathname: '/' },
        });
        traceReactRouter(router);
        nav.setActiveRouteName.mockClear();
        // No loading state: location + matches commit in one idle fire (RR short-circuit).
        emit({ navigation: { state: 'idle' }, matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } });
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].path).toBe('/product/p01');
        expect(nav.startNavigation.mock.calls[0]![0].hold).toBeFalsy(); // no loader window -> no hold
        expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('does not double-open on a follow-up same-location fire (scroll restoration etc.)', () => {
        const { router, emit } = fakeRouter({
            matches: [{ route: { path: '/' }, pathname: '/' }],
            location: { pathname: '/' },
        });
        traceReactRouter(router);
        emit({ navigation: { state: 'idle' }, matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } });
        emit({ navigation: { state: 'idle' }, matches: PRODUCT_MATCHES, location: { pathname: '/product/p01' } }); // same location
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
    });

    it('a redirect/superseding sequence produces exactly one startNavigation and one settleNavigation', () => {
        const { router, emit } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        traceReactRouter(router);
        emit({ navigation: { state: 'loading', location: { pathname: '/a' } } });
        emit({ navigation: { state: 'loading', location: { pathname: '/b' } } }); // hop, still in flight
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        emit({
            navigation: { state: 'idle' },
            matches: [
                { route: { path: '/' }, pathname: '/' },
                { route: { path: 'b' }, pathname: '/b' },
            ],
            location: { pathname: '/b' },
        });
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/b', source: 'route' });
    });

    it('falls back to the URL name when matches yield nothing', () => {
        const { router, emit } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        traceReactRouter(router);
        emit({ navigation: { state: 'loading', location: { pathname: '/nope' } } });
        emit({
            navigation: { state: 'idle' },
            matches: [{ route: {}, pathname: '/nope' }],
            location: { pathname: '/nope' },
        });
        expect(nav.settleNavigation).toHaveBeenCalledWith({ name: '/nope', source: 'url' });
    });

    it('opens no nav root for revalidation (navigation.state stays idle)', () => {
        const { router, emit } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        traceReactRouter(router);
        emit({ location: { pathname: '/' } }); // a non-navigation state change (e.g. revalidation/fetcher)
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('cleanup unsubscribes and unregisters', () => {
        const { router, unsub } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        const stop = traceReactRouter(router);
        stop();
        expect(unsub).toHaveBeenCalled();
        expect(nav.unregister).toHaveBeenCalled();
    });

    it('never escapes a tracing error into the router dispatch', () => {
        const { router, emit } = fakeRouter({ matches: [{ route: { path: '/' }, pathname: '/' }] });
        traceReactRouter(router);
        nav.startNavigation.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        expect(() => emit({ navigation: { state: 'loading', location: { pathname: '/x' } } })).not.toThrow();
    });
});
