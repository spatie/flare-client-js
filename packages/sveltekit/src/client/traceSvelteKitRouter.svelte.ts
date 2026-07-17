import { navigating, page } from '$app/state';
import { flare } from '@flareapp/js';
import {
    insulate,
    registerNavigationSource,
    safeInvoke,
    type NavigationSource,
    type RouteName,
} from '@flareapp/js/browser';

/** One observation of Kit's router state. Plain data: no runes, no `$app/state` coupling. */
export type NavSnapshot = {
    to: { url: URL; route?: { id: string | null } } | null;
    willUnload: boolean;
    routeId: string | null | undefined;
    url: URL;
};

let tracing = false;
let nav: NavigationSource | null = null;
let inFlight = false;
let lastKey = '';

// The hash is left out on purpose. A hash change updates `page.url` without a real navigation, so
// including it would open a root for a page that never moved.
const keyOf = (url: URL): string => url.pathname + url.search;

// Every name carries the destination url so the root's url.full is updated together with it. The
// root opens with the first destination, so after a redirect it would otherwise report a page the
// user never landed on.
const routeNameFor = (routeId: string | null | undefined, url: URL): RouteName =>
    routeId ? { name: routeId, source: 'route', url: url.href } : { name: url.pathname, source: 'url', url: url.href };

/** Advance the state machine for one observed snapshot. Exported for unit tests; not public API. */
export function syncNavigation(snapshot: NavSnapshot): void {
    if (!nav) return;
    // Kit's `a:` placeholder url, which it uses before hydration. Its origin is not ours, and it has
    // no pathname. Checked before the tracing gate because it is not a real page: storing it as
    // lastKey would make the next real snapshot look like a navigation.
    if (snapshot.url.origin !== location.origin) return;
    if (!flare.config?.enableTracing) {
        // No settle can arrive while tracing is off, so clear the flag. If it stayed set, the next
        // navigation would think one was already running and open no root.
        inFlight = false;
        // Keep following the current page as well. Otherwise the key goes stale during every
        // navigation made while tracing was off, and the first snapshot after it comes back on looks
        // like a navigation and opens a root for a page that never moved.
        lastKey = keyOf(snapshot.url);
        return;
    }

    const to = snapshot.to;
    if (to) {
        const toRouteId = to.route?.id;
        // The document is about to unload, so the next pageload will cover this. Kit derives both of
        // these from the same missing intent, which is why one check covers both.
        if (snapshot.willUnload || toRouteId == null) return;

        if (!inFlight) {
            // Kit tells us where it is going before the URL changes, so pass the destination along.
            inFlight = true;
            nav.startNavigation({ path: to.url.pathname, url: to.url.href, hold: true });
        }
        // Set again on every hop of a redirect. Kit gives each hop a new destination without going
        // back to null in between, so the same root just gets renamed.
        nav.setActiveRouteName(routeNameFor(toRouteId, to.url));
        return;
    }

    if (inFlight) {
        // `page` has caught up by now: Kit updates it before it clears `navigating`, so name the
        // root from the route we landed on.
        inFlight = false;
        lastKey = keyOf(snapshot.url);
        nav.settleNavigation(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    const key = keyOf(snapshot.url);
    if (key === lastKey) {
        // Naming the pageload, and picking up a route id that resolved late.
        nav.setActiveRouteName(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    // The page moved without us seeing a navigation. This is here so that if Svelte ever runs the
    // two updates together we still report a root, even though it will have no duration.
    lastKey = key;
    nav.startNavigation({ path: snapshot.url.pathname, url: snapshot.url.href });
    nav.settleNavigation(routeNameFor(snapshot.routeId, snapshot.url));
}

/**
 * Trace SvelteKit's client router: name the `browser_pageload` root from the initial route, and open
 * a parameterized, held `browser_navigation` root per client navigation. Names come from
 * `page.route.id` verbatim (e.g. `/product/[id]`). Call once from `hooks.client.ts`. Safe to call
 * before or after tracing is enabled; no-ops when off. Returns a cleanup that disposes the effect and
 * unregisters.
 *
 * No navigation root is opened for: shallow routing (`pushState`/`replaceState` from
 * `$app/navigation`), hash-only navigation, navigations cancelled by a `beforeNavigate` guard, or
 * navigations to routes SvelteKit does not own (those unload the document; the next pageload covers
 * them).
 */
export function traceSvelteKitRouter(): () => void {
    if (tracing || typeof window === 'undefined') return () => {};
    tracing = true;

    let dispose: (() => void) | undefined;
    // hooks.client.ts calls this while the module loads, so a throw here would take down the whole
    // client, not just tracing. The effect body guards itself with `insulate`.
    safeInvoke(() => {
        nav = registerNavigationSource();
        inFlight = false;
        lastKey = location.pathname + location.search;
        dispose = startEffect();
    });

    return () => {
        safeInvoke(dispose);
        safeInvoke(() => nav?.unregister());
        nav = null;
        tracing = false;
    };
}

/** The reactive half: one `$effect.root` feeding what it sees to the state machine above. */
function startEffect(): () => void {
    return $effect.root(() => {
        $effect(
            insulate(() =>
                // The reads are the whole body on purpose. Svelte only re-runs an effect for the
                // values it saw it read, so an early return above any of these would stop it
                // running again.
                syncNavigation({
                    to: navigating.to,
                    willUnload: navigating.willUnload,
                    routeId: page.route?.id,
                    url: page.url,
                }),
            ),
        );
    });
}
