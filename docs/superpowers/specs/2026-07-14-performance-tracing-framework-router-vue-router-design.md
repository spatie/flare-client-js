# Spec: performance tracing — framework router integration, Vue Router (vue-router 4/5)

## Context

Flare's browser performance tracing already emits `browser_pageload` and `browser_navigation` root
spans, plus nested `browser_fetch` / `browser_xhr` spans. Framework router integrations replace the
generic URL-based span name (`/product/p01`) with the parameterized route template (`/product/:id`)
and set a `flare.route.source` attribute (`route` vs `url`). Two such integrations have shipped:

- `@flareapp/react/tanstack-router` — `traceTanStackRouter(router)` (PR #69).
- `@flareapp/react/react-router` — `traceReactRouter(router)` (PR #72).

Both build on the **navigation-source seam** in `@flareapp/js` (exported from `@flareapp/js/browser`
as `registerNavigationSource()`), which lets an integration drive navigation instead of the built-in
History-API detection. The seam already carries everything a router whose events fire _before_ the URL
commits needs — added for React Router:

- `startNavigation({ path, url?, hold? })` — `url` overrides the nav root's `url.full` (React Router,
  and now vue-router, resolve the destination before the browser URL commits); `hold` opens the root
  idle-suppressed.
- `settleNavigation(route)` — names the root and releases the hold.
- `setActiveRouteName(route)` — (re)names the active root + `flare.route.source` in lockstep.
- `unregister()` — releases any hold and hands navigation back to the built-in detection.

This slice adds the **vue-router** integration. It assumes consumers use `vue-router` (the official
router) — no other Vue routing library is targeted.

Reference: Sentry's `@sentry/vue` `instrumentVueRouter` (`router.beforeEach` + `router.onError`,
naming from `to.matched[last].path`) guided the approach; the surface and semantics are adapted to
Flare's seam and conventions.

## Approved decisions driving this spec

1. **Scope: router tracing only.** Vue component profiling (the analog to `@flareapp/react/profiler`,
   a Sentry-style global mixin) is a separate follow-up spec, not part of this slice.
2. **Wiring: Vue-idiomatic plugin option.** `app.use(flareVue, { router })`. This is the canonical Vue
   plugin convention (router passed as a plugin option) and adds zero new exported API. It is
   behaviorally identical to the React `trace*Router` calls underneath. The standalone-function surface
   (`traceVueRouter(router)`) was rejected as the _least_ Vue-idiomatic option — it copies a React idiom
   Vue has no precedent for. Sentry's separate-init surface maps to Flare's existing `initFlare()`, so a
   second init-style API would be redundant.
3. **Route naming: parameterized path.** `to.matched[last].path` → `{ source: 'route' }`, falling back
   to `to.path` → `{ source: 'url' }`. Matches the React/TanStack slices exactly and the backend's
   cross-framework parameterized-route aggregation. No `routeLabel: 'name' | 'path'` toggle and no
   named-route (`custom`) source for v1 — route names are optional and would fragment aggregation.
4. **One additive `@flareapp/js` change: shared instrumentation guards.** No nav-seam behavior
   changes (`hold` + `url` + `settleNavigation` already exist). The slice does add two pure helpers
   (`insulate`, `safeInvoke`) to the side-effect-free `@flareapp/js/browser` barrel and converts the
   existing React integrations onto them, collapsing three near-duplicate try/catch wrappers into one
   definition (see Component 0). Land that as a small standalone step first; the vue slice then
   consumes it. Beyond that, this slice touches only `@flareapp/vue`, the Vue playground, and the e2e
   suite.

## vue-router lifecycle facts (verified against source)

Verified against `vuejs/router` `packages/router/src/router.ts` + `errors.ts` and the docs:

- `beforeEach(to, from)` fires **before** the URL commits and before `currentRoute` updates. `to.matched`
  is already resolved (the matcher runs before guards), so `to.matched[last].path` and `to.fullPath` are
  available here. In vue-router 4/5, each matched record's `path` is the **full absolute** template
  (`/user/:id/profile` for a nested route), so no chain-joining is needed (unlike React Router). Sentry
  reads `to.matched[last].path` directly, confirming this.
