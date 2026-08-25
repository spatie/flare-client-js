import type { Config, Span, SpanOptions } from '@flareapp/core';
import { resetNavigationSource } from '@flareapp/test-helpers';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerNavigationSource } from '../src/instrumentation/navigation';
import {
    pageloadContextForTests,
    pageloadRootForTests,
    pageloadRouteForTests,
    startBrowserTracing,
    stopBrowserTracing,
    type BrowserTracingFlare,
} from '../src/tracing/roots';
import { resetWebVitalsForTests, startWebVitals } from '../src/tracing/vitals';

function fakeSpan(name: string): Span {
    return {
        traceId: 'T',
        spanId: 's_' + name,
        parentSpanId: null,
        name,
        isRecording: true,
        endTimeUnixNano: 0,
        setAttribute: vi.fn(function (this: Span) {
            return this;
        }),
        setStatus() {
            return this;
        },
        addEvent() {
            return this;
        },
        end: vi.fn(),
    } as unknown as Span;
}

function fakeFlare() {
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => fakeSpan(_name));
    const setActiveRoot = vi.fn();
    const addSpanListener = vi.fn(() => () => {});
    const flush = vi.fn();
    const flare: BrowserTracingFlare = {
        config: {
            idleTimeout: 1000,
            finalTimeout: 30000,
            childSpanTimeout: 15000,
            urlDenylist: /(?!)/,
        } as unknown as Config,
        startSpan,
        tracer: { addSpanListener, setActiveRoot, flush } as unknown as BrowserTracingFlare['tracer'],
    };
    return { flare, startSpan, setActiveRoot, flush };
}

