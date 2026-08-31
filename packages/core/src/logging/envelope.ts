import type { Attributes, BufferedLog, LogsEnvelope, OtelLogRecord } from '../types';
import { flatJsonStringify } from '../util';
import { utf8Bytes } from '../util/utf8Bytes';
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

// Bytes one record adds to the envelope. Measures the real toOtelLogRecord output instead of the cached
// BufferedLog estimate, because keepaliveMaxBytes is a hard limit and an estimate is not precise enough.
// Uses flatJsonStringify, the same encoder Api.logs uses to send the envelope.
export function otelLogRecordBytes(record: BufferedLog): number {
    return utf8Bytes(flatJsonStringify(toOtelLogRecord(record)));
}

// UTF-8 bytes of an empty envelope: the fixed overhead every batch has, before any records are added.
export function emptyLogsEnvelopeBytes(
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): number {
    return utf8Bytes(flatJsonStringify(buildLogsEnvelope([], resourceAttributes, scopeName, scopeVersion)));
}
