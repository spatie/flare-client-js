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
 *
 * `base` is a value from `normalizeRouteBase`. It goes in front of both the template and the fallback.
 */
export function routeName(derive: () => string | undefined, fallbackPath: string, url?: string, base = ''): RouteName {
    try {
        const name = derive();
        if (name) {
            return { name: joinRouteBase(base, name), source: 'route', url };
        }
    } catch {}
    return { name: joinRouteBase(base, fallbackPath), source: 'url', url };
}

/**
 * Turns a router base into the prefix for a route name: `/app/` gives `/app`, `/shop/?q=1#` gives
 * `/shop/#`, and `/` gives an empty string. The query string is removed, because a route name must
 * not change per visit.
 */
export function normalizeRouteBase(base: string | null | undefined): string {
    if (!base) {
        return '';
    }
    const hashIndex = base.indexOf('#');
    const path = (hashIndex === -1 ? base : base.slice(0, hashIndex)).split('?')[0]!;
    if (hashIndex === -1) {
        return trimTrailingSlashes(path);
    }
    return `${path}#${trimTrailingSlashes(base.slice(hashIndex + 1))}`;
}

/** The base of a hash router: the page path in front of the `#`, then the router's own basename. */
export function hashRouteBase(basename?: string): string {
    return `${currentPath()}#${basename ?? ''}`;
}

/**
 * Removes a router basename from the front of a path. Some routers keep it on the location path
 * (React Router, older TanStack Router), and the base must not be added twice.
 */
export function stripBasename(pathname: string, basename: string | undefined): string {
    const trimmed = basename ? trimTrailingSlashes(basename) : '';
    if (!trimmed || (pathname !== trimmed && !pathname.startsWith(`${trimmed}/`))) {
        return pathname;
    }
    return pathname.slice(trimmed.length) || '/';
}

function joinRouteBase(base: string, name: string): string {
    if (!base) {
        return name;
    }
    return name.startsWith('/') ? base + name : `${base}/${name}`;
}

function trimTrailingSlashes(path: string): string {
    return path.replace(/\/+$/, '');
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
