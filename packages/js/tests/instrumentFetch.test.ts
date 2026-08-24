import type { SpanOptions } from '@flareapp/core';
import { nativeFetchStub } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instrumentFetch, unpatchFetch } from '../src/instrumentation/instrumentFetch';
import { resetRequestBus } from '../src/instrumentation/requestBus';
import { internalRequestInit } from '../src/tracing/internalRequest';
import { traceRequests } from '../src/tracing/traceRequests';
import { fixedUrls, makeTracer, tracedFetch } from './helpers';

const ORIGIN = 'https://app.example';
const URLS = fixedUrls(ORIGIN);

beforeEach(() => resetRequestBus());

const okFetch = (status = 200) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

describe('traced fetch', () => {
    it('creates a browser_fetch span with method/url attributes and injects traceparent same-origin', async () => {
        const { tracer, startSpan, calls } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://app.example/api/products');

        expect(startSpan).toHaveBeenCalledWith('GET /api/products', {
            spanType: 'browser_fetch',
            attributes: {
                'http.request.method': 'GET',
                'url.full': 'https://app.example/api/products',
                'url.scheme': 'https',
                'url.path': '/api/products',
                'server.address': 'app.example',
            },
        });
        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe(
            `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        );
        expect(calls.attrs['http.response.status_code']).toBe(200);
        expect(calls.ended).toBe(true);
    });

    it('takes the method from a Request object when the init has none', async () => {
        const { tracer, startSpan } = makeTracer();
        const wrapped = tracedFetch(tracer, okFetch(), URLS);

        await wrapped(new Request('https://app.example/api/orders', { method: 'POST' }));

        const [name, opts] = startSpan.mock.calls[0];
        expect(name).toBe('POST /api/orders');
        expect((opts as SpanOptions).attributes?.['http.request.method']).toBe('POST');
    });

    it('redacts denylisted query params in url.full and url.query', async () => {
        const { tracer, startSpan } = makeTracer();
        const wrapped = tracedFetch(tracer, okFetch(), URLS);

        await wrapped('https://app.example/api/reset?token=abc123&page=2');

        const attributes = (startSpan.mock.calls[0][1] as SpanOptions).attributes as Record<string, string>;
        expect(attributes['url.full']).toBe('https://app.example/api/reset?token=[redacted]&page=2');
        expect(attributes['url.query']).toBe('token=[redacted]&page=2');
    });

    it('does NOT inject traceparent cross-origin by default (span still created)', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://third-party.example/track');

        expect(startSpan).toHaveBeenCalledOnce();
        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as
            | RequestInit
            | undefined;
        const headers = (passedInit?.headers ?? {}) as Record<string, string>;
        expect(headers.traceparent).toBeUndefined();
    });

    it('does not inject our traceparent when the app already set one (caller wins, matching XHR)', async () => {
        const { tracer } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://app.example/api/x', { headers: { traceparent: '00-appappapp-child-01' } });

        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe('00-appappapp-child-01');
    });

    it('marks error status on HTTP >= 500', async () => {
        const { tracer, calls } = makeTracer();
        const wrapped = tracedFetch(tracer, okFetch(503), URLS);

        await wrapped('https://app.example/api/x');

        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('marks error status and rethrows on network failure', async () => {
        const { tracer, calls } = makeTracer();
        const original = vi.fn(async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;
        const wrapped = tracedFetch(tracer, original, URLS);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('network down');
        expect(calls.status).toEqual({ code: 2, message: 'network down' });
        expect(calls.ended).toBe(true);
    });

    it('ends the span and rethrows when the underlying fetch throws synchronously', async () => {
        const { tracer, calls } = makeTracer();
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const wrapped = tracedFetch(tracer, original, URLS);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('sync boom');
        expect(calls.status).toEqual({ code: 2, message: 'sync boom' });
        expect(calls.ended).toBe(true);
    });

    it('skips Flare ingest URLs entirely (no span, passthrough)', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://ingress.flareapp.io/v1/traces');

        expect(startSpan).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledOnce();
    });

    it('skips a request marked internal, and does not propagate on it', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        // A snippet fetch targets the app's own asset, so it is same-origin and would otherwise be
        // both traced and given a traceparent.
        await wrapped('https://app.example/assets/index.js', internalRequestInit());

        expect(startSpan).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledOnce();
        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string> | undefined)?.traceparent).toBeUndefined();
    });

    it('does not trace the flush POST when the traces ingest URL is relative', async () => {
        const { tracer, startSpan } = makeTracer({ tracesIngestUrl: '/flare/v1/traces' });
        const wrapped = tracedFetch(tracer, okFetch(), URLS);

        await wrapped('/flare/v1/traces', { method: 'POST' });

        expect(startSpan).not.toHaveBeenCalled();
    });

    it('passes through untouched when tracing is disabled', async () => {
        const { tracer, startSpan } = makeTracer({ enableTracing: false });
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://app.example/api/x');

        expect(startSpan).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledOnce();
    });

    it('calls the underlying fetch exactly once and propagates a synchronous throw when tracing is disabled', async () => {
        const { tracer } = makeTracer({ enableTracing: false });
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const wrapped = tracedFetch(tracer, original, URLS);

        expect(() => wrapped('https://app.example/api/x')).toThrow('sync boom');
        expect(original).toHaveBeenCalledOnce();
    });

    it('calls the underlying fetch exactly once and propagates a synchronous throw for an internal request', async () => {
        const { tracer } = makeTracer();
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const wrapped = tracedFetch(tracer, original, URLS);

        expect(() => wrapped('https://app.example/assets/index.js', internalRequestInit())).toThrow('sync boom');
        expect(original).toHaveBeenCalledOnce();
    });

    it('injects traceparent with flag 00 when the span is not recording', async () => {
        const { tracer, span } = makeTracer();
        (span as { isRecording: boolean }).isRecording = false;
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('/api/x'); // relative → same-origin

        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe(
            `00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`,
        );
    });

    it('resolves a bare-relative URL against the document base, not the origin', async () => {
        const { tracer, startSpan } = makeTracer();
        const wrapped = tracedFetch(tracer, okFetch(), fixedUrls(ORIGIN, `${ORIGIN}/store/`));

        await wrapped('api/products'); // the browser sends this to /store/api/products

        expect(startSpan).toHaveBeenCalledWith('GET /store/api/products', {
            spanType: 'browser_fetch',
            attributes: expect.objectContaining({ 'url.full': `${ORIGIN}/store/api/products` }),
        });
    });

    it('re-reads the base per request, so a pushState navigation relabels later fetches', async () => {
        const { tracer, startSpan } = makeTracer();
        let base = `${ORIGIN}/store/`;
        const wrapped = tracedFetch(
            tracer,
            okFetch(),
            fixedUrls(ORIGIN, () => base),
        );

        await wrapped('api/products');
        base = `${ORIGIN}/store/cart/`;
        await wrapped('api/products');

        expect(startSpan.mock.calls.map((call) => call[0])).toEqual([
            'GET /store/api/products',
            'GET /store/cart/api/products',
        ]);
    });

    it('does NOT inject traceparent when a cross-origin <base href> takes a relative URL off-origin', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, fixedUrls(ORIGIN, 'https://cdn.other.example/assets/'));

        await wrapped('data.json');

        const attributes = (startSpan.mock.calls[0][1] as SpanOptions).attributes as Record<string, string>;
        expect(attributes['url.full']).toBe('https://cdn.other.example/assets/data.json');
        // Injecting here would turn a simple request into a preflighted one and break it.
        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as
            | RequestInit
            | undefined;
        expect(((passedInit?.headers ?? {}) as Record<string, string>).traceparent).toBeUndefined();
    });

    it('injects traceparent for a relative same-origin URL when tracePropagationTargets is set', async () => {
        const { tracer } = makeTracer({ tracePropagationTargets: ['app.example'] });
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS); // ORIGIN = 'https://app.example'

        await wrapped('/api/products'); // relative → absolutizes to https://app.example/api/products

        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe(
            `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        );
    });
});

