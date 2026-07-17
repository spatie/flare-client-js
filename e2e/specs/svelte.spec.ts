import { testIds } from '../../playgrounds/shared/src';
import { expect, type FakeFlare, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, type OtlpSpan, spansOf } from './otlp';
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
        expect(JSON.stringify((nav && attr(nav, 'url.full')) ?? '')).toContain('/product/p01');

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
        // Worst case is idleTimeout (2000) + flush timer (500) = 2500ms before the root even POSTs;
        // add 500ms margin for that POST to reach the fake server.
        await page.waitForTimeout(3000);

        const all = (await fakeFlare.traces()).flatMap((t) => spansOf(t.bodyJson));
        const pageload = all.find((s) => hasSpanType(s, 'browser_pageload'));
        // Positive control: browser_pageload roots are opened by the framework-agnostic browser
        // tracer regardless of traceSvelteKitRouter, so merely finding one proves nothing. Its
        // route.source only flips from the default 'url' to 'route' once traceSvelteKitRouter's
        // effect names it, so this is what actually proves the SvelteKit integration is wired and
        // the zero-navigation assertion below is meaningful rather than vacuous.
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
        expect(all.filter((s) => hasSpanType(s, 'browser_navigation'))).toHaveLength(0);
    });
});

test.describe('svelte http tracing', () => {
    const urlOf = (span: OtlpSpan) => JSON.stringify(attr(span, 'url.full') ?? '');

    /**
     * A request span's parent root can flush in an earlier envelope than the request itself (roots
     * hold open for their idle window; requests flush eagerly), so poll across every captured trace
     * rather than the single envelope the request span was found in.
     */
    const waitForParentEnvelope = (fakeFlare: FakeFlare, child: OtlpSpan) =>
        fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => spansOf(r.bodyJson).some((s) => s.spanId === child.parentSpanId),
        });

    test('a fetch fires a browser_fetch span nested under the active root', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('fetch-ok')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('fetch-ok:200');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_fetch')),
        });
        const spans = spansOf(trace.bodyJson);
        const fetchSpan = spans.find((s) => hasSpanType(s, 'browser_fetch') && urlOf(s).includes('fetch-ok'));
        expect(fetchSpan).toBeTruthy();
        expect(attr(fetchSpan!, 'http.request.method')).toEqual({ stringValue: 'GET' });

        // The real assertion: it nests under a root, not orphaned at the top level.
        expect(fetchSpan!.parentSpanId).toBeTruthy();
        const rootTrace = await waitForParentEnvelope(fakeFlare, fetchSpan!);
        const root = spansOf(rootTrace.bodyJson).find((s) => s.spanId === fetchSpan!.parentSpanId);
        expect(root).toBeTruthy();
        expect(hasSpanType(root!, 'browser_pageload') || hasSpanType(root!, 'browser_navigation')).toBe(true);
    });

    test('a failing fetch still produces a span with its status recorded, not a span error', async ({
        page,
        fakeFlare,
    }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('fetch-404')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('fetch-404:404');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_fetch') && urlOf(s).includes('fetch-404')),
        });
        const span = spansOf(trace.bodyJson).find(
            (s) => hasSpanType(s, 'browser_fetch') && urlOf(s).includes('fetch-404'),
        );
        expect(span).toBeTruthy();
        // httpRequestSpan.ts's endHttpRequestSpan records the response status on every completion
        // via http.response.status_code, and only calls setStatus (span error, OTel code 2) for
        // status >= 500. A 404 is a completed request, so the status attribute must be 404 and the
        // span's own OTel status must stay Unset (0), not Error.
        expect(attr(span!, 'http.response.status_code')).toEqual({ intValue: 404 });
        expect(span!.status?.code ?? 0).toBe(0);
    });

    test('an XHR fires a browser_xhr span nested under the active root', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('xhr-ok')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('xhr-ok:200');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) => spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_xhr')),
        });
        const spans = spansOf(trace.bodyJson);
        const xhrSpan = spans.find((s) => hasSpanType(s, 'browser_xhr') && urlOf(s).includes('xhr-ok'));
        expect(xhrSpan).toBeTruthy();
        expect(attr(xhrSpan!, 'http.request.method')).toEqual({ stringValue: 'GET' });

        expect(xhrSpan!.parentSpanId).toBeTruthy();
        const rootTrace = await waitForParentEnvelope(fakeFlare, xhrSpan!);
        const root = spansOf(rootTrace.bodyJson).find((s) => s.spanId === xhrSpan!.parentSpanId);
        expect(root).toBeTruthy();
        expect(hasSpanType(root!, 'browser_pageload') || hasSpanType(root!, 'browser_navigation')).toBe(true);
    });

    // PINS VERIFIED FACT 11. Kit's fetcher.js:9 captures `native_fetch = window.fetch` at module
    // scope, which reads like it pins the unpatched original; it does not (that reference is only
    // used inside Kit's own wrapper). subsequent_fetch reads window.fetch at CALL time, so Flare's
    // patch sees a load fetch. If this test fails, the fact is wrong and the JSDoc needs the
    // limitation after all. Deep-linking would run the load on the SERVER (no patch, no span), so
    // this MUST be a client navigation.
    test("SvelteKit's load-provided fetch produces a browser_fetch span", async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.getByRole('link', { name: 'HTTP' }).click(); // client nav => load runs in the browser
        await expect(page).toHaveURL(/\/http$/);

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_fetch') && urlOf(s).includes('kit-load-fetch')),
        });
        const spans = spansOf(trace.bodyJson);
        const loadFetch = spans.find((s) => hasSpanType(s, 'browser_fetch') && urlOf(s).includes('kit-load-fetch'));
        expect(loadFetch).toBeTruthy();

        // It fired during the navigation, so it must nest under the navigation root, not the pageload.
        expect(loadFetch!.parentSpanId).toBeTruthy();
        const rootTrace = await waitForParentEnvelope(fakeFlare, loadFetch!);
        const root = spansOf(rootTrace.bodyJson).find((s) => s.spanId === loadFetch!.parentSpanId);
        expect(root && hasSpanType(root, 'browser_navigation')).toBe(true);
    });
});
