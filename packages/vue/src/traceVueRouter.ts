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

const NAVIGATION_CANCELLED = 8; // ErrorTypes.NAVIGATION_CANCELLED: a newer nav superseded this one

// Internal, wired through `flareVue({ router })`. Opens a held navigation root per route change,
// settled when the navigation confirms.
export function traceVueRouter(router: unknown): () => void {
    if (!isVueRouter(router)) {
        return () => {};
    }

    return instrumentOnce(router, (track) => install(router, track));
}

// Guards only what the integration calls unconditionally; `resolve` and `onError` stay optional.
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
    // Tracked first so it unwinds last — releasing the hold must happen once no guard can open a new
    // root. Later registrations track as they happen, so a throw tears down what's already attached.
    track(() => nav.unregister());

    function routeNameFor(loc: VueRouteLocationLike): RouteName {
        return routeName(() => loc.matched?.[loc.matched.length - 1]?.path, loc.path, hrefOf(loc));
    }

    // `resolve` restores the app's base path or `#` prefix, which `fullPath` strips. Without it, an
    // app served from `/app/` would report `/product/p01` instead of the real `/app/product/p01`.
    function hrefOf(loc: VueRouteLocationLike): string | undefined {
        const path = loc.fullPath ?? loc.path;
        if (!path) {
            return undefined;
        }
        return resolveHref(() => router.resolve?.(path)?.href, path);
    }

    function isInitial(from: VueRouteLocationLike | undefined): boolean {
        return !from || !from.matched || from.matched.length === 0; // START_LOCATION
    }

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
                    nav.setActiveRouteName(routeNameFor(to)); // no nav root here
                    return;
                }

                // Only a `force: true` re-navigation reaches beforeEach with to.fullPath === from.fullPath. A
                // plain duplicate nav is stopped earlier and shows up only as an afterEach failure (type 16,
                // dropped by the !inFlight guard there). Skip it so a same-URL refresh opens no navigation root.
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
                        nav.setActiveRouteName(routeNameFor(to));
                    }
                    return;
                }

                if (!inFlight) {
                    return;
                }

                if (!failure) {
                    inFlight = false;
                    nav.settleNavigation(routeNameFor(to));
                    return;
                }

                // A redirect never reaches afterEach (vue-router starts a new navigation instead), so a
                // failure here is final. `cancelled` (a newer nav replaced this one) keeps the held root for
                // that nav's afterEach; other failures release it, so a blocked nav doesn't stay held until
                // the finalTimeout backstop.
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
