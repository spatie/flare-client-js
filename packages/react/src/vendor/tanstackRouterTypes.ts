// Structural subset of @tanstack/react-router v1 that the tracing integration
// reads. Vendored (not imported) so this entry needs no runtime dependency on
// the router and non-TanStack consumers of @flareapp/react type-check cleanly.
// Verify against the pinned router version if these shapes drift.

// `href` is ParsedLocation.href: pathname + search + hash, without the origin. A `basepath` is
// applied as a rewrite, so it is stripped from `href` but kept on `publicHref`, which is the one
// that matches the address bar. TanStack marks publicHref internal, so treat it as optional and
// fall back to `href`; the fallback loses the basepath, which is what we did before it existed.
// Both are optional so a caller passing a hand-built location still types.
export type TsrLocation = {
    pathname: string;
    search: unknown;
    href?: string;
    publicHref?: string;
    state?: unknown;
};
export type TsrNavEvent = { fromLocation?: TsrLocation; toLocation: TsrLocation };
export type TsrMatch = { routeId?: string; fullPath?: string };

export type TsrRouter = {
    subscribe(eventType: 'onBeforeLoad' | 'onResolved', cb: (event: TsrNavEvent) => void): () => void;
    matchRoutes(pathname: string, search: unknown, opts?: { preload?: boolean; throwOnError?: boolean }): TsrMatch[];
    state: { location: TsrLocation };
};
