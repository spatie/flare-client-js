// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserSpanType } from '../src/tracing/spanTypes';
import {
    buildVitalsSpan,
    resetWebVitalsForTests,
    restoreWebVitals,
    startWebVitals,
    stopWebVitals,
    takeEarlyVitals,
    takeWebVitals,
    vitalAttributes,
} from '../src/tracing/webVitals';
import { onCLS } from '../src/tracing/webvitals/onCLS';
import { onFCP } from '../src/tracing/webvitals/onFCP';
import { onINP } from '../src/tracing/webvitals/onINP';
import { onLCP } from '../src/tracing/webvitals/onLCP';
import { onTTFB } from '../src/tracing/webvitals/onTTFB';

describe('vendored web-vitals', () => {
    it('exposes the five metric entry points', () => {
        for (const fn of [onCLS, onFCP, onINP, onLCP, onTTFB]) {
            expect(typeof fn).toBe('function');
        }
    });
});

// Regression guard for Finding 1: upstream's bindReporter only invokes our callback on a forced
// report unless `reportAllChanges` is set (webvitals/lib/bindReporter.ts). LCP, CLS and INP only
// force-report from a bfcache restore or a soft-navigation entry, neither of which this SDK uses, so
// without `reportAllChanges: true` a mid-page value (the only kind an SPA navigation trigger ever sees)
// never reaches `takeWebVitals()`. This drives the REAL vendored `onLCP`, not a fake subscriber, so it
// is the one test in this file that would actually catch that regression.
describe('drives a real upstream observer (Finding 1 regression guard)', () => {
    type ObserverList = { getEntries: () => unknown[] };
    type ObserverCallback = (list: ObserverList) => void;

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (performance as unknown as { getEntriesByType?: unknown }).getEntriesByType;
        resetWebVitalsForTests();
    });

    it('reports LCP off a single, non-forced observer entry, which only happens with reportAllChanges', async () => {
        const observers: Array<{ type: string; callback: ObserverCallback }> = [];

        class FakePerformanceObserver {
            static supportedEntryTypes = ['largest-contentful-paint'];
            private callback: ObserverCallback;
            constructor(callback: ObserverCallback) {
                this.callback = callback;
            }
            observe(init: { type: string }) {
                observers.push({ type: init.type, callback: this.callback });
            }
            disconnect() {}
        }

        vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
        // jsdom's Performance object has no getEntriesByType at all. The vendored code calls it
        // unconditionally while resolving activationStart and the navigation entry, so it must return
        // something rather than throw the moment onLCP() runs.
        (performance as unknown as { getEntriesByType: () => unknown[] }).getEntriesByType = () => [];

        startWebVitals(); // wires the REAL vendored on* functions, not a fake VitalSubscribers

        const lcpObserver = observers.find((o) => o.type === 'largest-contentful-paint');
        expect(lcpObserver).toBeDefined();

        // A plain entry, not a click/keydown/visibilitychange: this is the per-entry path
        // (onLCP.ts's handleEntries -> bare `report()`), not the finalize path that already forces.
        lcpObserver!.callback({
            getEntries: () => [{ entryType: 'largest-contentful-paint', startTime: 2140 }],
        });

        // observe() defers entry delivery by a microtask (a Safari workaround); let it run.
        await Promise.resolve();

        expect(takeWebVitals()).toEqual({ lcp: 2140 });
    });
});

const ORIGIN_MS = 1_700_000_000_000;
const ORIGIN_NANO = ORIGIN_MS * 1e6;

function plan(vitals: Parameters<typeof buildVitalsSpan>[0]['vitals']) {
    return buildVitalsSpan({
        vitals,
        rootStartTimeUnixNano: ORIGIN_NANO,
        routeName: '/product/:id',
        routeSource: 'route',
        contextAttributes: { 'url.full': 'https://shop.test/product/p01' },
    });
}

