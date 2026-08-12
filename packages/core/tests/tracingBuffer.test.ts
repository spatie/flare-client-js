import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { SpanBuffer, type SpanBufferDeps } from '../src/tracing/SpanBuffer';
import type { BufferedSpan, Config, SdkInfo } from '../src/types';
import { FakeApi } from './helpers/FakeApi';

const baseConfig = (over: Partial<Config> = {}): Config =>
    ({
        key: 'k',
        debug: false,
        tracesIngestUrl: 'https://x/v1/traces',
        enableTracing: true,
        maxSpanBufferSize: 100,
        spanFlushIntervalMs: 5000,
        spanFlushMaxBytes: 800_000,
        keepaliveMaxBytes: 60_000,
        ...over,
    }) as Config;

const span = (id: string): BufferedSpan => ({
    traceId: 'a'.repeat(32),
    spanId: id.padEnd(16, '0'),
    parentSpanId: null,
    name: 'op',
    startTimeUnixNano: 1,
    endTimeUnixNano: 2,
    status: { code: 0 },
    recordAttributes: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    events: [],
});

// SpanBuffer delegates to the shared TelemetryBuffer, so the byte bookkeeping under test lives one level in.
const internals = (buffer: SpanBuffer) =>
    (buffer as unknown as { inner: { entries: { bytes: number }[]; bufferedBytes: number } }).inner;

const runningTotal = (buffer: SpanBuffer): number => internals(buffer).bufferedBytes;

const entrySum = (buffer: SpanBuffer): number => internals(buffer).entries.reduce((sum, entry) => sum + entry.bytes, 0);

// Throws instead of using expect() so it adds no JSON.stringify calls to the serialization-count test.
const assertBytesInStep = (buffer: SpanBuffer): void => {
    if (runningTotal(buffer) !== entrySum(buffer)) {
        throw new Error(`bufferedBytes ${runningTotal(buffer)} drifted from the entry sum ${entrySum(buffer)}`);
    }
};

// Re-checks the running total after every public call, so a mutation site that forgets to update it fails
// whatever test touches it, not only the tests written with drift in mind.
const guardBytes = (buffer: SpanBuffer): SpanBuffer =>
    new Proxy(buffer, {
        get(target, prop) {
            const value = Reflect.get(target, prop) as unknown;
            if (typeof value !== 'function') {
                return value;
            }
            return (...args: unknown[]) => {
                const result = (value as (...a: unknown[]) => unknown).apply(target, args);
                assertBytesInStep(target);
                return result;
            };
        },
    });

const makeBuffer = (config: Config, api = new FakeApi(), over: Partial<SpanBufferDeps> = {}): SpanBuffer =>
    guardBytes(
        new SpanBuffer({
            api,
            getConfig: () => config,
            getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
            getFramework: () => null,
            getResourceAttributes: () => ({ 'service.name': 'web' }),
            track: (p) => p,
            scheduler: new NoopFlushScheduler(),
            ...over,
        }),
    );

