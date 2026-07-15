import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, spansOf } from './otlp';
import { runScenario, scenariosFor } from './shared';

test.describe('vue playground', () => {
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
        await page.goto('/product/p01');
        await page.waitForLoadState('networkidle');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => {
                const pl = spansOf(r.bodyJson).find((s) => hasSpanType(s, 'browser_pageload'));
                return !!pl && JSON.stringify(attr(pl, 'flare.route.source') ?? '').includes('route');
            },
        });
        const pageload = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_pageload'));
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

        await page.locator('a[href="/product/p01"]').first().click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => {
                const nav = spansOf(r.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
                return (
                    !!nav &&
                    JSON.stringify(attr(nav, 'flare.entry_point.handler.identifier') ?? '').includes('/product/:id')
                );
            },
        });
        const nav = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/product/:id' });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });

        // No-double-roots invariant: registerNavigationSource suppresses the History-based root, so this
        // one click produces exactly ONE browser_navigation root across all traces.
        const navSpans = (await fakeFlare.traces())
            .flatMap((t) => spansOf(t.bodyJson))
            .filter((s) => hasSpanType(s, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
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
