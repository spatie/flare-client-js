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
    // Returns attributes already split into resource ones (shared by every record) and record ones (attached
    // to a single record). Only collector attributes can become resource-level; the rest stay record-level.
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
                keepaliveBudget: () => deps.api.keepaliveBudgetRemaining(),
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
                    // The whole batch ships with one resource map, newest wins. That is fine because resource
                    // attributes do not change while the process runs (process.uptime does, so it stays record-level).
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

    // Two ways to add data, same as PHP's Logger::record. `context` goes in one nested `log.context` key and
    // shows up in Flare's "Context" section. `attributes` passes through untouched onto the record.
    private record(level: MessageLevel, message: string, context: Attributes, attributes: Attributes): void {
        const config = this.deps.getConfig();
        if (config.hasConsent === false) {
            return;
        }
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
        // A rough number, only used to decide when the buffer is full enough to flush. Counts UTF-16 code units,
        // not UTF-8 bytes, and counts resource attributes on every record though they are sent once. Good enough:
        // /v1/logs has no hard size limit, and otelLogRecordBytes measures the real ~64 KB keepalive limit exactly.
        // flatJsonStringify, not JSON.stringify, because record attributes can be circular.
        return flatJsonStringify(log).length;
    }
}