describe('SpanBuffer', () => {
    afterEach(() => vi.useRealTimers());

    it('flushes when the count trigger is reached', () => {
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 2 }), api);
        buffer.add(span('1'));
        expect(api.traceEnvelopes).toHaveLength(0);
        buffer.add(span('2'));
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    });

    it('flushes when the timer fires', () => {
        vi.useFakeTimers();
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 100, spanFlushIntervalMs: 5000 }), api);
        buffer.add(span('1'));
        expect(api.traceEnvelopes).toHaveLength(0);
        vi.advanceTimersByTime(5000);
        expect(api.traceEnvelopes).toHaveLength(1);
    });

    it('flushes when the byte-weight trigger is reached', () => {
        const api = new FakeApi();
        const oneSpanBytes = JSON.stringify(span('1')).length;
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 1000, spanFlushMaxBytes: oneSpanBytes + 5 }), api);
        buffer.add(span('1')); // bytes == oneSpanBytes, below cap -> no flush
        expect(api.traceEnvelopes).toHaveLength(0);
        buffer.add(span('2')); // bytes == 2*oneSpanBytes, over cap -> flush both
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    });

    it('drops a single span larger than spanFlushMaxBytes at capture', () => {
        const buffer = makeBuffer(baseConfig({ spanFlushMaxBytes: 10 }));
        buffer.add(span('1')); // far bigger than 10 bytes
        expect(buffer.length()).toBe(0);
    });

    it('trims to maxSpanBufferSize when flush cannot drain (no key)', () => {
        const buffer = makeBuffer(baseConfig({ key: null, maxSpanBufferSize: 2 }));
        ['1', '2', '3', '4'].forEach((id) => buffer.add(span(id)));
        expect(buffer.length()).toBe(2); // oldest two trimmed away
    });

    it('does not send without a key, retaining the buffer', () => {
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ key: null, maxSpanBufferSize: 1 }), api);
        buffer.add(span('1'));
        expect(api.traceEnvelopes).toHaveLength(0);
        expect(buffer.length()).toBe(1);
    });

    it('does not send when tracing is disabled, even with a key and buffered spans', () => {
        const api = new FakeApi();
        const cfg = baseConfig({ key: null, maxSpanBufferSize: 100 }); // key null so add() does not flush
        const buffer = makeBuffer(cfg, api);
        buffer.add(span('1'));
        cfg.key = 'k';
        cfg.enableTracing = false;
        buffer.flush();
        expect(api.traceEnvelopes).toHaveLength(0);
    });

    it('stamps the envelope resource with sdk identity merged over the last span resource', () => {
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 1 }), api);
        buffer.add(span('1'));
        const attrs = api.traceEnvelopes[0].resourceSpans[0].resource.attributes;
        const keys = attrs.map((a) => a.key);
        expect(keys).toContain('service.name');
        expect(keys).toContain('telemetry.sdk.name');
    });

    it('keepalive flush ships what fits and clears the buffer', () => {
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 100, keepaliveMaxBytes: 1_000_000 }), api);
        buffer.add(span('1'));
        buffer.flush({ keepalive: true });
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(api.lastTraceKeepalive).toBe(true);
        expect(buffer.length()).toBe(0);
    });

    it('keepalive over budget retains the tail and re-arms the timer', () => {
        vi.useFakeTimers();
        const api = new FakeApi();
        // Sized to fit exactly the newest of two spans (packing is newest-wins), so this exercises a genuine
        // partial pack rather than the nothing-fits case (see the fallback tests below for that one).
        const buffer = makeBuffer(baseConfig({ keepaliveMaxBytes: 900, spanFlushIntervalMs: 5000 }), api);
        buffer.add(span('1'));
        buffer.add(span('2'));
        buffer.flush({ keepalive: true });
        expect(api.traceEnvelopes).toHaveLength(1); // only the newest span fit
        expect(api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
        expect(buffer.length()).toBe(1); // the older span retained
        vi.advanceTimersByTime(5000); // re-armed timer drains it normally
        expect(api.traceEnvelopes).toHaveLength(2);
    });

    it('keepalive with nothing fitting the budget ships the whole buffer without keepalive instead of dropping it', () => {
        const api = new FakeApi();
        const buffer = makeBuffer(baseConfig({ keepaliveMaxBytes: 1, spanFlushIntervalMs: 5000 }), api);
        buffer.add(span('1'));
        buffer.add(span('2'));
        buffer.flush({ keepalive: true });
        // Nothing fits a 1-byte budget. A cancellable normal fetch beats silent retention on a page that is
        // unloading, so the whole buffer ships anyway, just without keepalive.
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
        expect(api.lastTraceKeepalive).toBe(false);
        expect(buffer.length()).toBe(0);
    });

    it('clear() empties the buffer', () => {
        const buffer = makeBuffer(baseConfig());
        buffer.add(span('1'));
        buffer.clear();
        expect(buffer.length()).toBe(0);
    });

    it('serializes a constant number of times per add(), whatever the buffer depth', () => {
        // key null so flush() no-ops and the buffer keeps growing; the caps are set high enough that
        // neither trigger nor trim fires, isolating the per-add serialization count.
        const buffer = makeBuffer(baseConfig({ key: null, maxSpanBufferSize: 500 }));
        const countOneAdd = (id: string): number => {
            const spy = vi.spyOn(JSON, 'stringify');
            buffer.add(span(id));
            const calls = spy.mock.calls.length;
            spy.mockRestore();
            return calls;
        };

        const shallow = countOneAdd('first');
        for (let i = 0; i < 100; i++) {
            buffer.add(span(`fill-${i}`));
        }
        const deep = countOneAdd('last');

        expect(deep).toBe(shallow);
        expect(deep).toBe(1);
    });

    it('keeps the running byte total in step through trim, keepalive and drain', () => {
        const api = new FakeApi();
        const cfg = baseConfig({ key: null, maxSpanBufferSize: 3, keepaliveMaxBytes: 1_000_000 });
        const buffer = makeBuffer(cfg, api);

        // No key, so flush() no-ops and trim()'s slice is the only thing shrinking the buffer.
        ['1', '2', '3', '4', '5'].forEach((id) => buffer.add(span(id)));
        expect(buffer.length()).toBe(3);
        expect(runningTotal(buffer)).toBe(entrySum(buffer));

        cfg.key = 'k';
        buffer.flush({ keepalive: true }); // packs everything, leaves an empty residue
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(runningTotal(buffer)).toBe(entrySum(buffer));

        buffer.add(span('6'));
        buffer.flush(); // normal drain
        expect(runningTotal(buffer)).toBe(0);
        expect(entrySum(buffer)).toBe(0);

        buffer.add(span('7'));
        buffer.clear();
        expect(runningTotal(buffer)).toBe(0);
    });

    it('subtracts the shifted span when trim drops one by weight', () => {
        const oneSpanBytes = JSON.stringify(span('1')).length;
        const buffer = makeBuffer(baseConfig({ key: null, spanFlushMaxBytes: oneSpanBytes + 5 }));
        buffer.add(span('1'));
        buffer.add(span('2')); // over the ceiling, no key so flush no-ops and trim shifts the oldest

        expect(buffer.length()).toBe(1);
        expect(runningTotal(buffer)).toBe(oneSpanBytes);
    });

    it('evaluates getResourceAttributes once per flush, even when keepalive packs multiple trial envelopes', () => {
        const api = new FakeApi();
        const getResourceAttributes = vi.fn(() => ({ 'host.name': 'h' }));
        const buffer = makeBuffer(baseConfig({ maxSpanBufferSize: 100, keepaliveMaxBytes: 1_000_000 }), api, {
            getResourceAttributes,
        });
        buffer.add(span('1'));
        buffer.add(span('2'));
        buffer.add(span('3'));
        getResourceAttributes.mockClear();
        buffer.flush({ keepalive: true });
        expect(getResourceAttributes).toHaveBeenCalledTimes(1);
        expect(api.traceEnvelopes).toHaveLength(1);
    });

    it('logs one console.error for all keepalive-dropped spans, not one per span, then ships them via the fallback', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const api = new FakeApi();
        // keepaliveMaxBytes: 1 means nothing fits, so packForKeepalive rejects every candidate.
        const cfg = baseConfig({ debug: true, maxSpanBufferSize: 200, keepaliveMaxBytes: 1 });
        const buffer = makeBuffer(cfg, api);
        for (let i = 0; i < 100; i++) {
            buffer.add(span(`s${i}`));
        }

        buffer.flush({ keepalive: true });

        // packForKeepalive still logs the rejection once, for all 100 candidates...
        expect(err).toHaveBeenCalledTimes(1);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('100'));
        // ...but the whole buffer ships anyway through the no-room-left fallback, just without keepalive.
        expect(api.traceEnvelopes).toHaveLength(1);
        expect(api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans).toHaveLength(100);
        expect(api.lastTraceKeepalive).toBe(false);
        expect(buffer.length()).toBe(0);

        err.mockRestore();
    });

    it('keepalive packing skips an over-budget span and keeps packing older ones', () => {
        const api = new FakeApi();
        const cfg = baseConfig({ key: null, maxSpanBufferSize: 100, keepaliveMaxBytes: 3000 });
        const buffer = makeBuffer(cfg, api);
        const fatName = 'GET /'.padEnd(4000, 'x');
        ['1', '2', '3'].forEach((id) => buffer.add(span(id)));
        buffer.add({ ...span('fat'), name: fatName }); // newest, over the whole budget on its own

        cfg.key = 'k';
        buffer.flush({ keepalive: true });

        const shipped = api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans.map((s) => s.name);
        expect(shipped).not.toContain(fatName);
        expect(shipped).toHaveLength(3); // the three older spans still fit and still ship

        // The whole point of packing incrementally: the envelope that actually ships must respect the budget,
        // not just contain the right span names.
        const bytes = new TextEncoder().encode(JSON.stringify(api.traceEnvelopes[0])).length;
        expect(bytes).toBeLessThanOrEqual(3000);
    });

    // Api.traces handles its own serialization failures, but buildEnvelope runs before it and encodes the
    // resource block, where a nested throwing getter still blows up. flush() is called from timers, so it must
    // swallow that rather than let it reach window.onerror. Non-keepalive only: the keepalive path sizes the
    // resource block before this try opens (see the comment above flush()'s try), so it is not covered here.
    it('does not throw out of a non-keepalive flush() when encoding the resource block fails', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const api = new FakeApi();
        const hostile = {
            get boom(): string {
                throw new Error('getter exploded');
            },
        };
        // Nested, not top level: resourceForFlush spreads the bag, so a top-level getter would throw before flush
        // even reaches the envelope build.
        const buffer = makeBuffer(baseConfig({ debug: true }), api, {
            getResourceAttributes: () => ({ nested: hostile }),
        });
        buffer.add(span('1'));

        expect(() => buffer.flush()).not.toThrow();
        expect(api.traceEnvelopes).toHaveLength(0);
        expect(err).toHaveBeenCalledWith('Flare: failed to send buffered spans', expect.any(Error));

        err.mockRestore();
    });
});
