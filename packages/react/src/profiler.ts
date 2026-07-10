// @flareapp/react/profiler — opt-in React component-mount tracing.
//
// Electron-safe / dependency-free: imports ONLY React and the side-effect-free
// @flareapp/js/browser seam. NO @flareapp/js root import (same discipline as
// ./tanstack-router). Each <FlareProfiler> records one `browser_react_component` span
// for its mount, nested under the nearest profiled ancestor (or the active
// browser_pageload / browser_navigation root) via React context and reserved span ids.
import {
    activeComponentRoot,
    nowNano,
    recordComponentSpan,
    reserveSpanId,
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
    type ReactNode,
} from 'react';

// useLayoutEffect matches componentDidMount timing (fires in commit, before paint,
// bottom-up) but warns during SSR where there is no DOM; fall back to useEffect there.
const useMountEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const FlareProfilerContext = createContext<ComponentTraceContext | null>(null);

export type FlareProfilerProps = { name: string; children?: ReactNode };

export function FlareProfiler({ name, children }: FlareProfilerProps): ReactNode {
    const context = useContext(FlareProfilerContext);

    // Resolve the parent once: an ancestor's context if present, else the active root.
    // `undefined` marks "not yet resolved"; `null` marks "resolved to transparent".
    const parentRef = useRef<ComponentTraceContext | null | undefined>(undefined);
    if (parentRef.current === undefined) {
        try {
            parentRef.current = context ?? activeComponentRoot();
        } catch {
            parentRef.current = null; // resolved to transparent; never throw into the host
        }
    }
    const parent = parentRef.current;

    // Reserve this component's own span id and capture its mount start, once, only
    // when it actually has a parent to nest under.
    const ownRef = useRef<{ spanId: string; startNano: number } | null>(null);
    if (parent && ownRef.current === null) {
        try {
            ownRef.current = { spanId: reserveSpanId(), startNano: nowNano() };
        } catch {
            // leave ownRef null: the mount effect no-ops and this component stays transparent
        }
    }

    // Freeze the context handed to descendants: this component's span when profiled,
    // otherwise pass the (null) context through. A descendant re-resolves against the
    // root live at ITS mount, so a dead-window ancestor (e.g. a layout mounted between
    // traces) does not permanently disable profiling for its subtree.
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
        if (!parent || !own || hasRecorded.current) return;
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

    return createElement(FlareProfilerContext.Provider, { value: providedRef.current ?? null }, children ?? null);
}

export function withFlareProfiler<P extends object>(
    Component: ComponentType<P>,
    options?: { name?: string },
): ComponentType<P> {
    // || not ??: an anonymous/minified component can have name '', which must fall
    // through to 'Unknown' (matches Sentry).
    const name = options?.name || Component.displayName || Component.name || 'Unknown';
    const Profiled = (props: P): ReactNode => createElement(FlareProfiler, { name }, createElement(Component, props));
    Profiled.displayName = `withFlareProfiler(${name})`;
    return Profiled;
}
