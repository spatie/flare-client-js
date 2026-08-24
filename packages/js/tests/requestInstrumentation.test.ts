import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unpatchFetch } from '../src/instrumentation/instrumentFetch';
import { resetRequestBus, subscribeToRequests } from '../src/instrumentation/requestBus';
import { withRequestPatches, resetRequestPatches } from '../src/instrumentation/requestInstrumentation';

const g = globalThis as { fetch: typeof fetch };
let before: typeof fetch;
let native: typeof fetch;

beforeEach(() => {
    resetRequestBus();
    resetRequestPatches();
    before = g.fetch;
    native = nativeFetchStub();
    g.fetch = native;
});

afterEach(() => {
    unpatchFetch();
    g.fetch = before;
});

describe('the patch belongs to nobody', () => {
    it('installs on the first subscriber and removes on the last', () => {
        const remove = withRequestPatches(() => subscribeToRequests(() => {}));
        expect(g.fetch).not.toBe(native);

        remove();
        expect(g.fetch).toBe(native);
    });

    it('keeps the patch while a second subscriber is still subscribed', () => {
        const removeA = withRequestPatches(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        const removeB = withRequestPatches(() => subscribeToRequests(() => {}));
        expect(g.fetch).toBe(patched);

        // Whichever one leaves first, the patch survives for the other.
        removeB();
        expect(g.fetch).toBe(patched);

        removeA();
        expect(g.fetch).toBe(native);
    });

    it('installs once, not once per subscriber', () => {
        withRequestPatches(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        withRequestPatches(() => subscribeToRequests(() => {}));

        expect(g.fetch).toBe(patched);
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);
    });

    it('ignores a teardown called twice, so one subscriber cannot unpatch for another', () => {
        const removeA = withRequestPatches(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        withRequestPatches(() => subscribeToRequests(() => {}));

        removeA();
        removeA();

        expect(g.fetch).toBe(patched);
    });

    it('unsubscribes its subscriber from the bus on release', () => {
        const subscriber = vi.fn();
        const remove = withRequestPatches(() => subscribeToRequests(subscriber));
        remove();

        withRequestPatches(() => subscribeToRequests(() => {}));
        void g.fetch('https://app.example/api/x');

        expect(subscriber).not.toHaveBeenCalled();
    });
});
