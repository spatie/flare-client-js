import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createXHROpen,
    createXHRSend,
    createXHRSetRequestHeader,
    resetRequestInstrumentationForTests,
    setRequestStartHandler,
} from '../src/instrument/request';
import type { UrlContext } from '../src/tracing/httpRequestSpan';
import { fixedUrls, recordSettles, useInstrumentationConfig } from './helpers';

const ORIGIN = 'https://app.example';
const URLS = fixedUrls(ORIGIN);
const TRACEPARENT = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

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

type InstrumentOptions = {
    sendImpl?: () => void;
    headerThrows?: (name: string, value: string) => boolean;
    urls?: UrlContext;
};

/** Wire the three factories onto a fake XHR instance and return it ready to open/send. */
function instrument(opts: InstrumentOptions = {}) {
    const f = fakeXHR(opts);
    const origOpen = f.xhr.open;
    const origSend = f.xhr.send;
    const origSet = f.xhr.setRequestHeader;
    const { entries, stop } = recordSettles();
    f.xhr.open = createXHROpen(origOpen as any) as any;
    f.xhr.setRequestHeader = createXHRSetRequestHeader(origSet as any) as any;
    f.xhr.send = createXHRSend(origSend as any, opts.urls ?? URLS) as any;
    return { ...f, entries, stop };
}

beforeEach(() => {
    useInstrumentationConfig();
});

afterEach(() => {
    resetRequestInstrumentationForTests();
});

describe('createXHR* wrappers', () => {
    it('reports the request and its response status to the settle handlers', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/products');
        xhr.send();
        xhr.fireDone(200);

        expect(entries).toHaveLength(1);
        expect(entries[0].context.kind).toBe('xhr');
        expect(entries[0].context.method).toBe('GET');
        expect(entries[0].context.url).toBe('https://app.example/api/products');
        expect(entries[0].context.absoluteUrl?.href).toBe('https://app.example/api/products');
        expect(entries[0].result.status).toBe(200);
        expect(entries[0].result.error).toBeUndefined();
    });

    it('reports status 0 at DONE (a network or CORS failure has no response)', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(0);

        expect(entries[0].result.status).toBe(0);
        expect(entries[0].result.aborted).toBeUndefined();
    });

    it('sends the traceparent the start owner returns', () => {
        const { xhr, headers } = instrument();
        setRequestStartHandler(() => TRACEPARENT);

        xhr.open('GET', 'https://app.example/api/products');
        xhr.send();

        expect(headers.traceparent).toBe(TRACEPARENT);
    });

    it('sends no traceparent when the start owner returns null', () => {
        const { xhr, headers } = instrument();
        setRequestStartHandler(() => null);

        xhr.open('POST', 'https://third-party.example/track');
        xhr.send();

        expect(headers.traceparent).toBeUndefined();
    });

    it('does not inject our traceparent when the app already set one', () => {
        const { xhr, setHeaderSpy } = instrument();
        setRequestStartHandler(() => TRACEPARENT);

        xhr.open('GET', 'https://app.example/api/x');
        xhr.setRequestHeader('traceparent', '00-appappapp-child-01');
        setHeaderSpy.mockClear();
        xhr.send();

        // send() must not add a second traceparent header
        expect(setHeaderSpy.mock.calls.some(([name]) => String(name).toLowerCase() === 'traceparent')).toBe(false);
    });

    it("still injects Flare's traceparent when the apps own setRequestHeader throws", () => {
        // Native setRequestHeader throws for a forbidden value (e.g. a stray newline); the app's
        // header never lands. Flare's own tp value is well-formed, so it must not trip the throw.
        const { xhr, headers } = instrument({
            headerThrows: (name, value) => name.toLowerCase() === 'traceparent' && value === 'bad\nvalue',
        });
        setRequestStartHandler(() => TRACEPARENT);

        xhr.open('GET', 'https://app.example/api/x');
        expect(() => xhr.setRequestHeader('traceparent', 'bad\nvalue')).toThrow();
        xhr.send();

        // The app's header never landed, so send() must NOT treat hasAppTraceparent as set.
        expect(headers.traceparent).toBe(TRACEPARENT);
    });

    it('skips Flare ingest URLs entirely (no settle)', () => {
        const { xhr, entries } = instrument();

        xhr.open('POST', 'https://ingress.flareapp.io/v1/traces');
        xhr.send();
        xhr.fireDone(200);

        expect(entries).toHaveLength(0);
    });

    it('passes through untouched once every handler has unsubscribed', () => {
        const sendImpl = vi.fn();
        const { xhr, entries, stop } = instrument({ sendImpl });
        stop(); // the wrapper stays in place, but must now idle

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        expect(entries).toHaveLength(0);
        expect(sendImpl).toHaveBeenCalledOnce();
    });

    it('bails in open when method or url is missing (nothing reported on send)', () => {
        const { xhr, entries } = instrument();

        (xhr.open as any)('GET'); // no url
        xhr.send();
        xhr.fireDone(200);

        expect(entries).toHaveLength(0);
    });

    it('traces an empty-string URL, matching fetch', () => {
        const { xhr, entries } = instrument();

        // An empty string resolves against the document base URL, same as fetch(''); it is a
        // performable request and must not be treated as missing.
        xhr.open('GET', '');
        xhr.send();
        xhr.fireDone(200);

        expect(entries).toHaveLength(1);
        expect(entries[0].context.absoluteUrl?.href).toBe('https://app.example/');
    });

    it('reports an error result and rethrows when the underlying send throws synchronously', () => {
        const boom = new Error('sync boom');
        const { xhr, entries } = instrument({
            sendImpl: () => {
                throw boom;
            },
        });

        xhr.open('GET', 'https://app.example/api/x');
        expect(() => xhr.send()).toThrow('sync boom');

        expect(entries[0].result.status).toBe(0);
        expect(entries[0].result.error).toBe(boom);
    });

    it('removes its readystatechange listener after completion (no accumulation on reuse)', () => {
        const { xhr } = instrument();

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('clears stale state on an open bail so a reused instance reports nothing on the next send', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        (xhr.open as any)('GET'); // bail: no url -> stale state must be cleared
        xhr.send();

        expect(entries).toHaveLength(1);
    });

    it('passes through a re-send on an already-completed request without a fresh open()', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        // Re-send without an intervening open(): state.ended is already true.
        xhr.send();

        expect(entries).toHaveLength(1);
    });

    it('settles the prior request as aborted on a mid-flight re-open, so the next DONE cannot cross-settle it', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/a');
        xhr.send();

        // Mid-flight re-open: per WHATWG this terminates /a with no DONE event.
        xhr.open('GET', 'https://app.example/api/b');
        xhr.send();

        xhr.fireDone(404);

        expect(entries).toHaveLength(2);
        // An abort is its own result shape: no HTTP response was received, and no error was raised
        // either. The consumer decides what that means; the wrapper only reports it.
        expect(entries[0].context.url).toBe('https://app.example/api/a');
        expect(entries[0].result.status).toBe(0);
        expect(entries[0].result.aborted).toBe(true);
        expect(entries[0].result.error).toBeUndefined();
        expect('error' in entries[0].result).toBe(false);

        expect(entries[1].context.url).toBe('https://app.example/api/b');
        expect(entries[1].result.status).toBe(404);
        expect(entries[1].result.aborted).toBeUndefined();

        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('settles the prior request when re-opened mid-flight but never re-sent', () => {
        const { xhr, entries } = instrument();

        xhr.open('GET', 'https://app.example/api/a');
        xhr.send();

        // Re-open mid-flight, but never send /b.
        xhr.open('GET', 'https://app.example/api/b');

        expect(entries).toHaveLength(1);
        expect(entries[0].result.aborted).toBe(true);
    });
});

