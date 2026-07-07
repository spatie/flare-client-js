# Spec: performance tracing — framework router integration, TanStack Router (React)

Status: design approved 2026-07-07. Branch: `research/tracing-framework-routers`.

Scope: the shared framework-agnostic **navigation-source seam** in `@flareapp/js`, plus the **first**
framework router integration built on it — **TanStack Router v1**, shipped from `@flareapp/react`.
React Router v7, Vue Router v4, and SvelteKit 2 (client + server correlation) are explicit follow-on
slices that reuse this seam and are out of scope here.

## Context

This continues the performance-tracing effort (core foundation, browser fetch, pageload/navigation
roots, and XHR instrumentation are all merged to `main`). The
[pageload/navigation roots slice](2026-07-02-performance-tracing-pageload-navigation-roots-design.md)
introduced framework-agnostic `browser_pageload` / `browser_navigation` root spans with a Sentry-style
idle lifecycle, detecting navigations by patching the History API and naming each root by the raw
`location.pathname` (e.g. `/products/123`). That slice explicitly deferred parameterized route names and
router-event integration to separate per-framework slices. This is the first of those.

The goal: replace the raw-URL root name with the **parameterized route template** (e.g. `/products/$id`)
supplied by the app's router, plus a `route` vs `url` source flag, so the backend `SpanAggregators`
group navigations correctly (research doc §8, §2.4). Full research: `.claude/docs/research/performance-tracing.md`
§8 (router interop) and §8.6 (cross-router summary). Sentry's real source was consulted; where we match
it and where we diverge is recorded below.

TanStack Router is first because the research doc calls it the cleanest of the four routers
(first-class `router.subscribe` events with an explicit start/end lifecycle) and the React playground
already uses it, giving us real end-to-end validation with no new fixture.

## Approved decisions driving this spec

- **Mechanism: router drives navigation; History detection steps aside (Sentry's approach).** When a
  framework router integration registers as the navigation source, the built-in History-API navigation
  detection is suppressed (no double roots), and the integration opens each `browser_navigation` root
  from the router's navigation-start event (URL-named, correct timing) and sets the parameterized name
  once the router resolves the route. This matches Sentry, whose framework integrations set
  `instrumentNavigation: false` on the generic browser-tracing and start navigation spans themselves,
  updating the name after the match resolves.
- **Pageload = start-generic-then-enrich.** The generic `browser_pageload` root still starts at
  `configure` time, backdated and URL-named, so early fetch/XHR spans nest correctly. The integration
  then renames it to the parameterized route (and flips source to `route`) once the router resolves the
  initial route. Also mirrors Sentry. Navigation and pageload thus share ONE "set the active root's
  route name" operation.
- **Emit the router-native parameterized form; no param-syntax normalization.** TanStack's `$id` form is
  used as-is (span name `/products/$id`), exactly like Sentry. Within an app the router is fixed, so the
  name is internally consistent and the backend groups occurrences fine. Canonicalizing placeholder
  syntax across frameworks (`$id` → `:id`) is cosmetic, guesses a backend contract that does not exist
  yet, and is trivial to add centrally in the seam later if the backend ever wants it. Deferred.
- **Packaging: existing framework package + subpath entry, not a new package.** The integration ships
  from `@flareapp/react` at `@flareapp/react/tanstack-router`, matching the existing `./inject` subpath
  convention and Sentry's `@sentry/react/tanstackrouter` convention. No new published package.
- **No `@flareapp/core` change.** `Span.name` is already a mutable field, so setting a root's route name
  is a guarded field assignment in the seam. The whole slice lives in `@flareapp/js` + `@flareapp/react`.
- **Automated React e2e coverage is in scope.** Unlike the manual-only XHR slice, this slice adds a
  Playwright spec in the `react` project, because the framework wiring working end-to-end is the point.

## Components

### 1. Navigation-source seam — `@flareapp/js` (`src/tracing/browserTracing.ts` + a small public surface)

Today `browserTracing` holds module-level singletons (`controller`, `uninstall`, `lastPath`,
`pageloadTraced`), starts the pageload root in `startBrowserTracing`, and starts `browser_navigation`
roots from `onUrlChanged` on History changes. This slice adds a seam so a framework integration can take
over navigation:

New public export from `@flareapp/js`'s browser surface (the tracing barrel is not currently public, so
this is a deliberate, minimal public-API addition that every future framework slice consumes):

