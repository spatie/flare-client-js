import { absoluteHref } from './absoluteHref';

export type RouteName = {
    name: string;
    source: 'route' | 'url';
    /**
     * Where the navigation is going. When set, the root's `url.full` and `flare.entry_point.value`
     * are updated together with the name, so a navigation that was redirected, or replaced by a
     * newer one, reports the page it ended on rather than the one it opened with. Leave it out to
     * keep the url the root started with.
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
 * Build a `RouteName`, preferring the router's own parameterized template over the raw path so names
 * aggregate per route rather than per url. `derive` runs inside a try: a router that throws on an
 * unresolved match chain falls back to the url name instead of taking the host down.
 */
export function routeName(derive: () => string | undefined, fallbackPath: string, url?: string): RouteName {
    try {
        const name = derive();
        if (name) {
            return { name, source: 'route', url };
        }
    } catch {
        // an unreadable match chain falls back to the url name
    }
    return { name: fallbackPath, source: 'url', url };
}

/**
 * Resolve a router location to a full url. `build` is the router's own href builder (vue-router's
 * `resolve`, React Router's `createHref`), which is what puts the app's base path and hash prefix
 * back on. Without it an app served from `/app/` reports `/product/p01` for the real
 * `/app/product/p01`. A router that throws, or has no builder, still gets a url from `fallback`.
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
