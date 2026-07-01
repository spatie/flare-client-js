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
    track: <T>(p: Promise<T>) => Promise<T>;
    scheduler: FlushScheduler;
};

export class SpanBuffer {
    private buffer: BufferedSpan[] = [];
    private resourceAttributes: Attributes = {};
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
        if (this.estimateBytes(span) > config.spanFlushMaxBytes) {
            if (config.debug) console.error('Flare: dropping oversized span');
            return;
        }
        this.buffer.push(span);
        this.resourceAttributes = span.resourceAttributes;
        this.evaluateTriggers(config);
        this.trim(config);
    }

    flush(opts?: { keepalive?: boolean }): void {
        const config = this.deps.getConfig();
        if (!config.enableTracing) return; // parity with Logger gating on enableLogs
        if (this.buffer.length === 0) return;

        if (!assertKey(config.key, config.debug)) {
            this.clearTimer();
            return;
        }
        this.clearTimer();

        let spans: BufferedSpan[];
        if (opts?.keepalive) {
            spans = this.packForKeepalive(config);
            this.buffer = this.buffer.filter((s) => !spans.includes(s));
            if (this.buffer.length > 0) this.armTimer(config);
        } else {
            spans = this.buffer;
            this.buffer = [];
        }
        if (spans.length === 0) return;

        this.deps.track(
            this.deps.api.traces(
                this.buildEnvelope(spans),
                config.tracesIngestUrl,
                config.key,
                config.debug,
                !!opts?.keepalive,
            ),
        );
    }

    clear(): void {
        this.buffer = [];
        this.clearTimer();
    }

    private evaluateTriggers(config: Config): void {
        if (this.buffer.length >= config.maxSpanBufferSize) {
            this.flush();
            return;
        }
        if (this.bufferBytes() >= config.spanFlushMaxBytes) {
            this.flush();
            return;
        }
        this.armTimer(config);
    }

    private armTimer(config: Config): void {
        if (this.timerActive) return;
        this.timerActive = true;
        this.timer = setTimeout(() => this.flush(), config.spanFlushIntervalMs);
        // Node's Timeout has unref(); the browser's number does not.
        (this.timer as { unref?: () => void }).unref?.();
    }

    private trim(config: Config): void {
        if (this.buffer.length > config.maxSpanBufferSize) {
            this.buffer = this.buffer.slice(this.buffer.length - config.maxSpanBufferSize);
        }
        while (this.buffer.length > 1 && this.bufferBytes() > config.spanFlushMaxBytes) {
            this.buffer.shift();
        }
    }

    private packForKeepalive(config: Config): BufferedSpan[] {
        let selected: BufferedSpan[] = [];
        for (let i = this.buffer.length - 1; i >= 0; i--) {
            const trial = [this.buffer[i], ...selected];
            const bytes = new TextEncoder().encode(flatJsonStringify(this.buildEnvelope(trial))).length;
            if (bytes <= config.keepaliveMaxBytes) {
                selected = trial;
            } else if (config.debug) {
                console.error('Flare: dropping span from keepalive envelope (over budget)');
            }
        }
        return selected;
    }

    private buildEnvelope(spans: BufferedSpan[]): TracesEnvelope {
        const sdk = this.deps.getSdkInfo();
        return buildTracesEnvelope(spans, this.resourceForFlush(), sdk.name, sdk.version);
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
        if (config.serviceName) identity['service.name'] = config.serviceName;
        if (config.version) identity['service.version'] = config.version;
        if (config.stage) identity['service.stage'] = config.stage;
        if (framework?.name) identity['flare.framework.name'] = framework.name;
        if (framework?.version) identity['flare.framework.version'] = framework.version;
        return { ...this.resourceAttributes, ...identity };
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.timerActive = false;
    }

    private estimateBytes(span: BufferedSpan): number {
        return flatJsonStringify(span).length;
    }

    private bufferBytes(): number {
        return this.buffer.reduce((sum, s) => sum + this.estimateBytes(s), 0);
    }
}
