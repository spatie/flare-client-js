// Structural subset of @tanstack/react-router v1 that the tracing integration
// reads. Vendored (not imported) so this entry needs no runtime dependency on
// the router and non-TanStack consumers of @flareapp/react type-check cleanly.
// Verify against the pinned router version if these shapes drift.

// `href` is ParsedLocation.href: pathname + search + hash, WITHOUT the origin (verified against
// @tanstack/react-router 1.170.10). Optional so a caller passing a hand-built location still types.
export type TsrLocation = { pathname: string; search: unknown; href?: string; state?: unknown };
export type TsrNavEvent = { fromLocation?: TsrLocation; toLocation: TsrLocation };
export type TsrMatch = { routeId?: string; fullPath?: string };

export type TsrRouter = {
    subscribe(eventType: 'onBeforeLoad' | 'onResolved', cb: (event: TsrNavEvent) => void): () => void;
    matchRoutes(pathname: string, search: unknown, opts?: { preload?: boolean; throwOnError?: boolean }): TsrMatch[];
    state: { location: TsrLocation };
};
