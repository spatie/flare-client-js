// Side-effect-free seam shared by @flareapp/react/profiler and the @flareapp/vue mixin. Keeps all
// tracer references on this side, same as registerNavigationSource.
import { defaultNowNano, spanId as makeSpanId, type Attributes } from '@flareapp/core';

import { BrowserSpanType } from '../spanTypes';
import { activeTracingFlare } from './browserTracing';

export type ComponentTraceContext = { traceId: string; parentSpanId: string };

/** Unix nanos on the same clock the tracer uses for span timestamps. */
export const nowNano = defaultNowNano;

/**
 * Reserved up front so descendants can point at a span before it is recorded. Null when the trace
 * is at its span cap, since descendants record before this span does and would be orphaned.
 */
export function reserveSpanId(traceId?: string): string | null {
    if (traceId !== undefined && !activeTracingFlare()?.tracer.claimSpanSlot(traceId)) {
        return null;
    }
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
 * An ancestor's context is only usable while it still belongs to the live trace. A component that
 * survives a navigation (a layout around a swapped page body) froze its context under the old
 * pageload trace, and `recordComponentSpan` would drop anything pointing at that closed root.
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

/** What a profiler hands back for one component mount. */
export type ComponentSpanRecord = {
    name: string;
    spanId: string;
    parent: ComponentTraceContext;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    attributes?: Attributes;
};

/**
 * Records only while the reserved root is still the live recording root, and drops the span
 * otherwise. Dropping avoids re-running the sampler for a dead trace and avoids adding a child to
 * a root that already shipped.
 */
export function recordComponentSpan(record: ComponentSpanRecord): void {
    try {
        const flare = activeTracingFlare();
        if (!flare) {
            return;
        }
        const root = flare.tracer.getActiveSpan();
        if (!root || root.traceId !== record.parent.traceId || !root.isRecording) {
            return;
        }
        flare
            .startSpan(record.name, {
                spanId: record.spanId,
                parent: { traceId: record.parent.traceId, spanId: record.parent.parentSpanId },
                spanType: BrowserSpanType.Component,
                startTimeUnixNano: record.startTimeUnixNano,
                attributes: { ...record.attributes, 'flare.component.name': record.name },
                claimed: true, // taken in reserveSpanId
            })
            .end(record.endTimeUnixNano);
    } catch {
        // instrumentation must never throw into the host app
    }
}
