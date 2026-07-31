// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
// Held separately from browserSeamMock's own so registration itself is assertable, not just what the
// handle is used for. Same shape as packages/vue/tests/vue-router.test.ts.
const registerNavigationSource = vi.hoisted(() => vi.fn(() => nav));
vi.mock('@flareapp/js/browser', async (importOriginal) => ({
    ...(await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
    registerNavigationSource,
}));

import { traceInertiaRouter } from '../src/traceInertiaRouter';
import { createFakeInertiaRouter } from './helpers';

// Same-origin SPA: every url the integration reports is the page origin plus a path.
const u = (path: string): string => `${window.location.origin}${path}`;

// mockReset, not mockClear: clearing keeps any implementation a test installed, so one test making a
// seam throw would leave it throwing for every test after it. Reset also drops queued
// `mockImplementationOnce` values, and it restores the implementation `vi.fn(impl)` was created with,
// so `registerNavigationSource` keeps returning `nav`.
beforeEach(() => {
    nav.startNavigation.mockReset();
    nav.setActiveRouteName.mockReset();
    nav.settleNavigation.mockReset();
    nav.unregister.mockReset();
    registerNavigationSource.mockReset();
});

describe('traceInertiaRouter listener lifecycle', () => {
    it('registers one listener per handled event, and one navigation source', () => {
        const router = createFakeInertiaRouter();

        traceInertiaRouter(router);

        expect(router.listenerCount('start')).toBe(1);
        expect(router.listenerCount('navigate')).toBe(1);
        expect(router.listenerCount('success')).toBe(1);
        expect(router.listenerCount('finish')).toBe(1);
        expect(registerNavigationSource).toHaveBeenCalledTimes(1);
    });

    it('removes every listener and unregisters on cleanup', () => {
        const router = createFakeInertiaRouter();

        const cleanup = traceInertiaRouter(router);
        cleanup();

        expect(router.listenerCount()).toBe(0);
        expect(nav.unregister).toHaveBeenCalledTimes(1);
    });

    it('releases the hold when cleanup runs mid-navigation', () => {
        const router = createFakeInertiaRouter();
        const cleanup = traceInertiaRouter(router);

        router.pendingVisit({ url: '/checkout' });
        expect(nav.startNavigation).toHaveBeenCalledWith(expect.objectContaining({ hold: true }));

        cleanup();

        // unregister is what releases a hold whose settle will never arrive. Without it the root stays
        // idle-suppressed until the 30s finalTimeout.
        expect(router.listenerCount()).toBe(0);
        expect(nav.unregister).toHaveBeenCalledTimes(1);
    });

    it('is inert for a value that is not an Inertia router', () => {
        expect(() => traceInertiaRouter({})()).not.toThrow();
        expect(() => traceInertiaRouter(null)()).not.toThrow();

        // Registering is not a free act: it takes navigation-root detection away from the built-in
        // History listener for the whole page. A value we cannot drive must not reach it, or an app
        // that passes the wrong thing loses navigation tracing entirely instead of keeping the
        // generic kind.
        expect(registerNavigationSource).not.toHaveBeenCalled();
        expect(nav.unregister).not.toHaveBeenCalled();
    });

    // install() runs unwrapped inside instrumentOnce, so a throw from the router's own `on()` would
    // otherwise escape straight into the host's bootstrap code.
    it('never lets a throwing on() reach the host, and unwinds the listeners already registered', () => {
        const router = createFakeInertiaRouter();
        const realOn = router.on;
        router.on = ((event, callback) => {
            if (event === 'success') {
                throw new Error('on boom');
            }
            return realOn(event, callback);
        }) as typeof router.on;

        expect(() => traceInertiaRouter(router)).not.toThrow();

        expect(router.listenerCount()).toBe(0); // the two that already registered are removed
        expect(nav.unregister).toHaveBeenCalledTimes(1);
    });

    it('leaves no live listeners behind after a failed install', () => {
        const router = createFakeInertiaRouter();
        const realOn = router.on;
        router.on = ((event, callback) => {
            if (event === 'success') {
                throw new Error('on boom');
            }
            return realOn(event, callback);
        }) as typeof router.on;
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/products/42', window.location.href) } });

        expect(nav.startNavigation).not.toHaveBeenCalled();
    });
});

describe('successful visits', () => {
    it('opens a held navigation root on start', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/products/42', window.location.href) } });

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation).toHaveBeenCalledWith({
            path: '/products/42',
            url: u('/products/42'),
            hold: true,
        });
    });

    it('settles the root with the page component name on navigate', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.visit({ url: '/products/42', component: 'Products/Show' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Show',
            source: 'route',
            url: u('/products/42'),
        });
    });

    it('falls back to a url-sourced name when the page carries no component', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.visit({ url: '/products/42' });

        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: '/products/42',
            source: 'url',
            url: u('/products/42'),
        });
    });

    // Regression pin, green today. `navigate` must NOT compare the page url against inFlightPath the
    // way `success` and `finish` do: this visit's page is not the page it asked for, and `navigate` is
    // the only event that carries the component name for it.
    it('settles a redirected visit under the page that actually arrived', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        // POST /login -> the server redirects -> the Dashboard page arrives.
        router.redirectedVisit({ url: '/login' }, { url: '/dashboard', component: 'Auth/Dashboard' });

        expect(nav.startNavigation).toHaveBeenCalledWith(expect.objectContaining({ path: '/login', hold: true }));
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Auth/Dashboard',
            source: 'route',
            url: u('/dashboard'),
        });
    });
});

