import type { Api } from '../api';
import type { Attributes, BufferedLog, Config, Framework, LogsEnvelope, MessageLevel, SdkInfo } from '../types';
import { assertKey, flatJsonStringify } from '../util';
import { buildLogsEnvelope } from './envelope';
import type { FlushFn, FlushScheduler } from './FlushScheduler';
import { isAtOrAboveMinimum, severityNumber, severityText } from './severity';

export type LoggerDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    // Returns attributes ALREADY split into resource-level (only the collector's
    // resource keys) and record-level (collector record keys + scope + entry point
    // + user attrs). The Logger does NOT partition — only the collector output is
    // partitionable; scope/user/entry-point attributes always stay record-level.
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

    debug(message: string, attributes: Attributes = {}): void {
        this.record('debug', message, attributes);
    }
    info(message: string, attributes: Attributes = {}): void {
        this.record('info', message, attributes);
    }
    notice(message: string, attributes: Attributes = {}): void {
        this.record('notice', message, attributes);
    }
    warning(message: string, attributes: Attributes = {}): void {
        this.record('warning', message, attributes);
    }
    error(message: string, attributes: Attributes = {}): void {
        this.record('error', message, attributes);
    }
    critical(message: string, attributes: Attributes = {}): void {
        this.record('critical', message, attributes);
    }
    alert(message: string, attributes: Attributes = {}): void {
        this.record('alert', message, attributes);
    }
    emergency(message: string, attributes: Attributes = {}): void {
        this.record('emergency', message, attributes);
    }

    bufferLength(): number {
        return this.buffer.length;
    }

    hasBuffered(): boolean {
        return this.buffer.length > 0;
    }

    private record(level: MessageLevel, message: string, userAttributes: Attributes): void {
        const config = this.deps.getConfig();
        if (!config.enableLogs) return;
        if (config.minimumLogLevel && !isAtOrAboveMinimum(level, config.minimumLogLevel)) return;

        const { record, resource } = this.deps.buildLogAttributes(userAttributes);

        const buffered: BufferedLog = {
            timeUnixNano: String(Date.now()) + '000000',
            severityNumber: severityNumber(level),
            severityText: severityText(level),
            message,
            recordAttributes: record,
            resourceAttributes: resource,
        };

        // Oversized-record guard: a single record bigger than the byte cap can
        // never ship (and would make the trim unsatisfiable). Drop at capture.
        if (this.estimateBytes(buffered) > config.logFlushMaxBytes) {
            if (config.debug) console.error('Flare: dropping oversized log record');
            return;
        }

        this.buffer.push(buffered);
        this.resourceAttributes = resource;

        // Triggers run BEFORE the trim: a keyed over-cap push flushes-and-clears
        // here (data shipped); the trim is only the safety net when the flush
        // no-ops (no key).
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
        if (!this.timerActive) {
            this.timerActive = true;
            this.timer = setTimeout(() => this.flush(), config.logFlushIntervalMs);
            // Node's Timeout has unref(); the browser's number does not.
            (this.timer as { unref?: () => void }).unref?.();
        }
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

        // Key gate: never send unauthenticated. Use assertKey (not a bare
        // truthiness check) so debug mode logs the same missing-key diagnostic
        // reports get. Reset the timer (one-shot fired) but keep the buffer so
        // records survive until a key is set.
        if (!assertKey(config.key, config.debug)) {
            this.clearTimer();
            return;
        }

        this.clearTimer();

        const records = opts?.keepalive ? this.packForKeepalive(config) : this.buffer;
        this.buffer = [];
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
        // flatJsonStringify (not JSON.stringify) because record attributes are raw
        // user data that can contain cycles.
        return flatJsonStringify(log).length;
    }

    private bufferBytes(): number {
        return this.buffer.reduce((sum, log) => sum + this.estimateBytes(log), 0);
    }
}
