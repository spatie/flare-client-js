import type { Config } from '@flareapp/core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { setInstrumentationConfig } from '../src/instrument/config';
import {
    resetRequestInstrumentationForTests,
    setRequestStartHandler,
    type RequestContext,
    type RequestResult,
} from '../src/instrument/request';
import { startTracingRequests, tracingRequestHandlers } from '../src/tracing/traceRequests';
import { fixedUrls, makeTracer } from './helpers';

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
    // Belt and braces: test 13 releases its own registration, but this guards the rest of the suite
    // (and the run) against the module-global start slot staying claimed if it doesn't.
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
        const instrumentConfig = {
            enableTracing: true,
            ingestUrl: 'https://ingest.test/v1/errors',
            logsIngestUrl: 'https://ingest.test/v1/logs',
            tracesIngestUrl: 'https://ingest.test/v1/traces',
        } as unknown as Config;
        setInstrumentationConfig(() => instrumentConfig);

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
