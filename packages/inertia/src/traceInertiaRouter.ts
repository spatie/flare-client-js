import { absoluteHref, insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';

import type { InertiaEventLike, InertiaPageLike, InertiaRouterLike, InertiaVisitLike } from './vendor/inertiaTypes';

// Dedup re-instrumentation of the same router. Vite HMR can re-run boot code against a router that
// survives the reload; without this, each cycle appends another listener set that is never removed.
const instrumented = new WeakMap<object, () => void>();

/** Resolve a router-reported location (a `URL` on visits, a relative string on pages) to a full href
 *  plus its path. Both are undefined outside a browser or for an unparseable value. */
function locationOf(raw: URL | string | null | undefined): { href?: string; path?: string } {
    if (raw == null) return {};
    const href = absoluteHref(String(raw));
    if (!href) return {};
    try {
        return { href, path: new URL(href).pathname };
    } catch {
        return { href };
    }
}

const here = (): string => (typeof location !== 'undefined' ? location.pathname : '');

/** True when the visit is Inertia doing background work rather than moving the user to another page.
 *  These fire the same `start` and `finish` a real visit does, and opening a root for one both invents
 *  a navigation and ends the root that was live. */
function isBackgroundVisit(visit: InertiaVisitLike | undefined): boolean {
    if (!visit) return false;
    if (visit.prefetch) return true;
    // `router.reload()` is the shared entry point for polling, deferred props and infinite scroll. It
    // always reloads the current url with `async: true`, so an async visit that does not take the user
    // off the page they are on is a refresh. Infinite scroll only changes the query, which is why this
    // compares the path rather than the whole url. A deliberate `router.visit(url, { async: true })`
    // to a different page still opens a root.
    const { path } = locationOf(visit.url);
    return !!visit.async && path !== undefined && path === here();
}

/** Name a root from the page object. `component` ('Products/Show') is Inertia's low-cardinality route
 *  identifier, so it aggregates the way the other integrations' route templates do. */
function routeNameFor(page: InertiaPageLike | undefined): RouteName {
    const { href, path } = locationOf(page?.url);
    return page?.component
        ? { name: page.component, source: 'route', url: href }
        : { name: path ?? here(), source: 'url', url: href };
}

/**
 * Trace an Inertia router: open a held `browser_navigation` root per visit, settled once the page
 * arrives. Call it before Inertia boots, so the initial `navigate` is seen. Returns a cleanup that
 * removes the listeners and unregisters. Inert for a non-router value; never throws into the host.
 */
export function traceInertiaRouter(router: unknown): () => void {
    const r = router as Partial<InertiaRouterLike> | null;
    if (!r || typeof r.on !== 'function') {
        return () => {}; // wrong shape -> inert
    }

    instrumented.get(r)?.(); // HMR: tear down any prior instrumentation of this same router first

    const nav = registerNavigationSource();

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
        if (route.source === 'route') lastComponent = { path: locationOf(page?.url).path, name: route.name };
        return route;
    };

    const settle = (page: InertiaPageLike | undefined): void => {
        inFlight = false;
        inFlightPath = undefined;
        nav.settleNavigation(nameFor(page));
    };

    const offStart = r.on(
        'start',
        insulate((event: InertiaEventLike) => {
            const visit = event?.detail?.visit;
            if (isBackgroundVisit(visit)) return;
            const { href, path } = locationOf(visit?.url);

            if (inFlight) {
                // The successor of an interrupted visit. Re-point the root the first click opened
                // rather than opening a second one. The name is url-sourced only until the page
                // arrives and settles it under the component name.
                inFlightPath = path;
                nav.setActiveRouteName({ name: path ?? here(), source: 'url', url: href });
                return;
            }

            sawInitial = true;
            inFlight = true;
            inFlightPath = path;
            nav.startNavigation({ path, url: href, hold: true });
        }),
    );

    const offNavigate = r.on(
        'navigate',
        insulate((event: InertiaEventLike) => {
            const page = event?.detail?.page;

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
        }),
    );
    const offSuccess = r.on(
        'success',
        insulate((event: InertiaEventLike) => {
            // page.set() fires navigate only when replace is false, and it forces replace for a visit
            // that lands on the url it started on. So a same-url visit, and one that asked for
            // `replace: true`, both settle here instead. On a normal visit navigate already cleared
            // inFlight and this is a no-op: navigate fires from inside the promise Response.handle()
            // returns, and success fires after that resolves.
            if (!inFlight) return;
            const page = event?.detail?.page;
            // A background reload's success fires on the async stream while a navigation is still
            // running on the sync one. Only the response for the page this root was opened for may
            // settle it here.
            //
            // A visit that redirects to a different path than it requested also fails this check: the
            // `success` detail carries only `page`, no visit, so a redirect back to the page the user
            // was already on is indistinguishable from a background poll of that same page. It is not
            // dropped, `finish` compares the stable `visit.url` instead and settles it through the
            // backstop there.
            //
            // Both sides can be undefined for a url neither side could parse, which compares equal and
            // falls through to settle rather than stall on it. Deliberate, unlike finish's explicit
            // undefined-visit fallthrough below: there is no visit object here to tell a genuinely
            // unreadable page apart from one that is simply missing.
            if (locationOf(page?.url).path !== inFlightPath) return;
            settle(page);
        }),
    );
    /** Whether `visit` is the one that opened the currently held root, i.e. `finish` may settle it. */
    const belongsToThisNavigation = (visit: InertiaVisitLike | undefined): boolean => {
        // Background work (prefetch, poll, deferred props, infinite scroll) fires the same finish a
        // real visit does, and can share the in-flight navigation's path: a poll of the page the user
        // is mid-navigation away from ticks on the path they started from, not the one they are
        // leaving. Without this a background visit that happens to match settles a root it never opened.
        if (isBackgroundVisit(visit)) return false;
        // Same stream-crossing problem as success. Must run before the interrupted check below: a
        // visit shape we cannot read at all falls through to the backstop rather than stranding the
        // held root.
        if (visit && locationOf(visit.url).path !== inFlightPath) return false;
        // A newer visit displaced this one, and Inertia only interrupts from inside `visit()`,
        // immediately before it sends the replacement. So a successor `start` is already on its way:
        // keep the root this visit opened and let the successor settle it. `cancelled` is the opposite
        // case, with nothing following, so it falls through and settles.
        if (visit?.interrupted) return false;
        return true;
    };

    const offFinish = r.on(
        'finish',
        insulate((event: InertiaEventLike) => {
            // An errored, cancelled or non-Inertia response fires neither navigate nor success. Without
            // this the held root stays idle-suppressed until the 30s finalTimeout. Settle to where the
            // browser actually is, since the visit never landed on its destination.
            if (!inFlight) return;
            if (!belongsToThisNavigation(event?.detail?.visit)) return;
            inFlight = false;
            inFlightPath = undefined;
            const { href, path } = locationOf(here());
            // Name it after that page when we know it, which is the usual case for a failed form post:
            // it re-renders the page it was sent from, and we were told that page's name on arrival.
            const known = lastComponent?.path === path ? lastComponent?.name : undefined;
            nav.settleNavigation(
                known
                    ? { name: known, source: 'route', url: href }
                    : { name: path ?? here(), source: 'url', url: href },
            );
        }),
    );

    const cleanup = (): void => {
        safeInvoke(offStart);
        safeInvoke(offNavigate);
        safeInvoke(offSuccess);
        safeInvoke(offFinish);
        safeInvoke(() => nav.unregister());
        if (instrumented.get(r) === cleanup) instrumented.delete(r);
    };
    instrumented.set(r, cleanup);

    return cleanup;
}
