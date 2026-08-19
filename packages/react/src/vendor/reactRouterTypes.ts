// Structural subset of the React Router v7 DataRouter (createBrowserRouter / createHashRouter /
// createMemoryRouter) that the tracing integration reads. Vendored (not imported) so this entry
// needs no runtime react-router dependency and non-RR consumers of @flareapp/react type-check
// cleanly. Read from react-router 7.x (installed 7.18.1, peer floor >=7.0.0 <8); verify against
// that floor if these shapes drift.

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
    /**
     * Applies the router's `basename` (and, for a hash router, the `#` prefix) to a location.
     * `state.location.pathname` has both stripped. Optional so a hand-built router still types.
     */
    createHref?(location: ReactRouterLocationLike): string;
};