- `afterEach(to, from, failure)` fires **after** the navigation is confirmed. Third arg is the
  `NavigationFailure` (undefined on success). Documented analytics pattern: `if (!failure) …`.
- A **redirect** (`beforeEach` returns a location, or a route `redirect`) does **not** fire `afterEach`
  for the original navigation — vue-router's `pushWithRedirect` short-circuits and starts a new
  navigation (new `beforeEach`, same `from`). `triggerAfterEach` is reached only for a **success** or a
  **terminal failure**.
- `ErrorTypes` (the numeric `failure.type`): `NAVIGATION_ABORTED = 4`, `NAVIGATION_CANCELLED = 8`,
  `NAVIGATION_DUPLICATED = 16`. `cancelled` means a newer navigation superseded this one (a successor
  will fire its own `afterEach`); `aborted` (guard returned `false`) and `duplicated` are terminal with
  no successor.
- `router.onError((error, to, from) => …)` fires for uncaught errors thrown in guards / during resolve.
- Initial navigation: `from` is `START_LOCATION`, whose `matched` is `[]`. The initial navigation is
  async, so at plugin-install time `router.currentRoute.value` is usually still `START_LOCATION`.
- `beforeEach` / `afterEach` / `onError` each return an unregister function.

## Components

### 0. `packages/js/src/tracing/instrumentationGuard.ts` (new — prerequisite refactor)

Two pure, environment-agnostic helpers, exported from the side-effect-free `@flareapp/js/browser`
barrel (so the Electron-safety / entry-test guarantees are unaffected). They replace three
near-duplicate copies of the same "instrumentation must never throw into the host" idea: the generic
`guard` HOF this slice would otherwise define locally, the monomorphic `guard` in
`@flareapp/react/tanstack-router`, and the inline `try/catch` in `@flareapp/react/react-router`.

```ts
/** Wrap a host-invoked callback (router guard / store subscriber) so a tracing throw can never escape
 *  into the host's dispatch. A thrown callback resolves to `undefined`. */
export function insulate<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
    return (...a: A): void => {
        try {
            fn(...a);
        } catch {
            // instrumentation never breaks the host
        }
    };
}

/** Invoke a teardown fn now (if present), swallowing any throw. For cleanup chains. */
export function safeInvoke(fn: (() => void) | null | undefined): void {
    try {
        fn?.();
    } catch {
        // ignore
    }
}
```

Land this as a small standalone step (js barrel + the two React call sites) **before** the vue slice,
so the vue integration consumes it rather than introducing a fourth copy. Conversion notes:

- `react-router` converges cleanly: `router.subscribe(insulate(onState))` — `onState` is already a
  named, typed function, so no annotation is needed.
- `tanstack-router` costs two explicit `(e: TsrNavEvent)` param annotations: the generic helper can't
  infer the event type from `router.subscribe`'s context, where the discarded monomorphic local `guard`
  typed it for free.
- All cleanup blocks collapse to `safeInvoke(off)` calls; `safeInvoke(() => nav.unregister())` wraps the
  seam call in an arrow so the method keeps its binding (no detached-`this` reliance).

### 1. `packages/vue/src/vendor/vueRouterTypes.ts` (new)

Structural subset of the router the integration reads. Vendored (not imported) so this integration needs
no runtime `vue-router` dependency and the shapes are pinned. Same discipline as
`packages/vue/src/getRouteContext.ts` (which already reads the router structurally) and the React vendor
types.

