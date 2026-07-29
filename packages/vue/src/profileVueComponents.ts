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

// Profiler state lives on the INTERNAL instance under a Symbol, never through Vue's public-instance
// proxy: no devtools noise, no `$`-prefix warnings, and no chance of colliding with a user property.
const PROFILE = Symbol('flareComponentProfile');

type PendingSpan = { name: string; spanId: string; startNano: number; parent: ComponentTraceContext };
type ProfileState = { marker: ComponentTraceContext; pending: PendingSpan | null };
type ProfiledInstance = ComponentInternalInstance & { [PROFILE]?: ProfileState };

/** The nearest profiled ancestor's marker, walking the internal parent chain. Only matched components
 *  store a marker, so unmatched ones (and functional components, which get no hooks at all) are
 *  skipped without any code for them. */
function nearestMarker(instance: ComponentInternalInstance): ComponentTraceContext | null {
    for (let node = instance.parent; node; node = node.parent) {
        const state = (node as ProfiledInstance)[PROFILE];
        if (state) {
            return state.marker;
        }
    }
    return null;
}

/**
 * Record one `browser_component` span per matched component mount. `beforeMount` reserves the span id
 * and captures the start; `mounted` records it. Vue runs `beforeMount` top-down and `mounted`
 * bottom-up, so a parent's span encloses every descendant's both by time and by parent id.
 */
export function createComponentProfilerMixin(matches: (name: string) => boolean): ComponentOptions {
    return {
        beforeMount(this: ComponentPublicInstance) {
            try {
                const name = getComponentName(this);
                // unmatched components stay transparent: no state, no marker
                if (!matches(name)) {
                    return;
                }

                const internal = this.$ as ProfiledInstance;
                const parent = resolveComponentParent(nearestMarker(internal), activeComponentRoot());
                // tracing off, or no root open: record nothing
                if (!parent) {
                    return;
                }

                const spanId = reserveSpanId();
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