// The host's fetch must survive our tracing throwing. Every seam below is reachable from user input or
// user config, so none of them can be assumed infallible.
describe('traced fetch never breaks the host fetch', () => {
    it('still performs the request when starting the span throws', async () => {
        const { tracer } = makeTracer();
        tracer.startSpan = vi.fn(() => {
            throw new Error('span setup exploded');
        });
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        const response = await wrapped('https://app.example/api/x');

        expect(response.status).toBe(200);
        expect(original).toHaveBeenCalledOnce();
    });

    it('calls the underlying fetch exactly once when starting the span throws', async () => {
        const { tracer } = makeTracer();
        tracer.startSpan = vi.fn(() => {
            throw new Error('span setup exploded');
        });
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);

        await wrapped('https://app.example/api/x');

        expect(original).toHaveBeenCalledOnce();
    });

    it('still performs the request when the input url getter throws', async () => {
        const { tracer } = makeTracer();
        const original = okFetch();
        const wrapped = tracedFetch(tracer, original, URLS);
        const hostileInput = {
            toString() {
                throw new Error('hostile input');
            },
        };

        const response = await wrapped(hostileInput as unknown as string);

        expect(response.status).toBe(200);
        expect(original).toHaveBeenCalledOnce();
    });

    it('still resolves with the response when ending the span throws', async () => {
        const { tracer, span } = makeTracer();
        span.end = vi.fn(() => {
            throw new Error('end exploded');
        });
        const wrapped = tracedFetch(tracer, okFetch(), URLS);

        const response = await wrapped('https://app.example/api/x');

        expect(response.status).toBe(200);
    });

    it('still rejects with the host error when ending the errored span throws', async () => {
        const { tracer, span } = makeTracer();
        span.end = vi.fn(() => {
            throw new Error('end exploded');
        });
        const boom = new Error('network down');
        const original = vi.fn(async () => {
            throw boom;
        }) as unknown as typeof fetch;
        const wrapped = tracedFetch(tracer, original, URLS);

        await expect(wrapped('https://app.example/api/x')).rejects.toBe(boom);
    });
});

