import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { runRouteChangeScenario } from './breadcrumbShared';
import { assertComponentTree } from './componentShared';
import { openHttpPage } from './httpShared';
import { logScenariosFor, runLogScenario } from './logShared';
import { attr, hasSpanType, parentOf, spansOf, stringAttr, urlOf } from './otlp';
import { runScenario, scenariosFor } from './shared';

test.describe('svelte playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.getByTestId(testIds.addToCart('1')).click();
        await page.getByRole('link', { name: 'Cart' }).click();
        await expect(page.getByTestId(testIds.cartItem('1'))).toBeVisible();
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
        await page.goto('/product/1'); // deep-link the initial load
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
            stringValue: '/product/[id]',
        });
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
    });

    test('navigation opens exactly one parameterized browser_navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await page.locator('a[href="/product/1"]').first().click();

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => {
                const nav = spansOf(record.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
                return !!nav && stringAttr(nav, 'flare.entry_point.handler.identifier') === '/product/[id]';
            },
        });
        const nav = spansOf(trace.bodyJson).find((span) => hasSpanType(span, 'browser_navigation'));
        expect(nav && attr(nav, 'flare.entry_point.handler.identifier')).toEqual({
            stringValue: '/product/[id]',
        });
        expect(nav && attr(nav, 'flare.route.source')).toEqual({ stringValue: 'route' });
        // Proves the url override is wired up: url.full must be where the navigation went, even
        // though Kit tells us before the URL changes.
        expect(nav && stringAttr(nav, 'url.full')).toContain('/product/1');

        // registerNavigationSource suppresses the History-based root, so one click => one root.
        const navSpans = (await fakeFlare.traces())
            .flatMap((record) => spansOf(record.bodyJson))
            .filter((span) => hasSpanType(span, 'browser_navigation'));
        expect(navSpans).toHaveLength(1);
    });

    // Span timing can't tell a correctly held root apart from the no-navigation fallback: with no load
    // function on any playground route, both look near-identical. So assert on what the effect
    // actually saw instead. A missing 'to:' entry means Svelte ran the two updates together.
    test('an effect created at client init observes the non-null navigating state', async ({ page }) => {
        // `window.__navStates` is declared by the playground, not the e2e tsconfig, hence the cast.
        const readStates = () =>
            page.evaluate(() => (window as unknown as { __navStates?: string[] }).__navStates ?? []);

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => {
            (window as unknown as { __navStates: string[] }).__navStates = [];
        });

        await page.locator('a[href="/product/1"]').first().click();
        await expect(page).toHaveURL(/\/product\/1$/);

        // Kit clears `navigating` a tick after the URL changes, not at the same time, so poll for
        // it rather than reading once.
        await expect.poll(async () => (await readStates()).at(-1)).toBe('null');

        expect(await readStates()).toContain('to:/product/1'); // survived batching
    });

    test('a hash-only change opens no navigation root', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => {
            window.location.hash = 'section-2';
        });
        // Worst case: idleTimeout (2000) + flush timer (500) before the root POSTs, plus margin.
        await page.waitForTimeout(3000);

        const all = (await fakeFlare.traces()).flatMap((record) => spansOf(record.bodyJson));
        const pageload = all.find((span) => hasSpanType(span, 'browser_pageload'));
        // Positive control: a pageload root alone proves nothing, since the framework-agnostic tracer
        // opens one regardless of traceSvelteKitRouter. route.source flipping to 'route' is what
        // proves the SvelteKit integration is wired, making the zero-navigation check below meaningful.
        expect(pageload && attr(pageload, 'flare.route.source')).toEqual({ stringValue: 'route' });
        expect(all.filter((span) => hasSpanType(span, 'browser_navigation'))).toHaveLength(0);
    });
});

