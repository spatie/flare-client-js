import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario, waitForLogMessage } from './logShared';
import { attr, attributeKeys, hasSpanType, spansOf, stringAttr, urlOf, waitForSpan, waitForSpanType } from './otlp';
import { runScenario, scenariosFor } from './shared';

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
                if (tp) {
                    outgoingTraceparent = tp;
                }
            }
        });

        await page.getByTestId('trace-fetch').click();

        const fetchSpan = await waitForSpanType(fakeFlare, 'browser_fetch');

        expect(stringAttr(fetchSpan, 'http.request.method')).toBe('GET');
        expect(attr(fetchSpan, 'http.response.status_code')).toEqual({ intValue: 200 });

        expect(outgoingTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    });

    test('an XHR carries a traceparent whose ids are the span it opened', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const traceparents: string[] = [];
        page.on('request', (req) => {
            if (req.resourceType() === 'xhr') {
                const header = req.headers()['traceparent'];
                if (header) {
                    traceparents.push(header);
                }
            }
        });

        // Navigate first, so the XHR lands inside a fresh root instead of racing the pageload idle window.
        await page.getByRole('link', { name: 'Broken' }).click();
        await page.getByTestId('trace-xhr').click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_xhr')),
        });
        const xhrSpan = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_xhr'));
        expect(xhrSpan).toBeTruthy();

        expect(traceparents).toHaveLength(1);
        const [version, traceId, spanId, flags] = traceparents[0].split('-');
        expect(version).toBe('00');
        expect(flags).toMatch(/^0[01]$/);
        // Stronger than the fetch assertion above: the header must identify the span we actually opened,
        // not just be well formed.
        expect(traceId).toBe(xhrSpan!.traceId);
        expect(spanId).toBe(xhrSpan!.spanId);
    });

    test('tracesSampleRate 0 stops new roots from reaching the ingest', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Positive control first: with sampling on, a navigation produces a root. Without this the
        // assertion below could pass because tracing never worked at all.
        await page.getByTestId(testIds.cartCount).click(); // pushState to /cart
        await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_navigation') && urlOf(s).includes('/cart')),
        });

        // Clears the positive control's own envelope, plus any keepalive flush still in flight from a
        // prior test's open root (e.g. the XHR traceparent test leaves /broken open on teardown). Without
        // this, a late-arriving envelope from either source could land before the negative check below.
        await fakeFlare.reset();

        // configure() merges into the existing config and clamps the rate; it does not restart tracing,
        // so the patches and listeners stay installed and only the sampler decision changes.
        await page.evaluate(() => (globalThis as { __flare?: any }).__flare.configure({ tracesSampleRate: 0 }));

        await page.getByRole('link', { name: 'Broken' }).click();
        // idleTimeout (2000) + flush timer (500) + margin, the same budget svelte.spec.ts:130 uses.
        await page.waitForTimeout(3000);

        const all = (await fakeFlare.traces()).flatMap((t) => spansOf(t.bodyJson));
        expect(all.filter((s) => hasSpanType(s, 'browser_navigation') && urlOf(s).includes('/broken'))).toHaveLength(0);
    });

    test('emits a browser_pageload root on load', async ({ page, fakeFlare }) => {
        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        const pageload = await waitForSpanType(fakeFlare, 'browser_pageload');
        expect(attr(pageload, 'flare.entry_point.type')).toEqual({ stringValue: 'web' });
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

        // Match on the URL, not just the type: the products page loads its catalog over the mock API,
        // so a bare browser_fetch match can land on one of those pageload requests instead.
        const fetchSpan = await waitForSpan(
            fakeFlare,
            (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('/broken'),
        );
        // The key assertion: the fetch is not its own root, it nests under the active root.
        // Root spans always serialize parentSpanId as null; a nested span carries the parent's spanId.
        expect(fetchSpan.parentSpanId).toBeTruthy();

        // And the parent is specifically the browser_navigation root of the same trace. The
        // root only ends after its idle window, so it arrives in a later envelope than the
        // fetch span (which the playground flushes eagerly); wait for it separately.
        const rootTrace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some(
                    (s) => hasSpanType(s, 'browser_navigation') && s.spanId === fetchSpan.parentSpanId,
                ),
        });
        const root = spansOf(rootTrace.bodyJson).find((s) => s.spanId === fetchSpan.parentSpanId);
        expect(root).toBeTruthy();
        expect(root?.traceId).toBe(fetchSpan.traceId);
        expect(root?.parentSpanId ?? null).toBeNull();
    });

    test('emits a browser_navigation root on in-app navigation', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        // Click a data-link nav anchor (triggers history.pushState).
        await page.getByTestId('cart-count').click();

        await waitForSpanType(fakeFlare, 'browser_navigation');
    });

    test('navigation root url reflects the page it represents (no drift)', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.getByTestId('cart-count').click(); // pushState to /cart

        // The /cart navigation root must carry /cart, not whatever page is current when it idles out.
        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => {
                const nav = spansOf(record.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
                return !!nav && (stringAttr(nav, 'url.full') ?? '').includes('/cart');
            },
        });
        const nav = spansOf(trace.bodyJson).find((s) => hasSpanType(s, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({ stringValue: '/cart' });
        // no manual context.* leakage
        for (const leaked of ['context.route', 'context.url', 'context.user_agent', 'context.viewport']) {
            expect(attributeKeys(nav).some((key) => key.includes(leaked))).toBe(false);
        }
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

        const fetchSpan = await waitForSpan(
            fakeFlare,
            (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('/broken'),
        );
        expect(fetchSpan.parentSpanId).toBeTruthy(); // a child, not its own root
        // lean: carries its own http.* but not cookies or referrer/ready_state page context
        expect(attr(fetchSpan, 'http.request.method')).toBeTruthy();
        for (const leaked of ['http.request.cookies', 'document.ready_state']) {
            expect(attributeKeys(fetchSpan).some((key) => key.includes(leaked))).toBe(false);
        }

        // resource has host.name (sourced stably, present even though children are lean). Find the
        // envelope that carried fetchSpan rather than re-waiting: waitForSpanType already confirmed
        // it landed, so it is in fakeFlare's history by now.
        const trace = (await fakeFlare.traces()).find((t) =>
            spansOf(t.bodyJson).some((s) => s.spanId === fetchSpan.spanId),
        )!;
        const resourceAttrs =
            (
                trace.bodyJson as {
                    resourceSpans?: Array<{ resource?: { attributes?: Array<{ key: string }> } }>;
                }
            ).resourceSpans?.[0]?.resource?.attributes ?? [];
        expect(resourceAttrs.some((attribute) => attribute.key === 'host.name')).toBe(true);
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

        const log = await waitForLogMessage(fakeFlare, 'e2e-unload-log');

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

        const log = await waitForLogMessage(fakeFlare, 'e2e-bg-resume-');
        expect(log.endpoint).toBe('logs');
    });
});
