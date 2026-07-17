// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { collectBrowserSpanContext } from '../src/browser/context/collectBrowserSpanContext';

const config = { urlDenylist: /(?!)/ } as unknown as Parameters<typeof collectBrowserSpanContext>[0];

describe('collectBrowserSpanContext', () => {
    it('returns entry-point + request keys, and excludes cookies/host.name/query', () => {
        window.history.replaceState({}, '', '/products?q=1');
        document.cookie = 'sid=abc';

        const attrs = collectBrowserSpanContext(config);

        // included
        expect(attrs['flare.entry_point.type']).toBe('web');
        expect(attrs['flare.entry_point.handler.identifier']).toBe('/products');
        expect(attrs['flare.entry_point.handler.type']).toBe('browser');
        expect(attrs['url.full']).toContain('/products');
        expect(attrs['user_agent.original']).toBeTypeOf('string');
        expect('http.request.referrer' in attrs).toBe(true);
        expect('document.ready_state' in attrs).toBe(true);

        // excluded
        expect('http.request.cookies' in attrs).toBe(false);
        expect('host.name' in attrs).toBe(false);
    });

    it('derives URL keys from an href override, leaving non-URL keys live', () => {
        window.history.replaceState({}, '', '/current?q=1');
        const attrs = collectBrowserSpanContext(config, 'https://app.test/product/p01?ref=x');
        expect(attrs['url.full']).toBe('https://app.test/product/p01?ref=x');
        expect(attrs['flare.entry_point.value']).toBe('https://app.test/product/p01?ref=x');
        expect(attrs['flare.entry_point.handler.identifier']).toBe('/product/p01');
        // non-URL keys are NOT derived from the override: they still reflect the live document.
        expect(attrs['user_agent.original']).toBe(window.navigator.userAgent);
        expect(attrs['document.ready_state']).toBe(window.document.readyState);
        expect('http.request.referrer' in attrs).toBe(true);
    });

    it('redacts denylisted query values on the override path (url.full and entry_point.value)', () => {
        // The override URL must run through redactUrlQuery just like the live-location path, or a
        // framework navigation root would leak denylisted query values. The default test config's
        // denylist matches nothing, so use one that matches the token param here.
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
