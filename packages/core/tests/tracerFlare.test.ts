import { stubFetch } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { Flare } from '../src/Flare';
import { InMemoryActiveSpanHolder } from '../src/tracing/context';
import type { ActiveSpanHolder } from '../src/tracing/context';
import { FakeApi } from './helpers/FakeApi';

const makeFlare = (api = new FakeApi(), holder?: ActiveSpanHolder) => {
    const flare = new Flare(api, undefined, undefined, undefined, undefined, holder);
    flare.light('test-key');
    flare.configure({ enableTracing: true });
    return flare;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Flare tracing wiring', () => {
    it('startSpan/withSpan are reachable and the tracer getter exists', () => {
        const flare = makeFlare();
        const span = flare.startSpan('op');
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        span.end();
        expect(flare.tracer).toBeDefined();
        expect(flare.withSpan('op2', (s) => s.spanId)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('Flare.flush() drains buffered spans, not just logs', async () => {
        const api = new FakeApi();
        const flare = makeFlare(api);
        flare.startSpan('op').end(); // buffered, below the count trigger
        expect(api.traceEnvelopes).toHaveLength(0);
        await flare.flush();
        expect(api.traceEnvelopes).toHaveLength(1);
    });

    it('Flare.light(key) flushes spans buffered while keyless', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ enableTracing: true }); // tracing on, no key yet
        flare.startSpan('op').end(); // buffered, cannot send without a key
        expect(api.traceEnvelopes).toHaveLength(0);
        flare.light('KEY');
        expect(api.traceEnvelopes).toHaveLength(1);
    });

    it('configure({ enableTracing: false }) after it was enabled clears buffered spans', async () => {
        const api = new FakeApi();
        const flare = makeFlare(api);
        flare.startSpan('op').end();
        flare.configure({ enableTracing: false });
        await flare.flush();
        expect(api.traceEnvelopes).toHaveLength(0);
    });

    it('drops a span whose payload cannot be serialized, without throwing out of end()', async () => {
        const api = new FakeApi();
        const flare = makeFlare(api);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;

        const span = flare.startSpan('op');
        span.setStatus({ code: 2, message: cyclic as unknown as string });

        expect(() => span.end()).not.toThrow();
        await flare.flush();
        expect(api.traceEnvelopes).toHaveLength(0);
    });

    // status.message is held by reference, so the host can still mutate a buffered span unserializable
    // after add(). Api.traces catches that and falls back to flatJsonStringify, so it still ships.
    it('still ships a buffered span that was mutated unserializable after add()', async () => {
        const fetchMock = stubFetch();
        const flare = new Flare(new Api());
        flare.light('k');
        flare.configure({ enableTracing: true, debug: true });

        const message: Record<string, unknown> = { detail: 'timeout' };
        const span = flare.startSpan('op');
        span.setStatus({ code: 2, message: message as unknown as string });
        span.end(); // JSON-safe here, so estimateBytes is happy and the span buffers

        message.self = message; // the host still holds the reference

        await expect(flare.flush()).resolves.toBeUndefined();
        expect(fetchMock.mock.calls[0][1].body).toContain('[Circular]');
    });

    it('clamps tracesSampleRate to [0, 1]', () => {
        const flare = makeFlare();
        flare.configure({ tracesSampleRate: 5 });
        expect(flare.config.tracesSampleRate).toBe(1);
        flare.configure({ tracesSampleRate: -2 });
        expect(flare.config.tracesSampleRate).toBe(0);
    });

    it('uses an injected active-span holder', () => {
        const calls: string[] = [];
        const inner = new InMemoryActiveSpanHolder();
        const holder: ActiveSpanHolder = {
            getActive: () => inner.getActive(),
            withActive: (span, fn) => {
                calls.push('withActive');
                return inner.withActive(span, fn);
            },
        };
        const flare = makeFlare(new FakeApi(), holder);
        flare.withSpan('op', () => undefined);
        expect(calls).toContain('withActive');
    });
});
