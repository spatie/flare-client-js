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
// oxlint-disable-next-line no-unused-vars
let inFlight = false;
// oxlint-disable-next-line no-unused-vars
let lastKey = '';

// Hash excluded on purpose: Kit's hash navigation reassigns `page.url` without running a real
// navigation, and a hash-keyed comparison would fabricate a root for it.
// oxlint-disable-next-line no-unused-vars
const keyOf = (url: URL): string => url.pathname + url.search;

// oxlint-disable-next-line no-unused-vars
const routeNameFor = (routeId: string | null | undefined, url: URL): RouteName =>
    routeId ? { name: routeId, source: 'route' } : { name: url.pathname, source: 'url' };

/** Advance the state machine for one observed snapshot. Exported for unit tests; not public API. */
export function syncNavigation(snapshot: NavSnapshot): void {
    if (!nav) return;
    if (!flare.config?.enableTracing) return; // branch 0
    if (snapshot.url.origin !== location.origin) return; // branch 1: Kit's `a:` placeholder
    // branches 2-7 arrive in Task 3
}

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