describe('instrumentFetch / unpatchFetch on globalThis', () => {
    it('patches global fetch when native, then restores it', async () => {
        const g = globalThis as { fetch: typeof fetch };
        const native = nativeFetchStub();
        const before = g.fetch;
        g.fetch = native;

        try {
            const { tracer, startSpan } = makeTracer();
            traceRequests(tracer, URLS);
            instrumentFetch();
            expect(g.fetch).not.toBe(native); // wrapped
            expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);

            await g.fetch('https://app.example/api/x');
            expect(startSpan).toHaveBeenCalledOnce();

            unpatchFetch();
            expect(g.fetch).toBe(native); // restored
        } finally {
            g.fetch = before;
        }
    });

    it('does not double-wrap on re-enable when a third party wrapped fetch after Flare', async () => {
        const g = globalThis as { fetch: typeof fetch };
        const native = nativeFetchStub();
        const before = g.fetch;
        g.fetch = native;

        try {
            const { tracer, startSpan } = makeTracer();
            traceRequests(tracer, URLS);
            instrumentFetch();
            const flareWrapped = g.fetch;

            // A third party wraps on top of Flare's wrapper, so unpatchFetch cannot
            // restore (the current fetch is not Flare's tagged wrapper).
            const thirdParty = function (this: unknown, ...args: Parameters<typeof fetch>) {
                return flareWrapped.apply(this, args);
            } as typeof fetch;
            g.fetch = thirdParty;

            unpatchFetch();
            expect(g.fetch).toBe(thirdParty); // the leak is real

            instrumentFetch(); // re-enable must not stack a second wrapper
            expect(g.fetch).toBe(thirdParty);

            await g.fetch('https://app.example/api/x');
            expect(startSpan).toHaveBeenCalledTimes(1); // one span per request, not two

            // Once the third party unwinds, unpatch restores and re-instrumenting works again.
            g.fetch = flareWrapped;
            unpatchFetch();
            expect(g.fetch).toBe(native);
            instrumentFetch();
            expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);
        } finally {
            unpatchFetch();
            g.fetch = before;
        }
    });

    it('does not patch a non-native (polyfilled) fetch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const polyfill = vi.fn(async () => new Response()) as unknown as typeof fetch; // toString has no [native code]
        const before = g.fetch;
        g.fetch = polyfill;

        try {
            const { tracer } = makeTracer();
            traceRequests(tracer, URLS);
            instrumentFetch();
            expect(g.fetch).toBe(polyfill); // untouched
        } finally {
            unpatchFetch();
            g.fetch = before;
        }
    });
});