describe('background visits', () => {
    it('opens no root for a prefetch', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.prefetchVisit('/products/42');

        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('opens no root for a background reload of the page we are on', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        // What polling, deferred props, infinite scroll and router.reload() all look like.
        router.backgroundVisit({ url: '/', component: 'Products/Index' });

        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('still opens a root for a deliberate async visit to another page', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/cart', window.location.href), async: true } });

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation).toHaveBeenCalledWith({
            path: '/cart',
            url: u('/cart'),
            hold: true,
        });
    });
});

describe('prefetch cache hits', () => {
    it('opens and settles exactly one root for a prefetch cache hit', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        // A first page has to have been seen, or this reads as the initial load.
        router.visit({ url: '/', component: 'Home' });
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();

        router.cachedVisit({ url: '/product/p01', component: 'Products/Show' });

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0]).toMatchObject({ path: '/product/p01' });
        expect(nav.startNavigation.mock.calls[0]![0].hold).toBeFalsy();
        // The trailing `success` must not settle a second time: `navigate` already cleared inFlight.
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Show',
            source: 'route',
            url: u('/product/p01'),
        });
    });
});

describe('initial page load and history navigation', () => {
    it('names the pageload root from the first bare navigate, opening no root', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.navigateOnly({ url: '/products', component: 'Products/Index' });

        expect(nav.setActiveRouteName).toHaveBeenCalledTimes(1);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: 'Products/Index',
            source: 'route',
            url: u('/products'),
        });
        expect(nav.startNavigation).not.toHaveBeenCalled();
        expect(nav.settleNavigation).not.toHaveBeenCalled();
    });

    it('opens and settles a root for a back/forward step after the initial load', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.navigateOnly({ url: '/products', component: 'Products/Index' }); // initial load
        nav.setActiveRouteName.mockClear();

        router.navigateOnly({ url: '/products/42', component: 'Products/Show' }); // back/forward

        expect(nav.startNavigation).toHaveBeenCalledWith({
            path: '/products/42',
            url: u('/products/42'),
        });
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Show',
            source: 'route',
            url: u('/products/42'),
        });
    });

    it('treats a bare navigate after a real visit as history, not as the initial load', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.visit({ url: '/products/42', component: 'Products/Show' });
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();

        router.navigateOnly({ url: '/products', component: 'Products/Index' });

        expect(nav.setActiveRouteName).not.toHaveBeenCalled();
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('still names the pageload root when a deferred-props reload fires start first', () => {
        // On a page using Inertia::defer(), page.set() kicks off the deferred reload from inside its
        // own promise chain, so that visit's `start` lands before InitialVisit fires `navigate`. The
        // background filter is what keeps it from claiming to be the initial navigation.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/', window.location.href), async: true } });
        router.navigateOnly({ url: '/', component: 'Products/Index' });

        expect(nav.startNavigation).not.toHaveBeenCalled();
        expect(nav.setActiveRouteName).toHaveBeenCalledTimes(1);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: 'Products/Index',
            source: 'route',
            url: u('/'),
        });
    });
});

describe('visits that fire no navigate', () => {
    it('settles a replace visit on success', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.replaceVisit({ url: '/cart', component: 'Cart/Index' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Cart/Index',
            source: 'route',
            url: u('/cart'),
        });
    });

    it('settles a form post that re-renders the page it was sent from', () => {
        // The common same-url shape, and the one the `replace: true` reading of this rule misses:
        // page.url is unchanged, so page.set() forces replace and no navigate fires.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.replaceVisit({ url: '/', component: 'Products/Index' });

        expect(nav.startNavigation).toHaveBeenCalledWith({
            path: '/',
            url: u('/'),
            hold: true,
        });
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Index',
            source: 'route',
            url: u('/'),
        });
    });

    it('does not settle twice when navigate already settled', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.visit({ url: '/products/42', component: 'Products/Show' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('releases the held root on finish when a visit failed', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.failedVisit({ url: '/checkout' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: '/',
            source: 'url',
            url: u('/'),
        });
    });

    it('names a failed visit after the page the browser is on', () => {
        // A validation error fires `error` and never `success`, so the backstop is the only settle.
        // Inertia has already swapped the page in by then, so the browser is on a real page with a
        // component name; reporting the raw url would give /products/42/comments.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.navigateOnly({ url: '/', component: 'Products/Index' }); // initial load
        router.failedVisit({ url: '/products/42/comments' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Products/Index',
            source: 'route',
            url: u('/'),
        });
    });

    it('does not apply a stale lastComponent recorded for a different path', () => {
        // jsdom's location never moves, so here() stays at '/' for the whole suite. Recording
        // lastComponent for a visit to a different path ('/products/42') is therefore the only way to
        // make its recorded path diverge from here(), which is the mismatch branch lastComponent
        // exists for in the first place.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.visit({ url: '/products/42', component: 'Products/Show' }); // records lastComponent
        nav.settleNavigation.mockClear();

        router.failedVisit({ url: '/checkout' }); // backstop runs while here() ('/') != '/products/42'

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: '/',
            source: 'url',
            url: u('/'),
        });
    });
});

