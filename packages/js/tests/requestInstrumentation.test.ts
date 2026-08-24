import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unpatchFetch } from '../src/instrumentation/instrumentFetch';
import { resetRequestBus, subscribeToRequests } from '../src/instrumentation/requestBus';
import { resetRequestInstrumentation, useRequestBus } from '../src/instrumentation/requestInstrumentation';

const g = globalThis as { fetch: typeof fetch };
let before: typeof fetch;
let native: typeof fetch;

beforeEach(() => {
    resetRequestBus();
    resetRequestInstrumentation();
    before = g.fetch;
    native = nativeFetchStub();
    g.fetch = native;
});

afterEach(() => {
    unpatchFetch();
    g.fetch = before;
});

describe('the patch belongs to nobody', () => {
    it('installs on the first consumer and removes on the last', () => {
        const release = useRequestBus(() => subscribeToRequests(() => {}));
        expect(g.fetch).not.toBe(native);

        release();
        expect(g.fetch).toBe(native);
    });

    it('keeps the patch while a second consumer is still listening', () => {
        const releaseA = useRequestBus(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        const releaseB = useRequestBus(() => subscribeToRequests(() => {}));
        expect(g.fetch).toBe(patched);

        // Whichever one leaves first, the patch survives for the other.
        releaseB();
        expect(g.fetch).toBe(patched);

        releaseA();
        expect(g.fetch).toBe(native);
    });

    it('installs once, not once per consumer', () => {
        useRequestBus(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        useRequestBus(() => subscribeToRequests(() => {}));

        expect(g.fetch).toBe(patched);
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);
    });

    it('ignores a teardown called twice, so one consumer cannot unpatch for another', () => {
        const releaseA = useRequestBus(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        useRequestBus(() => subscribeToRequests(() => {}));

        releaseA();
        releaseA();

        expect(g.fetch).toBe(patched);
    });

    it('unsubscribes its consumer from the bus on release', () => {
        const observer = vi.fn();
        const release = useRequestBus(() => subscribeToRequests(observer));
        release();

        useRequestBus(() => subscribeToRequests(() => {}));
        void g.fetch('https://app.example/api/x');

        expect(observer).not.toHaveBeenCalled();
    });
});
