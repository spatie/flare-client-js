import type { Config, Span, SpanOptions } from '@flareapp/core';
import { describe, expect, it, vi } from 'vitest';

import { createFetchWrapper, type FetchTracer, instrumentFetch, unpatchFetch } from '../src/tracing/instrumentFetch';

const ORIGIN = 'https://app.example';

function fakeSpan() {
    const calls = { attrs: {} as Record<string, unknown>, status: undefined as unknown, ended: false };
    const span: Span = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: null,
        name: '',
        isRecording: true,
        setAttribute(k, v) {
            calls.attrs[k] = v;
            return this;
        },
        setStatus(s) {
            calls.status = s;
            return this;
        },
        addEvent() {
            return this;
        },
        end() {
            calls.ended = true;
        },
    };
    return { span, calls };
}

function makeTracer(overrides: Partial<Config> = {}) {
    const { span, calls } = fakeSpan();
    const config = {
        enableTracing: true,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
        tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
        ...overrides,
    } as unknown as Config;
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => span);
    const tracer: FetchTracer = { config, startSpan };
    return { tracer, startSpan, span, calls };
}

const okFetch = (status = 200) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

describe('createFetchWrapper', () => {
    it('creates a browser_fetch span with method/url attributes and injects traceparent same-origin', async () => {
        const { tracer, startSpan, calls } = makeTracer();
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await wrapped('https://app.example/api/products');

        expect(startSpan).toHaveBeenCalledWith('GET /api/products', {
            spanType: 'browser_fetch',
            attributes: {
                'http.request.method': 'GET',
                'url.full': 'https://app.example/api/products',
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

    it('does NOT inject traceparent cross-origin by default (span still created)', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await wrapped('https://third-party.example/track');

        expect(startSpan).toHaveBeenCalledOnce();
        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as
            | RequestInit
            | undefined;
        const headers = (passedInit?.headers ?? {}) as Record<string, string>;
        expect(headers.traceparent).toBeUndefined();
    });

    it('marks error status on HTTP >= 500', async () => {
        const { tracer, calls } = makeTracer();
        const wrapped = createFetchWrapper(tracer, okFetch(503), ORIGIN);

        await wrapped('https://app.example/api/x');

        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('marks error status and rethrows on network failure', async () => {
        const { tracer, calls } = makeTracer();
        const original = vi.fn(async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('network down');
        expect(calls.status).toEqual({ code: 2, message: 'network down' });
        expect(calls.ended).toBe(true);
    });

    it('ends the span and rethrows when the underlying fetch throws synchronously', async () => {
        const { tracer, calls } = makeTracer();
        const original = vi.fn(() => {
            throw new Error('sync boom');
        }) as unknown as typeof fetch;
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await expect(wrapped('https://app.example/api/x')).rejects.toThrow('sync boom');
        expect(calls.status).toEqual({ code: 2, message: 'sync boom' });
        expect(calls.ended).toBe(true);
    });

    it('skips Flare ingest URLs entirely (no span, passthrough)', async () => {
        const { tracer, startSpan } = makeTracer();
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await wrapped('https://ingress.flareapp.io/v1/traces');

        expect(startSpan).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledOnce();
    });

    it('passes through untouched when tracing is disabled', async () => {
        const { tracer, startSpan } = makeTracer({ enableTracing: false });
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await wrapped('https://app.example/api/x');

        expect(startSpan).not.toHaveBeenCalled();
        expect(original).toHaveBeenCalledOnce();
    });

    it('injects traceparent with flag 00 when the span is not recording', async () => {
        const { tracer, span } = makeTracer();
        (span as { isRecording: boolean }).isRecording = false;
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN);

        await wrapped('/api/x'); // relative → same-origin

        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe(
            `00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`,
        );
    });

    it('injects traceparent for a relative same-origin URL when tracePropagationTargets is set', async () => {
        const { tracer } = makeTracer({ tracePropagationTargets: ['app.example'] });
        const original = okFetch();
        const wrapped = createFetchWrapper(tracer, original, ORIGIN); // ORIGIN = 'https://app.example'

        await wrapped('/api/products'); // relative → absolutizes to https://app.example/api/products

        const passedInit = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
        expect((passedInit.headers as Record<string, string>).traceparent).toBe(
            `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        );
    });
});

describe('instrumentFetch / unpatchFetch on globalThis', () => {
    it('patches global fetch when native, then restores it', async () => {
        const g = globalThis as { fetch: typeof fetch };
        // `isNativeFetch` checks `Function.prototype.toString.call(fn)`, which ignores an own
        // `fn.toString` override (the "not fooled by a spoofed toString" guarantee covered by
        // supportsNativeFetch.test.ts). A bound function genuinely reports `[native code]` from that
        // prototype method, so it's detected as native without any global mutation. The `.bind` is
        // load-bearing for exactly that reason, not redundant.
        // oxlint-disable-next-line no-extra-bind
        const native = (async () => new Response(null, { status: 200 })).bind(null) as unknown as typeof fetch;
        const before = g.fetch;
        g.fetch = native;

        try {
            const { tracer, startSpan } = makeTracer();
            instrumentFetch(tracer);
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

    it('does not patch a non-native (polyfilled) fetch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const polyfill = vi.fn(async () => new Response()) as unknown as typeof fetch; // toString has no [native code]
        const before = g.fetch;
        g.fetch = polyfill;

        try {
            const { tracer } = makeTracer();
            instrumentFetch(tracer);
            expect(g.fetch).toBe(polyfill); // untouched
        } finally {
            unpatchFetch();
            g.fetch = before;
        }
    });
});
