// Electron-safe entry: NO @flareapp/js root import. The navigation-source seam
// comes from @flareapp/js/browser (side-effect-free). NO runtime dependency on
// @tanstack/react-router — the router is consumed structurally (see ./vendor).
import { registerNavigationSource, type RouteName } from '@flareapp/js/browser';

import type { TsrLocation, TsrNavEvent, TsrRouter } from './vendor/tanstackRouterTypes';

/**
 * Trace a TanStack Router instance: name the `browser_pageload` root from the
 * initial route and open a parameterized `browser_navigation` root per route
 * change. Returns a cleanup that unsubscribes and unregisters. Safe to call
 * before or after tracing is enabled; no-ops when tracing is off.
 */
export function traceTanStackRouter(router: TsrRouter): () => void {
    const nav = registerNavigationSource();

    const routeNameFor = (loc: TsrLocation): RouteName => {
        try {
            const matches = router.matchRoutes(loc.pathname, loc.search, { preload: false, throwOnError: false });
            const last = matches[matches.length - 1];
            const matched = matches.some((m) => m.routeId !== '__root__');
            const name = matched ? last?.fullPath || last?.routeId : undefined;
            if (name) return { name, source: 'route' };
        } catch {
            // fall through to the URL name
        }
        return { name: loc.pathname, source: 'url' };
    };

    // A tracing error must never escape into the router's event dispatch.
    const guard =
        (fn: (event: TsrNavEvent) => void) =>
        (event: TsrNavEvent): void => {
            try {
                fn(event);
            } catch {
                // swallow: instrumentation never breaks the host
            }
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
        guard((e) => {
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
        guard((e) => {
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
        try {
            offBeforeLoad();
        } catch {
            // ignore
        }
        try {
            offResolved();
        } catch {
            // ignore
        }
        try {
            nav.unregister();
        } catch {
            // ignore
        }
    };
}
