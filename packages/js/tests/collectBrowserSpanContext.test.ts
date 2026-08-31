// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { browserSpanUrlAttributes, collectBrowserSpanContext } from '../src/browser/context/collectBrowserSpanContext';

const config = { urlDenylist: /(?!)/ } as unknown as Parameters<typeof collectBrowserSpanContext>[0];

describe('collectBrowserSpanContext', () => {
    it('returns entry-point + request keys, and excludes cookies/host.name/query', () => {
        window.history.replaceState({}, '', '/products?q=1');
        document.cookie = 'sid=abc';

        const attrs = collectBrowserSpanContext(config);

        expect(attrs['flare.entry_point.type']).toBe('web');
        expect(attrs['flare.entry_point.handler.identifier']).toBe('/products');
        expect(attrs['http.route']).toBe('/products');
        expect(attrs['flare.entry_point.handler.type']).toBe('browser');
        expect(attrs['url.full']).toContain('/products');
        expect(attrs['url.scheme']).toBe('http');
        expect(attrs['url.path']).toBe('/products');
        // url.query is on the span context now. It used to be on reports only.
        expect(attrs['url.query']).toBe('q=1');
        expect(attrs['user_agent.original']).toBeTypeOf('string');
        expect('http.request.referrer' in attrs).toBe(true);
        expect('document.ready_state' in attrs).toBe(true);

        expect('http.request.cookies' in attrs).toBe(false);
        expect('host.name' in attrs).toBe(false);
    });

    it('derives URL keys from an href override, leaving non-URL keys live', () => {
        window.history.replaceState({}, '', '/current?q=1');
        const attrs = collectBrowserSpanContext(config, 'https://app.test/product/p01?ref=x');
        expect(attrs['url.full']).toBe('https://app.test/product/p01?ref=x');
        expect(attrs['flare.entry_point.value']).toBe('https://app.test/product/p01?ref=x');
        expect(attrs['url.path']).toBe('/product/p01');
        expect(attrs['url.query']).toBe('ref=x');
        expect(attrs['flare.entry_point.handler.identifier']).toBe('/product/p01');
        expect(attrs['http.route']).toBe('/product/p01');
        // non-URL keys are NOT derived from the override: they still reflect the live document.
        expect(attrs['user_agent.original']).toBe(window.navigator.userAgent);
        expect(attrs['document.ready_state']).toBe(window.document.readyState);
        expect('http.request.referrer' in attrs).toBe(true);
    });

    it('redacts denylisted query values on the override path (url.full and entry_point.value)', () => {
        // The override URL must go through redactUrlQuery like the live-location path, or a
        // framework navigation root would leak denylisted query values. Uses a denylist matching token.
        const denylistConfig = { urlDenylist: /token/i } as unknown as Parameters<typeof collectBrowserSpanContext>[0];
        const attrs = collectBrowserSpanContext(denylistConfig, 'https://app.test/checkout?token=secret&x=1');
        expect(attrs['url.full']).toBe('https://app.test/checkout?token=[redacted]&x=1');
        expect(attrs['flare.entry_point.value']).toBe('https://app.test/checkout?token=[redacted]&x=1');
        expect(attrs['url.full']).not.toContain('secret');
    });

    it('ignores a malformed href override and uses the live location', () => {
        window.history.replaceState({}, '', '/current');
        const attrs = collectBrowserSpanContext(config, 'http://a:999999'); // invalid port -> new URL throws
        expect(attrs['url.full']).toContain('/current');
        expect(attrs['flare.entry_point.handler.identifier']).toBe('/current');
    });
});

describe('browserSpanUrlAttributes', () => {
    it('re-stamps the whole url.* set plus the entry point value', () => {
        const attrs = browserSpanUrlAttributes(config, 'https://app.test/checkout?step=2');

        expect(attrs).toEqual({
            'url.full': 'https://app.test/checkout?step=2',
            'url.scheme': 'https',
            'url.path': '/checkout',
            'url.query': 'step=2',
            'flare.entry_point.value': 'https://app.test/checkout?step=2',
        });
    });

    it('emits an empty url.query for a destination without one', () => {
        // You can overwrite a span attribute but not remove it, so a redirect off a URL with a query
        // must blank it out.
        const attrs = browserSpanUrlAttributes(config, 'https://app.test/thanks');

        expect(attrs['url.query']).toBe('');
        expect(attrs['url.path']).toBe('/thanks');
    });

    it('redacts denylisted query values in both url.full and url.query', () => {
        const denylistConfig = { urlDenylist: /token/i } as unknown as Parameters<typeof browserSpanUrlAttributes>[0];
        const attrs = browserSpanUrlAttributes(denylistConfig, 'https://app.test/reset?token=secret&x=1');

        expect(attrs['url.full']).toBe('https://app.test/reset?token=[redacted]&x=1');
        expect(attrs['url.query']).toBe('token=[redacted]&x=1');
        expect(attrs['flare.entry_point.value']).toBe('https://app.test/reset?token=[redacted]&x=1');
    });

    it('does not stamp the route-owned keys', () => {
        const attrs = browserSpanUrlAttributes(config, 'https://app.test/product/p01');

        expect('flare.entry_point.handler.identifier' in attrs).toBe(false);
        expect('http.route' in attrs).toBe(false);
    });

    it('returns nothing for an unresolvable href', () => {
        expect(browserSpanUrlAttributes(config, 'http://a:999999')).toEqual({});
    });
});
