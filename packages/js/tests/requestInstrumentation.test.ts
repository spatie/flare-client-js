import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unpatchFetch } from '../src/instrumentation/instrumentFetch';
import { resetRequestBus, subscribeToRequests } from '../src/instrumentation/requestBus';
import { addRequestConsumer, resetRequestInstrumentation } from '../src/instrumentation/requestInstrumentation';

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
        const remove = addRequestConsumer(() => subscribeToRequests(() => {}));
        expect(g.fetch).not.toBe(native);

        remove();
        expect(g.fetch).toBe(native);
    });

    it('keeps the patch while a second consumer is still listening', () => {
        const removeA = addRequestConsumer(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        const removeB = addRequestConsumer(() => subscribeToRequests(() => {}));
        expect(g.fetch).toBe(patched);

        // Whichever one leaves first, the patch survives for the other.
        removeB();
        expect(g.fetch).toBe(patched);

        removeA();
        expect(g.fetch).toBe(native);
    });

    it('installs once, not once per consumer', () => {
        addRequestConsumer(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        addRequestConsumer(() => subscribeToRequests(() => {}));

        expect(g.fetch).toBe(patched);
        expect((g.fetch as { __flare_original__?: unknown }).__flare_original__).toBe(native);
    });

    it('ignores a teardown called twice, so one consumer cannot unpatch for another', () => {
        const removeA = addRequestConsumer(() => subscribeToRequests(() => {}));
        const patched = g.fetch;
        addRequestConsumer(() => subscribeToRequests(() => {}));

        removeA();
        removeA();

        expect(g.fetch).toBe(patched);
    });

    it('unsubscribes its consumer from the bus on release', () => {
        const observer = vi.fn();
        const remove = addRequestConsumer(() => subscribeToRequests(observer));
        remove();

        addRequestConsumer(() => subscribeToRequests(() => {}));
        void g.fetch('https://app.example/api/x');

        expect(observer).not.toHaveBeenCalled();
    });
});
