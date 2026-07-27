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
});
