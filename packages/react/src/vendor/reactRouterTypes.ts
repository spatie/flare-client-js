// Structural subset of React Router's DataRouter (v7 and v8) that the tracing integration reads. Vendored, not
// imported, so this entry needs no runtime dependency and non-RR consumers still type-check cleanly.
// Verified against react-router 7.0.0 (peer floor) and 8.4.0 — recheck if these shapes drift.

export type ReactRouterLocationLike = { pathname: string; search?: string; hash?: string; state?: unknown };
export type ReactRouterRouteLike = { path?: string; index?: boolean; id?: string };
export type ReactRouterMatchLike = {
    route: ReactRouterRouteLike;
    pathname: string;
    params?: Record<string, string | undefined>;
};
export type ReactRouterNavigationLike = {
    state: 'idle' | 'loading' | 'submitting';
    location?: ReactRouterLocationLike;
};
export type ReactRouterStateLike = {
    location: ReactRouterLocationLike;
    matches: ReactRouterMatchLike[];
    navigation: ReactRouterNavigationLike;
    // `initialized` gates the initial-load guard. `historyAction` is deliberately not read: whether
    // to open a root is decided by the change in navigation.state, not by the committed action.
    initialized?: boolean;
};
export type ReactRouterLike = {
    subscribe(cb: (state: ReactRouterStateLike) => void): () => void;
    state: ReactRouterStateLike;
    // Applies the router's `basename` (and, for a hash router, the `#` prefix) to a location.
    // `state.location.pathname` has both stripped. Optional so a hand-built router still types.
    createHref?(location: ReactRouterLocationLike): string;
    // `/` when the router has no basename.
    basename?: string;
};
