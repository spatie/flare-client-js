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

    it('is dropped when the next startSpan has a parent (strict one-shot)', () => {
        const tracer = makeTracer();
        const root = tracer.startSpan('root');
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        const child = tracer.startSpan('child', { parent: root });
        expect(child.traceId).toBe(root.traceId); // parent wins over the continuation
        const later = tracer.startSpan('later'); // the continuation must not resurface here
        expect(later.traceId).not.toBe(TID);
        expect(later.parentSpanId).toBeNull();
    });

    it('is dropped when tracing is disabled at the next startSpan', () => {
        const cfg = config({ enableTracing: false });
        const tracer = makeTracer(cfg);
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        tracer.startSpan('while-disabled'); // consumes and drops the continuation
        cfg.enableTracing = true;
        const root = tracer.startSpan('root');
        expect(root.traceId).not.toBe(TID);
        expect(root.parentSpanId).toBeNull();
    });

    it('a fresh continuation overwrites an unconsumed pending one', () => {
        const tracer = makeTracer();
        const otherTid = 'c'.repeat(32);
        const otherSid = 'd'.repeat(16);
        tracer.continueFromTraceparent(`00-${otherTid}-${otherSid}-01`);
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        const root = tracer.startSpan('root');
        expect(root.traceId).toBe(TID);
        expect(root.parentSpanId).toBe(SID);
    });

    it('is discarded by clear()', () => {
        const tracer = makeTracer();
        tracer.continueFromTraceparent(`00-${TID}-${SID}-01`);
        tracer.clear();
        const root = tracer.startSpan('root');
        expect(root.traceId).not.toBe(TID);
        expect(root.parentSpanId).toBeNull();
    });
});
