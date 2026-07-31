import type { Api } from '../api';
import type { FlushFn, FlushScheduler } from '../logging';
import type { Attributes, BufferedSpan, Config, Framework, SdkInfo, TracesEnvelope } from '../types';
import { assertKey, flatJsonStringify } from '../util';
import { buildTracesEnvelope } from './envelope';

export type SpanBufferDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    getResourceAttributes: () => Attributes;
    track: <T>(p: Promise<T>) => Promise<T>;
    scheduler: FlushScheduler;
};

// The size is measured once, when the span arrives. Tracer.onSpanEnd builds a fresh BufferedSpan nothing else
// holds, and SpanImpl refuses every mutation after end(), so a cached size can never go stale.
type BufferEntry = { span: BufferedSpan; bytes: number };

export class SpanBuffer {
    private buffer: BufferEntry[] = [];
    // Running total of every entry's `bytes`. Kept in step at each mutation site: the push in add(), the drain
    // and the keepalive residue in flush(), both drops in trim(), and clear().
    private bufferedBytes = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private timerActive = false;

    constructor(private deps: SpanBufferDeps) {
        const flush: FlushFn = (opts) => this.flush(opts);
        this.deps.scheduler.register(flush);
    }

    length(): number {
        return this.buffer.length;
    }

    add(span: BufferedSpan): void {
        const config = this.deps.getConfig();
        const bytes = this.estimateBytes(span);
        // spanFlushMaxBytes is a request-size ceiling, not a batching trigger: 800_000 = 100 x 8000 bounds one
        // POST for the outlier case of a customer putting large payloads in span attributes. Realistic spans
        // measure ~727 B, so the count trigger fires first in every normal case. A single span over the ceiling
        // could never ship, so drop it here instead of letting trim fail to shed it later.
        if (bytes > config.spanFlushMaxBytes) {
            if (config.debug) {
                console.error('Flare: dropping oversized span');
            }
            return;
        }
        this.buffer.push({ span, bytes });
        this.bufferedBytes += bytes;
        this.evaluateTriggers(config);
        this.trim(config);
    }

    flush(opts?: { keepalive?: boolean }): void {
        const config = this.deps.getConfig();
        // parity with Logger gating on enableLogs
        if (!config.enableTracing) {
            return;
        }
        if (this.buffer.length === 0) {
            return;
        }

        if (!assertKey(config.key, config.debug)) {
            this.clearTimer();
            return;
        }
        this.clearTimer();

        const resource = this.resourceForFlush();

        let entries: BufferEntry[];
        if (opts?.keepalive) {
            entries = this.packForKeepalive(config, resource);
            this.buffer = this.buffer.filter((entry) => !entries.includes(entry));
            // Summed from what is retained rather than subtracted, because summing cached numbers is cheap and
            // cannot drift out of step with the filter.
            this.bufferedBytes = this.buffer.reduce((sum, entry) => sum + entry.bytes, 0);
            if (this.buffer.length > 0) {
                this.armTimer(config);
            }
        } else {
            entries = this.buffer;
            this.buffer = [];
            this.bufferedBytes = 0;
        }
        if (entries.length === 0) {
            return;
        }

        // add() sizes a snapshot, but status.message is held by reference, so a host can still mutate a buffered
        // span into something JSON.stringify rejects. flush() runs from a timer and a visibilitychange listener,
        // where a throw would escape into window.onerror and Flare would report itself as a host error.
        try {
            this.deps.track(
                this.deps.api.traces(
                    this.buildEnvelope(
                        entries.map((entry) => entry.span),
                        resource,
                    ),
                    config.tracesIngestUrl,
                    config.key,
                    config.debug,
                    !!opts?.keepalive,
                ),
            );
        } catch (error) {
            // The buffer is already drained above, so this batch is gone either way.
            if (config.debug) {
                console.error('Flare: failed to send buffered spans', error);
            }
        }
    }

    clear(): void {
        this.buffer = [];
        this.bufferedBytes = 0;
        this.clearTimer();
    }

    private evaluateTriggers(config: Config): void {
        if (this.buffer.length >= config.maxSpanBufferSize) {
            this.flush();
            return;
        }
        if (this.bufferedBytes >= config.spanFlushMaxBytes) {
            this.flush();
            return;
        }
        this.armTimer(config);
    }

    private armTimer(config: Config): void {
        if (this.timerActive) {
            return;
        }
        this.timerActive = true;
        this.timer = setTimeout(() => this.flush(), config.spanFlushIntervalMs);
        // Node's Timeout has unref(); the browser's number does not.
        (this.timer as { unref?: () => void }).unref?.();
    }

    private trim(config: Config): void {
        if (this.buffer.length > config.maxSpanBufferSize) {
            const excess = this.buffer.length - config.maxSpanBufferSize;
            for (let i = 0; i < excess; i++) {
                this.bufferedBytes -= this.buffer[i].bytes;
            }
            this.buffer = this.buffer.slice(excess);
        }
        // Never trim to empty: a lone span over the ceiling cannot be fixed by dropping it, and add() already
        // refused anything that large on the way in.
        while (this.buffer.length > 1 && this.bufferedBytes > config.spanFlushMaxBytes) {
            const dropped = this.buffer.shift();
            if (dropped) {
                this.bufferedBytes -= dropped.bytes;
            }
        }
    }

    private packForKeepalive(config: Config, resource: Attributes): BufferEntry[] {
        let selected: BufferEntry[] = [];
        for (let i = this.buffer.length - 1; i >= 0; i--) {
            const trial = [this.buffer[i], ...selected];
            const envelope = this.buildEnvelope(
                trial.map((entry) => entry.span),
                resource,
            );
            const bytes = new TextEncoder().encode(flatJsonStringify(envelope)).length;
            if (bytes <= config.keepaliveMaxBytes) {
                selected = trial;
            } else if (config.debug) {
                console.error('Flare: dropping span from keepalive envelope (over budget)');
            }
        }
        return selected;
    }

    private buildEnvelope(spans: BufferedSpan[], resource: Attributes): TracesEnvelope {
        const sdk = this.deps.getSdkInfo();
        return buildTracesEnvelope(spans, resource, sdk.name, sdk.version);
    }

    private resourceForFlush(): Attributes {
        const config = this.deps.getConfig();
        const sdk = this.deps.getSdkInfo();
        const framework = this.deps.getFramework();
        const identity: Attributes = {
            'telemetry.sdk.language': 'javascript',
            'telemetry.sdk.name': sdk.name,
            'telemetry.sdk.version': sdk.version,
            'flare.language.name': 'javascript',
        };
        if (config.serviceName) {
            identity['service.name'] = config.serviceName;
        }
        if (config.version) {
            identity['service.version'] = config.version;
        }
        if (config.stage) {
            identity['service.stage'] = config.stage;
        }
        if (framework?.name) {
            identity['flare.framework.name'] = framework.name;
        }
        if (framework?.version) {
            identity['flare.framework.version'] = framework.version;
        }
        return { ...this.deps.getResourceAttributes(), ...identity };
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.timerActive = false;
    }

    private estimateBytes(span: BufferedSpan): number {
        // onSpanEnd already reduced every attribute to an OTLP primitive, so safeClone cannot change a byte here.
        // .length is UTF-16 code units, not UTF-8 bytes, same soft-cap caveat as Logger.estimateBytes.
        return JSON.stringify(span).length;
    }
}
