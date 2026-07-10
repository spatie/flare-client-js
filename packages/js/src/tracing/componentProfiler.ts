// Side-effect-free component-profiler seam for @flareapp/react/profiler. Hides all
// tracer coupling behind four functions bound to the singleton browser tracer, the
// same discipline as registerNavigationSource. Imported from '@flareapp/js/browser'.
import { defaultNowNano, spanId as makeSpanId } from '@flareapp/core';

import { activeTracingFlare } from './browserTracing';

export type ComponentTraceContext = { traceId: string; parentSpanId: string };

const COMPONENT_SPAN_TYPE = 'browser_react_component';

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
        if (!root || !root.isRecording) return null;
        return { traceId: root.traceId, parentSpanId: root.spanId };
    } catch {
        return null;
    }
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
        if (!flare) return;
        const root = flare.tracer.getActiveSpan();
        if (!root || root.traceId !== span.parent.traceId || !root.isRecording) return;
        flare
            .startSpan(span.name, {
                spanId: span.spanId,
                parent: { traceId: span.parent.traceId, spanId: span.parent.parentSpanId },
                spanType: COMPONENT_SPAN_TYPE,
                startTimeUnixNano: span.startTimeUnixNano,
                attributes: { ...span.attributes, 'flare.react.component': span.name },
            })
            .end(span.endTimeUnixNano);
    } catch {
        // instrumentation must never throw into the host app
    }
}
