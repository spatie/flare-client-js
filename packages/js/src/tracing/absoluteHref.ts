/**
 * Resolve a router-reported href against the page we are on. Returns the `URL`, so a caller that
 * wants the pathname as well as the href does not parse it a second time.
 *
 * Undefined outside a browser or for an unparseable href, so the caller can leave its attribute alone.
 */
export function absoluteUrl(href: string | null | undefined): URL | undefined {
    if (href == null || typeof window === 'undefined') {
        return undefined;
    }
    try {
        return new URL(href, window.location.href);
    } catch {
        return undefined;
    }
}

/**
 * The href form of `absoluteUrl`. Pass one built by the router's own `createHref`/`resolve` (see
 * `resolveHref`), not a bare path: routers strip the app's base path, so `origin + path` yields an
 * address the server does not have.
 */
export function absoluteHref(href: string | null | undefined): string | undefined {
    return absoluteUrl(href)?.href;
}
