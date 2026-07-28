import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
    type ComponentTraceContext,
} from '@flareapp/js/browser';
import type { ComponentInternalInstance, ComponentOptions, ComponentPublicInstance } from 'vue';

import { getComponentName } from './getComponentName';

/** What `flareVue`'s `profileComponents` option accepts. */
export type ProfileComponentsOption = boolean | (string | RegExp)[];

/**
 * Build the allowlist predicate once at plugin install, so a mount costs one name resolution and one
 * match. Strings match exactly, regexes by `test()`.
 */
export function createComponentMatcher(option: ProfileComponentsOption): (name: string) => boolean {
    if (option === true) return () => true;
    if (!option || option.length === 0) return () => false;

    const names = new Set(option.filter((entry): entry is string => typeof entry === 'string'));

    // A `g` or `y` regex carries lastIndex between calls, so reusing the caller's object would make
    // every other test() miss. Strip those flags into a copy rather than mutating what was passed in.
    const patterns = option
        .filter((entry): entry is RegExp => entry instanceof RegExp)
        .map((pattern) =>
            pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern,
        );

    return (name: string): boolean => names.has(name) || patterns.some((pattern) => pattern.test(name));
}

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
        if (state) return state.marker;
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
                if (!matches(name)) return; // unmatched components stay transparent: no state, no marker

                const internal = this.$ as ProfiledInstance;
                const live = activeComponentRoot();
                const inherited = nearestMarker(internal);
                // Prefer an ancestor's marker only while it still belongs to the live trace. A profiled
                // component that survives a navigation (a layout around a swapped page body) froze its
                // marker under the pageload trace, and the live-root gate would drop anything pointing
                // at it. Re-home to the live root instead.
                const parent = inherited && live && inherited.traceId === live.traceId ? inherited : live;
                if (!parent) return; // tracing off, or no root open: record nothing

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
                if (!state || !pending) return;

                state.pending = null; // the marker stays for descendants; the span records once
                recordComponentSpan({
                    name: pending.name,
                    spanId: pending.spanId,
                    parent: pending.parent,
                    framework: 'vue',
                    startTimeUnixNano: pending.startNano,
                    endTimeUnixNano: nowNano(),
                });
            } catch {
                // instrumentation must never break the host
            }
        },
    };
}
