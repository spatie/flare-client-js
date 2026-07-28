/**
 * Resolve a router-reported href against the page we are on. Pass one built by the router's own
 * `createHref`/`resolve` (see `resolveHref`), not a bare path: routers strip the app's base path, so
 * `origin + path` yields an address the server does not have.
 *
 * Undefined outside a browser or for an unparseable href, so the caller can leave its attribute alone.
 */
export function absoluteHref(href: string | null | undefined): string | undefined {
    if (href == null || typeof window === 'undefined') {
        return undefined;
    }
    try {
        return new URL(href, window.location.href).href;
    } catch {
        return undefined;
    }
}