describe('vitalAttributes', () => {
    it('pins the wire keys, which the backend reads the values out of', () => {
        expect(vitalAttributes({ ttfb: 200, fcp: 500, lcp: 14430, cls: 0.003, inp: 200 })).toEqual({
            'browser.web_vital.ttfb': 200,
            'browser.web_vital.fcp': 500,
            'browser.web_vital.lcp': 14430,
            'browser.web_vital.cls': 0.003,
            'browser.web_vital.inp': 200,
        });
    });

    it('omits a vital that never reported rather than sending zero', () => {
        // CLS is Chromium-only, so a 0 from Firefox would read as a page with no layout shift.
        expect(vitalAttributes({ lcp: 2140 })).toEqual({ 'browser.web_vital.lcp': 2140 });
    });

    it('keeps cls as the raw float, never scaled', () => {
        expect(vitalAttributes({ cls: 0.08 })['browser.web_vital.cls']).toBe(0.08);
    });
});

describe('buildVitalsSpan', () => {
    it('pins the wire string, which the backend groups on', () => {
        expect(BrowserSpanType.WebVital).toBe('browser_web_vital');
    });

    it('carries the leftover vitals as attributes', () => {
        const result = plan({ lcp: 2140, cls: 0.08, inp: 190 });

        expect(result!.attributes['browser.web_vital.lcp']).toBe(2140);
        expect(result!.attributes['browser.web_vital.cls']).toBe(0.08);
        expect(result!.attributes['browser.web_vital.inp']).toBe(190);
    });

    it('has zero duration, both marks at the pageload root start', () => {
        // spans_2 buckets on start_time_unix_nano: stamping the report moment would file a page left
        // open for forty minutes into a minute forty minutes after it actually loaded.
        const result = plan({ lcp: 2140 });

        expect(result!.startTimeUnixNano).toBe(ORIGIN_NANO);
        expect(result!.endTimeUnixNano).toBe(ORIGIN_NANO);
    });

    it('copies the route onto the span, so nothing has to be joined back to the pageload', () => {
        const result = plan({ lcp: 2140 });

        expect(result!.name).toBe('/product/:id');
        expect(result!.attributes['flare.entry_point.handler.identifier']).toBe('/product/:id');
        expect(result!.attributes['flare.route.source']).toBe('route');
        expect(result!.attributes['url.full']).toBe('https://shop.test/product/p01');
    });

    it('returns null when nothing is left to report', () => {
        expect(plan({})).toBeNull();
    });
});

describe('takeEarlyVitals', () => {
    beforeEach(() => {
        resetWebVitalsForTests();
    });

    it('takes only the vitals that are already final, leaving the rest for the late span', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.ttfb({ value: 210 });
        cbs.fcp({ value: 890 });
        cbs.lcp({ value: 2140 });
        cbs.cls({ value: 0.08 });
        cbs.inp({ value: 190 });

        expect(takeEarlyVitals()).toEqual({ ttfb: 210, fcp: 890 });
        expect(takeWebVitals()).toEqual({ lcp: 2140, cls: 0.08, inp: 190 });
    });

    it('never reports the same vital twice', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.ttfb({ value: 210 });

        expect(takeEarlyVitals()).toEqual({ ttfb: 210 });
        expect(takeWebVitals()).toBeNull();
    });

    it('is idempotent, because a second close must not restamp', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.fcp({ value: 890 });

        expect(takeEarlyVitals()).toEqual({ fcp: 890 });
        expect(takeEarlyVitals()).toBeNull();
    });

    it('returns null when neither has reported by the time the root closes', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.lcp({ value: 2140 });

        expect(takeEarlyVitals()).toBeNull();
        // and the late span still gets lcp
        expect(takeWebVitals()).toEqual({ lcp: 2140 });
    });

    it('reports nothing once recording is off', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.ttfb({ value: 210 });
        stopWebVitals();

        expect(takeEarlyVitals()).toBeNull();
    });
});

type Cb = (metric: { value: number }) => void;

