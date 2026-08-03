import type { Attributes, BufferedLog, LogsEnvelope, OtelLogRecord } from '../types';
import { flatJsonStringify } from '../util';
import { attributesToOpenTelemetry } from './otel';

function toOtelLogRecord(record: BufferedLog): OtelLogRecord {
    return {
        timeUnixNano: record.timeUnixNano,
        observedTimeUnixNano: record.timeUnixNano,
        severityNumber: record.severityNumber,
        severityText: record.severityText,
        body: { stringValue: record.message },
        attributes: record.recordAttributes,
        flags: 0,
        droppedAttributesCount: 0,
    };
}

export function buildLogsEnvelope(
    records: BufferedLog[],
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): LogsEnvelope {
    return {
        resourceLogs: [
            {
                resource: {
                    attributes: attributesToOpenTelemetry(resourceAttributes),
                    droppedAttributesCount: 0,
                },
                scopeLogs: [
                    {
                        scope: {
                            name: scopeName,
                            version: scopeVersion,
                            attributes: [],
                            droppedAttributesCount: 0,
                        },
                        logRecords: records.map(toOtelLogRecord),
                    },
                ],
            },
        ],
    };
}

// Module scope: these run once per record during keepalive packing.
const textEncoder = new TextEncoder();

/**
 * UTF-8 bytes one record contributes to an envelope. Lives here to track toOtelLogRecord's shape rather than
 * reuse the cached BufferedLog estimate, since keepaliveMaxBytes is a hard browser limit.
 *
 * Uses flatJsonStringify to match Api.logs, which sends the envelope through the same encoder.
 */
export function otelLogRecordBytes(record: BufferedLog): number {
    return textEncoder.encode(flatJsonStringify(toOtelLogRecord(record))).length;
}

/** UTF-8 bytes of an envelope carrying no records: everything a batch does not pay for per record. */
export function emptyLogsEnvelopeBytes(
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): number {
    return textEncoder.encode(flatJsonStringify(buildLogsEnvelope([], resourceAttributes, scopeName, scopeVersion)))
        .length;
}
