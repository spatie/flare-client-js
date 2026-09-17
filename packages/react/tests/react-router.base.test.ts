// @vitest-environment jsdom
import {
    absoluteAddressBarUrl,
    ROUTER_BASE_CASES,
    visitAddressBarPath,
    type RouterBaseCase,
} from '@flareapp/test-helpers';
import { createBrowserRouter, createHashRouter } from 'react-router';
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

import { traceReactRouter } from '../src/react-router';

// A pathless root: with `path: '/'`, React Router matches the root for a 404 and the fallback path
// never runs.
const routes = [{ children: [{ index: true }, { path: 'product/:id' }] }];

// React Router's hash router has no page path option, so the hash cases get it from the address
// bar. The history cases pass the base as the basename.
function boot(testCase: RouterBaseCase, routerPath: string, includeRouterBase?: boolean) {
    visitAddressBarPath(testCase, routerPath);
    const router =
        testCase.mode === 'hash' ? createHashRouter(routes) : createBrowserRouter(routes, { basename: testCase.base });
    traceReactRouter(router, { includeRouterBase });
    return router;
}

let router: ReturnType<typeof boot> | null = null;

beforeEach(() => {
    nav.startNavigation.mockClear();
    nav.setActiveRouteName.mockClear();
    nav.settleNavigation.mockClear();
    nav.unregister.mockClear();
});

afterEach(() => {
    router?.dispose();
    router = null;
    window.history.replaceState({}, '', '/');
});

describe.each(ROUTER_BASE_CASES)('traceReactRouter router base: $title', (testCase) => {
    const productUrl = () => absoluteAddressBarUrl(testCase, '/product/p01');

    it('keeps the name without the base by default', async () => {
        router = boot(testCase, '/');
        await router.navigate('/product/p01');

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: '/product/:id',
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the pageload name', () => {
        router = boot(testCase, '/product/p01', true);

        expect(nav.setActiveRouteName).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/:id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of the navigation name', async () => {
        router = boot(testCase, '/', true);
        await router.navigate('/product/p01');

        expect(nav.startNavigation.mock.calls.at(-1)![0].url).toBe(productUrl());
        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/product/:id`,
            source: 'route',
            url: productUrl(),
        });
    });

    it('puts the base in front of an unmatched path', async () => {
        router = boot(testCase, '/', true);
        await router.navigate('/nope');

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: `${testCase.expectedBase}/nope`,
            source: 'url',
            url: absoluteAddressBarUrl(testCase, '/nope'),
        });
    });
});

describe('traceReactRouter router base: hash router with a basename', () => {
    it('puts the page path, the # and the basename in front of the name', async () => {
        window.history.replaceState({}, '', '/agent/#/certificates/');
        router = createHashRouter(routes, { basename: '/certificates' });
        traceReactRouter(router, { includeRouterBase: true });
        await router.navigate('/product/p01');

        expect(nav.settleNavigation).toHaveBeenLastCalledWith({
            name: '/agent/#/certificates/product/:id',
            source: 'route',
            url: `${window.location.origin}/agent/#/certificates/product/p01`,
        });
    });
});
