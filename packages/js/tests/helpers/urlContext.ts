import type { UrlContext } from '../../src/tracing/requests';

// A `UrlContext` for tests. `base` defaults to the origin; pass a different one for a sub-path
// document or a `<base href>`, or a function for a base that moves between requests.
export function fixedUrls(origin: string, base: string | (() => string) = origin): UrlContext {
    return { origin, base: typeof base === 'function' ? base : () => base };
}