```ts
export type VueRouteLocationLike = {
    path: string;
    fullPath?: string;
    matched?: { path?: string }[];
};

/** Truthy = a NavigationFailure; `.type` is a numeric ErrorTypes value. */
export type NavigationFailureLike = { type?: number } | undefined;

export type VueRouterLike = {
    currentRoute?: { value?: VueRouteLocationLike };
    beforeEach(guard: (to: VueRouteLocationLike, from: VueRouteLocationLike) => unknown): () => void;
    afterEach(
        guard: (to: VueRouteLocationLike, from: VueRouteLocationLike, failure?: NavigationFailureLike) => unknown,
    ): () => void;
    onError(handler: (error: unknown, to?: VueRouteLocationLike, from?: VueRouteLocationLike) => unknown): () => void;
};
```

### 2. `packages/vue/src/traceVueRouter.ts` (new, internal)

The whole integration. Imports `registerNavigationSource` + `RouteName` and the shared `insulate` /
`safeInvoke` guards (Component 0) from `@flareapp/js/browser` (side-effect-free → Electron-safe;
`flareVue.ts` already imports from that barrel via `resolveFlare`). **Not exported** from `index.ts` /
`inject.ts` — the only public surface is the plugin option. Accepts `unknown` and narrows defensively (checks `beforeEach`/`afterEach` are functions),
returning a no-op cleanup if the shape is wrong, so a shimmed/absent router never throws.

Numeric failure-type constants are defined locally (`NAVIGATION_CANCELLED = 8`) rather than imported, to
avoid a runtime `vue-router` dependency.

```ts
import { insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';
import type { NavigationFailureLike, VueRouteLocationLike, VueRouterLike } from './vendor/vueRouterTypes';

const NAVIGATION_CANCELLED = 8; // ErrorTypes.NAVIGATION_CANCELLED — a newer nav superseded this one

// Dedup re-instrumentation of the same router. Vite HMR re-runs plugin install against a persistent
// router; without this each cycle appends another guard triple that is never removed (inert, since the
// superseded nav source no-ops, but an unbounded accumulation on a long-lived router). Keyed on the
// router object, so a genuinely new router is unaffected.
const instrumented = new WeakMap<object, () => void>();

export function traceVueRouter(router: unknown): () => void {
    const r = router as Partial<VueRouterLike> | null;
    if (!r || typeof r.beforeEach !== 'function' || typeof r.afterEach !== 'function') {
        return () => {}; // wrong shape → inert
    }

    instrumented.get(r)?.(); // HMR: tear down any prior instrumentation of this same router first

    const nav = registerNavigationSource();

    const routeNameFor = (loc: VueRouteLocationLike): RouteName => {
        try {
            const matched = loc.matched;
            const template = matched && matched.length > 0 ? matched[matched.length - 1]?.path : undefined;
            if (template) return { name: template, source: 'route' };
        } catch {
            // fall through to the URL name
        }
        return { name: loc.path, source: 'url' };
    };

    const hrefOf = (loc: VueRouteLocationLike): string => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        return origin + (loc.fullPath ?? loc.path ?? '');
    };

    const isInitial = (from: VueRouteLocationLike | undefined): boolean =>
        !from || !from.matched || from.matched.length === 0; // START_LOCATION

    let sawInitial = false;
    let inFlight = false;

    // Enrich the pageload root immediately if the router already resolved its initial route
    // (e.g. flareVue installed after `await router.isReady()`); otherwise the first guard pair handles it.
    try {
        const current = r.currentRoute?.value;
        if (current && current.matched && current.matched.length > 0) {
            nav.setActiveRouteName(routeNameFor(current));
            sawInitial = true;
        }
    } catch {
        // never break the host on wiring
    }

    const offBefore = r.beforeEach(
        insulate((to: VueRouteLocationLike, from: VueRouteLocationLike) => {
            // Initial navigation first: START_LOCATION.fullPath is '/', so an app whose initial route is
            // '/' would otherwise be swallowed by the same-location skip below.
            if (!sawInitial && isInitial(from)) {
                nav.setActiveRouteName(routeNameFor(to)); // name the pageload root; open no nav root
                return;
            }

            // Only a `force: true` re-navigation reaches beforeEach with to.fullPath === from.fullPath: a
            // plain duplicated nav is short-circuited before guards run and surfaces solely as an afterEach
            // failure (type 16, dropped by the !inFlight guard there). Skip it so a same-URL refresh opens
            // no navigation root.
            if (to.fullPath && from?.fullPath && to.fullPath === from.fullPath) return;

            if (!inFlight) {
                inFlight = true;
                nav.startNavigation({ path: to.path, url: hrefOf(to), hold: true });
            }
            nav.setActiveRouteName(routeNameFor(to)); // set / re-set across redirect hops
        }),
    );

    const offAfter = r.afterEach(
        insulate((to: VueRouteLocationLike, from: VueRouteLocationLike, failure?: NavigationFailureLike) => {
            if (!sawInitial && isInitial(from)) {
                if (!failure) {
                    sawInitial = true;
                    nav.setActiveRouteName(routeNameFor(to)); // finalize pageload name
                }
                return;
            }

            if (!inFlight) return;

            if (!failure) {
                inFlight = false;
                nav.settleNavigation(routeNameFor(to)); // success: name + release hold
                return;
            }

            // A redirect never reaches afterEach (vue-router short-circuits to a new navigation), so any
            // failure here is terminal. `cancelled` (a newer nav superseded this one) keeps the held root
            // for the successor's afterEach; `aborted` / `duplicated` / unknown release it to the current
            // location so a blocked navigation can't strand a held root until the finalTimeout backstop.
            if (failure.type === NAVIGATION_CANCELLED) return;
            inFlight = false;
            nav.settleNavigation(routeNameFor(from));
        }),
    );

    const offError =
        typeof r.onError === 'function'
            ? r.onError(
                  insulate(() => {
                      if (!inFlight) return;
                      inFlight = false;
                      const current = r.currentRoute?.value;
                      nav.settleNavigation(current ? routeNameFor(current) : { name: '', source: 'url' });
                  }),
              )
            : undefined;

    const cleanup = (): void => {
        safeInvoke(offBefore);
        safeInvoke(offAfter);
        safeInvoke(offError);
        safeInvoke(() => nav.unregister());
        instrumented.delete(r);
    };
    instrumented.set(r, cleanup);
    return cleanup;
}
```

