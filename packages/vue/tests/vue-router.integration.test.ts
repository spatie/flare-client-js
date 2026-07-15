// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

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

import { traceVueRouter } from '../src/traceVueRouter';

const stub = { render: () => null };
function makeRouter(extra: Parameters<typeof createRouter>[0]['routes'] = []): Router {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'products', component: stub },
            { path: '/product/:id', name: 'product', component: stub },
            { path: '/cart', name: 'cart', component: stub },
            { path: '/blocked', name: 'blocked', component: stub },
            { path: '/user/:id', component: stub, children: [{ path: 'profile', component: stub }] },
            { path: '/old', redirect: '/cart' },
            ...extra,
        ],
    });
}
function mountWith(router: Router): void {
    createApp({ render: () => null }).use(router);
}

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

describe('traceVueRouter against a real vue-router', () => {
    it('names the pageload root from the initial route and opens no nav root', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/', source: 'route' });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('opens a held nav root with the destination url and settles the parameterized name', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        nav.startNavigation.mockClear();
        await router.push('/product/p01');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.startNavigation.mock.calls[0]![0]).toMatchObject({ path: '/product/p01', hold: true });
        expect(nav.startNavigation.mock.calls[0]![0].url).toBe(`${window.location.origin}/product/p01`);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/product/:id', source: 'route' });
    });

    it('names a nested child route with the absolute parameterized template', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        nav.settleNavigation.mockClear();
        await router.push('/user/u01/profile');
        // Confirms vue-router normalizes the child's relative `path` to the full absolute template —
        // the one runtime behavior the spec flagged as unpinned (matched[last].path, not chain-joined).
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/user/:id/profile', source: 'route' });
    });

    it('names a truly unmatched route from its path with url source', async () => {
        const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: stub }] });
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        nav.settleNavigation.mockClear();
        await router.push('/does/not/exist').catch(() => {});
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/does/not/exist', source: 'url' });
    });

    it('follows a route-config redirect and settles the final target (one nav root)', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        nav.startNavigation.mockClear();
        await router.push('/old');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/cart', source: 'route' });
    });

    it('follows a guard-returned redirect (one nav root, final name)', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        router.beforeEach((to) => (to.path === '/product/p01' ? '/cart' : undefined));
        mountWith(router);
        await router.isReady();
        nav.startNavigation.mockClear();
        await router.push('/product/p01');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/cart', source: 'route' });
    });

    it('settles an aborted navigation to the current location', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        router.beforeEach((to) => (to.path === '/blocked' ? false : undefined));
        mountWith(router);
        await router.isReady();
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();
        await router.push('/blocked');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({ name: '/', source: 'route' });
    });

    it('emits no nav span for a plain duplicated navigation', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        await router.push('/cart');
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();
        await router.push('/cart');
        expect(nav.startNavigation).not.toHaveBeenCalled();
        expect(nav.settleNavigation).not.toHaveBeenCalled();
    });

    it('skips a force re-navigation to the current location (no nav root)', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        await router.push('/cart');
        nav.startNavigation.mockClear();
        // force: true re-runs guards for the same location, so beforeEach DOES fire with
        // to.fullPath === from.fullPath — the same-location skip must suppress it (distinct from the
        // plain-duplicate case above, which never reaches beforeEach at all).
        await router.push({ path: '/cart', force: true });
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });

    it('releases the held root when a guard throws (onError)', async () => {
        const router = makeRouter();
        traceVueRouter(router);
        router.beforeEach((to) => {
            if (to.path === '/product/p01') throw new Error('guard boom');
        });
        mountWith(router);
        await router.isReady();
        nav.startNavigation.mockClear();
        nav.settleNavigation.mockClear();
        await router.push('/product/p01').catch(() => {});
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenCalledTimes(1);
    });

    it('names the pageload immediately when installed after the router is ready', async () => {
        const router = makeRouter();
        mountWith(router);
        await router.isReady();
        traceVueRouter(router);
        expect(nav.setActiveRouteName).toHaveBeenCalledWith({ name: '/', source: 'route' });
        nav.startNavigation.mockClear();
        await router.push('/cart');
        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
    });

    it('cleanup removes the guards and unregisters the nav source', async () => {
        const router = makeRouter();
        const stop = traceVueRouter(router);
        mountWith(router);
        await router.isReady();
        stop();
        expect(nav.unregister).toHaveBeenCalledTimes(1);
        nav.startNavigation.mockClear();
        await router.push('/cart');
        expect(nav.startNavigation).not.toHaveBeenCalled();
    });
});
