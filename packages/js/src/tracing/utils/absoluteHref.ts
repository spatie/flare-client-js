/**
 * Resolves a router-reported href against the current page. Returns the `URL`, so a caller that also
 * wants the pathname does not have to parse it again.
 *
 * Returns undefined outside a browser or for an unparseable href, so the caller can leave its
 * attribute alone.
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
 * The href form of `absoluteUrl`. Pass a value built by the router's own `createHref`/`resolve`, not
 * a bare path — routers strip the app's base path, so `origin + path` gives an address the server
 * does not have.
 */
export function absoluteHref(href: string | null | undefined): string | undefined {
    return absoluteUrl(href)?.href;
}
