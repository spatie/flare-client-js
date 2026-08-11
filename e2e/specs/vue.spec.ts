import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { assertComponentTree } from './componentShared';
import { assertNavigationRequestNests, assertNestedHttpSpan, openHttpPage } from './httpShared';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, spansOf, stringAttr } from './otlp';
import { runScenario, scenariosFor } from './shared';

test.describe('vue playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.getByTestId(testIds.addToCart('1')).click();
        await page.getByRole('link', { name: 'Cart' }).click();
        await expect(page.getByTestId(testIds.cartItem('1'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('vue')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });
});

test.describe('vue-router tracing', () => {
    test('pageload root carries the parameterized route and route source', async ({ page, fakeFlare }) => {
        await page.goto('/product/1');
        await page.waitForLoadState('networkidle');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => {
                const pl = spansOf(record.bodyJson).find((span) => hasSpanType(span, 'browser_pageload'));
                return !!pl && stringAttr(pl, 'flare.route.source') === 'route';
            },
        });
        const pageload = spansOf(trace.bodyJson).find((span) => hasSpanType(span, 'browser_pageload'));
        expect(pageload && attr(pageload, 'flare.entry_point.handler.identifier')).toEqual({
            stringValue: '/product/:id',
        });
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
    });

    test('client navigation opens a parameterized browser_navigation root (exactly one)', async ({
        page,
        fakeFlare,
    }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/product/1"]').first().click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => {
                const nav = spansOf(record.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
                return !!nav && stringAttr(nav, 'flare.entry_point.handler.identifier') === '/product/:id';
            },
        });
        const nav = spansOf(trace.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/product/:id' });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });

        // No-double-roots invariant: registerNavigationSource suppresses the History-based root, so this
        // one click produces exactly ONE browser_navigation root across all traces.
        const navSpans = (await fakeFlare.traces())
            .flatMap((record) => spansOf(record.bodyJson))
            .filter((span) => hasSpanType(span, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });
});

test.describe('vue component profiling', () => {
    test('a pageload records a browser_component tree rooted on the pageload span', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // profileComponents in main.ts:13 names Layout and ProductsPage; Layout is the app root.
        await assertComponentTree(page, fakeFlare, {
            outer: 'Layout',
            inner: 'ProductsPage',
            rootType: 'browser_pageload',
        });
    });
});

test.describe('vue http tracing', () => {
    test('a fetch fires a browser_fetch span nested under the active root', async ({ page, fakeFlare }) => {
        await openHttpPage(page);
        await assertNestedHttpSpan(page, fakeFlare, { scenario: 'fetch-ok', spanType: 'browser_fetch' });
    });

    test('an XHR fires a browser_xhr span nested under the active root', async ({ page, fakeFlare }) => {
        await openHttpPage(page);
        await assertNestedHttpSpan(page, fakeFlare, { scenario: 'xhr-ok', spanType: 'browser_xhr' });
    });

    test('a request fired during the navigation nests under the navigation root', async ({ page, fakeFlare }) => {
        await openHttpPage(page); // the route guard fetches while the nav root is held
        await assertNavigationRequestNests(page, fakeFlare);
    });
});

test.describe('vue logging', () => {
    for (const scenario of logScenariosFor('vue').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }
});
