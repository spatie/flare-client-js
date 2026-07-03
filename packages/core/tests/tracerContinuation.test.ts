import { describe, expect, it } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { Tracer } from '../src/tracing/Tracer';
import type { Config, SdkInfo } from '../src/types';

const TID = 'a'.repeat(32);
const SID = 'b'.repeat(16);

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

const makeTracer = (cfg = config()) =>
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

describe('Tracer.continueFromTraceparent', () => {
    it('the next root adopts the continued trace and parent', () => {
        const tracer = makeTracer();
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        const span = tracer.startSpan('root');
        expect(span.traceId).toBe(TID);
        expect(span.parentSpanId).toBe(SID);
    });

    it('inherits the upstream sampled-out decision', () => {
        const tracer = makeTracer(config({ tracesSampleRate: 1 }));
        tracer.continueFromTraceparent(`00-${TID}-${SID}-00`); // upstream not sampled
        expect(tracer.startSpan('root').isRecording).toBe(false);
    });

    it('is one-shot: a second root does not inherit the stale continuation', () => {
        const tracer = makeTracer();
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        const first = tracer.startSpan('first');
        first.end();
        const second = tracer.startSpan('second');
        expect(second.traceId).not.toBe(TID);
        expect(second.parentSpanId).toBeNull();
    });

    it('ignores a malformed continuation header', () => {
        const tracer = makeTracer();
        tracer.continueFromTraceparent('garbage');
        expect(tracer.startSpan('root').parentSpanId).toBeNull();
    });
});
