// Side-effect-free seam shared by @flareapp/react/profiler and the @flareapp/vue mixin. Keeps all
// tracer coupling on this side, the same discipline as registerNavigationSource.
import { defaultNowNano, spanId as makeSpanId } from '@flareapp/core';

import { activeTracingFlare } from './browserTracing';
import { BrowserSpanType } from './spanTypes';

export type ComponentTraceContext = { traceId: string; parentSpanId: string };

/** Unix nanos on the same clock the tracer uses for span timestamps. */
export const nowNano = defaultNowNano;

/** Reserved up front so descendants can point at a span before it is recorded. */
export function reserveSpanId(): string {
    return makeSpanId();
}

/** The root a top-level component nests under. Null when tracing is off or no root is recording. */
export function activeComponentRoot(): ComponentTraceContext | null {
    try {
        const root = activeTracingFlare()?.tracer.getActiveSpan();
        if (!root || !root.isRecording) {
            return null;
        }
        return { traceId: root.traceId, parentSpanId: root.spanId };
    } catch {
        return null;
    }
}

/**
 * An ancestor's context is only usable while it still belongs to the live trace. A profiled component
 * that survives a navigation (a layout around a swapped page body) froze its context under the pageload
 * trace, and `recordComponentSpan` would drop anything pointing at that closed root.
 */
export function resolveComponentParent(
    inherited: ComponentTraceContext | null | undefined,
    live: ComponentTraceContext | null,
): ComponentTraceContext | null {
    if (inherited && live && inherited.traceId === live.traceId) {
        return inherited;
    }
    return live;
}

/**
 * Records only while the reserved root is still the live recording root, and drops the span otherwise.
 * Dropping avoids seeding a fresh TraceState for a dead trace, which would re-sample, and avoids
 * attaching a phantom child to a root that already shipped.
 */
export function recordComponentSpan(span: {
    name: string;
    spanId: string;
    parent: ComponentTraceContext;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    attributes?: Record<string, unknown>;
}): void {
    try {
        const flare = activeTracingFlare();
        if (!flare) {
            return;
        }
        const root = flare.tracer.getActiveSpan();
        if (!root || root.traceId !== span.parent.traceId || !root.isRecording) {
            return;
        }
        flare
            .startSpan(span.name, {
                spanId: span.spanId,
                parent: { traceId: span.parent.traceId, spanId: span.parent.parentSpanId },
                spanType: BrowserSpanType.Component,
                startTimeUnixNano: span.startTimeUnixNano,
                attributes: { ...span.attributes, 'flare.component.name': span.name },
            })
            .end(span.endTimeUnixNano);
    } catch {
        // instrumentation must never throw into the host app
    }
}
