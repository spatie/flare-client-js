import {
    insulate,
    instrumentOnce,
    registerNavigationSource,
    resolveHref,
    routeName,
    safeInvoke,
    type RouteName,
} from '@flareapp/js/browser';

import type { NavigationFailureLike, VueRouteLocationLike, VueRouterLike } from './vendor/vueRouterTypes';

const NAVIGATION_CANCELLED = 8; // ErrorTypes.NAVIGATION_CANCELLED — a newer nav superseded this one

/**
 * Trace a vue-router instance: name the `browser_pageload` root from the initial route, and open a
 * parameterized, held `browser_navigation` root per route change, settled once the navigation confirms.
 * Returns a cleanup that removes the guards and unregisters. Consumed by `flareVue({ router })`; internal
 * (not part of the public entry). Inert for a non-router value; never throws into the host.
 */
export function traceVueRouter(router: unknown): () => void {
    if (!isVueRouter(router)) {
        return () => {}; // wrong shape → inert
    }

    return instrumentOnce(router, () => install(router));
}

/** Guards only what the integration calls unconditionally; `resolve` and `onError` stay optional. */
function isVueRouter(router: unknown): router is VueRouterLike {
    const r = router as Partial<VueRouterLike> | null;
    if (!r) {
        return false;
    }
    return typeof r.beforeEach === 'function' && typeof r.afterEach === 'function';
}

function install(r: VueRouterLike): () => void {
    const nav = registerNavigationSource();

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
        return resolveHref(() => r.resolve?.(path)?.href, path);
    };

    const isInitial = (from: VueRouteLocationLike | undefined): boolean =>
        !from || !from.matched || from.matched.length === 0; // START_LOCATION

    let sawInitial = false;
    let inFlight = false;

    // Enrich the pageload root immediately if the router already resolved its initial route (e.g. flareVue
    // installed after `await router.isReady()`); otherwise the first guard pair handles it.
    try {
        const current = r.currentRoute?.value;
        if (current && current.matched && current.matched.length > 0) {
            nav.setActiveRouteName(routeNameFor(current));
            sawInitial = true;
        }
    } catch {
        // never break the host on wiring
    }

    const offBefore = r.beforeEach(
        insulate((to: VueRouteLocationLike, from: VueRouteLocationLike) => {
            // Initial navigation first: START_LOCATION.fullPath is '/', so an app whose initial route is
            // '/' would otherwise be swallowed by the same-location skip below.
            if (!sawInitial && isInitial(from)) {
                nav.setActiveRouteName(routeNameFor(to)); // name the pageload root; open no nav root
                return;
            }

            // Only a `force: true` re-navigation reaches beforeEach with to.fullPath === from.fullPath: a
            // plain duplicated nav is short-circuited before guards run and surfaces solely as an afterEach
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
    );

    const offAfter = r.afterEach(
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

            // A redirect never reaches afterEach (vue-router short-circuits to a new navigation), so any
            // failure here is terminal. `cancelled` (a newer nav superseded this one) keeps the held root
            // for the successor's afterEach; `aborted` / `duplicated` / unknown release it to the current
            // location so a blocked navigation can't strand a held root until the finalTimeout backstop.
            if (failure.type === NAVIGATION_CANCELLED) {
                return;
            }
            inFlight = false;
            nav.settleNavigation(routeNameFor(from));
        }),
    );

    const offError =
        typeof r.onError === 'function'
            ? r.onError(
                  insulate(() => {
                      if (!inFlight) {
                          return;
                      }
                      inFlight = false;
                      const current = r.currentRoute?.value;
                      nav.settleNavigation(current ? routeNameFor(current) : { name: '', source: 'url' });
                  }),
              )
            : undefined;

    return () => {
        safeInvoke(offBefore);
        safeInvoke(offAfter);
        safeInvoke(offError);
        safeInvoke(() => nav.unregister());
    };
}
