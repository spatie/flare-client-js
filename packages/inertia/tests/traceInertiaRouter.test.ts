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
