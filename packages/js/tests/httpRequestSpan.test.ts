import type { Config } from '@flareapp/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
    browserUrlContext,
    endHttpRequestSpan,
    finishHttpSpanError,
    isFlareIngestUrl,
    requestSpanAttributes,
    safeAbsolute,
    traceparentFor,
} from '../src/tracing/httpRequestSpan';
import { fakeRecordingSpan } from './helpers';

const ORIGIN = 'https://app.example';
const config = {
    urlDenylist: /token/,
    ingestUrl: 'https://ingress.flareapp.io/v1/errors',
    logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
    tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
} as unknown as Config;

describe('httpRequestSpan helpers', () => {
    it('truncates url.full so an overlong URL cannot bloat a span', () => {
        const attributes = requestSpanAttributes(
            'GET',
            safeAbsolute('/search?q=' + 'a'.repeat(8000), ORIGIN),
            '/search',
            config,
        );
        const full = attributes['url.full'] as string;
        expect(full.length).toBeLessThan(2100);
        expect(full.endsWith('…[truncated]')).toBe(true);
    });

    it('safeAbsolute resolves relative URLs and returns null on garbage', () => {
        expect(safeAbsolute('/api/x', ORIGIN)?.href).toBe('https://app.example/api/x');
        expect(safeAbsolute('http://[', '')).toBeNull();
    });

    it('isFlareIngestUrl matches configured ingest endpoints only', () => {
        expect(isFlareIngestUrl(safeAbsolute('https://ingress.flareapp.io/v1/traces', ORIGIN), config, ORIGIN)).toBe(
            true,
        );
        expect(isFlareIngestUrl(safeAbsolute('https://app.example/api/x', ORIGIN), config, ORIGIN)).toBe(false);
    });

    it('resolves a relative ingest URL against the origin before comparing', () => {
        const proxied = { ...config, tracesIngestUrl: '/flare/v1/traces' } as unknown as Config;
        expect(isFlareIngestUrl(safeAbsolute('/flare/v1/traces', ORIGIN), proxied, ORIGIN)).toBe(true);
    });

    it('does not match a sibling path that merely shares a prefix', () => {
        const prefixed = { ...config, ingestUrl: 'https://app.example/flare' } as unknown as Config;
        expect(isFlareIngestUrl(safeAbsolute('https://app.example/flare', ORIGIN), prefixed, ORIGIN)).toBe(true);
        expect(
            isFlareIngestUrl(safeAbsolute('https://app.example/flareapp-assets/app.js', ORIGIN), prefixed, ORIGIN),
        ).toBe(false);
    });

    it('picks up an ingest URL changed after a previous call (no install-time snapshot)', () => {
        expect(isFlareIngestUrl(safeAbsolute('/flare/v1/traces', ORIGIN), config, ORIGIN)).toBe(false);
        const proxied = { ...config, tracesIngestUrl: '/flare/v1/traces' } as unknown as Config;
        expect(isFlareIngestUrl(safeAbsolute('/flare/v1/traces', ORIGIN), proxied, ORIGIN)).toBe(true);
    });

    it('requestSpanAttributes builds method/url/server attrs and redacts denylisted query', () => {
        const url = 'https://app.example:8443/api/x?token=abc&page=2';
        const attrs = requestSpanAttributes('GET', safeAbsolute(url, ORIGIN), url, config);
        expect(attrs).toEqual({
            'http.request.method': 'GET',
            'url.full': 'https://app.example:8443/api/x?token=[redacted]&page=2',
            'url.scheme': 'https',
            'url.path': '/api/x',
            'url.query': 'token=[redacted]&page=2',
            'server.address': 'app.example',
            'server.port': 8443,
        });
    });

    it('requestSpanAttributes falls back to url.full alone when the url will not resolve', () => {
        const attrs = requestSpanAttributes('GET', null, 'not a url', config);

        expect(attrs).toEqual({ 'http.request.method': 'GET', 'url.full': 'not a url' });
    });

    describe('browserUrlContext', () => {
        const globals = globalThis as { location?: unknown; document?: unknown };

        afterEach(() => {
            delete globals.location;
            delete globals.document;
        });

        it('takes the base from document.baseURI and re-reads it per call', () => {
            globals.location = { origin: ORIGIN };
            globals.document = { baseURI: `${ORIGIN}/store/` };
            const urls = browserUrlContext();

            expect(urls.origin).toBe(ORIGIN);
            expect(urls.base()).toBe(`${ORIGIN}/store/`);

            // pushState moves baseURI without a page load, so a snapshot would go stale in an SPA.
            (globals.document as { baseURI: string }).baseURI = `${ORIGIN}/store/cart/`;
            expect(urls.base()).toBe(`${ORIGIN}/store/cart/`);
        });

        it('falls back to the origin when there is no document (SSR)', () => {
            globals.location = { origin: ORIGIN };

            expect(browserUrlContext().base()).toBe(ORIGIN);
        });
    });

    describe('endHttpRequestSpan', () => {
        it('records the status code and leaves status Unset on a 2xx', () => {
            const { span, calls } = fakeRecordingSpan();
            endHttpRequestSpan(span, 204);
            expect(calls.attrs['http.response.status_code']).toBe(204);
            expect(calls.status).toBeUndefined();
            expect(calls.ended).toBe(true);
        });

        it('marks an error status on >= 500', () => {
            const { span, calls } = fakeRecordingSpan();
            endHttpRequestSpan(span, 503);
            expect(calls.status).toEqual({ code: 2 });
            expect(calls.ended).toBe(true);
        });

        it('status 0 without zeroIsError is NOT an error (opaque no-cors fetch response)', () => {
            const { span, calls } = fakeRecordingSpan();
            endHttpRequestSpan(span, 0);
            expect(calls.attrs['http.response.status_code']).toBe(0);
            expect(calls.status).toBeUndefined();
        });

        it('status 0 WITH zeroIsError is an error (XHR network/CORS failure)', () => {
            const { span, calls } = fakeRecordingSpan();
            endHttpRequestSpan(span, 0, { zeroIsError: true });
            expect(calls.status).toEqual({ code: 2 });
        });
    });

    describe('finishHttpSpanError', () => {
        it('maps an Error to a code:2 status carrying its message', () => {
            const { span, calls } = fakeRecordingSpan();
            finishHttpSpanError(span, new Error('boom'));
            expect(calls.status).toEqual({ code: 2, message: 'boom' });
            expect(calls.ended).toBe(true);
        });

        it('maps a non-Error value via String()', () => {
            const { span, calls } = fakeRecordingSpan();
            finishHttpSpanError(span, 'nope');
            expect(calls.status).toEqual({ code: 2, message: 'nope' });
            expect(calls.ended).toBe(true);
        });
    });

    describe('traceparentFor', () => {
        it('returns a traceparent header value when the URL is propagation-eligible', () => {
            const { span } = fakeRecordingSpan();
            const url = 'https://app.example/api/x';
            expect(traceparentFor(span, safeAbsolute(url, ORIGIN), url, ORIGIN, config)).toBe(
                `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
            );
        });

        it('returns null when shouldPropagate rejects the URL (cross-origin, no targets)', () => {
            const { span } = fakeRecordingSpan();
            const url = 'https://other.example/api';
            expect(traceparentFor(span, safeAbsolute(url, ORIGIN), url, ORIGIN, config)).toBeNull();
        });
    });
});