function fakeSubscribers() {
    const cbs: Record<string, Cb> = {};
    const keep = (key: string) => (cb: Cb) => {
        cbs[key] = cb;
    };
    return {
        cbs,
        subscribers: {
            onTTFB: keep('ttfb'),
            onFCP: keep('fcp'),
            onLCP: keep('lcp'),
            onCLS: keep('cls'),
            onINP: keep('inp'),
        },
    };
}

describe('web vitals collection', () => {
    beforeEach(() => {
        // Clears the subscribe latch too. stopWebVitals() alone would leave it set and every test
        // after the first would get an empty `cbs`.
        resetWebVitalsForTests();
    });

    it('records the latest value per vital', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);

        cbs.lcp({ value: 1200 });
        cbs.lcp({ value: 2140 });
        cbs.cls({ value: 0.08 });

        expect(takeWebVitals()).toEqual({ lcp: 2140, cls: 0.08 });
    });

    it('returns the values once and never again', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.ttfb({ value: 210 });

        expect(takeWebVitals()).toEqual({ ttfb: 210 });
        expect(takeWebVitals()).toBeNull();
    });

    it('restoreWebVitals puts the values back and clears the taken latch so a later trigger can retry', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.lcp({ value: 2140 });
        cbs.cls({ value: 0.08 });

        const taken = takeWebVitals();
        expect(taken).toEqual({ lcp: 2140, cls: 0.08 });
        expect(takeWebVitals()).toBeNull(); // still latched

        restoreWebVitals(taken!);

        expect(takeWebVitals()).toEqual({ lcp: 2140, cls: 0.08 });
    });

    it('returns null when nothing was ever recorded', () => {
        const { subscribers } = fakeSubscribers();
        startWebVitals(subscribers);

        expect(takeWebVitals()).toBeNull();
    });

    it('stops recording after stopWebVitals, and reports nothing', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.lcp({ value: 2140 });

        stopWebVitals();
        cbs.lcp({ value: 3000 });

        expect(takeWebVitals()).toBeNull();
    });

    it('clears collected values on stop, so a restart does not resurrect them', () => {
        const { cbs, subscribers } = fakeSubscribers();
        startWebVitals(subscribers);
        cbs.ttfb({ value: 210 });

        stopWebVitals();
        // Back to recording without clearing the latch, so `collected` being empty is the only
        // reason a take can fail here.
        startWebVitals(subscribers);

        expect(takeWebVitals()).toBeNull();
    });

    it('keeps the taken latch sticky across a stop, so a re-enable cannot ship a second report', () => {
        // The upstream observers cannot be detached, so a disable/re-enable cycle leaves the original
        // callback closure alive and free to fire again. Reusing it here (rather than wiring a fresh
        // one) is what simulates that: one document must still get exactly one report.
        const first = fakeSubscribers();
        startWebVitals(first.subscribers);
        first.cbs.ttfb({ value: 210 });
        expect(takeWebVitals()).toEqual({ ttfb: 210 }); // sets taken = true

        stopWebVitals();
        startWebVitals(first.subscribers); // re-enable, same document, no resetWebVitalsForTests()

        first.cbs.ttfb({ value: 220 }); // the surviving observer reports again

        expect(takeWebVitals()).toBeNull();
    });

    it('only resetWebVitalsForTests clears the taken latch, not stopWebVitals', () => {
        const first = fakeSubscribers();
        startWebVitals(first.subscribers);
        first.cbs.ttfb({ value: 210 });
        takeWebVitals();

        stopWebVitals();
        resetWebVitalsForTests();

        const second = fakeSubscribers();
        startWebVitals(second.subscribers);
        second.cbs.ttfb({ value: 220 });

        expect(takeWebVitals()).toEqual({ ttfb: 220 });
    });

    it('subscribes once per document, because upstream has no unsubscribe', () => {
        const first = fakeSubscribers();
        startWebVitals(first.subscribers);
        stopWebVitals();

        const second = fakeSubscribers();
        startWebVitals(second.subscribers);

        expect(Object.keys(second.cbs)).toEqual([]);
        first.cbs.lcp({ value: 2140 });
        expect(takeWebVitals()).toEqual({ lcp: 2140 });
    });
});
