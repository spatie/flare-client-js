import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
    resolveComponentParent,
    type ComponentTraceContext,
} from '@flareapp/js/browser';
import { getContext, onMount, setContext } from 'svelte';

// Separate from the component tree's key: that one chains every component, this one only the
// profiled ones.
const PROFILE_KEY = '__flare_component_profile';

/**
 * Records one `browser_component` span for this component's mount. The preprocessor injects the call,
 * don't write it by hand.
 *
 * Init runs top-down, so a child can point at a span id its parent reserved but hasn't recorded yet.
 */
export function __flareProfileComponent(name: string): void {
    try {
        const inherited = getContext<ComponentTraceContext>(PROFILE_KEY) ?? null;
        // A layout that survives a navigation still holds the old trace, so re-home rather than
        // record onto one that already shipped.
        const parent = resolveComponentParent(inherited, activeComponentRoot());
        if (!parent) {
            // Tracing off, no root open, or SSR. Publishing no context keeps us transparent:
            // descendants resolve against the live root themselves.
            return;
        }

        const spanId = reserveSpanId();
        const startTimeUnixNano = nowNano();

        setContext(PROFILE_KEY, { traceId: parent.traceId, parentSpanId: spanId });

        onMount(() => {
            try {
                recordComponentSpan({
                    name,
                    spanId,
                    parent,
                    startTimeUnixNano,
                    endTimeUnixNano: nowNano(),
                });
            } catch {
                // instrumentation must never break the host
            }
        });
    } catch {
        // instrumentation must never break the host
    }
}
