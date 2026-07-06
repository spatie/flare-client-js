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

test.describe('js playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.getByTestId(testIds.addToCart('p01')).click();
        await page.goto('/cart');
        await expect(page.getByTestId(testIds.cartItem('p01'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('js')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });

    test('traced fetch produces a browser_fetch span', async ({ page, fakeFlare }) => {
        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        let outgoingTraceparent: string | null = null;
        page.on('request', (req) => {
            if (req.resourceType() === 'fetch') {
                const tp = req.headers()['traceparent'];
                if (tp) outgoingTraceparent = tp;
            }
        });

        await page.getByTestId('trace-fetch').click();

        const trace = await fakeFlare.waitForTrace({
            predicate: (r) => JSON.stringify(r.bodyJson).includes('browser_fetch'),
        });

        const body = JSON.stringify(trace.bodyJson);
        expect(body).toContain('browser_fetch');
        expect(body).toContain('http.request.method');
        expect(body).toContain('http.response.status_code');

        expect(outgoingTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    });

    test('emits a browser_pageload root on load', async ({ page, fakeFlare }) => {
        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => JSON.stringify(r.bodyJson).includes('browser_pageload'),
        });
        const pageload = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_pageload'));
        expect(pageload).toBeTruthy();
        expect(pageload && attr(pageload, 'flare.entry_point.type')).toEqual({ stringValue: 'web' });
    });

    test('fetch span nests under the active navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Don't race the pageload root's idle window (idleTimeout counts from Flare init,
        // and goto + networkidle can eat all of it on a slow CI load). Instead start a
        // fresh browser_navigation root: the History pushState patch opens it synchronously
        // on the nav click, so the only gap before the fetch is one click to the next,
        // between two elements that are already rendered.
        await page.getByRole('link', { name: 'Broken' }).click();
        await page.getByTestId('trace-fetch').click();

        const fetchTrace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => JSON.stringify(r.bodyJson).includes('browser_fetch'),
        });
        const fetchSpan = spansOf(fetchTrace.bodyJson).find((s) => hasSpanType(s, 'browser_fetch'));
        expect(fetchSpan).toBeTruthy();
        // The key assertion: the fetch is not its own root, it nests under the active root.
        // Root spans always serialize parentSpanId as null; a nested span carries the parent's spanId.
        expect(fetchSpan?.parentSpanId).toBeTruthy();

        // And the parent is specifically the browser_navigation root of the same trace. The
        // root only ends after its idle window, so it arrives in a later envelope than the
        // fetch span (which the playground flushes eagerly); wait for it separately.
        const rootTrace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some(
                    (s) => hasSpanType(s, 'browser_navigation') && s.spanId === fetchSpan?.parentSpanId,
                ),
        });
        const root = spansOf(rootTrace.bodyJson).find((s) => s.spanId === fetchSpan?.parentSpanId);
        expect(root).toBeTruthy();
        expect(root?.traceId).toBe(fetchSpan?.traceId);
        expect(root?.parentSpanId ?? null).toBeNull();
    });

    test('emits a browser_navigation root on in-app navigation', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Click a data-link nav anchor (triggers history.pushState).
        await page.getByTestId('cart-count').click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => JSON.stringify(r.bodyJson).includes('browser_navigation'),
        });
        expect(spansOf(trace.bodyJson).some((s) => hasSpanType(s, 'browser_navigation'))).toBe(true);
    });

    test('navigation root url reflects the page it represents (no drift)', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.getByTestId('cart-count').click(); // pushState to /cart

        // The /cart navigation root must carry /cart, not whatever page is current when it idles out.
        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => {
                const nav = spansOf(r.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
                return !!nav && JSON.stringify(attr(nav, 'url.full') ?? '').includes('/cart');
            },
        });
        const nav = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/cart' });
        // no manual context.* leakage
        expect(JSON.stringify(nav)).not.toContain('context.route');
        expect(JSON.stringify(nav)).not.toContain('context.url');
        expect(JSON.stringify(nav)).not.toContain('context.user_agent');
        expect(JSON.stringify(nav)).not.toContain('context.viewport');
    });

    test('fetch child is lean (no cookies, no page context) and resource has host.name', async ({
        page,
        fakeFlare,
    }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Same navigation-first pattern as the nesting spec: guarantee the fetch is a
        // child (roots carry entry-point context, which would defeat the lean assertions).
        await page.getByRole('link', { name: 'Broken' }).click();
        await page.getByTestId('trace-fetch').click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => JSON.stringify(r.bodyJson).includes('browser_fetch'),
        });
        const fetchSpan = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_fetch'));
        expect(fetchSpan).toBeTruthy();
        expect(fetchSpan?.parentSpanId).toBeTruthy(); // a child, not its own root
        // lean: carries its own http.* but not cookies or referrer/ready_state page context
        expect(attr(fetchSpan!, 'http.request.method')).toBeTruthy();
        expect(JSON.stringify(fetchSpan)).not.toContain('http.request.cookies');
        expect(JSON.stringify(fetchSpan)).not.toContain('document.ready_state');

        // resource has host.name (sourced stably, present even though children are lean)
        const resourceAttrs =
            (
                trace.bodyJson as {
                    resourceSpans?: Array<{ resource?: { attributes?: Array<{ key: string }> } }>;
                }
            ).resourceSpans?.[0]?.resource?.attributes ?? [];
        expect(resourceAttrs.some((a) => a.key === 'host.name')).toBe(true);
    });
});

test.describe('js logging', () => {
    for (const scenario of logScenariosFor('js').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }

    test('ships a buffered log on page unload (cross-origin keepalive)', async ({ page, fakeFlare }) => {
        await fakeFlare.reset();

        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        // log-unload is flushOnTrigger:false — buffered, not sent on click.
        await page.getByTestId(testIds.logTrigger('log-unload')).click();

        await page.waitForTimeout(300);
        expect(await fakeFlare.logs()).toHaveLength(0);

        await page.goto('about:blank');

        const log = await fakeFlare.waitForLog({
            predicate: (r) => JSON.stringify(r.bodyJson).includes('e2e-unload-log'),
        });

        expect(log.endpoint).toBe('logs');
        expect(log.headers['x-api-token']).toBeTruthy();
    });

    test('backgrounding a tab retains over-keepalive logs and ships them on resume', async ({ page, fakeFlare }) => {
        await fakeFlare.reset();

        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        // Lower the keepalive budget and buffer a record larger than it. visibilitychange
        // :hidden fires on backgrounding too, not only on unload, so the over-budget
        // record must survive a hidden/visible cycle instead of being dropped.
        const oversized = 'e2e-bg-resume-' + 'x'.repeat(5000);
        await page.evaluate((message) => {
            const flare = (globalThis as { __flare?: any }).__flare;
            flare.configure({ keepaliveMaxBytes: 2000, logFlushIntervalMs: 999_999 });
            flare.logger.info(message);
        }, oversized);

        // Simulate the tab being backgrounded (not unloaded).
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // Nothing fit the keepalive budget, so no envelope shipped and the record is kept.
        await page.waitForTimeout(300);
        expect(await fakeFlare.logs()).toHaveLength(0);

        // Tab resumes; a normal flush ships the retained record.
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            return (globalThis as { __flare?: any }).__flare.flush();
        });

        const log = await fakeFlare.waitForLog({
            predicate: (r) => JSON.stringify(r.bodyJson).includes('e2e-bg-resume-'),
        });
        expect(log.endpoint).toBe('logs');
    });
});
