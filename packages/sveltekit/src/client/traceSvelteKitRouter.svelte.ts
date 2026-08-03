import { navigating, page } from '$app/state';
import { flare } from '@flareapp/js';
import {
    insulate,
    registerNavigationSource,
    routeName,
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
function keyOf(url: URL): string {
    return url.pathname + url.search;
}

function routeNameFor(routeId: string | null | undefined, url: URL): RouteName {
    return routeName(() => routeId ?? undefined, url.pathname, url.href);
}

/** Advance the state machine for one observed snapshot. Exported for unit tests; not public API. */
export function syncNavigation(snapshot: NavSnapshot): void {
    if (!nav) {
        return;
    }
    // Kit's pre-hydration `a:` placeholder url. Checked before the tracing gate because it is not a real
    // page: storing it as lastKey would make the next real snapshot look like a navigation.
    if (snapshot.url.origin !== location.origin) {
        return;
    }
    if (!flare.config?.enableTracing) {
        // No settle can arrive while tracing is off, so a set flag would make the next navigation think
        // one was already running.
        inFlight = false;
        // Keep following the page too, or the key goes stale across every navigation made while tracing
        // was off and the first snapshot after it returns looks like a navigation.
        lastKey = keyOf(snapshot.url);
        return;
    }

    const to = snapshot.to;
    if (to) {
        const toRouteId = to.route?.id;
        // The document is about to unload, so the next pageload covers this. Kit derives both of these
        // from the same missing intent, which is why one check does for both.
        if (snapshot.willUnload || toRouteId == null) {
            return;
        }

        if (!inFlight) {
            // Kit reports where it is going before the URL changes, so the destination is known here.
            inFlight = true;
            nav.startNavigation({ path: to.url.pathname, url: to.url.href, hold: true });
        }
        // Set again on every redirect hop: Kit hands each hop a new destination without returning to
        // null in between, so the same root is simply renamed.
        nav.setActiveRouteName(routeNameFor(toRouteId, to.url));
        return;
    }

    if (inFlight) {
        // `page` has caught up: Kit updates it before clearing `navigating`.
        inFlight = false;
        lastKey = keyOf(snapshot.url);
        nav.settleNavigation(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    const key = keyOf(snapshot.url);
    if (key === lastKey) {
        // Names the pageload, and picks up a route id that resolved late.
        nav.setActiveRouteName(routeNameFor(snapshot.routeId, snapshot.url));
        return;
    }

    // The page moved without a navigation being seen. Only reachable if Svelte ever batches the two
    // updates together; the root is still reported, just with no duration.
    lastKey = key;
    nav.startNavigation({ path: snapshot.url.pathname, url: snapshot.url.href });
    nav.settleNavigation(routeNameFor(snapshot.routeId, snapshot.url));
}

/**
 * Trace SvelteKit's client router. Names come from `page.route.id` verbatim (`/product/[id]`). Call once
 * from `hooks.client.ts`, before or after tracing is enabled.
 *
 * Opens no navigation root for shallow routing (`pushState`/`replaceState` from `$app/navigation`),
 * hash-only navigation, navigations a `beforeNavigate` guard cancelled, or navigations to routes Kit does
 * not own, which unload the document so the next pageload covers them.
 */
export function traceSvelteKitRouter(): () => void {
    if (tracing || typeof window === 'undefined') {
        return () => {};
    }
    tracing = true;

    let dispose: (() => void) | undefined;
    let installed = false;
    // hooks.client.ts calls this during module load, so a throw here takes down the whole client rather
    // than just tracing.
    safeInvoke(() => {
        nav = registerNavigationSource();
        inFlight = false;
        lastKey = location.pathname + location.search;
        dispose = startEffect();
        installed = true;
    });

    function stop(): void {
        safeInvoke(dispose);
        safeInvoke(() => nav?.unregister());
        nav = null;
        tracing = false;
    }

    // hooks.client.ts never calls the cleanup, so a half-done install has to undo itself. Left alone it
    // keeps a source registered that observes nothing, which suppresses the built-in History detection
    // for the whole page, and leaves `tracing` latched so nothing can install again.
    if (!installed) {
        stop();
        return () => {};
    }

    return stop;
}

/** The reactive half: one `$effect.root` feeding what it sees to the state machine above. */
function startEffect(): () => void {
    return $effect.root(() => {
        $effect(
            insulate(() =>
                // The reads are deliberately the whole body: Svelte only re-runs an effect for values it
                // saw it read, so an early return above any of these would stop it running again.
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
