import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
    resolveComponentParent,
    type ComponentTraceContext,
} from '@flareapp/js/browser';
import { getContext, onMount, setContext } from 'svelte';

// Its own key, separate from the component tree's: the tree links every registered component, the
// profiler links only profiled ones, so they need different chains.
const PROFILE_KEY = '__flare_component_profile';

/**
 * Records one `browser_component` span for this component's mount. Injected at the top of a matched
 * component's instance script by the Flare preprocessor; not meant to be called by hand.
 *
 * Init runs top-down, so a parent has published its context before any child initializes, which is what
 * lets a child point at a span id its parent reserved but has not recorded yet. `onMount` runs bottom-up
 * (except across an `{#await}`, which does not wait for the pending branch).
 */
export function __flareProfileComponent(name: string): void {
    try {
        const inherited = getContext<ComponentTraceContext>(PROFILE_KEY) ?? null;
        // An ancestor's context is only usable while it still belongs to the live trace. A layout that
        // survives a navigation froze its context under the previous root; re-home instead of recording
        // onto a trace that already shipped.
        const parent = resolveComponentParent(inherited, activeComponentRoot());
        if (!parent) {
            // Tracing off, no root open, or SSR. Publish no context: descendants then inherit the
            // nearest profiled ancestor and re-validate against the live root themselves.
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