### 3. `packages/vue/src/flareVue.ts` (edit) + `types.ts` (edit)

- `FlareVueOptions` gains `router?: unknown` (documented: a vue-router Router instance; enables
  navigation/pageload performance tracing).
- In `flareVue` install, after identity tagging and near the end of install, wire tracing:

    ```ts
    if (options?.router) {
        try {
            traceVueRouter(options.router);
        } catch {
            // never break plugin install
        }
    }
    ```

    Install is already idempotent per app (`installedApps` WeakSet), so router tracing is wired at most
    once per app. `flareVue` still discards the returned cleanup (Vue has no plugin-uninstall hook), but
    `traceVueRouter` self-dedups per router instance (module-level `WeakMap`, Component 2): an HMR re-init
    against a persistent router tears down the prior guard triple before re-registering, so guards can't
    accumulate. The nav source stays last-wins as a second line of defense. (The dedup is effective when
    the cached `@flareapp/vue` module survives the HMR update, as Vite's pre-bundled deps normally do; a
    full module re-eval resets the map, which is harmless.)

## Trace model for this slice

- **Pageload** (`browser_pageload`, opened by `startBrowserTracing` at `initFlare()`, before the app
  mounts): named from the initial vue-router navigation. `registerNavigationSource()` (called during
  plugin install) suppresses the built-in History detection so client navigations don't double-open roots.
- **Navigation** (`browser_navigation`): opened **held** in `beforeEach` (timed from navigation start,
  `url.full` from the destination `to.fullPath`), settled in `afterEach`. Nested `browser_fetch` /
  `browser_xhr` spans from guard-based or component-mount data loading attach to the held root; the idle
  lifecycle closes it after the last child settles.
