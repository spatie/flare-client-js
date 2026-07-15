import { createMemoryRouter } from 'react-router';
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', () => ({
    registerNavigationSource: vi.fn(() => nav),
    insulate:
        (fn: (...a: unknown[]) => void) =>
        (...a: unknown[]) => {
            try {
                fn(...a);
            } catch {
                /* swallow */
            }
        },
    safeInvoke: (fn?: (() => void) | null) => {
        try {
            fn?.();
        } catch {
            /* swallow */
        }
    },
}));

import { traceReactRouter } from '../src/react-router';
import type { RRDataRouter } from '../src/vendor/reactRouterTypes';

const routes = [
    {
        path: '/',
        children: [
            { index: true },
            { path: 'product/:id' },
            { path: 'stores/:storeId', children: [{ path: 'products/:productId' }] },
            { path: 'dashboard', children: [{ path: '/dashboard/settings' }] }, // absolute child
            { path: 'submit', action: () => null }, // form-action target (submitting state)
            { path: 'files/*' },
            { path: '*' },
        ],
    },
];

function boot(initialEntries: string[] = ['/']) {
    const router = createMemoryRouter(routes, { initialEntries });
    const stop = traceReactRouter(router as unknown as RRDataRouter);
    // Loader-less initial index route: initialize() settles synchronously, and the pageload is
    // named at registration from sync matches. router.initialize() returns the router (not a
    // promise); navigations below await router.navigate(), which does return one.
    router.initialize();
    return { router, stop };
}

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

describe('traceReactRouter against a real react-router data router', () => {
    it('names the pageload index route at registration', async () => {
        await boot(['/']);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/', source: 'route' });
    });

    it('opens a nav root on a loader-less push and settles it with the parameterized name', async () => {
        const { router } = await boot();
        await router.navigate('/product/p01'); // this route has NO loader -> loader-less path
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].path).toBe('/product/p01');
        expect(nav.startNavigation.mock.calls[0]![0].hold).toBeFalsy(); // no loader window -> no hold
        expect(nav.startNavigation.mock.calls[0]![0].url).toContain('/product/p01');
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('stamps the exact destination url (origin + path + search) on a query-string navigation', async () => {
        const { router } = await boot();
        await router.navigate('/product/p01?tab=specs');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].url).toBe(`${window.location.origin}/product/p01?tab=specs`);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('detects a same-pathname search-only change as a navigation', async () => {
        const { router } = await boot();
        await router.navigate('/product/p01?tab=specs');
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();
        await router.navigate('/product/p01?tab=reviews');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].url).toBe(`${window.location.origin}/product/p01?tab=reviews`);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('detects a same-pathname hash-only change as a navigation and keeps the hash in the url', async () => {
        const { router } = await boot();
        await router.navigate('/product/p01');
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();
        await router.navigate('/product/p01#reviews');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].url).toBe(`${window.location.origin}/product/p01#reviews`);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('reconstructs nested params', async () => {
        const { router } = await boot();
        await router.navigate('/stores/s1/products/p9');
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: '/stores/:storeId/products/:productId',
            source: 'route',
        });
    });

    it('keeps splats', async () => {
        const { router } = await boot();
        await router.navigate('/files/a/b');
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/files/*', source: 'route' });
    });

    it('resolves an absolute-path child route', async () => {
        const { router } = await boot();
        await router.navigate('/dashboard/settings');
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/dashboard/settings', source: 'route' });
    });

    it('handles a REPLACE navigation (not dropped)', async () => {
        const { router } = await boot();
        nav.startNavigation.mockClear();
        await router.navigate('/product/p02', { replace: true });
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('handles a POP back-navigation', async () => {
        const { router } = await boot();
        await router.navigate('/product/p01');
        nav.startNavigation.mockClear();
        await router.navigate(-1); // back to the index route
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/', source: 'route' });
    });

    it('handles a form-action submission (submitting state) as one held root named for its destination', async () => {
        const { router } = await boot();
        await router.navigate('/submit', { formMethod: 'post', formData: new FormData() });
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0].hold).toBe(true); // submitting is a non-idle, loader-shape nav
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/submit', source: 'route' });
    });

    it('names a navigation with an async loader (hold is requested)', async () => {
        const slowRoutes = [
            {
                path: '/',
                children: [
                    { index: true },
                    { path: 'slow', loader: () => new Promise((r) => setTimeout(() => r(null), 20)) },
                ],
            },
        ];
        const router = createMemoryRouter(slowRoutes, { initialEntries: ['/'] });
        traceReactRouter(router as unknown as RRDataRouter);
        router.initialize(); // loader-less index settles synchronously
        await router.navigate('/slow');
        expect(nav.startNavigation.mock.calls.at(-1)![0]).toMatchObject({ hold: true });
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/slow', source: 'route' });
    });
});
