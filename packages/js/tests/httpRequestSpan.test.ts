import type { Config } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import { isFlareIngestUrl, requestSpanAttributes, safeAbsolute } from '../src/tracing/httpRequestSpan';

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
        expect(isFlareIngestUrl('https://ingress.flareapp.io/v1/traces', ORIGIN, config)).toBe(true);
        expect(isFlareIngestUrl('https://app.example/api/x', ORIGIN, config)).toBe(false);
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
});
