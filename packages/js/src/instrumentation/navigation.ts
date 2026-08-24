import { absoluteHref } from '../tracing/absoluteHref';
import { fill, unfill } from '../tracing/fill';

export type RouteName = {
    name: string;
    source: 'route' | 'url';
    /**
     * Where the navigation is going. Re-stamps the root's `url.full` alongside the name, so a redirected
     * or superseded navigation reports where it ended rather than where it opened. Omit to keep the url
     * the root started with.
     */
    url?: string;
};

export type NavigationSource = {
    startNavigation(opts?: { path?: string; url?: string; hold?: boolean }): void;
    setActiveRouteName(route: RouteName): void;
    settleNavigation(route: RouteName): void;
    unregister(): void;
};

/** The path the address bar is on, or '' outside a browser. */
export function currentPath(): string {
    return typeof location !== 'undefined' ? location.pathname : '';
}

/**
 * Prefers the router's parameterized template over the raw path, so names aggregate per route rather
 * than per url. `derive` runs inside a try: a router that throws on an unresolved match chain falls back
 * to the url name instead of taking the host down.
 */
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
 * `build` is the router's own href builder (vue-router's `resolve`, React Router's `createHref`), which
 * is what puts the app's base path and hash prefix back on. Without it an app served from `/app/` reports
 * `/product/p01` for the real `/app/product/p01`. A router that throws still gets a url from `fallback`.
 */
export function resolveHref(build: () => string | null | undefined, fallback: string): string | undefined {
    let href = fallback;
    try {
        href = build() ?? fallback;
    } catch {
        // no base path, but still a url
    }
    return absoluteHref(href);
}

/**
 * What a subscriber hears. Tracing listens to open and name its roots. Breadcrumbs listen to record
 * a route change. Neither one knows about the other.
 */
export type NavigationSubscriber = {
    /** The browser changed the URL and no router drives navigation. */
    onUrlChanged?(path: string): void;
    onNavigationStart?(opts: { path: string; url?: string; hold?: boolean }): void;
    onRouteName?(route: RouteName, owner: object): void;
    onNavigationSettle?(route: RouteName, owner: object): void;
    onSourceUnregistered?(): void;
};

const subscribers = new Set<NavigationSubscriber>();
let source: object | null = null;
// The route a source named most recently. A router integration usually starts before the feature that
// wants the name, so a new subscriber hears this one straight away.
let currentRoute: { route: RouteName; owner: object } | null = null;
let lastPath = '';
let uninstallHistory: (() => void) | null = null;
let consumers = 0;

function broadcast(tell: (subscriber: NavigationSubscriber) => void): void {
    for (const subscriber of subscribers) {
        try {
            tell(subscriber);
        } catch {}
    }
}

function onHistoryChange(): void {
    // Another library can wrap pushState on top of ours. Then `unfill` cannot restore it and this
    // function stays in the chain. `uninstallHistory` is also our installed flag, so it does nothing.
    if (!uninstallHistory) {
        return;
    }
    const path = currentPath();
    if (path === lastPath) {
        return;
    }
    lastPath = path;
    // A router drives navigation itself. We only keep `lastPath` current, and tell nobody.
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

/**
 * Add one subscriber, and patch the History API while at least one is listening.
 *
 * We count the subscribers. Without that count, tracing turned off at runtime would remove the patch
 * that breadcrumbs still need.
 */
export function addNavigationConsumer(subscriber: NavigationSubscriber): () => void {
    if (consumers === 0) {
        installHistory();
    }
    consumers++;
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
        consumers--;
        if (consumers === 0) {
            uninstallHistory?.();
            uninstallHistory = null;
            lastPath = '';
        }
    };
}

/**
 * A framework router takes over navigation. While it is registered, our own History detection tells
 * nobody, and the router drives every step through the handle it gets back.
 *
 * The newest registration wins, and an old handle does nothing. Vite HMR can replace a router while
 * the old one still holds a handle.
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

/** A name a source handed over earlier is only still valid while that source is registered. */
export function isActiveNavigationSource(token: object | null): boolean {
    return token !== null && source === token;
}

// This is a helper function for use in the test suite only.
// The SDK never calls this.
export function resetNavigation(): void {
    uninstallHistory?.();
    uninstallHistory = null;
    subscribers.clear();
    source = null;
    currentRoute = null;
    lastPath = '';
    consumers = 0;
}
