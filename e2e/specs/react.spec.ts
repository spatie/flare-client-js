import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { assertNavigationRequestNests, assertNestedHttpSpan, openHttpPage } from './httpShared';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, spansOf, stringAttr } from './otlp';
import { runScenario, scenariosFor } from './shared';

test.describe('react playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.getByTestId(testIds.addToCart('p01')).click();
        await page.getByRole('link', { name: 'Cart' }).click();
        await expect(page.getByTestId(testIds.cartItem('p01'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('react')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });

    test('pageload root carries the parameterized route and route source', async ({ page, fakeFlare }) => {
        await page.goto('/product/p01'); // deep-link the initial load
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
            stringValue: '/product/$id',
        });
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
    });

    test('navigation root carries the parameterized route (not the concrete path)', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/product/p01"]').first().click(); // client nav to the parameterized route

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => {
                const nav = spansOf(record.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
                return !!nav && stringAttr(nav, 'flare.entry_point.handler.identifier') === '/product/$id';
            },
        });
        const nav = spansOf(trace.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/product/$id' });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });

        // The no-double-roots invariant: History detection must stay suppressed while the
        // integration is registered, so this one click produced exactly ONE browser_navigation
        // root across ALL captured traces. (If suppression broke, the History patch's duplicate
        // URL-named root opens and ends BEFORE the integration's parameterized one, so by the
        // time waitForTrace matched above, the duplicate would already have arrived.)
        const navSpans = (await fakeFlare.traces())
            .flatMap((record) => spansOf(record.bodyJson))
            .filter((span) => hasSpanType(span, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });
});

test.describe('react http tracing', () => {
    test('a fetch fires a browser_fetch span nested under the active root', async ({ page, fakeFlare }) => {
        await openHttpPage(page);
        await assertNestedHttpSpan(page, fakeFlare, { scenario: 'fetch-ok', spanType: 'browser_fetch' });
    });

    test('an XHR fires a browser_xhr span nested under the active root', async ({ page, fakeFlare }) => {
        await openHttpPage(page);
        await assertNestedHttpSpan(page, fakeFlare, { scenario: 'xhr-ok', spanType: 'browser_xhr' });
    });

    test('a request fired during the navigation nests under the navigation root', async ({ page, fakeFlare }) => {
        await openHttpPage(page); // the route's loader fetches while the nav root is open
        await assertNavigationRequestNests(page, fakeFlare);
    });
});

test.describe('react logging', () => {
    for (const scenario of logScenariosFor('react').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }
});