describe('browserTracing', () => {
    afterEach(() => {
        resetNavigationSource(registerNavigationSource);
        stopBrowserTracing();
        vi.useRealTimers();
        window.history.replaceState({}, '', '/');
    });

    it('starts a browser_pageload root on start', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/start');
        const { flare, startSpan } = fakeFlare();

        startBrowserTracing(flare);

        expect(startSpan).toHaveBeenCalledTimes(1);
        const [name, opts] = startSpan.mock.calls[0];
        expect(name).toBe('/start');
        expect(opts.spanType).toBe('browser_pageload');
        expect(opts.forceRoot).toBe(true); // must not become a child of an ambient active span
        expect(opts.attributes?.['flare.entry_point.type']).toBe('web');
        expect(opts.attributes?.['flare.entry_point.handler.identifier']).toBe('/start');
        expect(opts.attributes?.['http.route']).toBe('/start');
        expect(opts.attributes?.['flare.route.source']).toBe('url');
        expect(opts.attributes?.['url.full']).toContain('/start');
        expect(opts.attributes?.['url.path']).toBe('/start');
        expect('context.route' in (opts.attributes ?? {})).toBe(false);
        expect('context.url' in (opts.attributes ?? {})).toBe(false);
    });

    it('starts a browser_navigation root and ends the prior root on pushState path change', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan, setActiveRoot } = fakeFlare();
        startBrowserTracing(flare);
        setActiveRoot.mockClear();

        window.history.pushState({}, '', '/b');

        expect(setActiveRoot).toHaveBeenCalledWith(undefined);
        const navCall = startSpan.mock.calls[1];
        expect(navCall[0]).toBe('/b');
        expect(navCall[1].spanType).toBe('browser_navigation');
        expect(navCall[1].forceRoot).toBe(true);
    });

    it('does not start a navigation root when the path is unchanged', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/same');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);

        window.history.pushState({}, '', '/same?q=1'); // same pathname, different query

        expect(startSpan).toHaveBeenCalledTimes(1); // only the pageload root
    });

    it('does not let a tracer error escape into history.pushState', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare); // pageload root ok
        startSpan.mockImplementationOnce(() => {
            throw new Error('tracer boom'); // navigation root creation throws
        });
        expect(() => window.history.pushState({}, '', '/b')).not.toThrow();
    });

    it('ends the orphaned root and clears active state if the idle controller fails to construct', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/x');
        const { flare, setActiveRoot } = fakeFlare();
        const created: Array<{ end: ReturnType<typeof vi.fn> }> = [];
        (flare.startSpan as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
            const s = {
                traceId: 'T',
                spanId: 's',
                parentSpanId: null,
                name,
                isRecording: true,
                endTimeUnixNano: 0,
                setAttribute() {
                    return this;
                },
                setStatus() {
                    return this;
                },
                addEvent() {
                    return this;
                },
                end: vi.fn(),
            };
            created.push(s);
            return s as never;
        });
        // Make IdleRootController construction throw AFTER setActiveRoot(root): addSpanListener throws.
        (flare.tracer.addSpanListener as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('listener boom');
        });

        expect(() => startBrowserTracing(flare)).not.toThrow();
        expect(created[0].end).toHaveBeenCalled(); // orphaned root ended
        expect(setActiveRoot).toHaveBeenLastCalledWith(undefined); // active root cleared
    });

    it('pagehide ends the open root, then keepalive-flushes', () => {
        vi.useFakeTimers();
        const { flare, startSpan, setActiveRoot, flush } = fakeFlare();
        startBrowserTracing(flare);
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };
        setActiveRoot.mockClear();

        window.dispatchEvent(new Event('pagehide'));

        expect(root.end).toHaveBeenCalled();
        expect(setActiveRoot).toHaveBeenCalledWith(undefined);
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
        // The flush must run after the root ends, or the just-ended root misses the envelope.
        expect(root.end.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0]);
    });

    it('visibilitychange to hidden ends the open root and keepalive-flushes', () => {
        vi.useFakeTimers();
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare);
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        try {
            document.dispatchEvent(new Event('visibilitychange'));
        } finally {
            delete (document as { visibilityState?: string }).visibilityState;
        }

        expect(root.end).toHaveBeenCalled();
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });

    it('still keepalive-flushes on pagehide when the root already ended', () => {
        vi.useFakeTimers();
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare);
        vi.advanceTimersByTime(1000); // idleTimeout ends the pageload root
        const root = startSpan.mock.results[0].value as { end: ReturnType<typeof vi.fn> };
        expect(root.end).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('pagehide'));

        expect(root.end).toHaveBeenCalledTimes(1); // not ended twice
        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });

    it('removes the pagehide and visibilitychange listeners on stop', () => {
        vi.useFakeTimers();
        const { flare, flush } = fakeFlare();
        startBrowserTracing(flare);
        stopBrowserTracing();

        window.dispatchEvent(new Event('pagehide'));
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        try {
            document.dispatchEvent(new Event('visibilitychange'));
        } finally {
            delete (document as { visibilityState?: string }).visibilityState;
        }

        expect(flush).not.toHaveBeenCalled();
    });

    it('a history wrapper leaked by a third-party wrap is inert after stop', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan, setActiveRoot } = fakeFlare();
        const originalPushState = window.history.pushState;
        startBrowserTracing(flare);

        // A third party wraps pushState after Flare, so unfill cannot restore on stop
        // (the current function is not Flare's tagged wrapper) and Flare's wrapper leaks.
        const flarePushState = window.history.pushState;
        window.history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
            return flarePushState.apply(this, args);
        };

        stopBrowserTracing();
        expect(window.history.pushState).not.toBe(originalPushState); // the leak is real

        try {
            setActiveRoot.mockClear();
            const before = startSpan.mock.calls.length;
            window.history.pushState({}, '', '/leaked');

            expect(startSpan.mock.calls.length).toBe(before); // no root started
            expect(setActiveRoot).not.toHaveBeenCalled(); // no controller constructed
        } finally {
            window.history.pushState = originalPushState;
        }
    });

    it('stopBrowserTracing ends the active root and unpatches history', () => {
        vi.useFakeTimers();
        const { flare, setActiveRoot } = fakeFlare();
        startBrowserTracing(flare);
        setActiveRoot.mockClear();

        stopBrowserTracing();
        expect(setActiveRoot).toHaveBeenCalledWith(undefined);

        const before = (flare.startSpan as ReturnType<typeof vi.fn>).mock.calls.length;
        window.history.pushState({}, '', '/after-stop');
        expect((flare.startSpan as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
    });

    it('stopBrowserTracing completes teardown even if ending the root throws', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/stop');
        const { flare, startSpan, setActiveRoot } = fakeFlare();

        startBrowserTracing(flare);
        expect(startSpan).toHaveBeenCalledTimes(1);

        setActiveRoot.mockImplementation((span?: Span) => {
            if (span === undefined) {
                throw new Error('boom');
            }
        });

        expect(() => stopBrowserTracing()).not.toThrow();

        // Teardown ran to the end, so the History patches came off: a further pushState opens no root.
        window.history.pushState({}, '', '/after');
        expect(startSpan).toHaveBeenCalledTimes(1);
    });

    it('stashes the pageload root when it opens', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare, startSpan } = fakeFlare();

        startBrowserTracing(flare);

        expect(pageloadRootForTests()).toBe(startSpan.mock.results[0].value);
        expect(pageloadRouteForTests()).toEqual({ name: '/product/p01', source: 'url' });
    });

    it('does not stash a navigation root as the pageload root', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadRootSpan = startSpan.mock.results[0].value;

        window.history.pushState({}, '', '/b');

        expect(pageloadRootForTests()).toBe(pageloadRootSpan);
    });

    it('keeps the pageload route pinned when a navigation root is named after it', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare } = fakeFlare();
        startBrowserTracing(flare);

        const source = registerNavigationSource();
        source.setActiveRouteName({ name: '/product/:id', source: 'route' });
        source.startNavigation({ path: '/cart' });
        source.setActiveRouteName({ name: '/cart', source: 'route' });

        expect(pageloadRouteForTests()).toEqual({ name: '/product/:id', source: 'route' });
    });

    it('keeps the pageload context pinned when a navigation root is given a different url', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare } = fakeFlare();
        startBrowserTracing(flare);

        const source = registerNavigationSource();
        source.setActiveRouteName({ name: '/product/:id', source: 'route', url: 'https://app.test/product/p01' });
        source.startNavigation({ path: '/cart' });
        source.setActiveRouteName({ name: '/cart', source: 'route', url: 'https://app.test/cart' });

        expect(pageloadContextForTests()['url.full']).toBe('https://app.test/product/p01');
    });

    it('drops the stashed pageload state on stop', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare } = fakeFlare();
        startBrowserTracing(flare);
        registerNavigationSource().setActiveRouteName({
            name: '/product/:id',
            source: 'route',
            url: 'https://app.test/product/p01',
        });

        stopBrowserTracing();

        expect(pageloadRootForTests()).toBeNull();
        expect(pageloadRouteForTests()).toBeNull();
        expect(pageloadContextForTests()).toEqual({});
    });

    /** Returns the fake callbacks so a test can drive further values later, e.g. to simulate a
     *  surviving upstream observer reporting again after a disable/re-enable (Finding 4). */
    function recordVitals() {
        const cbs: Record<string, (m: { value: number }) => void> = {};
        const keep = (key: string) => (cb: (m: { value: number }) => void) => {
            cbs[key] = cb;
        };
        // startBrowserTracing already latched the subscription with the real observers; clear it so
        // these fakes are what gets wired.
        resetWebVitalsForTests();
        startWebVitals({
            onTTFB: keep('ttfb'),
            onFCP: keep('fcp'),
            onLCP: keep('lcp'),
            onCLS: keep('cls'),
            onINP: keep('inp'),
        });
        cbs.lcp({ value: 2140 });
        cbs.cls({ value: 0.08 });
        return cbs;
    }

    function vitalsSpans(startSpan: ReturnType<typeof fakeFlare>['startSpan']) {
        return startSpan.mock.calls.filter(([, opts]) => opts?.spanType === 'browser_web_vital');
    }

    it('emits one vitals span on page hide, carrying every leftover value as an attribute', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare);
        recordVitals();

        window.dispatchEvent(new Event('pagehide'));

        const emitted = vitalsSpans(startSpan);
        expect(emitted.map(([name, opts]) => [name, opts.spanType])).toEqual([['/product/p01', 'browser_web_vital']]);
        expect(emitted[0][1].attributes?.['browser.web_vital.lcp']).toBe(2140);
        expect(emitted[0][1].attributes?.['browser.web_vital.cls']).toBe(0.08);
        expect(emitted[0][1].forceRoot).toBe(true);

        // It must be started before the only flush that will ever run on page hide, or the span sits in
        // the buffer after everything has already shipped and never goes out.
        const index = startSpan.mock.calls.findIndex(([, o]) => o?.spanType === 'browser_web_vital');
        expect(startSpan.mock.invocationCallOrder[index]).toBeLessThan(flush.mock.invocationCallOrder[0]);
    });

    it('has zero duration, so it cannot stretch the pageload root it hangs off', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadStart = startSpan.mock.calls[0][1].startTimeUnixNano;
        recordVitals();

        window.dispatchEvent(new Event('pagehide'));

        const [[, opts]] = vitalsSpans(startSpan);
        const span = startSpan.mock.results[startSpan.mock.calls.findIndex(([, o]) => o === opts)].value;
        expect(opts.startTimeUnixNano).toBe(pageloadStart);
        expect(span.end).toHaveBeenCalledWith(pageloadStart);
    });

    it('parents the container on the pageload root span itself, so sampling is inherited', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadRootSpan = startSpan.mock.results[0].value;
        recordVitals();

        window.dispatchEvent(new Event('pagehide'));

        // A bare { traceId, spanId } pair would make resolveTrace re-run the sampler and could reach
        // the opposite decision; passing the Span makes it read parent.isRecording instead.
        const container = vitalsSpans(startSpan).find(([, o]) => o.spanType === 'browser_web_vital');
        expect(container![1].parent).toBe(pageloadRootSpan);
    });

    it('renames the container when a router named the pageload route', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        registerNavigationSource().setActiveRouteName({ name: '/product/:id', source: 'route' });
        recordVitals();

        window.dispatchEvent(new Event('pagehide'));

        const container = vitalsSpans(startSpan).find(([, o]) => o.spanType === 'browser_web_vital');
        expect(container![0]).toBe('/product/:id');
        expect(container![1].attributes?.['flare.route.source']).toBe('route');
    });

    it('pins a late route rename to the vitals container after the pageload root idle window has closed', () => {
        // Finding 5: the pin used to sit inside withLiveController alongside the root rename, so once
        // the controller closed (idle timeout, no children) a later rename never reached the container,
        // which then shipped the raw pathname instead of the template.
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/product/p01');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);

        // idleTimeout is 1000ms; past it with no open children the controller has already closed the
        // pageload root. Renaming the (already-ended) root itself is correctly a no-op from here on.
        vi.advanceTimersByTime(1100);

        registerNavigationSource().setActiveRouteName({ name: '/product/:id', source: 'route' });
        recordVitals();

        window.dispatchEvent(new Event('pagehide'));

        const container = vitalsSpans(startSpan).find(([, o]) => o.spanType === 'browser_web_vital');
        expect(container![0]).toBe('/product/:id');
        expect(container![1].attributes?.['flare.route.source']).toBe('route');
    });

    it('emits only once across both triggers', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        recordVitals();

        // Cross trigger types, not the same one twice: a page hide takes the vitals, then a pushState
        // navigation must find takeWebVitals() already empty rather than emitting a second container.
        window.dispatchEvent(new Event('pagehide'));
        window.history.pushState({}, '', '/b');

        expect(vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital')).toHaveLength(1);
    });

    it.each([
        ['history pushState', () => window.history.pushState({}, '', '/b')],
        ['a framework navigation', () => registerNavigationSource().startNavigation({ path: '/cart' })],
    ])('does not emit on %s: LCP, CLS and INP are still moving', (_label, navigate) => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        recordVitals();

        navigate();

        expect(vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital')).toHaveLength(0);
    });

    it('emits the one container at page hide, carrying vitals that only reported after a navigation', () => {
        vi.useFakeTimers();
        window.history.replaceState({}, '', '/a');
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const cbs = recordVitals();

        window.history.pushState({}, '', '/b');
        cbs.inp({ value: 480 }); // the interaction that only happens after the user navigated

        window.dispatchEvent(new Event('pagehide'));

        const emitted = vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital');
        expect(emitted).toHaveLength(1);
        expect(emitted[0][1].attributes?.['browser.web_vital.inp']).toBe(480);
    });

    it('does not backdate a pageload root past a load event that already fired', () => {
        // The SDK booting long after load (lazy import, consent gate, throttled background tab) starts the
        // root at now(). loadEventEnd is then in the past and cannot be its close floor.
        vi.useFakeTimers();
        vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
            type === 'navigation' ? ([{ startTime: 0, loadEventEnd: 2000 }] as never) : [],
        );
        vi.spyOn(performance, 'now').mockReturnValue(60_000);
        const { flare, startSpan } = fakeFlare();

        startBrowserTracing(flare);
        const [, opts] = startSpan.mock.calls[0];
        const root = startSpan.mock.results[0].value;
        vi.advanceTimersByTime(1500);

        expect(root.end).toHaveBeenCalledTimes(1);
        expect(root.end.mock.calls[0][0]).toBeGreaterThanOrEqual(opts.startTimeUnixNano);
    });

    it('ends the pageload root before emitting, on page hide inside the idle window', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadRootSpan = startSpan.mock.results[0].value;
        recordVitals();

        // Under idleTimeout (1000ms), so the controller is still live and endNow() runs here rather
        // than the idle timer having already closed the root. Advancing past it would make this
        // assertion pass for the wrong reason.
        vi.advanceTimersByTime(200);
        window.dispatchEvent(new Event('pagehide'));

        expect(pageloadRootSpan.end).toHaveBeenCalledTimes(1);
        const containerCallIndex = startSpan.mock.calls.findIndex(([, o]) => o?.spanType === 'browser_web_vital');
        expect(containerCallIndex).toBeGreaterThan(-1);
        expect(startSpan.mock.invocationCallOrder[containerCallIndex]).toBeGreaterThan(
            pageloadRootSpan.end.mock.invocationCallOrder[0],
        );
    });

    it('emits nothing after a disable, even on re-enable and page hide', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        recordVitals();

        stopBrowserTracing();
        startSpan.mockClear();
        startBrowserTracing(flare);
        window.dispatchEvent(new Event('pagehide'));

        expect(vitalsSpans(startSpan)).toEqual([]);
    });

    it('does not ship a second container after a disable/re-enable, even if a surviving observer reports again', () => {
        // This is the scenario Finding 4 actually describes: unlike the test above, an emit already
        // succeeded once (a real container shipped) before the disable, so `taken` must stay sticky
        // across stopBrowserTracing()/startBrowserTracing() rather than resetting and letting a still-alive
        // upstream observer refill `collected` for a second report.
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const cbs = recordVitals();

        window.dispatchEvent(new Event('pagehide'));
        expect(vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital')).toHaveLength(1);

        stopBrowserTracing();
        startSpan.mockClear();
        startBrowserTracing(flare);

        // The same callback closure as before the disable: upstream has no unsubscribe, so this is
        // what a still-running observer calling back after the re-enable looks like.
        cbs.lcp({ value: 3000 });
        window.dispatchEvent(new Event('pagehide'));

        expect(vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital')).toHaveLength(0);
    });

    it('emits nothing when no vital ever reported', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);

        window.dispatchEvent(new Event('pagehide'));

        expect(vitalsSpans(startSpan)).toEqual([]);
    });

    it('does not let a startSpan error during the emit escape into the page-hide handler, and still flushes', () => {
        vi.useFakeTimers();
        const { flare, startSpan, flush } = fakeFlare();
        startBrowserTracing(flare); // consumes the pageload root's startSpan call
        recordVitals();
        startSpan.mockImplementationOnce(() => {
            throw new Error('tracer boom'); // the vitals container's startSpan call
        });

        expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();

        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });

    it('restores the vitals for a later retry when the container span fails to start (Finding 3)', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare); // consumes the pageload root's startSpan call
        recordVitals();
        startSpan.mockImplementationOnce(() => {
            throw new Error('tracer boom'); // the vitals container's startSpan call
        });

        window.dispatchEvent(new Event('pagehide'));

        // A failed emit must not permanently discard the page's vitals: the next hide has to see them
        // again rather than a latched empty take. mockClear() first so the failed call above (still
        // recorded as a call even though its implementation threw) does not muddy this count.
        startSpan.mockClear();
        window.dispatchEvent(new Event('pagehide'));

        const retried = vitalsSpans(startSpan).filter(([, o]) => o.spanType === 'browser_web_vital');
        expect(retried).toHaveLength(1);
        expect(retried[0][1].attributes?.['browser.web_vital.cls']).toBe(0.08);
    });

    it('stamps the already-final vitals on the pageload root, and leaves the rest for the late span', () => {
        vi.useFakeTimers();
        const { flare, startSpan } = fakeFlare();
        startBrowserTracing(flare);
        const pageloadRootSpan = startSpan.mock.results[0].value;
        const cbs = recordVitals();
        cbs.ttfb({ value: 210 });
        cbs.fcp({ value: 890 });

        window.dispatchEvent(new Event('pagehide'));

        // ttfb and fcp are final the moment they fire, so they ride the root itself. lcp and cls keep
        // changing until the page goes away, so stamping them here would leave the root and the late
        // span disagreeing about the same vital.
        expect(pageloadRootSpan.setAttribute).toHaveBeenCalledWith('browser.web_vital.ttfb', 210);
        expect(pageloadRootSpan.setAttribute).toHaveBeenCalledWith('browser.web_vital.fcp', 890);

        const [[, opts]] = vitalsSpans(startSpan);
        expect(opts.attributes?.['browser.web_vital.lcp']).toBe(2140);
        expect(opts.attributes?.['browser.web_vital.cls']).toBe(0.08);
        expect('browser.web_vital.ttfb' in (opts.attributes ?? {})).toBe(false);
        expect('browser.web_vital.fcp' in (opts.attributes ?? {})).toBe(false);
    });
});
