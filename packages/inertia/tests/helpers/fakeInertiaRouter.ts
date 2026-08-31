import type { InertiaEventLike, InertiaEventName } from '../../src/vendor/inertiaTypes';

type Listener = (event: InertiaEventLike) => void;

export type FakeVisit = { url: string; component?: string };
// The visit flags Inertia stamps on background work and on a visit that did not run to completion.
// All four default to false on a plain visit that succeeds.
export type FakeVisitFlags = {
    prefetch?: boolean;
    async?: boolean;
    interrupted?: boolean;
    cancelled?: boolean;
};

// Stand-in for the Inertia router, driving whole visits rather than exposing a bare `on()`. The event
// sequences below are the ones verified against @inertiajs/core, so a change there is a change to this
// one file rather than to every test that would otherwise hand-fire events.
export type FakeInertiaRouter = {
    on(event: InertiaEventName, callback: Listener): () => void;
    // Fire a single raw event. Escape hatch for orderings the drivers below do not cover.
    emit(event: InertiaEventName, detail: InertiaEventLike['detail']): void;
    // Successful visit: start -> navigate -> success -> finish.
    visit(visit: FakeVisit): void;
    // A successful visit that fires no navigate, so start -> success -> finish. Covers both ways
    // `page.set()` suppresses it: an explicit `replace: true`, and a visit that lands on the url it
    // started on (a form POST re-rendering the current page, a redirect back to where the user was).
    replaceVisit(visit: FakeVisit): void;
    // Errored visit: start -> finish, with neither navigate nor success.
    failedVisit(visit: { url: string }): void;
    // A visit displaced by a newer one. Inertia interrupts the in-flight request from inside
    // `router.visit()`, so the wire order is start -> finish(interrupted) -> start, never two bare
    // starts. The second visit then runs to completion.
    supersededVisit(first: { url: string }, second: FakeVisit): void;
    // A visit whose response redirects, so the page that arrives is not the one the visit asked for.
    // `POST /login` landing the user on `/dashboard` is the canonical Laravel shape. `finish` carries
    // the ORIGINAL visit url: the redirect is followed by the HTTP client and Inertia never rewrites
    // the visit's own params (v1 `finishVisit(this.activeVisit)`, v2 `fireFinishEvent(this.requestParams.all())`).
    redirectedVisit(from: { url: string }, to: FakeVisit): void;
    // Only the `start` of a visit that has not come back yet, for mid-navigation assertions.
    pendingVisit(visit: { url: string }): void;
    // A `<Link prefetch>` click served from the prefetch cache: `navigate` then `success`, with no
    // `start` and no `finish`. Indistinguishable on the wire from a back/forward step, which is why the
    // span opens and settles in the same tick (README: "Prefetched navigations report near-zero duration").
    cachedVisit(visit: FakeVisit): void;
    // A visit cancelled outright (`router.cancelAll`, an `onCancelToken` cancel). No successor follows.
    cancelledVisit(visit: { url: string }): void;
    // A prefetch: start -> finish, `prefetch: true` and `async: true`, and no page is ever set.
    // Inertia fires `start` above its own prefetch branch, so this is indistinguishable from a real
    // visit apart from the flags.
    prefetchVisit(url: string): void;
    // A background refresh of the page we are already on, with `async: true` and the current url:
    // polling, deferred props, infinite scroll, or any other `router.reload()`. Fires start -> success
    // -> finish and no navigate, since the unchanged url makes `page.set()` force `replace`.
    backgroundVisit(visit: FakeVisit): void;
    // A bare `navigate` with no surrounding visit. This is what BOTH the initial page load
    // (InitialVisit.handle) and a back/forward step look like on the wire; they are indistinguishable
    // here, which is exactly why the integration keeps a `sawInitial` flag.
    navigateOnly(visit: FakeVisit): void;
    // Registered listener count, for asserting cleanup. Omit the event for the total.
    listenerCount(event?: InertiaEventName): number;
};

export function createFakeInertiaRouter(): FakeInertiaRouter {
    const listeners = new Map<InertiaEventName, Listener[]>();

    // `on()` and its unsubscribe always replace the array rather than mutate it in place, so the array
    // read here is already immune to a listener (un)subscribing mid-emit — no defensive copy needed.
    const emit: FakeInertiaRouter['emit'] = (event, detail) => {
        for (const listener of listeners.get(event) ?? []) {
            listener({ detail });
        }
    };

    // Both `start` and `finish` carry `{ visit }`. Inertia hands them a URL instance, not a string —
    // building it here keeps the String() conversion in the integration under test, not assumed away.
    const visitDetail = (url: string, flags: FakeVisitFlags = {}) => ({
        visit: {
            url: new URL(url, window.location.href),
            prefetch: false,
            async: false,
            interrupted: false,
            cancelled: false,
            ...flags,
        },
    });
    const pageDetail = ({ url, component }: FakeVisit) => ({ page: { url, component } });

    return {
        on(event, callback) {
            const existing = listeners.get(event) ?? [];
            listeners.set(event, [...existing, callback]);

            return () => {
                listeners.set(
                    event,
                    (listeners.get(event) ?? []).filter((l) => l !== callback),
                );
            };
        },
        emit,
        visit(visit) {
            emit('start', visitDetail(visit.url));
            emit('navigate', pageDetail(visit));
            emit('success', pageDetail(visit));
            emit('finish', visitDetail(visit.url));
        },
        replaceVisit(visit) {
            emit('start', visitDetail(visit.url));
            emit('success', pageDetail(visit));
            emit('finish', visitDetail(visit.url));
        },
        failedVisit(visit) {
            emit('start', visitDetail(visit.url));
            emit('finish', visitDetail(visit.url));
        },
        supersededVisit(first, second) {
            emit('start', visitDetail(first.url));
            emit('finish', visitDetail(first.url, { interrupted: true }));
            emit('start', visitDetail(second.url));
            emit('navigate', pageDetail(second));
            emit('success', pageDetail(second));
            emit('finish', visitDetail(second.url));
        },
        redirectedVisit(from, to) {
            emit('start', visitDetail(from.url));
            emit('navigate', pageDetail(to));
            emit('success', pageDetail(to));
            emit('finish', visitDetail(from.url));
        },
        pendingVisit(visit) {
            emit('start', visitDetail(visit.url));
        },
        cachedVisit(visit) {
            emit('navigate', pageDetail(visit));
            emit('success', pageDetail(visit));
        },
        cancelledVisit(visit) {
            emit('start', visitDetail(visit.url));
            emit('finish', visitDetail(visit.url, { cancelled: true }));
        },
        prefetchVisit(url) {
            const flags = { prefetch: true, async: true };
            emit('start', visitDetail(url, flags));
            emit('finish', visitDetail(url, flags));
        },
        backgroundVisit(visit) {
            emit('start', visitDetail(visit.url, { async: true }));
            emit('success', pageDetail(visit));
            emit('finish', visitDetail(visit.url, { async: true }));
        },
        navigateOnly(visit) {
            emit('navigate', pageDetail(visit));
        },
        listenerCount(event) {
            if (event) {
                return (listeners.get(event) ?? []).length;
            }
            return [...listeners.values()].reduce((total, l) => total + l.length, 0);
        },
    };
}
