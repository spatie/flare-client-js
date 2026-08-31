import type { Api } from '../api';
import type { FlushScheduler } from '../logging';
import { buildResourceIdentity, TelemetryBuffer } from '../telemetry';
import type { Attributes, BufferedSpan, Config, Framework, SdkInfo, TracesEnvelope } from '../types';
import { buildTracesEnvelope, emptyTracesEnvelopeBytes, otelSpanBytes } from './envelope';

export type SpanBufferDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    getResourceAttributes: () => Attributes;
    track: <T>(p: Promise<T>) => Promise<T>;
    scheduler: FlushScheduler;
};

// The span half of the shared telemetry buffer: names the config keys, the envelope and the ingest call.
export class SpanBuffer {
    private inner: TelemetryBuffer<BufferedSpan, TracesEnvelope>;

    constructor(private deps: SpanBufferDeps) {
        this.inner = new TelemetryBuffer<BufferedSpan, TracesEnvelope>(
            { getConfig: deps.getConfig, scheduler: deps.scheduler },
            {
                // spanFlushMaxBytes bounds one POST's size, not a batching trigger: 800_000 = 100 x 8000 covers a
                // customer putting large payloads in span attributes. Real spans are ~727 B, so the count trigger
                // fires first in the normal case.
                limits: (config) => ({
                    maxSize: config.maxSpanBufferSize,
                    maxBytes: config.spanFlushMaxBytes,
                    flushIntervalMs: config.spanFlushIntervalMs,
                }),
                enabled: (config) => config.enableTracing,
                keepaliveBudget: () => deps.api.keepaliveBudgetRemaining(),
                estimateBytes: (span) => this.estimateBytes(span),
                emptyEnvelopeBytes: (resource) => {
                    const sdk = deps.getSdkInfo();
                    return emptyTracesEnvelopeBytes(resource, sdk.name, sdk.version);
                },
                recordBytes: (span) => otelSpanBytes(span),
                oversizedMessage: 'Flare: dropping oversized span',
                keepaliveDropMessage: (count) =>
                    `Flare: dropped ${count} span(s) from keepalive envelope (over budget)`,
                sendFailureMessage: 'Flare: failed to send buffered spans',
                resourceForFlush: () => this.resourceForFlush(),
                buildEnvelope: (spans, resource) => {
                    const sdk = deps.getSdkInfo();
                    return buildTracesEnvelope(spans, resource, sdk.name, sdk.version);
                },
                send: (envelope, config, keepalive) => {
                    deps.track(deps.api.traces(envelope, config.tracesIngestUrl, config.key, config.debug, keepalive));
                },
            },
        );
    }

    length(): number {
        return this.inner.length();
    }

    add(span: BufferedSpan): void {
        this.inner.add(span);
    }

    flush(opts?: { keepalive?: boolean }): void {
        this.inner.flush(opts);
    }

    clear(): void {
        this.inner.clear();
    }

    private resourceForFlush(): Attributes {
        return buildResourceIdentity(
            this.deps.getResourceAttributes(),
            this.deps.getConfig(),
            this.deps.getSdkInfo(),
            this.deps.getFramework(),
        );
    }

    private estimateBytes(span: BufferedSpan): number {
        // onSpanEnd already reduced every attribute to an OTLP primitive, so safeClone changes nothing here.
        // .length is UTF-16 units, not UTF-8 bytes: exact for ASCII, but CJK-heavy values run ~3x over.
        return JSON.stringify(span).length;
    }
}
