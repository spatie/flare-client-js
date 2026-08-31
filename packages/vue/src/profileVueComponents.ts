import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
    resolveComponentParent,
    type ComponentTraceContext,
} from '@flareapp/js/browser';
import type { ComponentInternalInstance, ComponentOptions, ComponentPublicInstance } from 'vue';

import { getComponentName } from './getComponentName';

export { createComponentMatcher, type ProfileComponentsOption } from '@flareapp/core/util';

// Profiler state lives on the internal instance under a Symbol, never through Vue's public-instance
// proxy: no devtools noise, no `$`-prefix warnings, and no chance of colliding with a user property.
const PROFILE = Symbol('flareComponentProfile');

type PendingSpan = { name: string; spanId: string; startNano: number; parent: ComponentTraceContext };
type ProfileState = { marker: ComponentTraceContext; pending: PendingSpan | null };
type ProfiledInstance = ComponentInternalInstance & { [PROFILE]?: ProfileState };

// Only matched components store a marker. Unmatched and functional components (no lifecycle
// hooks at all) need no code of their own.
function nearestMarker(instance: ComponentInternalInstance): ComponentTraceContext | null {
    for (let node = instance.parent; node; node = node.parent) {
        const state = (node as ProfiledInstance)[PROFILE];
        if (state) {
            return state.marker;
        }
    }
    return null;
}

// Records one `browser_component` span per matched component mount. `beforeMount` reserves the span
// id and captures the start; `mounted` records it. Vue runs `beforeMount` top-down and `mounted`
// bottom-up, so a parent's span encloses its synchronous descendants in time.
//
// Async components and anything under `<Suspense>` break that contract: their span can start after
// the parent's ended, or get dropped if the root closed first. Nesting by parent id only holds while
// the trace stays the same; a trace change re-homes a descendant to the live root instead.
export function createComponentProfilerMixin(matches: (name: string) => boolean): ComponentOptions {
    return {
        beforeMount(this: ComponentPublicInstance) {
            try {
                // First and on its own: the mixin is global, so with tracing off or no root open this
                // one call is all every mount in the app pays for.
                const live = activeComponentRoot();
                if (!live) {
                    return;
                }

                const name = getComponentName(this);
                if (!matches(name)) {
                    return;
                }

                const internal = this.$ as ProfiledInstance;
                // The ?? cannot fire: with a live root, resolveComponentParent returns the ancestor's
                // context or that root. It keeps the type non-null without a branch that never runs.
                const parent = resolveComponentParent(nearestMarker(internal), live) ?? live;

                const spanId = reserveSpanId(parent.traceId);
                if (!spanId) {
                    return;
                }
                internal[PROFILE] = {
                    marker: { traceId: parent.traceId, parentSpanId: spanId },
                    pending: { name, spanId, startNano: nowNano(), parent },
                };
            } catch {
                // instrumentation must never break the host
            }
        },

        mounted(this: ComponentPublicInstance) {
            try {
                const state = (this.$ as ProfiledInstance)[PROFILE];
                const pending = state?.pending;
                if (!state || !pending) {
                    return;
                }

                state.pending = null; // the marker stays for descendants; the span records once
                recordComponentSpan({
                    name: pending.name,
                    spanId: pending.spanId,
                    parent: pending.parent,
                    startTimeUnixNano: pending.startNano,
                    endTimeUnixNano: nowNano(),
                });
            } catch {
                // instrumentation must never break the host
            }
        },
    };
}
