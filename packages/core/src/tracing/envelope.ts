import { attributesToOpenTelemetry } from '../logging/otel';
import type { Attributes, BufferedSpan, OtelSpan, TracesEnvelope } from '../types';

function toOtelSpan(span: BufferedSpan): OtelSpan {
    const status =
        span.status.message !== undefined
            ? { code: span.status.code, message: span.status.message }
            : { code: span.status.code };

    return {
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId, // null for roots; key always present
        name: span.name,
        startTimeUnixNano: span.startTimeUnixNano,
        endTimeUnixNano: span.endTimeUnixNano,
        status,
        attributes: span.recordAttributes,
        events: span.events,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        links: [],
        droppedLinksCount: 0,
    };
}

export function buildTracesEnvelope(
    spans: BufferedSpan[],
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): TracesEnvelope {
    return {
        resourceSpans: [
            {
                resource: {
                    attributes: attributesToOpenTelemetry(resourceAttributes),
                    droppedAttributesCount: 0,
                },
                scopeSpans: [
                    {
                        scope: {
                            name: scopeName,
                            version: scopeVersion,
                            attributes: [],
                            droppedAttributesCount: 0,
                        },
                        spans: spans.map(toOtelSpan),
                    },
                ],
            },
        ],
    };
}

// Module scope: these run once per span during keepalive packing.
const textEncoder = new TextEncoder();

/**
 * UTF-8 bytes one span contributes to an envelope. Lives here so it tracks toOtelSpan's shape: a
 * BufferedSpan measures 27 bytes smaller for the same span, and keepaliveMaxBytes is a hard browser limit.
 */
export function otelSpanBytes(span: BufferedSpan): number {
    return textEncoder.encode(JSON.stringify(toOtelSpan(span))).length;
}

/** UTF-8 bytes of an envelope carrying no spans: everything a batch does not pay for per span. */
export function emptyTracesEnvelopeBytes(
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): number {
    return textEncoder.encode(JSON.stringify(buildTracesEnvelope([], resourceAttributes, scopeName, scopeVersion)))
        .length;
}
