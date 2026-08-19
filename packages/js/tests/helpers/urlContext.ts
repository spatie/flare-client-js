import type { UrlContext } from '../../src/tracing/httpRequestSpan';

/**
 * A `UrlContext` for tests. `base` defaults to the origin (what a page at the root sees); pass a
 * different one to exercise a sub-path document or a `<base href>`. Pass a function for a base that
 * moves between requests.
 */
export function fixedUrls(origin: string, base: string | (() => string) = origin): UrlContext {
    return { origin, base: typeof base === 'function' ? base : () => base };
}
