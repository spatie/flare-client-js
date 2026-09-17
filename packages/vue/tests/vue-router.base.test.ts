// @vitest-environment jsdom
import {
    absoluteAddressBarUrl,
    ROUTER_BASE_CASES,
    visitAddressBarPath,
    type RouterBaseCase,
} from '@flareapp/test-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createRouter, createWebHashHistory, createWebHistory, type Router } from 'vue-router';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
);

import type { Flare } from '@flareapp/js';

import { flareVue } from '../src/flareVue';
import { traceVueRouter } from '../src/traceVueRouter';

const stub = { render: () => null };

function makeRouter(testCase: RouterBaseCase): Router {
    return createRouter({
        history: testCase.mode === 'hash' ? createWebHashHistory(testCase.base) : createWebHistory(testCase.base),
        routes: [
            { path: '/', component: stub },
            { path: '/product/:id', component: stub },
        ],
    });
}

async function boot(testCase: RouterBaseCase, routerPath: string, includeRouterBase?: boolean): Promise<Router> {
    visitAddressBarPath(testCase, routerPath);
    const router = makeRouter(testCase);
    traceVueRouter(router, { includeRouterBase });
    createApp({ render: () => null }).use(router);
    await router.isReady();
    return router;
}

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

afterEach(() => {
    window.history.replaceState({}, '', '/');
});

describe.each(ROUTER_BASE_CASES)('traceVueRouter router base: $title', (testCase) => {
    const productUrl = () => absoluteAddressBarUrl(testCase, '/product/p01');

    it('keeps the name without the base by default', async () => {
        const router = await boot(testCase, '/');
        await router.push('/product/p01');

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: '/product/:id',
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the pageload name', async () => {
        await boot(testCase, '/product/p01', true);

        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/:id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the navigation name', async () => {
        const router = await boot(testCase, '/', true);
        await router.push('/product/p01');

        expect(nav.startNavigation.mock.calls.at(-1)![0].url).toBe(productUrl());
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/:id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of an unmatched path', async () => {
        const router = await boot(testCase, '/', true);
        await router.push('/nope');

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/nope`,
            source: 'url',
            url: absoluteAddressBarUrl(testCase, '/nope'),
        });
    });
});

describe('flareVue includeRouterBase', () => {
    it('passes the option to the router tracing', async () => {
        const testCase = ROUTER_BASE_CASES.find((c) => c.title === 'hash, sub path')!;
        visitAddressBarPath(testCase, '/product/p01');
        const router = makeRouter(testCase);
        const flare = { setFramework: vi.fn() } as unknown as Flare;
        createApp({ render: () => null })
            .use(router)
            .use(flareVue, { flare, router, includeRouterBase: true });
        await router.isReady();

        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith(
            expect.objectContaining({ name: '/agent/certificates/#/product/:id' }),
        );
    });
});
