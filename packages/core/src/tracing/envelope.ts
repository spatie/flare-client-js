import { attributesToOpenTelemetry } from '../logging/otel';
import type { Attributes, BufferedSpan, OtelSpan, TracesEnvelope } from '../types';
import { flatJsonStringify } from '../util';
import { utf8Bytes } from '../util/utf8Bytes';

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

// Bytes one span adds to an envelope. Measures the real toOtelSpan output, not the cached estimate,
// because keepaliveMaxBytes is a hard browser limit. Uses flatJsonStringify, not JSON.stringify, since
// a span can hold values that turn unserializable after it ends, and this runs uncaught from a
// visibilitychange listener. Not bulletproof: a class instance with a throwing getter can still throw.
export function otelSpanBytes(span: BufferedSpan): number {
    return utf8Bytes(flatJsonStringify(toOtelSpan(span)));
}

// UTF-8 bytes of an empty envelope: the fixed overhead every batch has, before any spans are added.
export function emptyTracesEnvelopeBytes(
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): number {
    return utf8Bytes(JSON.stringify(buildTracesEnvelope([], resourceAttributes, scopeName, scopeVersion)));
}
