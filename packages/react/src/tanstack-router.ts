// Electron-safe entry: no @flareapp/js root import; the navigation-source seam is side-effect-free.
// No runtime dependency on @tanstack/react-router either — the router is consumed structurally (see ./vendor).
import {
    insulate,
    instrumentOnce,
    registerNavigationSource,
    resolveHref,
    routeName,
    type RouteName,
    type TrackTeardown,
} from '@flareapp/js/browser';

import type { TanStackLocationLike, TanStackNavEventLike, TanStackRouterLike } from './vendor/tanstackRouterTypes';

// How long a held navigation root waits for `onResolved` before settling itself. Exported so the suite
// drives it instead of hardcoding the number; not part of the supported surface.
export const STALE_NAVIGATION_TIMEOUT_MS = 5_000;

/**
 * Traces a TanStack Router instance: names the `browser_pageload` root from the initial route, then
 * opens a parameterized `browser_navigation` root per route change. Safe to call before/after tracing
 * is enabled, and to call twice (replaces the prior instrumentation instead of stacking subscriptions).
 */
export function traceTanStackRouter(router: TanStackRouterLike): () => void {
    if (typeof router?.subscribe !== 'function') {
        return () => {}; // not a router: do nothing
    }

    return instrumentOnce(router, (track) => install(router, track));
}

function install(router: TanStackRouterLike, track: TrackTeardown): void {
    const nav = registerNavigationSource();
    track(() => nav.unregister()); // tracked first so it unwinds last

    // `publicHref` matches the address bar; `basepath` is a rewrite, so it's stripped from `href` but
    // kept on `publicHref`. Falling back to `href` just costs the basepath, same as before this existed.
    function hrefOf(loc: TanStackLocationLike): string | undefined {
        return resolveHref(() => loc.publicHref ?? loc.href, loc.pathname);
    }

    // Roots here open without a url of their own (TanStack reports the destination only as a parsed
    // location), so without the url a nav root would keep the url of the page it left.
    function routeNameFor(loc: TanStackLocationLike): RouteName {
        return routeName(
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
    }

    try {
        nav.setActiveRouteName(routeNameFor(router.state.location));
    } catch {
        // never break the host on wiring
    }

    // onResolved fires only from React's Transitioner layout effect, so an unmounted-mid-navigation
    // RouterProvider never releases the hold. Recover on a timer instead of waiting for the 30s finalTimeout.
    let inFlight = false;
    let destination: TanStackLocationLike | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    function clearStaleTimer(): void {
        if (staleTimer !== null) {
            clearTimeout(staleTimer);
            staleTimer = null;
        }
    }

    function settle(location: TanStackLocationLike): void {
        clearStaleTimer();
        inFlight = false;
        destination = null;
        nav.settleNavigation(routeNameFor(location));
    }

    // Tracked as each subscription registers: subscribe() can throw (a hostile router), and
    // instrumentOnce then unwinds whatever already succeeded, plus this timer, instead of leaking them.
    track(clearStaleTimer);

    track(
        router.subscribe(
            'onBeforeLoad',
            insulate((event: TanStackNavEventLike) => {
                // initial pageload (handled via onResolved)
                if (event.fromLocation === undefined) {
                    return;
                }
                // no-op reload (e.g. router.invalidate()). The router's own flag first; the state-identity
                // comparison stays as the fallback for an event built without the flags.
                if (event.hrefChanged === false) {
                    return;
                }
                if (event.toLocation.state === event.fromLocation.state) {
                    return;
                }
                if (!inFlight) {
                    inFlight = true;
                    // Held: components mount after onResolved, and a cached or code-split route can
                    // produce no child span at all — an idle window would close the root immediately and drop those spans.
                    nav.startNavigation({ path: event.toLocation.pathname, hold: true });
                }
                destination = event.toLocation;
                nav.setActiveRouteName(routeNameFor(event.toLocation)); // set / re-set (redirect hops)

                // Re-armed per redirect hop, so the window measures the gap since the last sign of life.
                // Insulated on its own: this timer is ours, so a throw here reaches nothing but the window.
                clearStaleTimer();
                staleTimer = setTimeout(
                    insulate(() => {
                        staleTimer = null;
                        if (destination) {
                            settle(destination);
                        }
                    }),
                    STALE_NAVIGATION_TIMEOUT_MS,
                );
            }),
        ),
    );

    track(
        router.subscribe(
            'onResolved',
            insulate((event: TanStackNavEventLike) => {
                if (event.fromLocation === undefined) {
                    nav.setActiveRouteName(routeNameFor(event.toLocation)); // one-shot pageload correction
                    return;
                }
                if (inFlight) {
                    settle(event.toLocation); // finalize the navigation name and release the hold
                }
            }),
        ),
    );
}

export type {
    TanStackLocationLike,
    TanStackMatchLike,
    TanStackNavEventLike,
    TanStackRouterLike,
} from './vendor/tanstackRouterTypes';
