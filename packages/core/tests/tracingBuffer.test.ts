import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { SpanBuffer } from '../src/tracing/SpanBuffer';
import type { BufferedSpan, Config, SdkInfo } from '../src/types';
import { flatJsonStringify } from '../src/util';
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

const makeBuffer = (config: Config, api = new FakeApi()) =>
    new SpanBuffer({
        api,
        getConfig: () => config,
        getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
        getFramework: () => null,
        getResourceAttributes: () => ({ 'service.name': 'web' }),
        track: (p) => p,
        scheduler: new NoopFlushScheduler(),
    });

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
        const oneSpanBytes = flatJsonStringify(span('1')).length;
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
        const buffer = makeBuffer(baseConfig({ keepaliveMaxBytes: 1, spanFlushIntervalMs: 5000 }), api);
        buffer.add(span('1'));
        buffer.flush({ keepalive: true });
        expect(api.traceEnvelopes).toHaveLength(0); // nothing fit the 1-byte budget
        expect(buffer.length()).toBe(1); // retained
        vi.advanceTimersByTime(5000); // re-armed timer drains it normally
        expect(api.traceEnvelopes).toHaveLength(1);
    });

    it('clear() empties the buffer', () => {
        const buffer = makeBuffer(baseConfig());
        buffer.add(span('1'));
        buffer.clear();
        expect(buffer.length()).toBe(0);
    });

    it('evaluates getResourceAttributes once per flush, even when keepalive packs multiple trial envelopes', () => {
        const api = new FakeApi();
        const getResourceAttributes = vi.fn(() => ({ 'host.name': 'h' }));
        const buffer = new SpanBuffer({
            api,
            getConfig: () => baseConfig({ maxSpanBufferSize: 100, keepaliveMaxBytes: 1_000_000 }),
            getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
            getFramework: () => null,
            getResourceAttributes,
            track: (p) => p,
            scheduler: new NoopFlushScheduler(),
        });
        buffer.add(span('1'));
        buffer.add(span('2'));
        buffer.add(span('3'));
        getResourceAttributes.mockClear();
        buffer.flush({ keepalive: true });
        expect(getResourceAttributes).toHaveBeenCalledTimes(1);
        expect(api.traceEnvelopes).toHaveLength(1);
    });
});
