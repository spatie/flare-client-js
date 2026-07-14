// Shared OTLP trace-span parsing helpers for the tracing e2e specs (react, react-router).

export type OtlpSpan = {
    name: string;
    spanId: string;
    parentSpanId: string | null;
    traceId: string;
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

export const spansOf = (bodyJson: unknown): OtlpSpan[] =>
    ((bodyJson as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }> }).resourceSpans ?? [])
        .flatMap((r) => r.scopeSpans ?? [])
        .flatMap((s) => s.spans ?? []);

export const attr = (span: OtlpSpan, key: string): unknown => span.attributes.find((a) => a.key === key)?.value;

export const hasSpanType = (span: OtlpSpan, type: string): boolean =>
    JSON.stringify(attr(span, 'flare.span_type') ?? '').includes(type);
