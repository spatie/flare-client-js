import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { collectBrowser } from '../src/browser/context/collectBrowser';

describe('collectBrowser', () => {
    it('reads window.location.href into url.full', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['url.full']).toBe(window.location.href);
    });

    it('reads user agent', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(typeof attrs['user_agent.original']).toBe('string');
    });

    it('sets flare.entry_point.type to web', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['flare.entry_point.type']).toBe('web');
    });

    it('sets host.name from window.location.hostname so logs get a Hostname', () => {
        const attrs = collectBrowser({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['host.name']).toBe(window.location.hostname);
    });
});
