/**
 * Turn a router-reported href into a full URL, resolved against the page we are on.
 *
 * Routers report paths with the app's base path and hash prefix taken off, so building a URL by
 * hand as `origin + path` gives an address the server does not have: a Vue app on `/app/` reports
 * `/product/p01` for the real `/app/product/p01`. Pass the href from the router's own `createHref`
 * or `resolve` instead, which puts the base path and hash back, and this resolves it to a full URL.
 *
 * Returns undefined outside a browser, or when the href cannot be parsed, so a caller can leave the
 * span attribute it would have written alone.
 */
export function absoluteHref(href: string | null | undefined): string | undefined {
    if (href == null || typeof window === 'undefined') return undefined;
    try {
        return new URL(href, window.location.href).href;
    } catch {
        return undefined;
    }
}
