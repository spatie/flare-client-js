import {
    absoluteUrl,
    currentPath,
    insulate,
    instrumentOnce,
    registerNavigationSource,
    routeName,
    type RouteName,
    type TrackTeardown,
} from '@flareapp/js/browser';

import type {
    InertiaEventLike,
    InertiaEventName,
    InertiaPageLike,
    InertiaRouterLike,
    InertiaVisitLike,
} from './vendor/inertiaTypes';

/** Resolve a router-reported location (a `URL` on visits, a relative string on pages) to a full href
 *  plus its path. Both are undefined outside a browser or for an unparseable value. */
function locationOf(raw: URL | string | null | undefined): { href?: string; path?: string } {
    if (raw == null) {
        return {};
    }
    const url = absoluteUrl(String(raw));
    if (!url) {
        return {};
    }
    return { href: url.href, path: url.pathname };
}

/** Background work fires the same `start` and `finish` a real visit does, so opening a root for one both
 *  invents a navigation and ends the root that was live. */
function isBackgroundVisit(visit: InertiaVisitLike | undefined): boolean {
    if (!visit) {
        return false;
    }
    if (visit.prefetch) {
        return true;
    }
    // `router.reload()` backs polling, deferred props and infinite scroll, and always reloads the current
    // url with `async: true`. So an async visit that keeps the user on their page is a refresh. Compares
    // the path, not the url, because infinite scroll only changes the query. A deliberate
    // `router.visit(url, { async: true })` to another page still opens a root.
    const { path } = locationOf(visit.url);
    return !!visit.async && path !== undefined && path === currentPath();
}

/** `component` ('Products/Show') is Inertia's route identifier, and there is a small fixed set of them,
 *  so reports group by it the way the other integrations' route templates do. */
function routeNameFor(page: InertiaPageLike | undefined): RouteName {
    const { href, path } = locationOf(page?.url);
    return routeName(() => page?.component, path ?? currentPath(), href);
}

/**
 * Trace an Inertia router: open a held `browser_navigation` root per visit, settled once the page
 * arrives. Call it before Inertia boots, so the initial `navigate` is seen. Returns a cleanup that
 * removes the listeners and unregisters. Does nothing for a non-router value; never throws into the host.
 */
export function traceInertiaRouter(router: unknown): () => void {
    if (!isInertiaRouter(router)) {
        return () => {}; // not a router: do nothing
    }

    return instrumentOnce(router, (track) => install(router, track));
}

function isInertiaRouter(router: unknown): router is InertiaRouterLike {
    return !!router && typeof (router as Partial<InertiaRouterLike>).on === 'function';
}

