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
});
