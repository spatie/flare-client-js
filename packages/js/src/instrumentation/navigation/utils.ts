import { absoluteHref } from '../../tracing/utils/absoluteHref';
import type { RouteName } from './types';

export function currentPath(): string {
    return typeof location !== 'undefined' ? location.pathname : '';
}

/** The whole address, query string included. */
export function currentHref(): string {
    return typeof location !== 'undefined' ? location.href : '';
}

/**
 * Prefers the router's route template (`/product/:id`) over the raw path, so all urls of one route
 * group together. If `derive` throws, the fallback path is used instead of breaking the app.
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
 * `build` is the router's own href builder (vue-router `resolve`, React Router `createHref`). It restores
 * the app's base path and hash prefix, so an app served from `/app/` reports `/app/product/p01` instead
 * of `/product/p01`. Falls back to `fallbackHref` if `build` throws.
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
