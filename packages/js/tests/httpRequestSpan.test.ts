import type { Config } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import {
    endHttpRequestSpan,
    finishHttpSpanError,
    isFlareIngestUrl,
    requestSpanAttributes,
    safeAbsolute,
    traceparentFor,
} from '../src/tracing/httpRequestSpan';
import { fakeSpan } from './helpers';

const ORIGIN = 'https://app.example';
const config = {
    urlDenylist: /token/,
    ingestUrl: 'https://ingress.flareapp.io/v1/errors',
    logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
    tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
} as unknown as Config;

describe('httpRequestSpan helpers', () => {
    it('safeAbsolute resolves relative URLs and returns null on garbage', () => {
        expect(safeAbsolute('/api/x', ORIGIN)?.href).toBe('https://app.example/api/x');
        expect(safeAbsolute('http://[', '')).toBeNull();
    });

    it('isFlareIngestUrl matches configured ingest endpoints only', () => {
        expect(isFlareIngestUrl(safeAbsolute('https://ingress.flareapp.io/v1/traces', ORIGIN), config)).toBe(true);
        expect(isFlareIngestUrl(safeAbsolute('https://app.example/api/x', ORIGIN), config)).toBe(false);
    });

    it('requestSpanAttributes builds method/url/server attrs and redacts denylisted query', () => {
        const url = 'https://app.example:8443/api/x?token=abc&page=2';
        const attrs = requestSpanAttributes('GET', safeAbsolute(url, ORIGIN), url, config);
        expect(attrs).toEqual({
            'http.request.method': 'GET',
            'url.full': 'https://app.example:8443/api/x?token=[redacted]&page=2',
            'server.address': 'app.example',
            'server.port': 8443,
        });
    });

    describe('endHttpRequestSpan', () => {
        it('records the status code and leaves status Unset on a 2xx', () => {
            const { span, calls } = fakeSpan();
            endHttpRequestSpan(span, 204);
            expect(calls.attrs['http.response.status_code']).toBe(204);
            expect(calls.status).toBeUndefined();
            expect(calls.ended).toBe(true);
        });

        it('marks an error status on >= 500', () => {
            const { span, calls } = fakeSpan();
            endHttpRequestSpan(span, 503);
            expect(calls.status).toEqual({ code: 2 });
            expect(calls.ended).toBe(true);
        });

        it('status 0 without zeroIsError is NOT an error (opaque no-cors fetch response)', () => {
            const { span, calls } = fakeSpan();
            endHttpRequestSpan(span, 0);
            expect(calls.attrs['http.response.status_code']).toBe(0);
            expect(calls.status).toBeUndefined();
        });

        it('status 0 WITH zeroIsError is an error (XHR network/CORS failure)', () => {
            const { span, calls } = fakeSpan();
            endHttpRequestSpan(span, 0, { zeroIsError: true });
            expect(calls.status).toEqual({ code: 2 });
        });
    });

    describe('finishHttpSpanError', () => {
        it('maps an Error to a code:2 status carrying its message', () => {
            const { span, calls } = fakeSpan();
            finishHttpSpanError(span, new Error('boom'));
            expect(calls.status).toEqual({ code: 2, message: 'boom' });
            expect(calls.ended).toBe(true);
        });

        it('maps a non-Error value via String()', () => {
            const { span, calls } = fakeSpan();
            finishHttpSpanError(span, 'nope');
            expect(calls.status).toEqual({ code: 2, message: 'nope' });
            expect(calls.ended).toBe(true);
        });
    });

    describe('traceparentFor', () => {
        it('returns a traceparent header value when the URL is propagation-eligible', () => {
            const { span } = fakeSpan();
            const url = 'https://app.example/api/x';
            expect(traceparentFor(span, safeAbsolute(url, ORIGIN), url, ORIGIN, config)).toBe(
                `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
            );
        });

        it('returns null when shouldPropagate rejects the URL (cross-origin, no targets)', () => {
            const { span } = fakeSpan();
            const url = 'https://other.example/api';
            expect(traceparentFor(span, safeAbsolute(url, ORIGIN), url, ORIGIN, config)).toBeNull();
        });
    });
});
