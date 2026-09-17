// @vitest-environment jsdom
import {
    absoluteAddressBarUrl,
    ROUTER_BASE_CASES,
    visitAddressBarPath,
    type RouterBaseCase,
} from '@flareapp/test-helpers';
import {
    createBrowserHistory,
    createHashHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
    startNavigation: vi.fn(),
    setActiveRouteName: vi.fn(),
    settleNavigation: vi.fn(),
    unregister: vi.fn(),
}));
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()),
);

import { traceTanStackRouter } from '../src/tanstack-router';

function makeRouter(testCase: RouterBaseCase) {
    const rootRoute = createRootRoute();
    const routeTree = rootRoute.addChildren([
        createRoute({ getParentRoute: () => rootRoute, path: '/' }),
        createRoute({ getParentRoute: () => rootRoute, path: 'product/$id' }),
    ]);
    if (testCase.mode === 'hash') {
        return createRouter({ routeTree, history: createHashHistory() });
    }
    return createRouter({ routeTree, history: createBrowserHistory(), basepath: testCase.base });
}

// TanStack only reports a navigation (and fires `onResolved`) from a mounted RouterProvider.
async function boot(testCase: RouterBaseCase, routerPath: string, includeRouterBase?: boolean) {
    visitAddressBarPath(testCase, routerPath);
    const router = makeRouter(testCase);
    traceTanStackRouter(router, { includeRouterBase });
    await act(async () => {
        render(createElement(RouterProvider, { router } as Parameters<typeof RouterProvider>[0]));
    });
    return router;
}

async function navigateToProduct(router: ReturnType<typeof makeRouter>): Promise<void> {
    await act(async () => {
        await router.navigate({ to: '/product/$id', params: { id: 'p01' } });
    });
}

beforeEach(() => {
    window.scrollTo = vi.fn();
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
});

describe.each(ROUTER_BASE_CASES)('traceTanStackRouter router base: $title', (testCase) => {
    const productUrl = () => absoluteAddressBarUrl(testCase, '/product/p01');

    it('keeps the name without the base by default', async () => {
        const router = await boot(testCase, '/');
        await navigateToProduct(router);

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: '/product/$id',
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the pageload name', async () => {
        await boot(testCase, '/product/p01', true);

        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/$id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the navigation name', async () => {
        const router = await boot(testCase, '/', true);
        await navigateToProduct(router);

        expect(nav.startNavigation).toHaveBeenCalledTimes(1);
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/$id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of an unmatched path', async () => {
        await boot(testCase, '/nope', true);

        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/nope`,
            source: 'url',
            url: absoluteAddressBarUrl(testCase, '/nope'),
        });
    });
});
