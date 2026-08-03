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

/**
 * UTF-8 bytes one span contributes to an envelope. Lives here to track toOtelSpan's shape rather than reuse
 * the cached BufferedSpan estimate, since keepaliveMaxBytes is a hard browser limit.
 *
 * Uses flatJsonStringify, not JSON.stringify: status.message is a live caller reference and can go
 * unserializable after end(), and this runs on a bare visibilitychange listener. flatJsonStringify's safeClone
 * absorbs the common cases (circular refs, BigInt, a throwing getter on a plain object) but is not throw-proof:
 * a class instance with a throwing getter passes through untouched and can still throw at JSON.stringify.
 */
export function otelSpanBytes(span: BufferedSpan): number {
    return utf8Bytes(flatJsonStringify(toOtelSpan(span)));
}

/** UTF-8 bytes of an envelope carrying no spans: everything a batch does not pay for per span. */
export function emptyTracesEnvelopeBytes(
    resourceAttributes: Attributes,
    scopeName: string,
    scopeVersion: string,
): number {
    return utf8Bytes(JSON.stringify(buildTracesEnvelope([], resourceAttributes, scopeName, scopeVersion)));
}
