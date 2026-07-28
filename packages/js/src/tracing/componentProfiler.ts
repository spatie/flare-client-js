// Side-effect-free component-profiler seam, shared by @flareapp/react/profiler and the
// @flareapp/vue component-profiler mixin. Hides all tracer coupling behind four functions
// bound to the singleton browser tracer, the same discipline as registerNavigationSource.
// Imported from '@flareapp/js/browser'.
import { defaultNowNano, spanId as makeSpanId } from '@flareapp/core';

import { activeTracingFlare } from './browserTracing';
import { BrowserSpanType } from './spanTypes';

export type ComponentTraceContext = { traceId: string; parentSpanId: string };

/** Unix nanos on the same clock the tracer uses for span timestamps. */
export const nowNano = defaultNowNano;

/** Reserve a 16-hex span id a component uses as its own, so descendants can point at it. */
export function reserveSpanId(): string {
    return makeSpanId();
}

/**
 * The active pageload/navigation root a top-level component should nest under, read
 * from the holder's active root (which IdleRootController clears on close). Null when
 * tracing is off, no root is active, or the root is not recording.
 */
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
 * Pick what a component span nests under. An ancestor's context is only usable while it still belongs
 * to the live trace: a profiled component that survives a navigation (a layout around a swapped page
 * body) froze its context under the pageload trace, and `recordComponentSpan` drops anything pointing
 * at a closed root. Re-home those to the live root instead.
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
 * Record a completed mount span. Records ONLY while the reserved root is still the
 * live, recording active root (its traceId still matches getActiveSpan()); otherwise
 * it DROPS the span. Dropping avoids seeding a fresh TraceState for a dead trace
 * (which would re-sample) and attaching a phantom child to an already-shipped root.
 * No-op when tracing is off. Never throws into the host.
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
                // No framework attribute: which framework recorded this is already on the envelope
                // resource as flare.framework.name, and repeating it per span is duplicate weight
                // on a span type that can hit maxSpansPerTrace.
                attributes: { ...span.attributes, 'flare.component.name': span.name },
            })
            .end(span.endTimeUnixNano);
    } catch {
        // instrumentation must never throw into the host app
    }
}
