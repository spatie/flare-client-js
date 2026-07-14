// Electron-safe entry: NO @flareapp/js root import. The navigation-source seam comes from
// @flareapp/js/browser (side-effect-free). NO runtime dependency on react-router — the router is
// consumed structurally (see ./vendor/reactRouterTypes).
import { registerNavigationSource, type RouteName } from '@flareapp/js/browser';

import type { RRDataRouter, RRLocation, RRMatch, RRRouterState } from './vendor/reactRouterTypes';

/**
 * Reconstruct the parameterized route template (e.g. `/product/:id`) from a resolved match chain
 * by joining each match's declared `route.path`. Returns undefined when nothing usable matched (a
 * URL-name fallback then applies). Ports the substance of Sentry's getNormalizedName, reading the
 * router's already-resolved `state.matches` instead of re-matching.
 */
export function routeNameFromMatches(matches: RRMatch[] | undefined): string | undefined {
    if (!matches || matches.length === 0) return undefined;
    let path = '';
    for (const m of matches) {
        const p = m.route?.path;
        if (!p) continue; // pathless layout route, or an index route's empty contribution
        // An absolute child path resets the accumulator; a relative one appends.
        path = p[0] === '/' ? p : (path.endsWith('/') ? path : path + '/') + p;
    }
    if (!path) return undefined;
    if (path[0] !== '/') path = '/' + path;
    return path.replace(/\/{2,}/g, '/'); // collapse the `//` a '/' root part introduces
}

/**
 * Trace a React Router v7 data router (createBrowserRouter / createHashRouter / createMemoryRouter):
 * name the browser_pageload root from the initial route, and open a parameterized, held
 * browser_navigation root per route change, named once the router settles. Returns a cleanup that
 * unsubscribes and unregisters. Safe to call before or after tracing is enabled; no-ops when off.
 */
export function traceReactRouter(router: RRDataRouter): () => void {
    const nav = registerNavigationSource();

    const routeNameFor = (state: RRRouterState): RouteName => {
        try {
            const name = routeNameFromMatches(state.matches);
            if (name) return { name, source: 'route' };
        } catch {
            // fall through to the URL name
        }
        return { name: state.location.pathname, source: 'url' };
    };

    // Same-origin SPA: reconstruct the destination href for the nav root's url.full. NOTE: for
    // createHashRouter this does not reconstruct the fragment-encoded URL (known limitation).
    const hrefOf = (loc: RRLocation): string => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return origin + (loc.pathname || '') + (loc.search || '') + (loc.hash || '');
    };

    const keyOf = (loc: RRLocation): string => (loc.pathname || '') + (loc.search || '') + (loc.hash || '');

    let sawInitialSettle = false;
    let inFlight = false;
    let lastLocationKey = keyOf(router.state.location);

    // Name (or one-shot re-name, e.g. after an initial-load redirect) the already-running pageload
    // root from a resolved match chain, and track the committed location it now represents.
    const namePageload = (state: RRRouterState): void => {
        lastLocationKey = keyOf(state.location);
        nav.setActiveRouteName(routeNameFor(state));
    };

    // Name the pageload immediately from RR's synchronously-resolved initial matches (RR populates
    // state.matches at router creation, before initialization completes), so pageload naming never
    // depends on a later subscribe firing. `sawInitialSettle` separately gates when we START treating
    // changes as navigations: only once the router reports `initialized`. RR never dispatches a
    // navigation before initialization and always notifies on init completion, so the first
    // `initialized` fire is the settle (possibly after an initial-load redirect), never a navigation.
    try {
        if (router.state.matches.length > 0) namePageload(router.state);
        sawInitialSettle = router.state.initialized === true;
    } catch {
        // never break the host on wiring
    }

    const onState = (state: RRRouterState): void => {
        // Initial-load phase: until RR reports `initialized`, attribute every fire to the pageload
        // root (one-shot correcting its name once matches resolve) and never open a navigation root.
        if (!sawInitialSettle) {
            if (state.matches.length > 0) namePageload(state);
            if (state.initialized) sawInitialSettle = true;
            return;
        }

        const navState = state.navigation.state;

        // Loader navigation: RR publishes a non-idle state (loaders/middleware running) BEFORE the
        // URL commits. Open the root held, timed from now, named at resolve. url from the pending
        // destination so url.full is correct despite RR committing the URL only at resolve.
        if (!inFlight && navState !== 'idle') {
            inFlight = true;
            const dest = state.navigation.location ?? state.location;
            nav.startNavigation({ path: dest.pathname, url: hrefOf(dest), hold: true });
            return;
        }

        // Loader navigation resolved: name from the now-committed matches and release the hold.
        if (inFlight && navState === 'idle') {
            inFlight = false;
            lastLocationKey = keyOf(state.location);
            nav.settleNavigation(routeNameFor(state));
            return;
        }

        // Loader-less navigation: RR short-circuits to completeNavigation with NO loading state
        // (react-router router.ts handleLoaders returns before publishing the loading navigation
        // when nothing shouldLoad), so location + matches commit in one idle fire and no
        // navigation.state transition is seen. Detect it by the committed location changing, and
        // name it immediately (no hold; the normal idle lifecycle captures effect-fired fetches).
        // settleNavigation's releaseHold is a harmless no-op on this un-held root.
        if (!inFlight && navState === 'idle') {
            const locKey = keyOf(state.location);
            if (locKey !== lastLocationKey) {
                lastLocationKey = locKey;
                nav.startNavigation({ path: state.location.pathname, url: hrefOf(state.location) });
                nav.settleNavigation(routeNameFor(state));
            }
        }
        // else (inFlight && non-idle): a redirect / superseding hop -> keep the single held root.
    };

    const unsubscribe = router.subscribe((state) => {
        try {
            onState(state);
        } catch {
            // a tracing error must never escape into the router's state dispatch
        }
    });

    return () => {
        try {
            unsubscribe();
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
