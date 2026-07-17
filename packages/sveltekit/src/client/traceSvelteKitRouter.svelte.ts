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

// Hash excluded on purpose: Kit's hash navigation reassigns `page.url` without running a real
// navigation, and a hash-keyed comparison would fabricate a root for it.
const keyOf = (url: URL): string => url.pathname + url.search;

const routeNameFor = (routeId: string | null | undefined, url: URL): RouteName =>
    routeId ? { name: routeId, source: 'route' } : { name: url.pathname, source: 'url' };

/** Advance the state machine for one observed snapshot. Exported for unit tests; not public API. */
export function syncNavigation(snapshot: NavSnapshot): void {
    if (!nav) return;
    if (!flare.config?.enableTracing) return; // branch 0
    if (snapshot.url.origin !== location.origin) return; // branch 1: Kit's `a:` placeholder

    const to = snapshot.to;
    if (to) {
        const toRouteId = to.route?.id;
        // branch 2: `willUnload` is `!intent` and `to.route.id` is `intent?.route?.id ?? null`, so
        // these are one condition. The document is about to unload; its pageload will cover it.
        if (snapshot.willUnload || toRouteId == null) return;

        if (!inFlight) {
            // branch 3: Kit emits this BEFORE the URL commits, so pass the destination explicitly.
            inFlight = true;
            nav.startNavigation({ path: to.url.pathname, url: to.url.href, hold: true });
        }
        // branch 3 + 4: re-set across redirect hops, which re-emit without an intervening null.
        nav.setActiveRouteName(routeNameFor(toRouteId, to.url));
        return;
    }

    if (inFlight) {
        // branch 5: `page` is fully committed by now (Kit calls update() at client.js:1941, well
        // before it nulls `navigating` at :2023), so name from the committed route.
        inFlight = false;
        lastKey = keyOf(snapshot.url);
        nav.settleNavigation(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    const key = keyOf(snapshot.url);
    if (key === lastKey) {
        // branch 6: pageload naming, and late-resolving route ids.
        nav.setActiveRouteName(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    // branch 7: the committed location moved with no observed `navigating` emission. Expected to be
    // dead code; it exists so a coalesced effect degrades to an instant root instead of no root.
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

    nav = registerNavigationSource();
    inFlight = false;
    lastKey = location.pathname + location.search;

    const dispose = $effect.root(() => {
        $effect(
            insulate(() =>
                // The reads ARE the body. No control flow here: Svelte tracks dependencies as they
                // are read, so an early return above any read would stop the effect re-running.
                syncNavigation({
                    to: navigating.to,
                    willUnload: navigating.willUnload,
                    routeId: page.route?.id,
                    url: page.url,
                }),
            ),
        );
    });

    return () => {
        safeInvoke(dispose);
        safeInvoke(() => nav?.unregister());
        nav = null;
        tracing = false;
    };
}