describe('background traffic during a navigation', () => {
    it('ignores a background reload that lands mid-navigation', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/checkout', window.location.href) } });
        nav.startNavigation.mockClear();

        // A poll of the page we have not left yet ticks while the navigation is still in flight.
        router.backgroundVisit({ url: '/', component: 'Products/Index' });

        expect(nav.startNavigation).not.toHaveBeenCalled();
        expect(nav.settleNavigation).not.toHaveBeenCalled();
    });

    it('ignores a prefetch that finishes mid-navigation', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/checkout', window.location.href) } });
        router.prefetchVisit('/products/42');

        expect(nav.settleNavigation).not.toHaveBeenCalled();
    });

    it('ignores a background visit whose path matches the in-flight navigation on finish', () => {
        // Real, synchronous navigation whose target happens to be the path jsdom reports as current
        // (jsdom's location never moves over the course of a test, so this is the only way to make a
        // background visit's path collide with inFlightPath rather than with here()). Driven through
        // emit directly, and finish alone: router.backgroundVisit() also fires success, which would
        // settle first through its own path-comparison guard and hide what finish does on its own.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/', window.location.href) } });

        // A poll of that same page finishes mid-navigation.
        router.emit('finish', { visit: { url: new URL('/', window.location.href), async: true } });

        expect(nav.settleNavigation).not.toHaveBeenCalled();
    });

    it('still settles the navigation when its own response arrives', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/checkout', window.location.href) } });
        router.backgroundVisit({ url: '/', component: 'Products/Index' });
        router.emit('navigate', { page: { url: '/checkout', component: 'Checkout/Index' } });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Checkout/Index',
            source: 'route',
            url: u('/checkout'),
        });
    });

    it('settles a redirect-back through the finish backstop, since success cannot tell it apart from a background poll', () => {
        // Posting to /checkout and the server does redirect()->back(): the page lands back on the url
        // the user already had, which forces replace and never fires navigate. success carries no
        // visit, only page, so this looks identical to a background poll of that same page and the
        // guard skips it. finish compares the stable visit.url instead, so the root still settles
        // there, using whatever the fallback naming resolves to. The fake router's visit()/replaceVisit()
        // drivers cannot express this: both derive page url and visit url from one FakeVisit, so this
        // uses emit directly.
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/checkout', window.location.href) } });
        router.emit('success', { page: { url: '/', component: 'Products/Index' } });
        router.emit('finish', { visit: { url: new URL('/checkout', window.location.href) } });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: '/',
            source: 'url',
            url: u('/'),
        });
    });
});

describe('a navigation superseded by a newer one', () => {
    it('opens one root and settles it on the newer destination', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.supersededVisit({ url: '/slow' }, { url: '/fast', component: 'Fast/Show' });

        // Timed from the first click, named after the page that actually arrived.
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation).toHaveBeenCalledWith({
            path: '/slow',
            url: u('/slow'),
            hold: true,
        });
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledWith({
            name: 'Fast/Show',
            source: 'route',
            url: u('/fast'),
        });
    });

    it('re-points the root at the newer destination while it is still in flight', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        router.emit('start', { visit: { url: new URL('/slow', window.location.href) } });
        router.emit('finish', {
            visit: { url: new URL('/slow', window.location.href), interrupted: true },
        });
        router.emit('start', { visit: { url: new URL('/fast', window.location.href) } });

        expect(nav.setActiveRouteName).toHaveBeenCalledWith({
            name: '/fast',
            source: 'url',
            url: u('/fast'),
        });
    });

    it('still settles a visit that was cancelled outright', () => {
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        // router.cancelAll(): nothing follows it, so the held root has to be released here.
        router.cancelledVisit({ url: '/slow' });

        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });
});

describe('re-instrumentation and isolation', () => {
    it('tears down the previous instrumentation when called twice on the same router', () => {
        const router = createFakeInertiaRouter();

        traceInertiaRouter(router);
        traceInertiaRouter(router);

        expect(router.listenerCount()).toBe(4);

        router.visit({ url: '/products/42', component: 'Products/Show' });

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('never lets a throwing seam escape into the host dispatch', () => {
        nav.startNavigation.mockImplementation(() => {
            throw new Error('seam exploded');
        });
        const router = createFakeInertiaRouter();
        traceInertiaRouter(router);

        // No cleanup here on purpose. Undoing it at the end of the body would be skipped the moment
        // this expectation failed, and every later test would then run against a throwing seam. The
        // mockReset in beforeEach handles it whether this passes or not.
        expect(() => router.visit({ url: '/products/42', component: 'Products/Show' })).not.toThrow();
    });
});
