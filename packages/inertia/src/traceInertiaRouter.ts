import { insulate, registerNavigationSource, safeInvoke } from '@flareapp/js/browser';

import type { InertiaRouterLike } from './vendor/inertiaTypes';

// Dedup re-instrumentation of the same router. Vite HMR can re-run boot code against a router that
// survives the reload; without this, each cycle appends another listener set that is never removed.
const instrumented = new WeakMap<object, () => void>();

/**
 * Trace an Inertia router: open a held `browser_navigation` root per visit, settled once the page
 * arrives. Call it before Inertia boots, so the initial `navigate` is seen. Returns a cleanup that
 * removes the listeners and unregisters. Inert for a non-router value; never throws into the host.
 */
export function traceInertiaRouter(router: unknown): () => void {
    const r = router as Partial<InertiaRouterLike> | null;
    if (!r || typeof r.on !== 'function') {
        return () => {}; // wrong shape -> inert
    }

    instrumented.get(r)?.(); // HMR: tear down any prior instrumentation of this same router first

    const nav = registerNavigationSource();

    const offStart = r.on(
        'start',
        insulate(() => {}),
    );
    const offNavigate = r.on(
        'navigate',
        insulate(() => {}),
    );
    const offSuccess = r.on(
        'success',
        insulate(() => {}),
    );
    const offFinish = r.on(
        'finish',
        insulate(() => {}),
    );

    const cleanup = (): void => {
        safeInvoke(offStart);
        safeInvoke(offNavigate);
        safeInvoke(offSuccess);
        safeInvoke(offFinish);
        safeInvoke(() => nav.unregister());
        if (instrumented.get(r) === cleanup) instrumented.delete(r);
    };
    instrumented.set(r, cleanup);

    return cleanup;
}
