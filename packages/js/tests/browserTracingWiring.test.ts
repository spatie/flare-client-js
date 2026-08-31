// @vitest-environment jsdom
import type { OtelSpan } from '@flareapp/core';
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { unpatchFetch } from '../src/instrumentation/requests';
import { unpatchXHR } from '../src/instrumentation/requests';
import { resetRequestPatches } from '../src/instrumentation/requests';
import { stopBrowserTracing } from '../src/tracing/roots';
import { BrowserSpanType } from '../src/tracing/spanTypes';
import { resetWebVitalsForTests, startWebVitals } from '../src/tracing/vitals';
import { FakeApi } from './helpers';

// OTLP KeyValue array back to a plain lookup.
function attrs(span: OtelSpan): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const kv of span.attributes) {
        out[kv.key] = Object.values(kv.value)[0];
    }
    return out;
}

function flushed(api: FakeApi): OtelSpan[] {
    return api.traceEnvelopes.flatMap((e) => e.resourceSpans[0].scopeSpans[0].spans);
}

// Real vitals never fire under jsdom, so this wires fake subscribers, like browserTracing.test.ts does.
// Reports one LCP value: the pageload root's early stamp never takes LCP, so it stays for the late span.
function recordLcp(value: number): void {
    resetWebVitalsForTests();
    let reportLcp: ((metric: { value: number }) => void) | undefined;
    startWebVitals({
        onTTFB: () => {},
        onFCP: () => {},
        onLCP: (cb) => {
            reportLcp = cb;
        },
        onCLS: () => {},
        onINP: () => {},
    });
    reportLcp?.({ value });
}

function vitalsSpans(api: FakeApi): OtelSpan[] {
    return flushed(api).filter((span) => attrs(span)['flare.span_type'] === BrowserSpanType.WebVital);
}

describe('Flare browser tracing wiring', () => {
    afterEach(() => {
        stopBrowserTracing();
        unpatchFetch();
        unpatchXHR();
        // Forcing the patches off here bypasses the subscription count, so put it back to zero.
        resetRequestPatches();
        resetWebVitalsForTests();
    });

    it('enabling tracing starts a pageload root (active), disabling clears it', () => {
        const flare = new Flare();
        expect(flare.tracer.getActiveSpan()).toBeUndefined();

        flare.configure({ enableTracing: true });
        expect(flare.tracer.getActiveSpan()).toBeDefined();

        flare.configure({ enableTracing: false });
        expect(flare.tracer.getActiveSpan()).toBeUndefined();
    });

    it('pagehide ends the open pageload root so it ships with its children', () => {
        const flare = new Flare();
        flare.configure({ enableTracing: true });
        expect(flare.tracer.getActiveSpan()).toBeDefined();

        window.dispatchEvent(new Event('pagehide'));

        expect(flare.tracer.getActiveSpan()).toBeUndefined();
    });

    it('an unsampled pageload emits no vitals spans on page hide', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({
            key: 'test-key',
            enableTracing: true,
            // Root unsampled, everything else sampled. Inheriting the root's decision drops the vitals; the bug
            // this guards against re-rolls the sampler and ships them anyway. tracesSampleRate: 0 cannot test this.
            tracesSampler: (ctx) => ctx.spanType !== BrowserSpanType.Pageload,
        });
        recordLcp(2140);

        window.dispatchEvent(new Event('pagehide'));

        expect(vitalsSpans(api)).toEqual([]);
    });

    it('a sampled pageload ships one vitals span carrying the value as an attribute', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ key: 'test-key', enableTracing: true, tracesSampler: () => true });
        recordLcp(2140);

        window.dispatchEvent(new Event('pagehide'));

        // Positive control for the test above, and an end-to-end guard that the emit is wired ahead of
        // the keepalive flush: without both, this list would come back empty too.
        const spans = vitalsSpans(api);
        expect(spans).toHaveLength(1);
        expect(attrs(spans[0])['browser.web_vital.lcp']).toBe(2140);
    });

    it('enabling tracing patches XMLHttpRequest.prototype.send, disabling restores it', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const nativeSend = proto.send;
        const flare = new Flare();

        flare.configure({ enableTracing: true });
        expect((proto.send as { __flare_original__?: unknown }).__flare_original__).toBe(nativeSend);

        flare.configure({ enableTracing: false });
        expect(proto.send).toBe(nativeSend);
    });
});
