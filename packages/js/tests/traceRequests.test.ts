import type { SpanOptions } from '@flareapp/core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
    resetRequestInstrumentationForTests,
    setRequestStartHandler,
    type RequestContext,
    type RequestResult,
} from '../src/instrument/request';
import { startTracingRequests, tracingRequestHandlers } from '../src/tracing/traceRequests';
import { fixedUrls, makeTracer, useInstrumentationConfig } from './helpers';

function context(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
        kind: 'fetch',
        method: 'GET',
        url: 'https://api.test/products',
        absoluteUrl: new URL('https://api.test/products'),
        startTimeUnixNano: 1_000,
        ...overrides,
    };
}

function result(overrides: Partial<RequestResult> = {}): RequestResult {
    return { status: 200, endTimeUnixNano: 2_000, ...overrides };
}

const ORIGIN = 'https://api.test';
const URLS = fixedUrls(ORIGIN);

describe('tracingRequestHandlers', () => {
    // Belt and braces: the registration test releases its own handlers, but this guards the rest of
    // the suite (and the run) against the module-global start slot staying claimed if it doesn't.
    afterEach(() => {
        resetRequestInstrumentationForTests();
    });

    test('opens a browser_fetch span named "GET /products"', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        onStart(context());

        expect(startSpan).toHaveBeenCalledWith('GET /products', {
            spanType: 'browser_fetch',
            attributes: {
                'http.request.method': 'GET',
                'url.full': 'https://api.test/products',
                'url.scheme': 'https',
                'url.path': '/products',
                'server.address': 'api.test',
            },
        });
    });

    test('names the span from the method and the resolved pathname, leaving the query out', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        onStart(
            context({ method: 'POST', url: '/orders?token=abc', absoluteUrl: new URL(`${ORIGIN}/orders?token=abc`) }),
        );

        expect(startSpan).toHaveBeenCalledWith('POST /orders', expect.anything());
    });

    test('falls back to the raw url in the span name when it could not be resolved', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        onStart(context({ url: 'http://[', absoluteUrl: null }));

        expect(startSpan).toHaveBeenCalledWith('GET http://[', expect.anything());
    });

    test('redacts denylisted query params in url.full and url.query', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);
        const url = `${ORIGIN}/reset?token=abc123&page=2`;

        onStart(context({ url, absoluteUrl: new URL(url) }));

        const attributes = (startSpan.mock.calls[0][1] as SpanOptions).attributes as Record<string, string>;
        expect(attributes['url.full']).toBe(`${ORIGIN}/reset?token=[redacted]&page=2`);
        expect(attributes['url.query']).toBe('token=[redacted]&page=2');
    });

    test('opens a browser_xhr span for an xhr context', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        onStart(context({ kind: 'xhr' }));

        expect(startSpan).toHaveBeenCalledWith('GET /products', expect.objectContaining({ spanType: 'browser_xhr' }));
    });

    test('returns a traceparent for a propagation-eligible url', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        const traceparent = onStart(context());

        expect(traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
        expect(startSpan).toHaveBeenCalledOnce();
    });

    test('returns no traceparent cross-origin by default, but still opens the span', () => {
        const { tracer, startSpan } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);
        const url = 'https://third-party.example/track';

        const traceparent = onStart(context({ url, absoluteUrl: new URL(url) }));

        expect(traceparent).toBeNull();
        expect(startSpan).toHaveBeenCalledOnce();
    });

    test('returns no traceparent when a cross-origin <base href> took a relative url off-origin', () => {
        const { tracer } = makeTracer();
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        // Injecting here would turn a simple request into a preflighted one and break it.
        const traceparent = onStart(
            context({ url: 'data.json', absoluteUrl: new URL('https://cdn.other.example/assets/data.json') }),
        );

        expect(traceparent).toBeNull();
    });

    test('returns a traceparent for a relative same-origin url when tracePropagationTargets is set', () => {
        const { tracer } = makeTracer({ tracePropagationTargets: ['api.test'] });
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        const traceparent = onStart(context({ url: '/products' }));

        expect(traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    });

    test('flags the traceparent 00 when the span is not recording', () => {
        const { tracer, span } = makeTracer();
        (span as { isRecording: boolean }).isRecording = false;
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        expect(onStart(context())).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`);
    });

    test('returns null for a url the propagation targets exclude', () => {
        const { tracer, startSpan } = makeTracer({ tracePropagationTargets: ['other.example'] });
        const { onStart } = tracingRequestHandlers(tracer, URLS);

        const traceparent = onStart(context());

        expect(traceparent).toBeNull();
        // Returning null must never mean "no span": the owner still has to open one so the request is
        // recorded, even though it will not carry a traceparent.
        expect(startSpan).toHaveBeenCalledOnce();
    });

    test('opens no span and returns no traceparent when tracing is off', () => {
        const { tracer, startSpan, calls } = makeTracer({ enableTracing: false });
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context();

        const traceparent = onStart(ctx);

        expect(traceparent).toBeNull();
        expect(startSpan).not.toHaveBeenCalled();

        onSettle(ctx, result());

        expect(calls.ended).toBe(false);
    });

    test('ends the span with the response status', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context();

        onStart(ctx);
        onSettle(ctx, result({ status: 204 }));

        expect(calls.attrs['http.response.status_code']).toBe(204);
        expect(calls.status).toBeUndefined();
        expect(calls.ended).toBe(true);
    });

    test('marks a 500 as an error', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context();

        onStart(ctx);
        onSettle(ctx, result({ status: 503 }));

        expect(calls.attrs['http.response.status_code']).toBe(503);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    test('marks a rejected request as an error and keeps the reason', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context();

        onStart(ctx);
        onSettle(ctx, result({ status: 0, error: new Error('network down') }));

        expect(calls.status).toEqual({ code: 2, message: 'network down' });
        expect(calls.ended).toBe(true);
    });

    test('maps status 0 to an error for an xhr on http(s)', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context({ kind: 'xhr' });

        onStart(ctx);
        onSettle(ctx, result({ status: 0 }));

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    test('maps status 0 to an error for an xhr on plain http too', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const url = 'http://api.test/products';
        const ctx = context({ kind: 'xhr', url, absoluteUrl: new URL(url) });

        onStart(ctx);
        onSettle(ctx, result({ status: 0 }));

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toEqual({ code: 2 });
    });

    test('leaves status 0 alone for an xhr on a file: url', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context({
            kind: 'xhr',
            url: 'file:///local/report.json',
            absoluteUrl: new URL('file:///local/report.json'),
        });

        onStart(ctx);
        onSettle(ctx, result({ status: 0 }));

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toBeUndefined();
        expect(calls.ended).toBe(true);
    });

    test('leaves status 0 alone for a fetch (an opaque no-cors response is not a failure)', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context(); // kind: 'fetch'

        onStart(ctx);
        onSettle(ctx, result({ status: 0 }));

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toBeUndefined();
        expect(calls.ended).toBe(true);
    });

    test('ends an aborted xhr with a bare error status: no message, no status-code attribute', () => {
        const { tracer, calls } = makeTracer();
        const { onStart, onSettle } = tracingRequestHandlers(tracer, URLS);
        const ctx = context({ kind: 'xhr' });

        onStart(ctx);
        onSettle(ctx, result({ status: 0, aborted: true }));

        expect(calls.status).toEqual({ code: 2 });
        expect(calls.attrs['http.response.status_code']).toBeUndefined();
        expect(calls.ended).toBe(true);
    });

    test('ends nothing when the settle arrives for a request it never started', () => {
        const { tracer, calls } = makeTracer();
        const { onSettle } = tracingRequestHandlers(tracer, URLS);

        onSettle(context(), result());

        expect(calls.ended).toBe(false);
    });

    test('unsubscribing frees the start slot for the next owner', async () => {
        useInstrumentationConfig({
            ingestUrl: 'https://ingest.test/v1/errors',
            logsIngestUrl: 'https://ingest.test/v1/logs',
            tracesIngestUrl: 'https://ingest.test/v1/traces',
        });

        const nativeFetch = globalThis.fetch;
        // Native-looking (bound) stub, matching the pattern instrumentRequest.test.ts uses to satisfy
        // the supportsNativeFetch guard, so the request patch actually installs.
        const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
        globalThis.fetch = fetchMock.bind(null) as unknown as typeof fetch;

        try {
            const { tracer } = makeTracer();
            const stopTracing = startTracingRequests(tracer, URLS);

            const other = vi.fn(() => null);
            setRequestStartHandler(other); // refused while tracing owns the slot

            await fetch('https://api.test/products');
            expect(other).not.toHaveBeenCalled();

            stopTracing();

            const stopOther = setRequestStartHandler(other); // the slot is free: this owner is accepted
            await fetch('https://api.test/products');
            expect(other).toHaveBeenCalledTimes(1);

            stopOther();
        } finally {
            globalThis.fetch = nativeFetch;
        }
    });
});