test.describe('svelte http tracing', () => {
    test('a fetch fires a browser_fetch span nested under the active root', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('fetch-ok')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('fetch-ok:200');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => spansOf(record.bodyJson).some((span) => hasSpanType(span, 'browser_fetch')),
        });
        const spans = spansOf(trace.bodyJson);
        const fetchSpan = spans.find((span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('fetch-ok'));
        expect(fetchSpan).toBeTruthy();
        expect(attr(fetchSpan!, 'http.request.method')).toEqual({ stringValue: 'GET' });

        // The real assertion: it nests under a root, not orphaned at the top level.
        expect(fetchSpan!.parentSpanId).toBeTruthy();
        const root = await parentOf(fakeFlare, fetchSpan!);
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
            predicate: (record) =>
                spansOf(record.bodyJson).some(
                    (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('fetch-404'),
                ),
        });
        const span = spansOf(trace.bodyJson).find(
            (candidate) => hasSpanType(candidate, 'browser_fetch') && urlOf(candidate).includes('fetch-404'),
        );
        expect(span).toBeTruthy();
        // endHttpRequestSpan (httpRequestSpan.ts) records the status on every completion but only
        // marks a span error for status >= 500, so a 404 keeps OTel status Unset (0), not Error.
        expect(attr(span!, 'http.response.status_code')).toEqual({ intValue: 404 });
        expect(span!.status?.code ?? 0).toBe(0);
    });

    test('a 5xx fetch produces a span error, unlike a 4xx', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('fetch-500')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('fetch-500:500');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) =>
                spansOf(record.bodyJson).some(
                    (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('fetch-500'),
                ),
        });
        const span = spansOf(trace.bodyJson).find(
            (candidate) => hasSpanType(candidate, 'browser_fetch') && urlOf(candidate).includes('fetch-500'),
        );
        expect(span).toBeTruthy();
        // Other half of the 404 test above: status >= 500 records the status and marks a span error (code 2).
        expect(attr(span!, 'http.response.status_code')).toEqual({ intValue: 500 });
        expect(span!.status?.code ?? 0).toBe(2);
    });

    test('an XHR fires a browser_xhr span nested under the active root', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('xhr-ok')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('xhr-ok:200');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) => spansOf(record.bodyJson).some((span) => hasSpanType(span, 'browser_xhr')),
        });
        const spans = spansOf(trace.bodyJson);
        const xhrSpan = spans.find((span) => hasSpanType(span, 'browser_xhr') && urlOf(span).includes('xhr-ok'));
        expect(xhrSpan).toBeTruthy();
        expect(attr(xhrSpan!, 'http.request.method')).toEqual({ stringValue: 'GET' });

        expect(xhrSpan!.parentSpanId).toBeTruthy();
        const root = await parentOf(fakeFlare, xhrSpan!);
        expect(root).toBeTruthy();
        expect(hasSpanType(root!, 'browser_pageload') || hasSpanType(root!, 'browser_navigation')).toBe(true);
    });

    // The fetch 404/500 pair above pins endHttpRequestSpan's status branch. XHR runs through the same
    // helper but a different patch, so pin its 404 too rather than assume it behaves like fetch's.
    test('a failing XHR records its status without marking the span an error', async ({ page, fakeFlare }) => {
        await page.goto('/http');
        await page.waitForLoadState('networkidle');

        await page.getByTestId(testIds.httpTrigger('xhr-404')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('xhr-404:404');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) =>
                spansOf(record.bodyJson).some(
                    (span) => hasSpanType(span, 'browser_xhr') && urlOf(span).includes('xhr-404'),
                ),
        });
        const span = spansOf(trace.bodyJson).find(
            (candidate) => hasSpanType(candidate, 'browser_xhr') && urlOf(candidate).includes('xhr-404'),
        );
        expect(span).toBeTruthy();
        expect(attr(span!, 'http.response.status_code')).toEqual({ intValue: 404 });
        expect(span!.status?.code ?? 0).toBe(0);
    });

    // Kit flags the init it gives a load fetch with a hidden `__sveltekit_fetch__`, and its dev-mode
    // wrapper warns when the flag is missing. Rebuilding that init to add traceparent used to drop the
    // flag, falsely warning the developer about using window.fetch. The unit tests cover
    // mergeTraceparentHeader alone; only this test catches the warning as actually reported.
    test('Kit does not warn about window.fetch for a traced load fetch', async ({ page }) => {
        const warnings: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'warning') {
                warnings.push(msg.text());
            }
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.getByRole('link', { name: 'HTTP' }).click(); // client nav => load fetch runs in the browser
        await expect(page).toHaveURL(/\/http$/);
        await expect(page.getByTestId(testIds.httpResult)).toBeVisible();

        expect(warnings.filter((w) => /using `window.fetch`/.test(w))).toEqual([]);
    });

    // Kit grabs window.fetch when its module loads, which looks like it would pin the unpatched
    // original — it does not, since the fetch it hands a load function reads window.fetch lazily
    // when called, so our patch sees it. If this test fails that's no longer true. Must be a client
    // navigation: deep-linking runs the load on the server, where there is no patch and no span.
    test("SvelteKit's load-provided fetch produces a browser_fetch span", async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // dispatchEvent, not click(): click() moves the pointer first, and app.html's
        // data-sveltekit-preload-data="hover" preloads /http's load fetch before the navigation
        // starts, wrongly attributing it to the page being left. Measured on WebKit: click() put the
        // fetch under the pageload root in 7 of 8 runs, dispatchEvent in 0 of 8.
        await page.getByRole('link', { name: 'HTTP' }).dispatchEvent('click');
        await expect(page).toHaveURL(/\/http$/);

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (record) =>
                spansOf(record.bodyJson).some(
                    (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('kit-load-fetch'),
                ),
        });
        const spans = spansOf(trace.bodyJson);
        const loadFetch = spans.find(
            (span) => hasSpanType(span, 'browser_fetch') && urlOf(span).includes('kit-load-fetch'),
        );
        expect(loadFetch).toBeTruthy();

        // It fired during the navigation, so it must nest under the navigation root, not the pageload.
        expect(loadFetch!.parentSpanId).toBeTruthy();
        const root = await parentOf(fakeFlare, loadFetch!);
        expect(root && hasSpanType(root, 'browser_navigation')).toBe(true);
    });

    // The unit suite fakes completion with fireDone(0), which is the same call an abort and a network
    // failure both make. This is the only place a real xhr.abort() runs through the real patch.
    test('an aborted XHR ends its span once and releases the root', async ({ page, fakeFlare }) => {
        await openHttpPage(page);

        await page.getByTestId(testIds.httpTrigger('xhr-abort')).click();
        await expect(page.getByTestId(testIds.httpResult)).toHaveText('xhr-abort:0');

        const trace = await fakeFlare.waitForTrace({
            timeout: 9000,
            predicate: (r) =>
                spansOf(r.bodyJson).some((s) => hasSpanType(s, 'browser_xhr') && urlOf(s).includes('xhr-abort')),
        });
        const span = spansOf(trace.bodyJson).find(
            (s) => hasSpanType(s, 'browser_xhr') && urlOf(s).includes('xhr-abort'),
        );
        expect(span).toBeTruthy();
        // Status 0 on an http(s) URL means "no HTTP response", so the span is an OTel error (instrumentXHR.ts:163).
        expect(attr(span!, 'http.response.status_code')).toEqual({ intValue: 0 });
        expect(span!.status?.code ?? 0).toBe(2);

        // Exactly one span: the abort must not also end it a second time through another path.
        const all = (await fakeFlare.traces()).flatMap((t) => spansOf(t.bodyJson));
        expect(all.filter((s) => hasSpanType(s, 'browser_xhr') && urlOf(s).includes('xhr-abort'))).toHaveLength(1);

        // The root arriving inside the 9s wait proves the open-child count went back to zero;
        // a leaked child would hold it to the 15s childSpanTimeout instead.
        const root = await parentOf(fakeFlare, span!);
        expect(root).toBeTruthy();
    });
});

test.describe('svelte component profiling', () => {
    test('a pageload records a browser_component tree rooted on the pageload span', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // svelte.config.js profiles anything matching /\+(page|layout)(@[^/]*)?$/, and the
        // preprocessor records the route-relative id: '+layout' wraps '+page'.
        await assertComponentTree(page, fakeFlare, {
            outer: '+layout',
            inner: '+page',
            rootType: 'browser_pageload',
        });
    });

    // Each router drives the navigation seam its own way, so this one runs per framework.
    test('records a route change', async ({ page, fakeFlare }) => {
        await runRouteChangeScenario(page, fakeFlare);
    });
});
