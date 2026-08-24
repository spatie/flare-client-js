import type { Config, SpanOptions } from '@flareapp/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createXHROpen, createXHRSend, createXHRSetRequestHeader } from '../src/instrumentation/instrumentXHR';
import { resetRequestBus } from '../src/instrumentation/requestBus';
import type { HttpTracer } from '../src/tracing/httpRequestSpan';
import { traceRequests } from '../src/tracing/traceRequests';
import { fixedUrls, makeTracer } from './helpers';

beforeEach(() => resetRequestBus());

const ORIGIN = 'https://app.example';
const URLS = fixedUrls(ORIGIN);

/** A minimal XMLHttpRequest stand-in that records header/listener calls and can fire readystatechange. */
function fakeXHR(opts: { sendImpl?: () => void; headerThrows?: (name: string, value: string) => boolean } = {}) {
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
            // Mirrors the native behavior: a forbidden value throws BEFORE the header is recorded.
            if (opts.headerThrows?.(name, value)) {
                throw new Error('forbidden header value');
            }
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

/** Wire the three wrappers onto a fake XHR, with tracing subscribed behind them. */
function instrument(
    tracer: HttpTracer,
    opts: { sendImpl?: () => void; headerThrows?: (name: string, value: string) => boolean } = {},
) {
    const f = fakeXHR(opts);
    const origOpen = f.xhr.open;
    const origSend = f.xhr.send;
    const origSet = f.xhr.setRequestHeader;
    traceRequests(tracer, URLS);
    f.xhr.open = createXHROpen(origOpen as any) as any;
    f.xhr.setRequestHeader = createXHRSetRequestHeader(origSet as any) as any;
    f.xhr.send = createXHRSend(origSend as any) as any;
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
                'url.scheme': 'https',
                'url.path': '/api/products',
                'server.address': 'app.example',
            },
        });
        expect(headers.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
        expect(calls.attrs['http.response.status_code']).toBe(200);
        expect(calls.ended).toBe(true);
    });

    it('redacts denylisted query params in url.full and url.query', () => {
        const { tracer, startSpan } = makeTracer({ urlDenylist: /token/ } as Partial<Config>);
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/reset?token=abc123&page=2');
        xhr.send();

        const attributes = (startSpan.mock.calls[0][1] as SpanOptions).attributes as Record<string, string>;
        expect(attributes['url.full']).toBe('https://app.example/api/reset?token=[redacted]&page=2');
        expect(attributes['url.query']).toBe('token=[redacted]&page=2');
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

    it("still injects Flare's traceparent when the apps own setRequestHeader throws", () => {
        const { tracer } = makeTracer();
        // Native setRequestHeader throws for a forbidden value (e.g. a stray newline); the app's
        // header never lands. Flare's own tp value is well-formed, so it must not trip the throw.
        const { xhr, headers } = instrument(tracer, {
            headerThrows: (name, value) => name.toLowerCase() === 'traceparent' && value === 'bad\nvalue',
        });

        xhr.open('GET', 'https://app.example/api/x');
        expect(() => xhr.setRequestHeader('traceparent', 'bad\nvalue')).toThrow();
        xhr.send();

        // The app's header never landed, so send() must NOT treat hasAppTraceparent as set.
        expect(headers.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
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

    it('marks error status and emits status_code 0 on network failure (status 0 at DONE, https)', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(0);

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('marks error status on status 0 for a plain http:// URL too', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'http://app.example/api/x');
        xhr.send();
        xhr.fireDone(0);

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toEqual({ code: 2 });
        expect(calls.ended).toBe(true);
    });

    it('does NOT map status 0 to error for a file:// URL (a successful local-resource response is also status 0)', () => {
        const { tracer, calls } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'file:///local/report.json');
        xhr.send();
        xhr.fireDone(0);

        expect(calls.attrs['http.response.status_code']).toBe(0);
        expect(calls.status).toBeUndefined();
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

    it('traces an empty-string URL, matching fetch', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        // An empty string resolves against the document base URL, same as fetch(''); it is a
        // performable request and must not be treated as missing.
        xhr.open('GET', '');
        xhr.send();

        expect(startSpan).toHaveBeenCalledOnce();
        expect(startSpan).toHaveBeenCalledWith('GET /', {
            spanType: 'browser_xhr',
            attributes: {
                'http.request.method': 'GET',
                'url.full': 'https://app.example/',
                'url.scheme': 'https',
                'url.path': '/',
                'server.address': 'app.example',
            },
        });
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

    it('ends the prior span as aborted on a mid-flight re-open, so the next DONE cannot cross-end it', () => {
        const { tracer, startSpan, spans } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/a');
        xhr.send();

        // Mid-flight re-open: per WHATWG this terminates /a with no DONE event.
        xhr.open('GET', 'https://app.example/api/b');
        xhr.send();

        xhr.fireDone(404);

        const [callsA, callsB] = spans;
        expect(callsA.ended).toBe(true);
        expect(callsA.attrs['http.response.status_code']).toBeUndefined();
        expect(callsA.status).toEqual({ code: 2 });

        expect(callsB.ended).toBe(true);
        expect(callsB.attrs['http.response.status_code']).toBe(404);

        expect(startSpan).toHaveBeenCalledTimes(2);
        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('ends the prior span when re-opened mid-flight but never re-sent', () => {
        const { tracer, startSpan, spans } = makeTracer();
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/a');
        xhr.send();

        // Re-open mid-flight, but never send /b.
        xhr.open('GET', 'https://app.example/api/b');

        expect(spans[0].ended).toBe(true);
        expect(startSpan).toHaveBeenCalledOnce();
    });
});

// The host's request must survive our tracing throwing, same as the fetch wrapper. Both seams below run
// before the native send(), and both read user config, so neither can be assumed infallible.
describe('createXHRSend never breaks the host request', () => {
    it('still sends when starting the span throws', () => {
        const { tracer } = makeTracer();
        tracer.startSpan = vi.fn(() => {
            throw new Error('span setup exploded');
        });
        const sendImpl = vi.fn();
        const { xhr } = instrument(tracer, { sendImpl });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();

        expect(sendImpl).toHaveBeenCalledOnce();
    });

    it('leaves no readystatechange listener behind when starting the span throws', () => {
        const { tracer } = makeTracer();
        tracer.startSpan = vi.fn(() => {
            throw new Error('span setup exploded');
        });
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('still sends when the propagation config throws', () => {
        // A non-RegExp entry is unreachable in TypeScript but not in plain JS or JSON-built config;
        // shouldPropagate calls .test on it.
        const { tracer } = makeTracer({ tracePropagationTargets: [null as unknown as RegExp] });
        const sendImpl = vi.fn();
        const { xhr, headers } = instrument(tracer, { sendImpl });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();

        expect(sendImpl).toHaveBeenCalledOnce();
        expect(headers.traceparent).toBeUndefined();
    });

    it('keeps the span it already opened when the propagation config throws', () => {
        const { tracer, calls } = makeTracer({ tracePropagationTargets: [null as unknown as RegExp] });
        const { xhr } = instrument(tracer);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        // Losing the header costs backend correlation; the request itself still settles, so the span
        // has a real status to report and must not be dropped or left open.
        expect(calls.attrs['http.response.status_code']).toBe(200);
        expect(calls.ended).toBe(true);
    });
});

// open() captures method and URL before handing off to the native call, so a throw in that
// bookkeeping would stop the host's request from ever being opened.
describe('createXHROpen never breaks the host open', () => {
    const hostile = (label: string) => ({
        toString() {
            throw new Error(label);
        },
    });

    it('still calls the native open when stringifying the url throws', () => {
        const originalOpen = vi.fn();
        const open = createXHROpen(originalOpen as unknown as XMLHttpRequest['open']);

        expect(() => open.call({} as XMLHttpRequest, 'GET', hostile('hostile url') as unknown as URL)).not.toThrow();
        expect(originalOpen).toHaveBeenCalledOnce();
    });

    it('still calls the native open when stringifying the method throws', () => {
        const originalOpen = vi.fn();
        const open = createXHROpen(originalOpen as unknown as XMLHttpRequest['open']);

        expect(() =>
            open.call({} as XMLHttpRequest, hostile('hostile method') as unknown as string, 'https://app.example/x'),
        ).not.toThrow();
        expect(originalOpen).toHaveBeenCalledOnce();
    });

    it('opens no span on a later send when the url could not be captured', () => {
        const { tracer, startSpan } = makeTracer();
        const { xhr } = instrument(tracer);

        (xhr.open as unknown as (m: string, u: unknown) => void)('GET', hostile('hostile url'));
        xhr.send();

        // State capture failed, so there is nothing to trace; the request must still go out untraced.
        expect(startSpan).not.toHaveBeenCalled();
    });
});
