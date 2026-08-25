import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { unpatchFetch } from '../src/instrumentation/requests';
import { resetRequestPatches } from '../src/instrumentation/requests';

describe('js Flare tracing auto-wiring', () => {
    const g = globalThis as { fetch: typeof fetch };
    const originalFetch = g.fetch;

    afterEach(() => {
        unpatchFetch();
        // Forcing the patch off here bypasses the subscription count, so put it back to zero.
        resetRequestPatches();
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

    it('disable then re-enable does not stack a second wrapper when a third party wrapped fetch after Flare', () => {
        g.fetch = nativeFetchStub();
        const flare = new Flare();
        flare.configure({ enableTracing: true });
        const flareWrapped = g.fetch;

        // A third party wraps on top, so the disable's unpatch cannot restore.
        const thirdParty = function (this: unknown, ...args: Parameters<typeof fetch>) {
            return flareWrapped.apply(this, args);
        } as typeof fetch;
        g.fetch = thirdParty;

        flare.configure({ enableTracing: false });
        expect(g.fetch).toBe(thirdParty); // leaked, expectedly

        flare.configure({ enableTracing: true });
        expect(g.fetch).toBe(thirdParty); // NOT re-wrapped: Flare's wrapper is still in the chain

        // Simulate the third party unwinding so unpatch can restore and clear installed state.
        g.fetch = flareWrapped;
        flare.configure({ enableTracing: false });
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBeUndefined();
    });
});
