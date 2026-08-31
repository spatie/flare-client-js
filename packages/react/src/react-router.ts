// Electron-safe entry: no @flareapp/js root import; the navigation-source seam is side-effect-free.
// No runtime dependency on react-router either — the router is consumed structurally (see ./vendor/reactRouterTypes).
import {
    insulate,
    instrumentOnce,
    registerNavigationSource,
    resolveHref,
    routeName,
    type RouteName,
    type TrackTeardown,
} from '@flareapp/js/browser';

import type {
    ReactRouterLike,
    ReactRouterLocationLike,
    ReactRouterMatchLike,
    ReactRouterStateLike,
} from './vendor/reactRouterTypes';

/**
 * Rebuild the parameterized template (`/product/:id`) by joining each match's declared `route.path`.
 * Follows Sentry's getNormalizedName, but reads the router's already-resolved `state.matches` rather
 * than matching again.
 */
export function routeNameFromMatches(matches: ReactRouterMatchLike[] | undefined): string | undefined {
    if (!matches || matches.length === 0) {
        return undefined;
    }
    let path = '';
    for (const match of matches) {
        const routePath = match.route?.path;
        // pathless layout route, or an index route's empty contribution
        if (!routePath) {
            continue;
        }
        // An absolute child path resets the accumulator; a relative one appends.
        path = routePath[0] === '/' ? routePath : (path.endsWith('/') ? path : path + '/') + routePath;
    }
    if (!path) {
        return undefined;
    }
    if (path[0] !== '/') {
        path = '/' + path;
    }
    return path.replace(/\/{2,}/g, '/'); // collapse the `//` a '/' root part introduces
}

/**
 * Traces a React Router v7 data router: names the `browser_pageload` root from the initial route, then
 * opens a held, parameterized `browser_navigation` root per route change once it settles. Safe to call
 * before/after tracing is enabled, and to call twice (replaces the prior instrumentation).
 */
export function traceReactRouter(router: ReactRouterLike): () => void {
    if (typeof router?.subscribe !== 'function') {
        return () => {}; // not a router: do nothing
    }

    return instrumentOnce(router, (track) => install(router, track));
}

function install(router: ReactRouterLike, track: TrackTeardown): void {
    const nav = registerNavigationSource();
    track(() => nav.unregister()); // tracked first so it unwinds last

    function routeNameFor(state: ReactRouterStateLike): RouteName {
        return routeName(() => routeNameFromMatches(state.matches), state.location.pathname, hrefOf(state.location));
    }

    // `createHref` restores the router's `basename` and turns a hash router's location into the
    // `#`-prefixed URL the address bar shows; `location.pathname` has both stripped.
    function hrefOf(loc: ReactRouterLocationLike): string | undefined {
        return resolveHref(() => router.createHref?.(loc), keyOf(loc));
    }

    function keyOf(loc: ReactRouterLocationLike): string {
        return (loc.pathname || '') + (loc.search || '') + (loc.hash || '');
    }

    let sawInitialSettle = false;
    let inFlight = false;
    let lastLocationKey = keyOf(router.state.location);

    // RR populates state.matches at router creation, before init completes, so the pageload can be named
    // now. `sawInitialSettle` then gates when changes start counting as navigations: RR always notifies
    // on init completion, so the first `initialized` fire is the settle, never a navigation.
    try {
        if (router.state.matches.length > 0) {
            nav.setActiveRouteName(routeNameFor(router.state));
        }
        sawInitialSettle = router.state.initialized === true;
    } catch {
        // never break the host on wiring
    }

    function onState(state: ReactRouterStateLike): void {
        // Until RR reports `initialized`, every fire belongs to the pageload root; open no navigation root.
        if (!sawInitialSettle) {
            // Tracked on every fire, not just ones that produce a name — otherwise an unmatched pre-init
            // fire leaves the key on the starting url, and the next idle fire reads as a spurious change.
            lastLocationKey = keyOf(state.location);
            if (state.matches.length > 0) {
                nav.setActiveRouteName(routeNameFor(state));
            }
            if (state.initialized) {
                sawInitialSettle = true;
            }
            return;
        }

        const navState = state.navigation.state;

        // RR publishes a non-idle state while loaders run, before the URL commits. Hence the pending
        // destination for the url: the committed one is still the page being left.
        if (!inFlight && navState !== 'idle') {
            inFlight = true;
            const destination = state.navigation.location ?? state.location;
            nav.startNavigation({ path: destination.pathname, url: hrefOf(destination), hold: true });
            return;
        }

        // Resolved: the matches have committed, so name from them and release the hold.
        if (inFlight && navState === 'idle') {
            inFlight = false;
            lastLocationKey = keyOf(state.location);
            nav.settleNavigation(routeNameFor(state));
            return;
        }

        // A loader-less navigation never publishes a loading state, so location and matches commit in one
        // idle fire — the changed location is the only signal. No hold needed: normal idle handling still
        // catches fetches fired from effects.
        if (!inFlight && navState === 'idle') {
            const locationKey = keyOf(state.location);
            if (locationKey !== lastLocationKey) {
                lastLocationKey = locationKey;
                nav.startNavigation({ path: state.location.pathname, url: hrefOf(state.location) });
                nav.settleNavigation(routeNameFor(state));
            }
        }
        // else (inFlight && non-idle): a redirect / superseding hop -> keep the single held root.
    }

    // subscribe() itself can throw (a hostile or misbehaving router); instrumentOnce keeps that off
    // the host and drops the registration with it.
    track(router.subscribe(insulate(onState)));
}

export type {
    ReactRouterLike,
    ReactRouterLocationLike,
    ReactRouterMatchLike,
    ReactRouterNavigationLike,
    ReactRouterRouteLike,
    ReactRouterStateLike,
} from './vendor/reactRouterTypes';
