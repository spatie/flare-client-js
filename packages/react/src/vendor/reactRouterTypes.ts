// Structural subset of the React Router v7 DataRouter (createBrowserRouter / createHashRouter /
// createMemoryRouter) that the tracing integration reads. Vendored (not imported) so this entry
// needs no runtime react-router dependency and non-RR consumers of @flareapp/react type-check
// cleanly. Verify against the pinned floor if these shapes drift.

export type RRLocation = { pathname: string; search?: string; hash?: string; state?: unknown };
export type RRRoute = { path?: string; index?: boolean; id?: string };
export type RRMatch = { route: RRRoute; pathname: string; params?: Record<string, string | undefined> };
export type RRNavigation = { state: 'idle' | 'loading' | 'submitting'; location?: RRLocation };
export type RRRouterState = {
    location: RRLocation;
    matches: RRMatch[];
    navigation: RRNavigation;
    // `initialized` gates the initial-load guard. `historyAction` is intentionally NOT read: the
    // open decision keys on the navigation.state transition, not the committed action.
    initialized?: boolean;
};
export type RRDataRouter = {
    subscribe(cb: (state: RRRouterState) => void): () => void;
    state: RRRouterState;
    /**
     * Applies the router's `basename` (and, for a hash router, the `#` prefix) to a location.
     * `state.location.pathname` has both stripped. Optional so a hand-built router still types.
     */
    createHref?(location: RRLocation): string;
};
