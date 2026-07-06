import type { Config, Span, SpanOptions } from '@flareapp/core';
import { describe, expect, it, vi } from 'vitest';

import type { HttpTracer } from '../src/tracing/httpRequestSpan';
import { createXHROpen, createXHRSend, createXHRSetRequestHeader } from '../src/tracing/instrumentXHR';

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
    const tracer: HttpTracer = { config, startSpan };
    return { tracer, startSpan, span, calls };
}

/** A minimal XMLHttpRequest stand-in that records header/listener calls and can fire readystatechange. */
function fakeXHR(opts: { sendImpl?: () => void } = {}) {
    const headers: Record<string, string> = {};
    const listeners: Record<string, Array<() => void>> = {};
    const setHeaderSpy = vi.fn();
    const xhr = {
        readyState: 1,
        status: 0,
        open(..._args: unknown[]) {},
        send(_body?: unknown) {
            opts.sendImpl?.();
        },
        setRequestHeader(name: string, value: string) {
            setHeaderSpy(name, value);
            headers[name.toLowerCase()] = value;
        },
        addEventListener(type: string, cb: () => void) {
            (listeners[type] ??= []).push(cb);
        },
        removeEventListener(type: string, cb: () => void) {
            listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb);
        },
        fireDone(status: number) {
            xhr.status = status;
            xhr.readyState = 4;
            (listeners.readystatechange ?? []).slice().forEach((f) => f.call(xhr));
        },
        listenerCount(type: string) {
            return (listeners[type] ?? []).length;
        },
    };
    return { xhr, headers, setHeaderSpy };
}

/** Wire the three factories onto a fake XHR instance and return it ready to open/send. */
function instrument(tracer: HttpTracer, opts: { sendImpl?: () => void } = {}) {
    const f = fakeXHR(opts);
    const origOpen = f.xhr.open;
    const origSend = f.xhr.send;
    const origSet = f.xhr.setRequestHeader;
    f.xhr.open = createXHROpen(origOpen as any) as any;
    f.xhr.setRequestHeader = createXHRSetRequestHeader(origSet as any) as any;
    f.xhr.send = createXHRSend(tracer, origSend as any, ORIGIN) as any;
    return f;
}

describe('createXHR* wrappers', () => {
    it('creates a browser_xhr span with method/url attributes and injects traceparent same-origin', () => {
        const { tracer, startSpan, calls } = makeTracer();
        const { xhr, headers } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/products');
        xhr.send();
        xhr.fireDone(200);

        expect(startSpan).toHaveBeenCalledWith('GET /api/products', {
            spanType: 'browser_xhr',
            attributes: {
                'http.request.method': 'GET',
                'url.full': 'https://app.example/api/products',
                'server.address': 'app.example',
            },
        });
        expect(headers.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
        expect(calls.attrs['http.response.status_code']).toBe(200);
        expect(calls.ended).toBe(true);
    });

    it('redacts denylisted query params in url.full', () => {
        const { tracer, startSpan } = makeTracer({ urlDenylist: /token/ } as Partial<Config>);
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/reset?token=abc123&page=2');
        xhr.send();

        const opts = startSpan.mock.calls[0][1] as SpanOptions;
        expect((opts.attributes as Record<string, string>)['url.full']).toBe(
            'https://app.example/api/reset?token=[redacted]&page=2',
        );
    });

    it('does NOT inject traceparent cross-origin by default (span still created)', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr, headers } = instrument(tracer);

        xhr.open('POST', 'https://third-party.example/track');
        xhr.send();

        expect(startSpan).toHaveBeenCalledOnce();
        expect(headers.traceparent).toBeUndefined();
    });

    it('injects traceparent with flag 00 when the span is not recording', () => {
        const { tracer, span } = makeTracer();
        (span as { isRecording: boolean }).isRecording = false;
        const { xhr, headers } = instrument(tracer);

        xhr.open('GET', '/api/x'); // relative -> same-origin
        xhr.send();

        expect(headers.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`);
    });

    it('injects for a relative same-origin URL when tracePropagationTargets is set', () => {
        const { tracer } = makeTracer({ tracePropagationTargets: ['app.example'] });
        const { xhr, headers } = instrument(tracer);

        xhr.open('GET', '/api/products');
        xhr.send();

        expect(headers.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    });

    it('does not inject our traceparent when the app already set one', () => {
        const { tracer } = makeTracer();
        const { xhr, setHeaderSpy } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.setRequestHeader('traceparent', '00-appappapp-child-01');
        setHeaderSpy.mockClear();
        xhr.send();

        // send() must not add a second traceparent header
        expect(setHeaderSpy.mock.calls.some(([name]) => String(name).toLowerCase() === 'traceparent')).toBe(false);
    });

    it('marks error status on HTTP >= 500', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(503);

        expect(calls.attrs['http.response.status_code']).toBe(503);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('marks error status and emits status_code 0 on network failure (status 0 at DONE)', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(0);

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('ends Unset on a normal 2xx', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(204);

        expect(calls.status).toBeUndefined();
        expect(calls.ended).toBe(true);
    });

    it('skips Flare ingest URLs entirely (no span)', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('POST', 'https://ingress.flareapp.io/v1/traces');
        xhr.send();

        expect(startSpan).not.toHaveBeenCalled();
    });

    it('passes through untouched when tracing is disabled', () => {
        const { tracer, startSpan } = makeTracer({ enableTracing: false });
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();

        expect(startSpan).not.toHaveBeenCalled();
    });

    it('bails in open when method or url is missing (no span on send)', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        (xhr.open as any)('GET'); // no url
        xhr.send();

        expect(startSpan).not.toHaveBeenCalled();
    });

    it('ends the span and rethrows when the underlying send throws synchronously', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer, {
            sendImpl: () => {
                throw new Error('sync boom');
            },
        });

        xhr.open('GET', 'https://app.example/api/x');
        expect(() => xhr.send()).toThrow('sync boom');
        expect(calls.status).toEqual({ code: 2, message: 'sync boom' });
        expect(calls.ended).toBe(true);
    });

    it('removes its readystatechange listener after completion (no accumulation on reuse)', () => {
        const { tracer } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('clears stale state on an open bail so a reused instance creates no span on the next send', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        (xhr.open as any)('GET'); // bail: no url -> stale state must be cleared
        xhr.send();

        expect(startSpan).toHaveBeenCalledOnce();
    });

    it('passes through a re-send on an already-completed request without a fresh open() (no second span)', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        // Re-send without an intervening open(): state.ended is already true.
        xhr.send();

        expect(startSpan).toHaveBeenCalledOnce();
    });
});
