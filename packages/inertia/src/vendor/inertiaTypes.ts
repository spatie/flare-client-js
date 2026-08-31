// Minimal duck-typed shapes for Inertia's global event API. Vendored instead of imported, so the
// package carries no @inertiajs/* dependency or release-cadence coupling; only fields the integration
// reads are declared. Mirrors packages/vue/src/vendor/vueRouterTypes.ts.
// Targets Inertia v2's router API. No @inertiajs package is installed here to pin a version — the
// README's Requirements section is the evidence (v1 lacks the prefetch/async flags this needs).

// The page object Inertia ships with every response. `component` is the page component name
// ('Products/Show'), `url` a relative string ('/products/42').
export type InertiaPageLike = {
    component?: string;
    url?: string;
};

// `visit.url` is a `URL` instance in @inertiajs/core; a string is tolerated for older versions.
// `prefetch` and `async` mark a background visit — see `isBackgroundVisit`. `interrupted` and
// `cancelled` come from the visit `finish` carries; only `interrupted` means a successor is on its way.
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