```ts
export function registerNavigationSource(): NavigationSource;

export type RouteName = { name: string; source: 'route' | 'url' };

export type NavigationSource = {
    // End the active root (if any) and open a new browser_navigation root, URL-named
    // (source: 'url') with correct timing. This is what onUrlChanged used to do, now
    // caller-driven. The parameterized name is applied via setActiveRouteName once known.
    startNavigation(): void;
    // Rename the currently-active root (pageload OR navigation) to the parameterized route
    // and set its source flag. Used both for the initial-pageload enrichment and to upgrade
    // a navigation root's name when the router resolves. No-op if no root is open / it ended.
    setActiveRouteName(route: RouteName): void;
    // Restore the default History-based navigation detection.
    unregister(): void;
};
```

Supporting changes in `browserTracing`:

- A module-level flag/reference recording that an external navigation source is registered. While set,
  `onUrlChanged` early-returns (the History `pushState`/`replaceState`/`popstate` patches may stay
  installed but do not open navigation roots), so there is exactly one root per navigation.
  Registration is **order-independent**: registering before `startBrowserTracing` runs makes it skip
  installing History navigation detection; registering after makes the already-installed handler inert.
- A module-level reference to the **active tracing flare** (set in `startBrowserTracing`, cleared in
  `stopBrowserTracing`) and to the **current root span**, so `startNavigation` can open a root (reusing
  the existing `startRoot` machinery: end the current `IdleRootController`, create a `browser_navigation`
  root via `flare.startSpan`, wire a fresh `IdleRootController`) and `setActiveRouteName` can rename the
  current root.
- `startNavigation()` ends the current `IdleRootController` and opens a `browser_navigation` root
  URL-named (`source: 'url'`) with correct timing.
- `setActiveRouteName(route)` assigns `root.name = route.name` and sets the source attribute on the
  currently-active root (pageload or navigation) **only while it is open** (guarded via the controller's
  `isEnded`); it no-ops otherwise. `Span.name` is a mutable field, so no core change is needed; the guard
  preserves the "don't mutate an ended span" invariant that `setAttribute`/`setStatus` already enforce.

Default behavior is unchanged when no integration registers: History detection still names roots by URL
with `source: 'url'`.

### 2. TanStack integration — `@flareapp/react/tanstack-router` (new subpath entry)

A new tsdown entry and `exports` map entry in `packages/react/package.json` (mirroring `./inject`). One
exported function:

```ts
import { traceTanStackRouter } from '@flareapp/react/tanstack-router';
const stop = traceTanStackRouter(router); // returns a cleanup fn
```

Behavior:

- Calls `registerNavigationSource()` from `@flareapp/js`.
- Subscribes to the TanStack router: on a navigation start (`onBeforeNavigate`) → `startNavigation()`
  (opens the URL-named nav root with correct timing); on resolve (`onResolved`) →
  `setActiveRouteName({ name, source: 'route' })` (upgrades the active root's name to the parameterized
  route). The initial pageload uses `setActiveRouteName` against the already-running pageload root. Nav
  end is handled by the idle controller as today; the router supplies nav start + the name.
- Reads the parameterized route from `router.state.matches[last].fullPath`, falling back to `routeId`,
  then leaving the URL name with `source: 'url'` when neither is usable (pathless/layout routes can yield
  an empty `fullPath` — research §8.2, TanStack issue #4892).
- Distinguishes the initial pageload (upgrade the existing pageload root via `setActiveRouteName`) from a
  navigation (`startNavigation()` on start, then `setActiveRouteName` on resolve). Candidate initial-load
  signal: `fromLocation === undefined` on the first event — flagged for source verification (see Items to
  verify).
- Returns a cleanup that unsubscribes from the router and calls `NavigationSource.unregister()`
  (restoring default History detection). Safe to call zero or multiple times.
- **No-ops safely when tracing is disabled**, and is order-independent relative to
  `configure({ enableTracing: true })`.
- The integration is actually React-agnostic (it only touches the TanStack router core); it ships from
  `@flareapp/react/tanstack-router` for discoverability. If Vue+TanStack is wanted later, extract; not now.

Dependencies: `@tanstack/react-router` (v1) becomes an **optional** peer dep scoped to this entry via
`peerDependenciesMeta`, so the main `@flareapp/react` entry is unaffected and apps not using TanStack
pay nothing. `@flareapp/js` is already a peer dependency of `@flareapp/react`.

### 3. React playground wiring + e2e (`playgrounds/react`, `e2e/`)

- Enable tracing in the React playground (`VITE_FLARE_URL` override + `configure({ enableTracing: true })`,
  as the JS playground already does) and call `traceTanStackRouter(router)` at bootstrap, right after
  `createRouter`.
- The e2e `react` project gets a Playwright spec asserting an in-app navigation yields a
  `browser_navigation` envelope at the fake-flare-server whose root name is the parameterized route
  (e.g. `/products/$id`, `source: route`), and that the pageload root carries the parameterized initial
  route. Mirrors the roots slice's pageload/navigation/nesting specs.

## Trace model for this slice

- **Pageload**: `configure({ enableTracing: true })` starts the backdated `browser_pageload` root
  URL-named (`source: url`); the integration renames it to the parameterized initial route
  (`source: route`) on the router's first resolve, while it is still open. Fetch/XHR spans nest under it
  unchanged.
- **Navigation**: each route change → the integration opens one `browser_navigation` root (URL-named on
  nav start, correct timing) and upgrades its name to the parameterized route (`source: route`) on
  resolve; the idle controller closes it as today. History-based detection is suppressed, so exactly one
  root per navigation.
- **No integration registered**: unchanged from the roots slice (URL-named roots, `source: url`).

## Route name & attributes

- The root span **name** is the parameterized route template as the router emits it (native `$id`
  syntax), or the raw URL path when no template is resolvable.
- A **source flag** attribute distinguishes the two: proposed key `flare.route.source` with values
  `route | url`. Both the key and the broader browser-perf attribute contract are **provisional** —
  the research doc lists the attribute contract as a backend decision still gated on B5/B9/P4. The raw
  page URL remains available via the roots' existing `collectBrowserSpanContext`, so the backend can show
  the concrete URL alongside the template.

## Error handling

Instrumentation must never break the host app or its router:

- `router.subscribe` callbacks are wrapped so a tracing error never escapes into the router's event
  dispatch, mirroring `browserTracing`'s existing defensive boundaries (the `startRoot` try/catch and the
  `pushState` wrap guards).
