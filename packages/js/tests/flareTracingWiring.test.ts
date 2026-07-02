import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { unpatchFetch } from '../src/tracing/instrumentFetch';

// A bound function reports "[native code]" from Function.prototype.toString, so the
// robust isNativeFetch detects it as native. An own-property toString override does NOT
// work (isNativeFetch uses Function.prototype.toString.call, which ignores own toString).
function nativeFetchStub(): typeof fetch {
    // oxlint-disable-next-line no-extra-bind
    return (async () => new Response(null, { status: 200 })).bind(null) as unknown as typeof fetch;
}

describe('js Flare tracing auto-wiring', () => {
    const g = globalThis as { fetch: typeof fetch };
    const originalFetch = g.fetch;

    afterEach(() => {
        unpatchFetch();
        g.fetch = originalFetch;
    });

    it('patches fetch when configure enables tracing', () => {
        g.fetch = nativeFetchStub();
        const flare = new Flare();
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBeUndefined();

        flare.configure({ enableTracing: true });
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBeDefined();
    });

    it('unpatches fetch when configure disables tracing', () => {
        g.fetch = nativeFetchStub();
        const flare = new Flare();
        flare.configure({ enableTracing: true });
        flare.configure({ enableTracing: false });
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBeUndefined();
    });
});
