import { absoluteHref, insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';

import type { InertiaEventLike, InertiaPageLike, InertiaRouterLike } from './vendor/inertiaTypes';

// Dedup re-instrumentation of the same router. Vite HMR can re-run boot code against a router that
// survives the reload; without this, each cycle appends another listener set that is never removed.
const instrumented = new WeakMap<object, () => void>();

/** Resolve a router-reported location (a `URL` on visits, a relative string on pages) to a full href
 *  plus its path. Both are undefined outside a browser or for an unparseable value. */
function locationOf(raw: URL | string | null | undefined): { href?: string; path?: string } {
    if (raw == null) return {};
    const href = absoluteHref(String(raw));
    if (!href) return {};
    try {
        return { href, path: new URL(href).pathname };
    } catch {
        return { href };
    }
}

const here = (): string => (typeof location !== 'undefined' ? location.pathname : '');

/** Name a root from the page object. `component` ('Products/Show') is Inertia's low-cardinality route
 *  identifier, so it aggregates the way the other integrations' route templates do. */
function routeNameFor(page: InertiaPageLike | undefined): RouteName {
    const { href, path } = locationOf(page?.url);
    return page?.component
        ? { name: page.component, source: 'route', url: href }
        : { name: path ?? here(), source: 'url', url: href };
}

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

    let inFlight = false;

    const settle = (page: InertiaPageLike | undefined): void => {
        inFlight = false;
        nav.settleNavigation(routeNameFor(page));
    };

    const offStart = r.on(
        'start',
        insulate((event: InertiaEventLike) => {
            inFlight = true;
            const { href, path } = locationOf(event?.detail?.visit?.url);
            nav.startNavigation({ path, url: href, hold: true });
        }),
    );

    const offNavigate = r.on(
        'navigate',
        insulate((event: InertiaEventLike) => {
            if (!inFlight) return;
            settle(event?.detail?.page);
        }),
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
