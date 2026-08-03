// Minimal duck-typed shapes for Inertia's global event API. Vendored rather than imported so the
// package carries no @inertiajs/* dependency and no coupling to Inertia's release cadence. Only the
// fields the integration actually reads are declared. Mirrors packages/vue/src/vendor/vueRouterTypes.ts.
// Read from Inertia v2's router event API. No @inertiajs package is installed anywhere in this repo,
// so there is no lockfile pin for an exact minor/patch; the README's Requirements section is the
// evidence for v2 (v1 lacks the prefetch/async visit flags InertiaVisitLike relies on).

/** The page object Inertia ships with every response. `component` is the page component name
 *  ('Products/Show'), `url` a relative string ('/products/42'). */
export type InertiaPageLike = {
    component?: string;
    url?: string;
};

/** `visit.url` is a `URL` instance in @inertiajs/core. A string is tolerated for older versions.
 *  `prefetch` and `async` are how a background visit gives itself away: see `isBackgroundVisit`.
 *  `interrupted` and `cancelled` are set on the visit `finish` carries, and only the first of the two
 *  means a successor visit is already on its way. */
export type InertiaVisitLike = {
    url?: URL | string;
    prefetch?: boolean;
    async?: boolean;
    interrupted?: boolean;
    cancelled?: boolean;
};

export type InertiaEventLike = {
    detail?: {
        visit?: InertiaVisitLike;
        page?: InertiaPageLike;
    };
};

export type InertiaEventName = 'start' | 'navigate' | 'success' | 'finish';

export type InertiaRouterLike = {
    on(event: InertiaEventName, callback: (event: InertiaEventLike) => void): () => void;
};
