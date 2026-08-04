// @flareapp/react/profiler is Electron-safe, so it imports only React and the side-effect-free
// @flareapp/js/browser seam. No @flareapp/js root import (same rule as ./tanstack-router).
import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
    resolveComponentParent,
    type ComponentTraceContext,
} from '@flareapp/js/browser';
import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    type ComponentType,
    type FunctionComponent,
    type ReactNode,
} from 'react';

// useLayoutEffect matches componentDidMount timing (fires in commit, before paint,
// bottom-up) but warns during SSR where there is no DOM; fall back to useEffect there.
const useMountEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const FlareProfilerContext = createContext<ComponentTraceContext | null>(null);

export type FlareProfilerProps = {
    /** The span's name, as it appears in the trace. */
    name: string;
    children?: ReactNode;
};

/** Records one `browser_component` span for its mount, nested under the nearest profiled ancestor
 *  or the active `browser_pageload` / `browser_navigation` root. */
export function FlareProfiler({ name, children }: FlareProfilerProps): ReactNode {
    const context = useContext(FlareProfilerContext);

    // `undefined` marks "not yet resolved"; `null` marks "resolved to transparent".
    const parentRef = useRef<ComponentTraceContext | null | undefined>(undefined);
    if (parentRef.current === undefined) {
        try {
            parentRef.current = resolveComponentParent(context, activeComponentRoot());
        } catch {
            parentRef.current = null; // resolved to transparent; never throw into the host
        }
    }
    const parent = parentRef.current;

    const ownRef = useRef<{ spanId: string; startNano: number } | null>(null);
    if (parent && ownRef.current === null) {
        try {
            ownRef.current = { spanId: reserveSpanId(), startNano: nowNano() };
        } catch {
            // leave ownRef null: the mount effect no-ops and this component stays transparent
        }
    }

    // A descendant re-resolves against the root live at its own mount, so a layout that mounted between
    // traces does not permanently disable profiling for its subtree.
    const providedRef = useRef<ComponentTraceContext | null | undefined>(undefined);
    if (providedRef.current === undefined) {
        providedRef.current =
            parent && ownRef.current ? { traceId: parent.traceId, parentSpanId: ownRef.current.spanId } : null;
    }

    // Record exactly once per committed fiber. Under StrictMode React replays the
    // effect (setup -> cleanup -> setup) on the same fiber, and the refs above persist,
    // so an unguarded effect would buffer the same reserved spanId twice.
    const hasRecorded = useRef(false);
    useMountEffect(() => {
        const own = ownRef.current;
        if (!parent || !own || hasRecorded.current) {
            return;
        }
        hasRecorded.current = true;
        try {
            recordComponentSpan({
                name,
                spanId: own.spanId,
                parent,
                startTimeUnixNano: own.startNano,
                endTimeUnixNano: nowNano(),
            });
        } catch {
            // instrumentation must never break the host
        }
    }, []);

    if (providedRef.current === null) {
        // Transparent: publish nothing rather than a null that shadows a real profiled ancestor.
        return children ?? null;
    }

    return createElement(FlareProfilerContext.Provider, { value: providedRef.current }, children ?? null);
}

/** Wraps `Component` in a `FlareProfiler`. Name it explicitly when the component is anonymous or minified. */
export function withFlareProfiler<P extends object>(
    Component: ComponentType<P>,
    options?: { name?: string },
): FunctionComponent<P> {
    // || not ??: an anonymous/minified component can have name '', which must fall
    // through to 'Unknown' (matches Sentry).
    const name = options?.name || Component.displayName || Component.name || 'Unknown';
    function Profiled(props: P): ReactNode {
        return createElement(FlareProfiler, { name }, createElement(Component, props));
    }
    Profiled.displayName = `withFlareProfiler(${name})`;
    return Profiled;
}
