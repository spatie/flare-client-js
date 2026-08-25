import { absoluteHref } from '../tracing/absoluteHref';
import { fill, unfill } from '../tracing/fill';

export type RouteName = {
    name: string;
    source: 'route' | 'url';
    /** Where the navigation ends. Set on a redirect so the final url is reported; leave out to keep
     *  the url the root opened with. */
    url?: string;
};

export type NavigationSource = {
    startNavigation(opts?: { path?: string; url?: string; hold?: boolean }): void;
    setActiveRouteName(route: RouteName): void;
    settleNavigation(route: RouteName): void;
    unregister(): void;
};

export function currentPath(): string {
    return typeof location !== 'undefined' ? location.pathname : '';
}

// The whole address, query string included
export function currentHref(): string {
    return typeof location !== 'undefined' ? location.href : '';
}

// Prefers the router's route template (`/product/:id`) over the raw path, so all urls of one route
// group together. If `derive` throws, the fallback path is used instead of breaking the app.
export function routeName(derive: () => string | undefined, fallbackPath: string, url?: string): RouteName {
    try {
        const name = derive();
        if (name) {
            return { name, source: 'route', url };
        }
    } catch {}
    return { name: fallbackPath, source: 'url', url };
}

/**
 * `build` is the router's own href builder (vue-router `resolve`, React Router `createHref`). It puts
 * the app's base path and hash prefix back. Without it, an app served from `/app/` reports
 * `/product/p01` instead of `/app/product/p01`. If `build` throws, we use `fallback`.
 */
export function resolveHref(build: () => string | null | undefined, fallbackHref: string): string | undefined {
    let href = fallbackHref;
    try {
        href = build() ?? fallbackHref;
    } catch {
        // no base path, but still a url
    }
    return absoluteHref(href);
}

// Tracing and breadcrumbs both subscribe; neither knows about the other.
export type NavigationSubscriber = {
    /** The url changed and no router is registered. */
    onUrlChanged?(path: string): void;
    onNavigationStart?(opts: { path: string; url?: string; hold?: boolean }): void;
    onRouteName?(route: RouteName, owner: object): void;
    onNavigationSettle?(route: RouteName, owner: object): void;
    onSourceUnregistered?(): void;
};

const subscribers = new Set<NavigationSubscriber>();
let source: object | null = null;
let currentRoute: { route: RouteName; owner: object } | null = null;
let lastPath = '';
let uninstallHistory: (() => void) | null = null;

function broadcast(callback: (subscriber: NavigationSubscriber) => void): void {
    for (const subscriber of subscribers) {
        try {
            callback(subscriber);
        } catch {}
    }
}

function onHistoryChange(): void {
    // If another library wrapped pushState on top of ours, `unfill` cannot remove us and their
    // wrapper keeps calling this after uninstall. `uninstallHistory` is null by then, so do nothing.
    if (!uninstallHistory) {
        return;
    }
    const path = currentPath();
    if (path === lastPath) {
        return;
    }
    lastPath = path;
    // A registered router reports its own navigations; broadcasting here would report each one twice.
    // `lastPath` is still updated above so the change check stays correct.
    if (source) {
        return;
    }
    broadcast((subscriber) => subscriber.onUrlChanged?.(path));
}

function installHistory(): void {
    if (uninstallHistory) {
        return;
    }
    if (typeof window === 'undefined' || typeof history === 'undefined' || typeof location === 'undefined') {
        return;
    }
    lastPath = currentPath();

    function wrapHistoryMethod<F extends (...args: never[]) => unknown>(original: F): F {
        return function (this: unknown, ...args: Parameters<F>): unknown {
            const result = original.apply(this, args);
            onHistoryChange();
            return result;
        } as F;
    }

    fill(history, 'pushState', wrapHistoryMethod);
    fill(history, 'replaceState', wrapHistoryMethod);
    window.addEventListener('popstate', onHistoryChange);

    uninstallHistory = () => {
        unfill(history, 'pushState');
        unfill(history, 'replaceState');
        window.removeEventListener('popstate', onHistoryChange);
    };
}

// The History patch stays while at least one subscriber lives. Counted, so turning tracing off
// cannot remove the patch that breadcrumbs still need.
export function subscribeToNavigation(subscriber: NavigationSubscriber): () => void {
    if (subscribers.size === 0) {
        installHistory();
    }
    subscribers.add(subscriber);

    if (currentRoute) {
        try {
            subscriber.onRouteName?.(currentRoute.route, currentRoute.owner);
        } catch {}
    }

    let removed = false;
    return () => {
        if (removed) {
            return;
        }
        removed = true;
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
            uninstallHistory?.();
            uninstallHistory = null;
            lastPath = '';
        }
    };
}

/**
 * Hands navigation to a framework router: while registered, the built-in History detection stays
 * quiet and the router drives every step through the returned handle. The newest registration wins
 * and a stale handle no-ops, because HMR can replace a router that still holds one.
 */
export function registerNavigationSource(): NavigationSource {
    const token = {};
    if (source) {
        console.debug('Flare: navigation source replaced');
    }
    source = token;
    const active = (): boolean => source === token;

    return {
        startNavigation(opts) {
            if (!active()) {
                return;
            }
            const path = opts?.path ?? currentPath();
            lastPath = path;
            broadcast((subscriber) => subscriber.onNavigationStart?.({ path, url: opts?.url, hold: opts?.hold }));
        },
        setActiveRouteName(route) {
            if (!active()) {
                return;
            }
            currentRoute = { route, owner: token };
            broadcast((subscriber) => subscriber.onRouteName?.(route, token));
        },
        settleNavigation(route) {
            if (!active()) {
                return;
            }
            currentRoute = { route, owner: token };
            broadcast((subscriber) => subscriber.onNavigationSettle?.(route, token));
        },
        unregister() {
            if (!active()) {
                return;
            }
            broadcast((subscriber) => subscriber.onSourceUnregistered?.());
            source = null;
            currentRoute = null;
            lastPath = currentPath();
        },
    };
}

/** A name from an earlier call is only valid while that source is still registered. */
export function isActiveNavigationSource(token: object | null): boolean {
    return token !== null && source === token;
}

// Test helper. The SDK never calls this.
export function resetNavigation(): void {
    uninstallHistory?.();
    uninstallHistory = null;
    subscribers.clear();
    source = null;
    currentRoute = null;
    lastPath = '';
}
