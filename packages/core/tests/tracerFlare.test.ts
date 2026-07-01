import { describe, expect, it } from 'vitest';

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