- **Blocked / aborted navigations still emit a short navigation span.** `beforeEach` is vue-router's
  earliest hook and cannot know a later guard will abort, so the held root — and the `endNow()` of the
  prior root — is committed before any abort is known. An aborted navigation therefore ends the prior
  root and emits a brief `browser_navigation` span named after `from` (where the user stayed). This is
  inherent to a `beforeEach`-timed integration and matches `@sentry/vue`; accepted rather than worked
  around, since opening the root only in `afterEach` would lose navigation-start timing and drop in-guard
  fetches. Aborting guards are uncommon (mostly "unsaved changes" prompts), so the noise is bounded.

## Route name & attributes

`routeNameFor` sets, via the seam's `setActiveRouteName` / `settleNavigation`, the root's `name`,
`flare.entry_point.handler.identifier`, and `flare.route.source` in lockstep (handled inside the seam's
`applyRouteName`). Primary: `to.matched[last].path` (`route`). Fallback: `to.path` (`url`). No per-param
or per-query span attributes (Sentry stamps them; excluded here to match the React slices and avoid PII
given the codebase's redaction posture).

## Error handling

- Every guard body is wrapped with the shared `insulate` helper (Component 0) so a tracing error is
  swallowed and never escapes into vue-router's navigation dispatch (a thrown guard would otherwise
  abort the user's navigation).
- `router.onError` releases the hold so a guard exception mid-navigation cannot strand a held root.
- A wrong-shaped / absent router makes `traceVueRouter` inert (no-op cleanup), never a throw.
- `traceVueRouter` is invoked inside a try/catch in `flareVue` install, so wiring can never break the
  plugin.

## Testing

Mirror the React `*.integration.test.ts` / `*.entry.test.ts` split.

- `packages/vue/tests/vue-router.test.ts` — mock `@flareapp/js/browser`'s `registerNavigationSource` to
  a spy object (`startNavigation` / `setActiveRouteName` / `settleNavigation` / `unregister` spies); drive
  a fake router (object exposing `beforeEach`/`afterEach`/`onError` that capture the guards + a mutable
  `currentRoute`). Assert the seam-call sequence for:
    - initial load → `setActiveRouteName` names the pageload from the initial route (source `route`); no
      `startNavigation`.
    - client nav → one `startNavigation({ hold: true })` with `url` = origin + `to.fullPath`; `settleNavigation`
      with `{ name: '/product/:id', source: 'route' }`.
    - unmatched route (`matched: []`) → `{ source: 'url' }`, name = `to.path`.
    - force same-location re-nav (`beforeEach` fires with `to.fullPath === from.fullPath`) → skipped: no
      `startNavigation`, no span.
    - plain duplicated nav (no `beforeEach`; `afterEach` with `failure.type === 16`) → dropped by the
      `!inFlight` guard: no span. (Distinct from the force case above — a non-force duplicate never runs
      guards.)
    - guard-returned redirect (two `beforeEach`: original + target, one successful `afterEach`) → one
      `startNavigation`, one `settleNavigation` named the final target.
    - route-config redirect (one `beforeEach`: target only, since vue-router short-circuits before guards
      for the original; one successful `afterEach`) → one `startNavigation`, one `settleNavigation` named
      the final target.
    - `cancelled` (type 8) afterEach → held root kept; the superseding nav's success settles it.
    - `aborted` (type 4) afterEach → `settleNavigation(from)` (release); the prior root was already ended
      by the `beforeEach` `startNavigation`, and a short `from`-named nav span is emitted (see Trace model).
    - `onError` mid-nav → `settleNavigation` (release).
    - install after `router.isReady()` (resolved `currentRoute`) → pageload named immediately, first
      `beforeEach` treated as a client nav.
    - cleanup → guards removed + `nav.unregister()` called.
- `packages/vue/tests/vue-router.entry.test.ts` — assert `traceVueRouter` (and `flareVue` with a
  `router` option) does not import the `@flareapp/js` root (Electron-safety), matching the React entry
  test discipline and the existing `verify:inject` guard.
- `packages/js/tests/instrumentationGuard.test.ts` — unit-test the extracted helpers (Component 0):
  `insulate` swallows a throw and yields `undefined`; `safeInvoke` tolerates a nullish fn and swallows a
  throw. Lands with the prerequisite refactor, not the vue slice.

## Playground

- `playgrounds/vue/src/flare.ts` — `enableTracing: true` (as the react / react-router playgrounds do).
- `playgrounds/vue/src/main.ts` — `app.use(flareVue, { router })`.
- e2e: extend the Vue playground project to assert a client navigation (e.g. products → product detail)
  emits a `browser_navigation` span named `/product/:id`. Reuse the existing OTLP span-inspection helpers
  (the react-router slice noted extracting the duplicated helpers as a follow-up; reuse in place here).

## Items to verify during implementation

- `enableTracing: true` on the singleton results in `startBrowserTracing` running at `initFlare()` and a
  live pageload root by the time `flareVue` installs (same assumption the React playgrounds rely on).
- `FlareVueOptions['router']` typed as `unknown` accepts a real `vue-router` `Router` at
  `app.use(flareVue, { router })` with no cast. If a slightly tighter type gives good DX without
  friction, prefer it; otherwise `unknown` + defensive narrowing (as `getRouteContext` does) is fine.
- Navigation start time is stamped when our `beforeEach` runs — in registration order among all
  `beforeEach` guards. A slow async app guard registered earlier defers our `startNavigation` and
  undercounts the navigation. `beforeEach` is vue-router's earliest hook (no pre-guard seam exists), so
  this is inherent and matches `@sentry/vue`; installing `flareVue` right after the router (before
  feature guards) minimizes it. Confirm the playground wires it in that order.
- vue-router 4.0.0 (the peer floor) and 5.1.0 (the playground devDep) expose identical shapes for this
  integration — verified against the 4.0.0 `.d.ts`: `afterEach(to, from, failure?)` is 3-arg with the
  `failure` param present from 4.0.0 (`NavigationHookAfter`), `ErrorTypes` is `NAVIGATION_ABORTED=4 /
NAVIGATION_CANCELLED=8 / NAVIGATION_DUPLICATED=16` (so the hardcoded `NAVIGATION_CANCELLED = 8` is
  correct at the floor), and `beforeEach` / `afterEach` / `onError` each return a `() => void` unregister.
  The unit tests drive a structural fake router, so they exercise both majors by construction; a manual v4
  playground smoke before publish is optional belt-and-suspenders, not a correctness gate.
- `to.matched[last].path` as the absolute template is the one shape not pinned from the `.d.ts` (it is a
  matcher-normalization runtime behavior, not a type). Sentry reads it directly and it holds on 5.1.0;
  confirm on a 4.0.x install that a nested child route resolves its last matched record's `path` to the
  full absolute template before publish.
- After converting `@flareapp/react/tanstack-router` + `react-router` onto the shared `insulate` /
  `safeInvoke` (Component 0), both packages' existing router + entry tests still pass — Electron-safety
  is unchanged since the helpers are pure and come from the side-effect-free browser barrel.

## Out of scope / follow-ups

- **Vue component profiling** (Sentry-style global mixin; the `@flareapp/react/profiler` analog) — separate spec.
- `routeLabel: 'name' | 'path'` toggle and named-route (`custom`) source — deliberately excluded; possible
  follow-up if requested.
- Per-param / per-query span attributes — excluded (PII posture).
- Hash-history routers: `url.full` uses `to.fullPath` (the in-app path, not the `#/…` form) — same
  documented limitation as the React Router hash case.
- **Pre-publish coupling:** raise `@flareapp/vue`'s `@flareapp/js` peer floor to the version carrying the
  nav seam before releasing (the seam is on `main` but the published `@flareapp/js` is still 2.6.0). Same
  carry-forward the React Router slice recorded; coordinate with the other lockstep-set peer bumps.
- Backend `flare.route.source` + parameterized-name semantics remain gated (B5/B9/P4); `enableTracing`
  stays opt-in.
