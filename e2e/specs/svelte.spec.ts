import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, spansOf } from './otlp';
import { runScenario, scenariosFor } from './shared';

test.describe('svelte playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.getByTestId(testIds.addToCart('p01')).click();
        await page.getByRole('link', { name: 'Cart' }).click();
        await expect(page.getByTestId(testIds.cartItem('p01'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('svelte')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await page.waitForLoadState('networkidle');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });
});

test.describe('svelte logging', () => {
    for (const scenario of logScenariosFor('svelte').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }
});

test.describe('svelte tracing', () => {
    test('pageload root carries the parameterized route and route source', async ({ page, fakeFlare }) => {
        await page.goto('/product/p01'); // deep-link the initial load
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
            stringValue: '/product/[id]',
        });
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
    });

    test('navigation opens exactly one parameterized browser_navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/product/p01"]').first().click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => {
                const nav = spansOf(r.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
                return (
                    !!nav &&
                    JSON.stringify(attr(nav, 'flare.entry_point.handler.identifier') ?? '').includes('/product/[id]')
                );
            },
        });
        const nav = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({
            stringValue: '/product/[id]',
        });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });
        // The nav root's url.full must be the DESTINATION even though Kit emits `navigating`
        // before the URL commits. This is what proves the seam's url override is wired.
        expect(JSON.stringify(attr(nav!, 'url.full') ?? '')).toContain('/product/p01');

        // registerNavigationSource suppresses the History-based root, so one click => one root.
        const navSpans = (await fakeFlare.traces())
            .flatMap((t) => spansOf(t.bodyJson))
            .filter((s) => hasSpanType(s, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });

    // THE BATCHING GATE. The span assertions above cannot distinguish a correctly held root from a
    // coalesced branch-7 fallback: with no load function on any playground route, both are near-zero
    // and identically named, and `hold` never reaches the wire. So assert on what the effect actually
    // observed. A missing 'to:' entry means Svelte batched the non-null state away.
    test('an effect created at client init observes the non-null navigating state', async ({ page }) => {
        // `window.__navStates` is declared by the playground, not by the e2e tsconfig, so read it
        // through a cast rather than adding a global declaration to the suite.
        const readStates = () =>
            page.evaluate(() => (window as unknown as { __navStates?: string[] }).__navStates ?? []);

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => {
            (window as unknown as { __navStates: string[] }).__navStates = [];
        });

        await page.locator('a[href="/product/p01"]').first().click();
        await expect(page).toHaveURL(/\/product\/p01$/);

        // `navigating` returns to null a tick AFTER the URL commits (client.js:1856 then :2023), so
        // poll rather than reading once.
        await expect.poll(async () => (await readStates()).at(-1)).toBe('null');

        expect(await readStates()).toContain('to:/product/p01'); // survived batching
    });

    test('a hash-only change opens no navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => {
            window.location.hash = 'section-2';
        });
        await page.waitForTimeout(2500); // outlive idleTimeout (2000) so any root would have flushed

        const navSpans = (await fakeFlare.traces())
            .flatMap((t) => spansOf(t.bodyJson))
            .filter((s) => hasSpanType(s, 'browser_navigation'));
        expect(navSpans).toHaveLength(0);
    });
});