function install(router: InertiaRouterLike, track: TrackTeardown): void {
    const nav = registerNavigationSource();
    // Tracked first so it unwinds last: releasing the hold has to happen once no listener can open a
    // new root.
    track(() => nav.unregister());

    let inFlight = false;
    let inFlightPath: string | undefined;
    let sawInitial = false;

    // The component name of the page the browser is showing, as far as Inertia has told us. A visit
    // that ends without a page of its own is then named after the page it left the user on, rather
    // than after a raw url like /products/42/comments.
    let lastComponent: { path?: string; name: string } | undefined;

    const nameFor = (page: InertiaPageLike | undefined): RouteName => {
        const route = routeNameFor(page);
        // Only a route-sourced name is worth keeping. A url-sourced one is what we are trying to
        // avoid falling back to in the first place.
        if (route.source === 'route') {
            lastComponent = { path: locationOf(page?.url).path, name: route.name };
        }
        return route;
    };

    const settle = (page: InertiaPageLike | undefined): void => {
        inFlight = false;
        inFlightPath = undefined;
        nav.settleNavigation(nameFor(page));
    };

    // Every listener is tracked as it registers, so a throw from the next `on()` tears down the ones
    // already attached rather than leaving them on a router nothing is tracing any more.
    const on = (event: InertiaEventName, handler: (event: InertiaEventLike) => void): void =>
        track(router.on(event, insulate(handler)));

    on('start', (event: InertiaEventLike) => {
        const visit = event?.detail?.visit;
        if (isBackgroundVisit(visit)) {
            return;
        }
        const { href, path } = locationOf(visit?.url);

        if (inFlight) {
            // The successor of an interrupted visit. Re-point the root the first click opened
            // rather than opening a second one. The name is url-sourced only until the page
            // arrives and settles it under the component name.
            inFlightPath = path;
            nav.setActiveRouteName({ name: path ?? currentPath(), source: 'url', url: href });
            return;
        }

        sawInitial = true;
        inFlight = true;
        inFlightPath = path;
        nav.startNavigation({ path, url: href, hold: true });
    });

    on('navigate', (event: InertiaEventLike) => {
        const page = event?.detail?.page;

        // Deliberately unguarded, unlike `success` and `finish`. A redirected visit (POST /login
        // landing on /dashboard) arrives here with a page url that does not match inFlightPath, and
        // this is the only event carrying that page's component name. Comparing the path would push
        // every redirect onto the `finish` backstop, which has no component name to use and reports
        // a raw url instead.
        if (inFlight) {
            settle(page);
            return;
        }

        // The initial page load fires navigate with no preceding start: page.set() suppresses it
        // (the initial load forces replace), but InitialVisit.handle() fires it directly. The
        // pageload root already covers that window, so name it rather than open a second root.
        if (!sawInitial) {
            sawInitial = true;
            nav.setActiveRouteName(nameFor(page));
            return;
        }

        // Back/forward fires navigate alone, with no start to open the root, so do both here.
        // No hold: there is no pending wait to suppress, and settling in the same tick would
        // force-close a held root at zero duration before any child span could attach.
        const { href, path } = locationOf(page?.url);
        nav.startNavigation({ path, url: href });
        settle(page);
    });

    on('success', (event: InertiaEventLike) => {
        // This is where a same-url visit and a `replace: true` one settle: page.set() fires navigate
        // only when replace is false, and it forces replace for a visit landing on the url it started
        // on. A normal visit already cleared inFlight in navigate, so this is a no-op for those.
        if (!inFlight) {
            return;
        }
        const page = event?.detail?.page;
        // A background reload's success fires on the async stream while a navigation runs on the sync
        // one, so only the response for the page this root opened for may settle it.
        //
        // A visit redirected to a different path also fails this check. `success` carries no visit, so
        // a redirect back to the page the user was on is indistinguishable from a background poll of
        // it. Not a leak: `finish` compares the stable `visit.url` and settles through its backstop.
        if (locationOf(page?.url).path !== inFlightPath) {
            return;
        }
        settle(page);
    });

    /** Whether `visit` is the one that opened the currently held root, i.e. `finish` may settle it. */
    const belongsToThisNavigation = (visit: InertiaVisitLike | undefined): boolean => {
        // Background work fires the same finish a real visit does, and can share the in-flight path: a
        // poll ticks on the page the user is navigating away from, not the one they are heading to.
        if (isBackgroundVisit(visit)) {
            return false;
        }
        // Same stream-crossing problem as success. Must run before the interrupted check: an unreadable
        // visit shape should reach the backstop rather than leave the held root open forever.
        if (visit && locationOf(visit.url).path !== inFlightPath) {
            return false;
        }
        // Inertia only interrupts from inside `visit()`, right before sending the replacement, so a
        // successor `start` is already on its way and can settle this root. `cancelled` has nothing
        // following it, so it deliberately falls through and settles here.
        if (visit?.interrupted) {
            return false;
        }
        return true;
    };

    on('finish', (event: InertiaEventLike) => {
        // An errored, cancelled or non-Inertia response fires neither navigate nor success. Without
        // this the held root stays idle-suppressed until the 30s finalTimeout. Settle to where the
        // browser actually is, since the visit never landed on its destination.
        if (!inFlight) {
            return;
        }
        if (!belongsToThisNavigation(event?.detail?.visit)) {
            return;
        }
        inFlight = false;
        inFlightPath = undefined;
        const { href, path } = locationOf(currentPath());
        // Name it after that page when we know it, which is the usual case for a failed form post:
        // it re-renders the page it was sent from, and we were told that page's name on arrival.
        const known = lastComponent?.path === path ? lastComponent?.name : undefined;
        nav.settleNavigation(routeName(() => known, path ?? currentPath(), href));
    });
}
