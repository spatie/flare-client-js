// @vitest-environment node
/**
 * Tests that collectBrowser is safe to call in a Node (SSR) environment
 * where `window` is not defined.
 */
import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import { collectBrowser } from '../src/browser/context/collectBrowser';

describe('collectBrowser in SSR (no window)', () => {
    it('does not throw when window is undefined', () => {
        expect(() => collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any)).not.toThrow();
    });

    it('returns flare.entry_point.type === server when window is absent', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['flare.entry_point.type']).toBe('server');
    });

    it('does not include window-dependent attributes when window is absent', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['url.full']).toBeUndefined();
        expect(attrs['user_agent.original']).toBeUndefined();
        expect(attrs['http.request.cookies']).toBeUndefined();
        expect(attrs['url.query']).toBeUndefined();
    });
});
