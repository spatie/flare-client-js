// Shared OTLP trace-span parsing helpers for the tracing e2e specs (js, react, react-router, svelte).

import type { FakeFlare } from '../fixtures/fake-flare';

export type OtlpSpan = {
    name: string;
    spanId: string;
    parentSpanId: string | null;
    traceId: string;
    status?: { code: number; message?: string };
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

export const spansOf = (bodyJson: unknown): OtlpSpan[] =>
    ((bodyJson as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> }).resourceSpans ?? [])
        .flatMap((resourceSpan) => resourceSpan.scopeSpans ?? [])
        .flatMap((scopeSpan) => scopeSpan.spans ?? []);

export const attr = (span: OtlpSpan, key: string): unknown =>
    span.attributes.find((attribute) => attribute.key === key)?.value;

/** An attribute's `stringValue`, or undefined when the attribute is absent or not a string. */
export const stringAttr = (span: OtlpSpan, key: string): string | undefined =>
    (attr(span, key) as { stringValue?: string } | undefined)?.stringValue;

/** Every attribute key on a span. For asserting a key is absent without matching against values. */
export const attributeKeys = (span: OtlpSpan): string[] => span.attributes.map((attribute) => attribute.key);

export const hasSpanType = (span: OtlpSpan, type: string): boolean => stringAttr(span, 'flare.span_type') === type;

/** A span's `url.full`, or '' when absent, so a missing attribute matches nothing instead of throwing. */
export const urlOf = (span: OtlpSpan): string => stringAttr(span, 'url.full') ?? '';

/**
 * Wait for the trace envelope carrying a span of `type` and return that span. Replaces predicates that
 * substring-match the serialized envelope, which pass on the string turning up anywhere in the payload.
 */
export const waitForSpanType = async (fakeFlare: FakeFlare, type: string, timeout = 9000): Promise<OtlpSpan> => {
    const record = await fakeFlare.waitForTrace({
        timeout,
        predicate: (trace) => spansOf(trace.bodyJson).some((span) => hasSpanType(span, type)),
    });
    return spansOf(record.bodyJson).find((span) => hasSpanType(span, type))!;
};

/**
 * Wait for the envelope carrying a child's parent root. A root holds open for its idle window while
 * request spans flush eagerly, so the parent usually arrives in a later envelope than the child.
 * Poll across every captured trace rather than searching the one the child was found in.
 */
export const waitForParentEnvelope = (fakeFlare: FakeFlare, child: OtlpSpan) =>
    fakeFlare.waitForTrace({
        timeout: 9000,
        predicate: (trace) => spansOf(trace.bodyJson).some((span) => span.spanId === child.parentSpanId),
    });

/** The root a child nests under, or undefined if that envelope has not arrived yet. */
export const parentOf = async (fakeFlare: FakeFlare, child: OtlpSpan): Promise<OtlpSpan | undefined> =>
    spansOf((await waitForParentEnvelope(fakeFlare, child)).bodyJson).find(
        (span) => span.spanId === child.parentSpanId,
    );
