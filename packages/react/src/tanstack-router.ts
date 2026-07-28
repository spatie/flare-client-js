// Electron-safe entry: NO @flareapp/js root import. The navigation-source seam
// comes from @flareapp/js/browser (side-effect-free). NO runtime dependency on
// @tanstack/react-router — the router is consumed structurally (see ./vendor).
import {
    insulate,
    registerNavigationSource,
    resolveHref,
    routeName,
    safeInvoke,
    type RouteName,
} from '@flareapp/js/browser';

import type { TsrLocation, TsrNavEvent, TsrRouter } from './vendor/tanstackRouterTypes';

/**
 * Trace a TanStack Router instance: name the `browser_pageload` root from the
 * initial route and open a parameterized `browser_navigation` root per route
 * change. Returns a cleanup that unsubscribes and unregisters. Safe to call
 * before or after tracing is enabled; no-ops when tracing is off.
 */
export function traceTanStackRouter(router: TsrRouter): () => void {
    const nav = registerNavigationSource();

    // `publicHref` is the one that matches the address bar: a `basepath` is applied as a rewrite, so
    // an app served from `/app/` has it stripped from `href` but kept on `publicHref`. Falling back
    // to `href` costs the basepath, which is what we reported before, so it never makes things worse.
    const hrefOf = (loc: TsrLocation): string | undefined =>
        resolveHref(() => loc.publicHref ?? loc.href, loc.pathname);

    // Roots here open without a url of their own (TanStack reports the destination only as a parsed
    // location), so without the url a nav root would keep the url of the page it left.
    const routeNameFor = (loc: TsrLocation): RouteName =>
        routeName(
            () => {
                const matches = router.matchRoutes(loc.pathname, loc.search, { preload: false, throwOnError: false });
                const matched = matches.some((m) => m.routeId !== '__root__');
                if (!matched) {
                    return undefined;
                }
                const last = matches[matches.length - 1];
                return last?.fullPath || last?.routeId;
            },
            loc.pathname,
            hrefOf(loc),
        );

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
            // initial pageload (handled via onResolved)
            if (e.fromLocation === undefined) {
                return;
            }
            // no-op reload (e.g. router.invalidate())
            if (e.toLocation.state === e.fromLocation.state) {
                return;
            }
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
