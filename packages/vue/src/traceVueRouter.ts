import { insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';

import type { NavigationFailureLike, VueRouteLocationLike, VueRouterLike } from './vendor/vueRouterTypes';

const NAVIGATION_CANCELLED = 8; // ErrorTypes.NAVIGATION_CANCELLED — a newer nav superseded this one

// Dedup re-instrumentation of the same router. Vite HMR can re-run plugin install against a persistent
// router; without this each cycle appends another guard triple that is never removed. Keyed on the
// router object, so a genuinely new router is unaffected.
const instrumented = new WeakMap<object, () => void>();

/**
 * Trace a vue-router instance: name the `browser_pageload` root from the initial route, and open a
 * parameterized, held `browser_navigation` root per route change, settled once the navigation confirms.
 * Returns a cleanup that removes the guards and unregisters. Consumed by `flareVue({ router })`; internal
 * (not part of the public entry). Inert for a non-router value; never throws into the host.
 */
export function traceVueRouter(router: unknown): () => void {
    const r = router as Partial<VueRouterLike> | null;
    if (!r || typeof r.beforeEach !== 'function' || typeof r.afterEach !== 'function') {
        return () => {}; // wrong shape → inert
    }

    instrumented.get(r)?.(); // HMR: tear down any prior instrumentation of this same router first

    const nav = registerNavigationSource();

    const routeNameFor = (loc: VueRouteLocationLike): RouteName => {
        try {
            const matched = loc.matched;
            const template = matched && matched.length > 0 ? matched[matched.length - 1]?.path : undefined;
            if (template) return { name: template, source: 'route' };
        } catch {
            // fall through to the URL name
        }
        return { name: loc.path, source: 'url' };
    };

    const hrefOf = (loc: VueRouteLocationLike): string => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return origin + (loc.fullPath ?? loc.path ?? '');
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
            if (to.fullPath && from?.fullPath && to.fullPath === from.fullPath) return;

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

            if (!inFlight) return;

            if (!failure) {
                inFlight = false;
                nav.settleNavigation(routeNameFor(to)); // success: name + release hold
                return;
            }

            // A redirect never reaches afterEach (vue-router short-circuits to a new navigation), so any
            // failure here is terminal. `cancelled` (a newer nav superseded this one) keeps the held root
            // for the successor's afterEach; `aborted` / `duplicated` / unknown release it to the current
            // location so a blocked navigation can't strand a held root until the finalTimeout backstop.
            if (failure.type === NAVIGATION_CANCELLED) return;
            inFlight = false;
            nav.settleNavigation(routeNameFor(from));
        }),
    );

    const offError =
        typeof r.onError === 'function'
            ? r.onError(
                  insulate(() => {
                      if (!inFlight) return;
                      inFlight = false;
                      const current = r.currentRoute?.value;
                      nav.settleNavigation(current ? routeNameFor(current) : { name: '', source: 'url' });
                  }),
              )
            : undefined;

    const cleanup = (): void => {
        safeInvoke(offBefore);
        safeInvoke(offAfter);
        safeInvoke(offError);
        safeInvoke(() => nav.unregister());
        instrumented.delete(r);
    };
    instrumented.set(r, cleanup);
    return cleanup;
}
