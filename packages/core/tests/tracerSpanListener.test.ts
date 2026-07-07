import { describe, expect, it } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { Tracer } from '../src/tracing/Tracer';
import type { Config, SdkInfo } from '../src/types';

const config = (over: Partial<Config> = {}): Config =>
    ({
        key: 'k',
        debug: false,
        enableTracing: true,
        tracesIngestUrl: 'https://x/v1/traces',
        tracesSampleRate: 1,
        maxSpanBufferSize: 1000,
        spanFlushIntervalMs: 5000,
        spanFlushMaxBytes: 800_000,
        keepaliveMaxBytes: 60_000,
        maxSpansPerTrace: 1024,
        maxAttributesPerSpan: 128,
        maxEventsPerSpan: 128,
        maxAttributesPerSpanEvent: 128,
        ...over,
    }) as Config;

const makeTracer = (cfg: Config = config()): Tracer =>
    new Tracer({
        api: {} as never,
        getConfig: () => cfg,
        getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
        getFramework: () => null,
        getScopeAttributes: () => ({}),
        getResourceAttributes: () => ({}),
        track: (p) => p,
        scheduler: new NoopFlushScheduler(),
        now: () => 100,
        rng: () => 0,
    });

describe('Tracer span listener + active root', () => {
    it('emits start on startSpan and end on span end; unsubscribe stops delivery', () => {
        const tracer = makeTracer();
        const events: Array<{ phase: string; spanId: string }> = [];
        const off = tracer.addSpanListener((e) => events.push({ phase: e.phase, spanId: e.span.spanId }));

        const span = tracer.startSpan('op');
        span.end();

        expect(events.map((e) => e.phase)).toEqual(['start', 'end']);
        expect(events[0].spanId).toBe(span.spanId);

        off();
        tracer.startSpan('op2').end();
        expect(events).toHaveLength(2); // no new events after unsubscribe
    });

    it('a throwing listener does not break span creation or ending', () => {
        const tracer = makeTracer();
        tracer.addSpanListener(() => {
            throw new Error('listener boom');
        });
        expect(() => tracer.startSpan('op').end()).not.toThrow();
    });

    it('setActiveRoot makes getActiveSpan return the root, and clearing returns undefined', () => {
        const tracer = makeTracer();
        const root = tracer.startSpan('root');
        tracer.setActiveRoot(root);
        expect(tracer.getActiveSpan()).toBe(root);
        tracer.setActiveRoot(undefined);
        expect(tracer.getActiveSpan()).toBeUndefined();
    });
});
