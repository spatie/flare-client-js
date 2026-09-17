import type { Page } from '@playwright/test';

import { addressBarPath, ROUTER_BASE_CASES, type RouterBaseCase } from '../../packages/test-helpers/src/routerBase';
import { ROUTER_SETUP_GLOBAL, testIds, type PlaygroundRouterSetup } from '../../playgrounds/shared/src';
import { expect, test, type FakeFlare } from '../fixtures/fake-flare';
import { hasSpanType, stringAttr, waitForSpan, type OtlpSpan } from './otlp';

// Boots the playground with the router mode and base of the case. The same table drives the unit
// suites, so the real browser checks the exact setups jsdom checks.
const openWithRouter = async (
    page: Page,
    testCase: RouterBaseCase,
    routerPath: string,
    includeRouterBase: boolean,
): Promise<string> => {
    const setup: PlaygroundRouterSetup = { mode: testCase.mode, base: testCase.base, includeRouterBase };
    await page.addInitScript(([key, value]) => Object.assign(window, { [key]: value }), [
        ROUTER_SETUP_GLOBAL,
        setup,
    ] as const);
    const path = addressBarPath(testCase, routerPath);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    return new URL(path, page.url()).href;
};

const routeAttributes = (span: OtlpSpan) => ({
    route: stringAttr(span, 'http.route'),
    identifier: stringAttr(span, 'flare.entry_point.handler.identifier'),
    source: stringAttr(span, 'flare.route.source'),
    url: stringAttr(span, 'url.full'),
});

const waitForRootSpan = (fakeFlare: FakeFlare, type: string) =>
    waitForSpan(fakeFlare, (span) => hasSpanType(span, type) && stringAttr(span, 'flare.route.source') === 'route');

const clickProduct = async (page: Page): Promise<void> => {
    await page.getByTestId(testIds.productCard('1')).locator('a').first().click();
    await expect(page.getByTestId(testIds.productCard('1'))).toBeHidden();
};

/** `productTemplate` is the product route as the router writes it: `/product/:id` or `/product/$id`. */
export const runRouterBaseSuite = (productTemplate: string): void => {
    for (const testCase of ROUTER_BASE_CASES) {
        test.describe(`router base: ${testCase.title}`, () => {
            test('pageload name includes the base', async ({ page, fakeFlare }) => {
                const url = await openWithRouter(page, testCase, '/product/1', true);
                const pageload = await waitForRootSpan(fakeFlare, 'browser_pageload');

                expect(routeAttributes(pageload)).toEqual({
                    route: `${testCase.expectedBase}${productTemplate}`,
                    identifier: `${testCase.expectedBase}${productTemplate}`,
                    source: 'route',
                    url,
                });
            });

            test('navigation name includes the base', async ({ page, fakeFlare }) => {
                const url = await openWithRouter(page, testCase, '/', true);
                await clickProduct(page);
                const navigation = await waitForRootSpan(fakeFlare, 'browser_navigation');

                expect(routeAttributes(navigation)).toEqual({
                    route: `${testCase.expectedBase}${productTemplate}`,
                    identifier: `${testCase.expectedBase}${productTemplate}`,
                    source: 'route',
                    url: new URL(addressBarPath(testCase, '/product/1'), url).href,
                });
            });

            test('navigation name has no base when the option is off', async ({ page, fakeFlare }) => {
                const url = await openWithRouter(page, testCase, '/', false);
                await clickProduct(page);
                const navigation = await waitForRootSpan(fakeFlare, 'browser_navigation');

                expect(routeAttributes(navigation)).toEqual({
                    route: productTemplate,
                    identifier: productTemplate,
                    source: 'route',
                    url: new URL(addressBarPath(testCase, '/product/1'), url).href,
                });
            });
        });
    }
};
