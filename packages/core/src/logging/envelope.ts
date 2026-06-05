import type { Attributes, BufferedLog, LogsEnvelope } from '../types';
import { attributesToOpenTelemetry } from './otel';

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
                        logRecords: records.map((record) => ({
                            timeUnixNano: record.timeUnixNano,
                            observedTimeUnixNano: record.timeUnixNano,
                            severityNumber: record.severityNumber,
                            severityText: record.severityText,
                            body: { stringValue: record.message },
                            attributes: record.recordAttributes,
                            flags: 0,
                            droppedAttributesCount: 0,
                        })),
                    },
                ],
            },
        ],
    };
}
