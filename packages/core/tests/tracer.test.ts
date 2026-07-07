import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { defaultNowNano, Tracer } from '../src/tracing/Tracer';
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

const makeTracer = (cfg: Config, rng: () => number = () => 0, maxLiveTraces?: number) => {
    const tracer = new Tracer({
        api: {} as never,
        getConfig: () => cfg,
        getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
        getFramework: () => null,
        getScopeAttributes: () => ({}),
        getResourceAttributes: () => ({}),
        track: (p) => p,
        scheduler: new NoopFlushScheduler(),
        now: () => 100,
        rng,
        maxLiveTraces,
    });
    return tracer;
};

const spyBuffer = (tracer: Tracer): unknown[] => {
    const captured: unknown[] = [];
    (tracer as unknown as { buffer: { add: (s: unknown) => void; clear: () => void } }).buffer = {
        add: (s) => captured.push(s),
        clear: () => {},
    };
    return captured;
};

const traceCount = (tracer: Tracer): number =>
    (tracer as unknown as { traceStates: Map<string, unknown> }).traceStates.size;

const hasTrace = (tracer: Tracer, traceId: string): boolean =>
    (tracer as unknown as { traceStates: Map<string, unknown> }).traceStates.has(traceId);

describe('Tracer.startSpan', () => {
    it('creates a root with fresh ids and a null parent', () => {
        const span = makeTracer(config()).startSpan('root');
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(span.parentSpanId).toBeNull();
        expect(span.isRecording).toBe(true);
    });

    it('parents a child under an explicit Span parent in the same trace', () => {
        const tracer = makeTracer(config());
        const root = tracer.startSpan('root');
        const child = tracer.startSpan('child', { parent: root });
        expect(child.traceId).toBe(root.traceId);
        expect(child.parentSpanId).toBe(root.spanId);
    });

    it('returns inert (non-recording) spans when tracing is disabled', () => {
        const span = makeTracer(config({ enableTracing: false })).startSpan('x');
        expect(span.isRecording).toBe(false);
    });

    it('makes children non-recording in a sampled-out trace', () => {
        const tracer = makeTracer(config({ tracesSampleRate: 0 }));
        const root = tracer.startSpan('root');
        expect(root.isRecording).toBe(false);
        expect(tracer.startSpan('child', { parent: root }).isRecording).toBe(false);
    });

    it('a plain {traceId, spanId} parent inherits existing sampled-out state (lookup first)', () => {
        const tracer = makeTracer(config({ tracesSampleRate: 0 }));
        const root = tracer.startSpan('root'); // sampled out, state still live
        const child = tracer.startSpan('child', { parent: { traceId: root.traceId, spanId: root.spanId } });
        expect(child.traceId).toBe(root.traceId);
        expect(child.parentSpanId).toBe(root.spanId);
        expect(child.isRecording).toBe(false); // inherited, not defaulted to recording
    });

    it('re-seeds from parent.isRecording when the parent trace state was pruned', () => {
        const tracer = makeTracer(config({ tracesSampleRate: 0 }));
        const root = tracer.startSpan('root'); // sampled out
        root.end(); // prunes the trace state (rootEnded + openSpanCount 0)
        const child = tracer.startSpan('child', { parent: root });
        expect(child.isRecording).toBe(false); // not resurrected as recording
    });

    it('records exactly maxSpansPerTrace spans, root counted as #1', () => {
        const tracer = makeTracer(config({ maxSpansPerTrace: 2 }));
        const root = tracer.startSpan('root');
        const a = tracer.startSpan('a', { parent: root });
        const b = tracer.startSpan('b', { parent: root });
        expect(root.isRecording).toBe(true);
        expect(a.isRecording).toBe(true);
        expect(b.isRecording).toBe(false); // 3rd span exceeds cap of 2
    });

    it('buffers a finished recording span and sets flare.span_type from opts', () => {
        const captured: unknown[] = [];
        const tracer = makeTracer(config());
        (tracer as unknown as { buffer: { add: (s: unknown) => void } }).buffer = {
            add: (s) => captured.push(s),
        };
        const span = tracer.startSpan('op', { spanType: 'browser_pageload', attributes: { a: 1 } });
        span.end();
        expect(captured).toHaveLength(1);
        const buffered = captured[0] as { name: string; recordAttributes: { key: string }[] };
        expect(buffered.name).toBe('op');
        const keys = buffered.recordAttributes.map((kv) => kv.key);
        expect(keys).toContain('flare.span_type');
        expect(keys).toContain('a');
    });

    it('does not buffer non-recording spans', () => {
        const captured: unknown[] = [];
        const tracer = makeTracer(config({ tracesSampleRate: 0 }));
        (tracer as unknown as { buffer: { add: (s: unknown) => void } }).buffer = {
            add: (s) => captured.push(s),
        };
        tracer.startSpan('op').end();
        expect(captured).toHaveLength(0);
    });

    it('does not buffer a span ended after tracing was disabled, and does not throw', () => {
        const cfg = config();
        const tracer = makeTracer(cfg);
        const captured = spyBuffer(tracer);
        const span = tracer.startSpan('op'); // recording while enabled
        cfg.enableTracing = false; // disabled before end
        expect(() => span.end()).not.toThrow();
        expect(captured).toHaveLength(0);
    });

    it('does not buffer a stale span ended after clear(), even with tracing still enabled', () => {
        const tracer = makeTracer(config());
        const captured = spyBuffer(tracer);
        const span = tracer.startSpan('op'); // epoch 0
        tracer.clear(); // epoch -> 1
        expect(() => span.end()).not.toThrow();
        expect(captured).toHaveLength(0);
    });

    it('evicts a trace state when over maxLiveTraces (bounded backstop)', () => {
        const tracer = makeTracer(config(), () => 0, 2);
        tracer.startSpan('r1'); // three distinct roots, never ended
        tracer.startSpan('r2');
        tracer.startSpan('r3');
        expect(traceCount(tracer)).toBe(2);
    });

    it('evicts the least-recently-used trace, keeping a recently-touched one', () => {
        const tracer = makeTracer(config(), () => 0, 2);
        const a = tracer.startSpan('a'); // trace A
        const b = tracer.startSpan('b'); // trace B
        tracer.startSpan('a-child', { parent: a }); // touch A -> most recent
        const c = tracer.startSpan('c'); // new trace C -> evicts LRU (B)
        expect(hasTrace(tracer, a.traceId)).toBe(true);
        expect(hasTrace(tracer, b.traceId)).toBe(false);
        expect(hasTrace(tracer, c.traceId)).toBe(true);
    });

    it('ignores a stale Span parent after clear() (handle is inert)', () => {
        const tracer = makeTracer(config());
        const span = tracer.startSpan('op'); // epoch 0
        tracer.clear(); // epoch -> 1; traceStates emptied
        const child = tracer.startSpan('child', { parent: span });
        expect(child.traceId).not.toBe(span.traceId); // not parented to the stale span
        expect(child.parentSpanId).toBeNull(); // becomes a fresh root instead
    });

    it('a plain parent for an unknown trace makes the child the local root and prunes on its end', () => {
        const tracer = makeTracer(config());
        const foreignTraceId = 'f'.repeat(32);
        const foreignSpanId = 'e'.repeat(16);
        const child = tracer.startSpan('child', {
            parent: { traceId: foreignTraceId, spanId: foreignSpanId },
        });
        expect(child.traceId).toBe(foreignTraceId);
        expect(child.parentSpanId).toBe(foreignSpanId);
        expect(child.isRecording).toBe(true); // no local state -> sampler runs (rate 1 -> sampled)
        expect(traceCount(tracer)).toBe(1);
        child.end(); // child is the local root -> rootEnded -> trace state pruned
        expect(hasTrace(tracer, foreignTraceId)).toBe(false);
    });

    it('runs the sampler for a plain parent with unknown recording state (no default-to-recording)', () => {
        // A manually stitched {traceId, spanId} parent carries no recording decision.
        // With tracesSampleRate 0 the child must be sampled out, not assumed recording.
        const tracer = makeTracer(config({ tracesSampleRate: 0 }));
        const child = tracer.startSpan('child', {
            parent: { traceId: 'f'.repeat(32), spanId: 'e'.repeat(16) },
        });
        expect(child.isRecording).toBe(false);
    });

    it('does not invoke the sampler for a plain parent whose trace state already exists', () => {
        let calls = 0;
        const cfg = config({
            tracesSampler: () => {
                calls++;
                return true;
            },
        });
        const tracer = makeTracer(cfg);
        const root = tracer.startSpan('root');
        expect(calls).toBe(1);
        const child = tracer.startSpan('child', { parent: { traceId: root.traceId, spanId: root.spanId } });
        expect(child.traceId).toBe(root.traceId);
        expect(calls).toBe(1); // existing state found, no spurious sampler invocation
    });

    it('does not throw out of startSpan when a customer tracesSampler throws; span is not sampled', () => {
        const cfg = config({
            tracesSampler: () => {
                throw new Error('sampler boom');
            },
        });
        const tracer = makeTracer(cfg);
        let span: ReturnType<Tracer['startSpan']> | undefined;
        expect(() => {
            span = tracer.startSpan('root');
        }).not.toThrow();
        expect(span?.isRecording).toBe(false);
        expect(() => span?.end()).not.toThrow();
    });

    it('forceRoot ignores the ambient active span and starts a new trace', () => {
        const tracer = makeTracer(config());
        let outerTraceId = '';
        let nav: ReturnType<Tracer['startSpan']> | undefined;
        tracer.withSpan('user-action', (outer) => {
            outerTraceId = outer.traceId;
            nav = tracer.startSpan('navigation', { forceRoot: true });
        });
        expect(nav?.parentSpanId).toBeNull();
        expect(nav?.traceId).not.toBe(outerTraceId);
    });

    it('without forceRoot a span started inside withSpan joins the active trace', () => {
        const tracer = makeTracer(config());
        let outerTraceId = '';
        let child: ReturnType<Tracer['startSpan']> | undefined;
        tracer.withSpan('user-action', (outer) => {
            outerTraceId = outer.traceId;
            child = tracer.startSpan('navigation');
        });
        expect(child?.traceId).toBe(outerTraceId); // contrast: default nests
    });
});

describe('defaultNowNano', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses performance.timeOrigin + performance.now() when both are available', () => {
        vi.stubGlobal('performance', { now: () => 5, timeOrigin: 1000 });
        expect(defaultNowNano()).toBe(Math.round(1005 * 1e6));
    });

    it('falls back to Date.now() when performance.timeOrigin is missing (no NaN)', () => {
        // Some environments (older Safari, some Hermes builds) expose performance.now
        // without timeOrigin; timeOrigin + now() would be NaN there.
        vi.stubGlobal('performance', { now: () => 5 });
        const before = Date.now() * 1e6;
        const value = defaultNowNano();
        const after = Date.now() * 1e6;
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(before);
        expect(value).toBeLessThanOrEqual(after);
    });

    it('falls back to Date.now() when performance is absent entirely', () => {
        vi.stubGlobal('performance', undefined);
        expect(Number.isFinite(defaultNowNano())).toBe(true);
    });
});
