// Structural subset of vue-router the tracing integration reads. Vendored (not imported) so this needs
// no runtime vue-router dependency and non-router consumers of @flareapp/vue type-check cleanly. Verify
// against the peer floor (vue-router 4.0.0) if these shapes drift.

export type VueRouteLocationLike = {
    path: string;
    fullPath?: string;
    matched?: { path?: string }[];
};

/** Truthy = a NavigationFailure; `.type` is a numeric ErrorTypes value (ABORTED 4 / CANCELLED 8 / DUPLICATED 16). */
export type NavigationFailureLike = { type?: number } | undefined;

export type VueRouterLike = {
    currentRoute?: { value?: VueRouteLocationLike };
    /**
     * `href` here already has the app's base path (or `#` prefix) applied, which `fullPath` does
     * not. Optional because a caller can pass any router-shaped object; we fall back to `fullPath`.
     */
    resolve?(to: string): { href?: string };
    beforeEach(guard: (to: VueRouteLocationLike, from: VueRouteLocationLike) => unknown): () => void;
    afterEach(
        guard: (to: VueRouteLocationLike, from: VueRouteLocationLike, failure?: NavigationFailureLike) => unknown,
    ): () => void;
    onError(handler: (error: unknown, to?: VueRouteLocationLike, from?: VueRouteLocationLike) => unknown): () => void;
};
