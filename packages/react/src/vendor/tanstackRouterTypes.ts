// Structural subset of @tanstack/react-router v1 that the tracing integration
// reads. Vendored (not imported) so this entry needs no runtime dependency on
// the router and non-TanStack consumers of @flareapp/react type-check cleanly.
// Read from @tanstack/react-router 1.x (installed 1.170.10, peer floor
// >=1.64.0 <2); verify against that floor if these shapes drift.

// `href` is ParsedLocation.href: pathname + search + hash, without the origin. A `basepath` is
// applied as a rewrite, so it is stripped from `href` but kept on `publicHref`, which is the one
// that matches the address bar. TanStack marks publicHref internal, so treat it as optional and
// fall back to `href`; the fallback loses the basepath, which is what we did before it existed.
// Both are optional so a caller passing a hand-built location still types.
export type TanStackLocationLike = {
    pathname: string;
    search: unknown;
    href?: string;
    publicHref?: string;
    state?: unknown;
};
// `hrefChanged` is optional here and required upstream: these events are hand-built in the suite, and a
// consumer on an older router version may not send it.
export type TanStackNavEventLike = {
    fromLocation?: TanStackLocationLike;
    toLocation: TanStackLocationLike;
    hrefChanged?: boolean;
};
export type TanStackMatchLike = { routeId?: string; fullPath?: string };

export type TanStackRouterLike = {
    subscribe(eventType: 'onBeforeLoad' | 'onResolved', cb: (event: TanStackNavEventLike) => void): () => void;
    matchRoutes(
        pathname: string,
        search: unknown,
        opts?: { preload?: boolean; throwOnError?: boolean },
    ): TanStackMatchLike[];
    state: { location: TanStackLocationLike };
};
