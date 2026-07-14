import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario } from './logShared';
import { runScenario, scenariosFor } from './shared';

type OtlpSpan = {
    name: string;
    spanId: string;
    parentSpanId: string | null;
    traceId: string;
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

const spansOf = (bodyJson: unknown): OtlpSpan[] =>
    ((bodyJson as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> }).resourceSpans ?? [])
        .flatMap((r) => r.scopeSpans ?? [])
        .flatMap((s) => s.spans ?? []);

const attr = (span: OtlpSpan, key: string): unknown => span.attributes.find((a) => a.key === key)?.value;

const hasSpanType = (span: OtlpSpan, type: string): boolean =>
    JSON.stringify(attr(span, 'flare.span_type') ?? '').includes(type);

test.describe('react-router playground', () => {
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
                await page.waitForLoadState('networkidle');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });

    test('pageload root carries the parameterized route and route source', async ({ page, fakeFlare }) => {
        await page.goto('/product/p01'); // deep-link the initial load (loader route)
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

    test('loader navigation opens a parameterized browser_navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/product/p01"]').first().click(); // loader route -> held nav root

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

        // No-double-roots invariant: registerNavigationSource suppresses the History-based root,
        // so this one click produced exactly ONE browser_navigation root across all traces.
        const navSpans = (await fakeFlare.traces())
            .flatMap((t) => spansOf(t.bodyJson))
            .filter((s) => hasSpanType(s, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });

    test('loader-less navigation opens a parameterized browser_navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/cart"]').first().click(); // no loader -> loader-less nav root

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => {
                const nav = spansOf(r.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
                return (
                    !!nav && JSON.stringify(attr(nav, 'flare.entry_point.handler.identifier') ?? '').includes('/cart')
                );
            },
        });
        const nav = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/cart' });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });

        const navSpans = (await fakeFlare.traces())
            .flatMap((t) => spansOf(t.bodyJson))
            .filter((s) => hasSpanType(s, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });
});

test.describe('react-router logging', () => {
    for (const scenario of logScenariosFor('react').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }
});
