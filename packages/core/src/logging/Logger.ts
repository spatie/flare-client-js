import type { Api } from '../api';
import { buildResourceIdentity, TelemetryBuffer } from '../telemetry';
import type { Attributes, BufferedLog, Config, Framework, LogsEnvelope, MessageLevel, SdkInfo } from '../types';
import { flatJsonStringify } from '../util';
import { buildLogsEnvelope, emptyLogsEnvelopeBytes, otelLogRecordBytes } from './envelope';
import type { FlushScheduler } from './FlushScheduler';
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
    private inner: TelemetryBuffer<BufferedLog, LogsEnvelope>;
    private resourceAttributes: Attributes = {};

    constructor(private deps: LoggerDeps) {
        this.inner = new TelemetryBuffer<BufferedLog, LogsEnvelope>(
            { getConfig: deps.getConfig, scheduler: deps.scheduler },
            {
                limits: (config) => ({
                    maxSize: config.maxLogBufferSize,
                    maxBytes: config.logFlushMaxBytes,
                    flushIntervalMs: config.logFlushIntervalMs,
                }),
                enabled: (config) => config.enableLogs,
                estimateBytes: (record) => this.estimateBytes(record),
                emptyEnvelopeBytes: (resource) => {
                    const sdk = deps.getSdkInfo();
                    return emptyLogsEnvelopeBytes(resource, sdk.name, sdk.version);
                },
                recordBytes: (record) => otelLogRecordBytes(record),
                oversizedMessage: 'Flare: dropping oversized log record',
                keepaliveDropMessage: (count) =>
                    `Flare: dropped ${count} log record(s) from keepalive envelope (over budget)`,
                sendFailureMessage: 'Flare: failed to send buffered log records',
                resourceForFlush: () => this.resourceForFlush(),
                buildEnvelope: (records, resource) => {
                    const sdk = deps.getSdkInfo();
                    return buildLogsEnvelope(records, resource, sdk.name, sdk.version);
                },
                send: (envelope, config, keepalive) => {
                    deps.track(deps.api.logs(envelope, config.logsIngestUrl, config.key, config.debug, keepalive));
                },
                onRecordBuffered: (record) => {
                    // Last-write-wins: the envelope stamps ALL batched records with this single most-recent resource
                    // map. Correct ONLY because every resource-prefixed key in the partition allowlist is
                    // instance-static for the process lifetime (the one varying key, process.uptime, is held to
                    // record-level via the partition's exception set). A future collector emitting a request-varying
                    // resource key would silently mis-stamp batched records.
                    this.resourceAttributes = record.resourceAttributes;
                },
            },
        );
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
        return this.inner.length();
    }

    flush(opts?: { keepalive?: boolean }): void {
        this.inner.flush(opts);
    }

    clear(): void {
        this.inner.clear();
    }

    // Mirrors PHP's Logger::record: everyday `context` nests under `log.context` (Flare's "Context" section), while
    // `attributes` is a raw passthrough spread flat onto the record (same resource/record partitioning).
    private record(level: MessageLevel, message: string, context: Attributes, attributes: Attributes): void {
        const config = this.deps.getConfig();
        if (!config.enableLogs) {
            return;
        }
        if (config.minimumLogLevel && !isAtOrAboveMinimum(level, config.minimumLogLevel)) {
            return;
        }

        const userAttributes: Attributes = { 'log.context': context, ...attributes };
        const { record, resource } = this.deps.buildLogAttributes(userAttributes);

        this.inner.add({
            timeUnixNano: String(Date.now()) + '000000',
            severityNumber: severityNumber(level),
            severityText: severityText(level),
            message,
            recordAttributes: attributesToOpenTelemetry(record),
            resourceAttributes: resource,
        });
    }

    private resourceForFlush(): Attributes {
        return buildResourceIdentity(
            this.resourceAttributes,
            this.deps.getConfig(),
            this.deps.getSdkInfo(),
            this.deps.getFramework(),
        );
    }

    private estimateBytes(log: BufferedLog): number {
        // Rough, and only for the soft batching caps: UTF-16 code units rather than UTF-8 bytes, and resource
        // attributes counted per record though they ship once. Safe: /v1/logs has no hard per-request limit,
        // and the real ~64 KB keepalive cap is measured exactly by otelLogRecordBytes. flatJsonStringify:
        // record attributes can cycle.
        return flatJsonStringify(log).length;
    }
}
