// Structural subset of @tanstack/react-router v1 that the tracing integration
// reads. Vendored (not imported) so this entry needs no runtime dependency on
// the router and non-TanStack consumers of @flareapp/react type-check cleanly.
// Verify against the pinned router version if these shapes drift.

export type TsrLocation = { pathname: string; search: unknown; state?: unknown };
export type TsrNavEvent = { fromLocation?: TsrLocation; toLocation: TsrLocation };
export type TsrMatch = { routeId?: string; fullPath?: string };

export type TsrRouter = {
    subscribe(eventType: 'onBeforeLoad' | 'onResolved', cb: (event: TsrNavEvent) => void): () => void;
    matchRoutes(pathname: string, search: unknown, opts?: { preload?: boolean; throwOnError?: boolean }): TsrMatch[];
    state: { location: TsrLocation };
};
