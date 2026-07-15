import { NoopFlushScheduler } from '../../src/logging';
import { Tracer } from '../../src/tracing/Tracer';
import type { Config, SdkInfo } from '../../src/types';

export const config = (over: Partial<Config> = {}): Config =>
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

export const makeTracer = (cfg: Config, rng: () => number = () => 0, maxLiveTraces?: number) => {
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

export const spyBuffer = (tracer: Tracer): unknown[] => {
    const captured: unknown[] = [];
    (tracer as unknown as { buffer: { add: (s: unknown) => void; clear: () => void } }).buffer = {
        add: (s) => captured.push(s),
        clear: () => {},
    };
    return captured;
};

export const traceCount = (tracer: Tracer): number =>
    (tracer as unknown as { traceStates: Map<string, unknown> }).traceStates.size;

export const hasTrace = (tracer: Tracer, traceId: string): boolean =>
    (tracer as unknown as { traceStates: Map<string, unknown> }).traceStates.has(traceId);