- Seam operations no-op when there is no active tracing session or no active root; `setActiveRouteName`
  no-ops if the active root already closed (e.g. a slow initial load past the idle timeout), leaving the
  URL name rather than throwing.
- Route-name reads are guarded: empty `fullPath` / pathless routes fall back (`routeId` → keep URL name),
  and `router.state` shape reads are defensive against router version drift.
- Registration is idempotent; the returned cleanup is safe to call zero or multiple times.

## Testing (unit + e2e)

- **Unit — js seam** (`packages/js/tests`, alongside `browserTracing.test.ts`): registering a nav source
  suppresses History navigation detection; `startNavigation()` opens a URL-named `browser_navigation`
  root and ends the prior one; `setActiveRouteName` renames the open active root (pageload or navigation)
  and sets its source, and no-ops once it has ended; `unregister` restores default History detection; all
  operations no-op with no active session.
- **Unit — TanStack integration** (`packages/react/tests`): with a minimal fake router (exposing
  `subscribe` + `state.matches`), assert `onBeforeNavigate` → `startNavigation()` then `onResolved` →
  `setActiveRouteName` with the parameterized name + `source: 'route'`; the initial pageload path
  (`setActiveRouteName` on the pageload root); empty-`fullPath` fallback to `routeId` / URL; cleanup
  unsubscribes and unregisters. No React render needed (router-only).
- **E2e** (`playgrounds/react` + Playwright `react` project): the navigation/pageload assertions above
  against the fake-flare-server.

The existing pageload/navigation roots unit + e2e coverage must stay green (default URL-named behavior is
unchanged when no integration registers).

## Items to verify during implementation

- **TanStack initial-pageload signal.** The candidate `fromLocation === undefined` on the first event is
  not source-verified (research §8.2, open question #2). Confirm against the router's actual event
  payload; if unreliable, gate the initial `setActiveRouteName` on a "first event seen" latch instead.
- **Exact TanStack events.** Start the nav root on the navigation-start event (`onBeforeNavigate`) and set
  the name on `onResolved` (the design decouples these, so matches need not be populated at start).
  Confirm both events fire for every navigation and that `router.state.matches[last].fullPath` is
  populated at `onResolved`.
- **Seam function names** (`registerNavigationSource` / `startNavigation` / `setActiveRouteName`) are
  provisional; finalize in the plan.
- **`flare.route.source` attribute key** is provisional pending the backend attribute contract.

## Out of scope / follow-ups

- **Other routers** (React Router v7, Vue Router v4, SvelteKit 2 client) — each a follow-on slice reusing
  this seam.
- **SvelteKit server↔client correlation** (inbound `traceparent` in `handle`, SSR trace `<meta>` tags,
  client-side continuation) — net-new on both ends; its own slice (research §8.4).
- **Param-syntax canonicalization** across frameworks — deferred to the backend-contract work.
- **Multi-instance tracing ownership** (the deferred XHR-round Finding 5) — unrelated, still pending.
- **Backend taxonomy/attribute contract** for route names (B5/B9/P4) — the `flare.route.source` key and
  the parameterized-name semantics need backend agreement before real-product correlation.
