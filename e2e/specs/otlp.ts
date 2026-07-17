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
        .flatMap((r) => r.scopeSpans ?? [])
        .flatMap((s) => s.spans ?? []);

export const attr = (span: OtlpSpan, key: string): unknown => span.attributes.find((a) => a.key === key)?.value;

export const hasSpanType = (span: OtlpSpan, type: string): boolean =>
    JSON.stringify(attr(span, 'flare.span_type') ?? '').includes(type);

/** A span's `url.full`, JSON-stringified so a missing attribute matches nothing instead of throwing. */
export const urlOf = (span: OtlpSpan): string => JSON.stringify(attr(span, 'url.full') ?? '');

/**
 * Wait for the envelope carrying a child's parent root. A root holds open for its idle window while
 * request spans flush eagerly, so the parent routinely arrives in a LATER envelope than the child:
 * poll across every captured trace rather than searching the one the child was found in.
 */
export const waitForParentEnvelope = (fakeFlare: FakeFlare, child: OtlpSpan) =>
    fakeFlare.waitForTrace({
        timeout: 9000,
        predicate: (r) => spansOf(r.bodyJson).some((s) => s.spanId === child.parentSpanId),
    });

/** The root a child nests under, or undefined if that envelope has not arrived yet. */
export const parentOf = async (fakeFlare: FakeFlare, child: OtlpSpan): Promise<OtlpSpan | undefined> =>
    spansOf((await waitForParentEnvelope(fakeFlare, child)).bodyJson).find((s) => s.spanId === child.parentSpanId);
