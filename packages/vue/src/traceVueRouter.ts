import {
    insulate,
    instrumentOnce,
    registerNavigationSource,
    resolveHref,
    routeName,
    type RouteName,
    type TrackTeardown,
} from '@flareapp/js/browser';

import type { NavigationFailureLike, VueRouteLocationLike, VueRouterLike } from './vendor/vueRouterTypes';

const NAVIGATION_CANCELLED = 8; // ErrorTypes.NAVIGATION_CANCELLED — a newer nav superseded this one

/**
 * Trace a vue-router instance: name the `browser_pageload` root from the initial route, and open a
 * parameterized, held `browser_navigation` root per route change, settled once the navigation confirms.
 * Returns a cleanup that removes the guards and unregisters. Consumed by `flareVue({ router })`; internal
 * (not part of the public entry). Does nothing for a non-router value; never throws into the host.
 */
export function traceVueRouter(router: unknown): () => void {
    if (!isVueRouter(router)) {
        return () => {}; // not a router: do nothing
    }

    return instrumentOnce(router, (track) => install(router, track));
}

/** Guards only what the integration calls unconditionally; `resolve` and `onError` stay optional. */
function isVueRouter(router: unknown): router is VueRouterLike {
    if (typeof router !== 'object' || router === null) {
        return false;
    }
    return (
        'beforeEach' in router &&
        typeof router.beforeEach === 'function' &&
        'afterEach' in router &&
        typeof router.afterEach === 'function'
    );
}

function install(router: VueRouterLike, track: TrackTeardown): void {
    const nav = registerNavigationSource();
    // Tracked first so it unwinds last: releasing the hold has to happen once no guard can open a
    // new root. Everything after it is tracked as it registers, so a throw from the next registration
    // tears down the ones already attached instead of leaking them.
    track(() => nav.unregister());

    const routeNameFor = (loc: VueRouteLocationLike): RouteName =>
        routeName(() => loc.matched?.[loc.matched.length - 1]?.path, loc.path, hrefOf(loc));

    // `resolve` is what puts the app's base path or `#` prefix back on: `fullPath` has them
    // stripped, so an app served from `/app/` would report `/product/p01` for the real
    // `/app/product/p01`.
    const hrefOf = (loc: VueRouteLocationLike): string | undefined => {
        const path = loc.fullPath ?? loc.path;
        if (!path) {
            return undefined;
        }
        return resolveHref(() => router.resolve?.(path)?.href, path);
    };

    const isInitial = (from: VueRouteLocationLike | undefined): boolean =>
        !from || !from.matched || from.matched.length === 0; // START_LOCATION

    let sawInitial = false;
    let inFlight = false;

    // Enrich the pageload root immediately if the router already resolved its initial route (e.g. flareVue
    // installed after `await router.isReady()`); otherwise the first guard pair handles it.
    try {
        const current = router.currentRoute?.value;
        if (current && current.matched && current.matched.length > 0) {
            nav.setActiveRouteName(routeNameFor(current));
            sawInitial = true;
        }
    } catch {
        // never break the host on wiring
    }

    track(
        router.beforeEach(
            insulate((to: VueRouteLocationLike, from: VueRouteLocationLike) => {
                // Initial navigation first: START_LOCATION.fullPath is '/', so an app whose initial route is
                // '/' would otherwise be swallowed by the same-location skip below.
                if (!sawInitial && isInitial(from)) {
                    nav.setActiveRouteName(routeNameFor(to)); // name the pageload root; open no nav root
                    return;
                }

                // Only a `force: true` re-navigation reaches beforeEach with to.fullPath === from.fullPath: a
                // plain duplicate nav is stopped before the guards run and shows up only as an afterEach
                // failure (type 16, dropped by the !inFlight guard there). Skip it so a same-URL refresh opens
                // no navigation root.
                if (to.fullPath && from?.fullPath && to.fullPath === from.fullPath) {
                    return;
                }

                if (!inFlight) {
                    inFlight = true;
                    nav.startNavigation({ path: to.path, url: hrefOf(to), hold: true });
                }
                nav.setActiveRouteName(routeNameFor(to)); // set / re-set across redirect hops
            }),
        ),
    );

    track(
        router.afterEach(
            insulate((to: VueRouteLocationLike, from: VueRouteLocationLike, failure?: NavigationFailureLike) => {
                if (!sawInitial && isInitial(from)) {
                    if (!failure) {
                        sawInitial = true;
                        nav.setActiveRouteName(routeNameFor(to)); // finalize pageload name
                    }
                    return;
                }

                if (!inFlight) {
                    return;
                }

                if (!failure) {
                    inFlight = false;
                    nav.settleNavigation(routeNameFor(to)); // success: name + release hold
                    return;
                }

                // A redirect never reaches afterEach (vue-router starts a new navigation instead), so a failure
                // here is the end of the road. `cancelled` (a newer nav replaced this one) keeps the held root
                // for that newer nav's afterEach; `aborted` / `duplicated` / unknown release it to the current
                // location, so a blocked navigation can't leave a root held open until the finalTimeout backstop.
                if (failure.type === NAVIGATION_CANCELLED) {
                    return;
                }
                inFlight = false;
                nav.settleNavigation(routeNameFor(from));
            }),
        ),
    );

    if (typeof router.onError === 'function') {
        track(
            router.onError(
                insulate(() => {
                    if (!inFlight) {
                        return;
                    }
                    inFlight = false;
                    const current = router.currentRoute?.value;
                    nav.settleNavigation(current ? routeNameFor(current) : { name: '', source: 'url' });
                }),
            ),
        );
    }
}