// The host's request must survive our instrumentation throwing, same as the fetch wrapper. Both steps
// below run before the native send(), and both reach user config or a third-party handler, so neither
// can be assumed infallible.
describe('createXHRSend never breaks the host request', () => {
    const throwingUrls: UrlContext = {
        origin: ORIGIN,
        base: () => {
            throw new Error('context setup exploded');
        },
    };

    it('still sends when opening the request context throws', () => {
        const sendImpl = vi.fn();
        const { xhr } = instrument({ sendImpl, urls: throwingUrls });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();

        expect(sendImpl).toHaveBeenCalledOnce();
    });

    it('leaves no readystatechange listener behind when opening the request context throws', () => {
        const { xhr } = instrument({ urls: throwingUrls });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        expect(xhr.listenerCount('readystatechange')).toBe(0);
    });

    it('still sends when the start owner throws', () => {
        const sendImpl = vi.fn();
        const { xhr, headers } = instrument({ sendImpl });
        setRequestStartHandler(() => {
            throw new Error('owner exploded');
        });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();

        expect(sendImpl).toHaveBeenCalledOnce();
        expect(headers.traceparent).toBeUndefined();
    });

    it('still settles the request it already opened when the start owner throws', () => {
        const { xhr, entries } = instrument();
        setRequestStartHandler(() => {
            throw new Error('owner exploded');
        });

        xhr.open('GET', 'https://app.example/api/x');
        xhr.send();
        xhr.fireDone(200);

        // Losing the header costs backend correlation; the request itself still settles, so it has a
        // real status to report and must not be dropped.
        expect(entries[0].result.status).toBe(200);
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

    it('reports nothing on a later send when the url could not be captured', () => {
        const { xhr, entries } = instrument();

        (xhr.open as unknown as (m: string, u: unknown) => void)('GET', hostile('hostile url'));
        xhr.send();
        xhr.fireDone(200);

        // State capture failed, so there is nothing to report; the request must still go out.
        expect(entries).toHaveLength(0);
    });
});
