// Electron-safe entry: NO @flareapp/js root import. The navigation-source seam
// comes from @flareapp/js/browser (side-effect-free). NO runtime dependency on
// @tanstack/react-router — the router is consumed structurally (see ./vendor).
import { insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';

import type { TsrLocation, TsrNavEvent, TsrRouter } from './vendor/tanstackRouterTypes';

/**
 * Trace a TanStack Router instance: name the `browser_pageload` root from the
 * initial route and open a parameterized `browser_navigation` root per route
 * change. Returns a cleanup that unsubscribes and unregisters. Safe to call
 * before or after tracing is enabled; no-ops when tracing is off.
 */
export function traceTanStackRouter(router: TsrRouter): () => void {
    const nav = registerNavigationSource();

    // Same-origin SPA: TanStack's `href` is origin-relative, so prepend the origin to get a full one.
    const hrefOf = (loc: TsrLocation): string | undefined => {
        if (typeof window === 'undefined') return undefined;
        return window.location.origin + (loc.href ?? loc.pathname ?? '');
    };

    // `url` rides along on every name so it re-stamps the root's url.full in lockstep. This slice
    // opens roots without a url override (TanStack reports the destination only as a parsed
    // location), so without the re-stamp a nav root keeps the url of the page it left.
    const routeNameFor = (loc: TsrLocation): RouteName => {
        const url = hrefOf(loc);
        try {
            const matches = router.matchRoutes(loc.pathname, loc.search, { preload: false, throwOnError: false });
            const last = matches[matches.length - 1];
            const matched = matches.some((m) => m.routeId !== '__root__');
            const name = matched ? last?.fullPath || last?.routeId : undefined;
            if (name) return { name, source: 'route', url };
        } catch {
            // fall through to the URL name
        }
        return { name: loc.pathname, source: 'url', url };
    };

    // Enrich the pageload root immediately from the current (already-resolved) location.
    try {
        nav.setActiveRouteName(routeNameFor(router.state.location));
    } catch {
        // never break the host on wiring
    }

    let inFlight = false;

    const offBeforeLoad = router.subscribe(
        'onBeforeLoad',
        insulate((e: TsrNavEvent) => {
            if (e.fromLocation === undefined) return; // initial pageload (handled via onResolved)
            if (e.toLocation.state === e.fromLocation.state) return; // no-op reload (e.g. router.invalidate())
            if (!inFlight) {
                inFlight = true;
                nav.startNavigation({ path: e.toLocation.pathname });
            }
            nav.setActiveRouteName(routeNameFor(e.toLocation)); // set / re-set (redirect hops)
        }),
    );

    const offResolved = router.subscribe(
        'onResolved',
        insulate((e: TsrNavEvent) => {
            if (e.fromLocation === undefined) {
                nav.setActiveRouteName(routeNameFor(e.toLocation)); // one-shot pageload correction
                return;
            }
            if (inFlight) {
                inFlight = false;
                nav.setActiveRouteName(routeNameFor(e.toLocation)); // finalize the navigation name
            }
        }),
    );

    return () => {
        safeInvoke(offBeforeLoad);
        safeInvoke(offResolved);
        safeInvoke(() => nav.unregister());
    };
}
