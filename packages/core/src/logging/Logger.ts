import type { Api } from '../api';
import type { Attributes, BufferedLog, Config, Framework, LogsEnvelope, MessageLevel, SdkInfo } from '../types';
import { assertKey, flatJsonStringify } from '../util';
import { buildLogsEnvelope } from './envelope';
import type { FlushFn, FlushScheduler } from './FlushScheduler';
import { attributesToOpenTelemetry } from './otel';
import { isAtOrAboveMinimum, severityNumber, severityText } from './severity';

export type LoggerDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    // Returns attributes already split into resource-level (only the collector's resource keys) and record-level
    // (collector record keys + scope + entry point + user attrs). The Logger does not partition; only the collector
    // output is partitionable, scope/user/entry-point attributes always stay record-level.
    buildLogAttributes: (userAttributes: Attributes) => { record: Attributes; resource: Attributes };
    track: <T>(p: Promise<T>) => Promise<T>;
    scheduler: FlushScheduler;
};

export class Logger {
    private buffer: BufferedLog[] = [];
    private resourceAttributes: Attributes = {};
    private timer: ReturnType<typeof setTimeout> | undefined;
    private timerActive = false;

    constructor(private deps: LoggerDeps) {
        const flush: FlushFn = (opts) => this.flush(opts);
        this.deps.scheduler.register(flush);
    }

    debug(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('debug', message, context, attributes);
    }
    info(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('info', message, context, attributes);
    }
    notice(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('notice', message, context, attributes);
    }
    warning(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('warning', message, context, attributes);
    }
    error(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('error', message, context, attributes);
    }
    critical(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('critical', message, context, attributes);
    }
    alert(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('alert', message, context, attributes);
    }
    emergency(message: string, context: Attributes = {}, attributes: Attributes = {}): void {
        this.record('emergency', message, context, attributes);
    }

    bufferLength(): number {
        return this.buffer.length;
    }

    // Mirrors PHP's Logger::record: everyday `context` nests under `log.context` (Flare's "Context" section), while
    // `attributes` is a raw passthrough spread flat onto the record (same resource/record partitioning).
    private record(level: MessageLevel, message: string, context: Attributes, attributes: Attributes): void {
        const config = this.deps.getConfig();
        if (!config.enableLogs) return;
        if (config.minimumLogLevel && !isAtOrAboveMinimum(level, config.minimumLogLevel)) return;

        const userAttributes: Attributes = { 'log.context': context, ...attributes };
        const { record, resource } = this.deps.buildLogAttributes(userAttributes);

        const buffered: BufferedLog = {
            timeUnixNano: String(Date.now()) + '000000',
            severityNumber: severityNumber(level),
            severityText: severityText(level),
            message,
            recordAttributes: attributesToOpenTelemetry(record),
            resourceAttributes: resource,
        };

        // Oversized-record guard: a single record over the byte cap can never ship (and makes the trim
        // unsatisfiable). Drop at capture.
        if (this.estimateBytes(buffered) > config.logFlushMaxBytes) {
            if (config.debug) console.error('Flare: dropping oversized log record');
            return;
        }

        this.buffer.push(buffered);
        // Last-write-wins: the envelope stamps ALL batched records with this single most-recent resource map. Correct
        // ONLY because every resource-prefixed key in the partition allowlist is instance-static for the process
        // lifetime (the one varying key, process.uptime, is held to record-level via the partition's exception set). A
        // future collector emitting a request-varying resource key would silently mis-stamp batched records.
        this.resourceAttributes = resource;

        // Triggers run BEFORE the trim: a keyed over-cap push flushes-and-clears here (data shipped); the trim is only
        // the safety net when the flush no-ops (no key).
        this.evaluateTriggers(config);
        this.trim(config);
    }

    private evaluateTriggers(config: Config): void {
        if (this.buffer.length >= config.maxLogBufferSize) {
            this.flush();
            return;
        }
        if (this.bufferBytes() >= config.logFlushMaxBytes) {
            this.flush();
            return;
        }
        this.armTimer(config);
    }

    private armTimer(config: Config): void {
        if (this.timerActive) return;
        this.timerActive = true;
        this.timer = setTimeout(() => this.flush(), config.logFlushIntervalMs);
        // Node's Timeout has unref(); the browser's number does not.
        (this.timer as { unref?: () => void }).unref?.();
    }

    private trim(config: Config): void {
        if (this.buffer.length > config.maxLogBufferSize) {
            this.buffer = this.buffer.slice(this.buffer.length - config.maxLogBufferSize);
        }
        while (this.buffer.length > 1 && this.bufferBytes() > config.logFlushMaxBytes) {
            this.buffer.shift();
        }
    }

    flush(opts?: { keepalive?: boolean }): void {
        const config = this.deps.getConfig();
        if (!config.enableLogs) return;
        if (this.buffer.length === 0) return;

        // Key gate: never send unauthenticated. assertKey (not bare truthiness) so debug mode logs the same missing-key
        // diagnostic reports get. Reset the timer but keep the buffer so records survive until a key is set.
        if (!assertKey(config.key, config.debug)) {
            this.clearTimer();
            return;
        }

        this.clearTimer();

        // keepalive fires on visibilitychange:hidden, which also fires on mere backgrounding (not just unload).
        // packForKeepalive ships only what fits the browser's ~64KB keepalive budget, so the over-budget tail is
        // retained (a resumed tab can still send it normally). A real unload discards the buffer with the page anyway.
        let records: BufferedLog[];
        if (opts?.keepalive) {
            records = this.packForKeepalive(config);
            this.buffer = this.buffer.filter((log) => !records.includes(log));
            // Re-arm the interval so retained records flush on resume without waiting for the next captured log.
            if (this.buffer.length > 0) this.armTimer(config);
        } else {
            records = this.buffer;
            this.buffer = [];
        }
        if (records.length === 0) return;

        this.deps.track(
            this.deps.api.logs(
                this.buildEnvelope(records),
                config.logsIngestUrl,
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

    private packForKeepalive(config: Config): BufferedLog[] {
        let selected: BufferedLog[] = [];
        for (let i = this.buffer.length - 1; i >= 0; i--) {
            const trial = [this.buffer[i], ...selected];
            const bytes = new TextEncoder().encode(flatJsonStringify(this.buildEnvelope(trial))).length;
            if (bytes <= config.keepaliveMaxBytes) {
                selected = trial;
            } else if (config.debug) {
                console.error('Flare: dropping log record from keepalive envelope (over budget)');
            }
        }
        return selected;
    }

    private buildEnvelope(records: BufferedLog[]): LogsEnvelope {
        const sdk = this.deps.getSdkInfo();
        return buildLogsEnvelope(records, this.resourceForFlush(), sdk.name, sdk.version);
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

    private estimateBytes(log: BufferedLog): number {
        // Approximate heuristic used ONLY for the soft batching caps (weight-flush, oversized-record drop, trim loop).
        // Two known approximations: (1) .length counts UTF-16 code units, not UTF-8 bytes; (2) resourceAttributes are
        // hoisted to the envelope and sent once per request, but counted once per record here. Both acceptable: these
        // caps are soft and /v1/logs has no hard per-request byte limit. The HARD keepalive cap is measured separately
        // with exact UTF-8 bytes in packForKeepalive (~64 KB, real browser-enforced). flatJsonStringify (not
        // JSON.stringify) because record attributes are raw user data that can contain cycles.
        return flatJsonStringify(log).length;
    }

    private bufferBytes(): number {
        // Uses estimateBytes(); see its comment for the deliberate approximations.
        return this.buffer.reduce((sum, log) => sum + this.estimateBytes(log), 0);
    }
}
