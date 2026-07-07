# Spec: performance tracing — framework router integration, TanStack Router (React)

Status: design approved 2026-07-07; revised the same day after review (nav-start event switched
`onBeforeNavigate` → `onBeforeLoad` per TanStack/router#3920, `startNavigation` gained a destination-path
param, same-path-load policy and registration semantics made explicit, Sentry packaging citation
corrected). Branch: `research/tracing-framework-routers`.

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
  then renames it to the parameterized route (and flips source to `route`) immediately at registration,
  by resolving the current location through `router.matchRoutes` synchronously, with a one-shot
  correction on the router's first `onResolved` in case a loader redirect changed the route. Also
  mirrors Sentry (which names the pageload span from a synchronous `matchRoutes` call and corrects it
  once on resolve). Enriching at registration rather than waiting for the first resolve closes the
  window where a slow initial load lets the pageload root idle out still URL-named. Navigation and
  pageload thus share ONE "set the active root's route name" operation.
- **Emit the router-native parameterized form; no param-syntax normalization.** TanStack's `$id` form is
  used as-is (span name `/products/$id`), exactly like Sentry. Within an app the router is fixed, so the
  name is internally consistent and the backend groups occurrences fine. Canonicalizing placeholder
  syntax across frameworks (`$id` → `:id`) is cosmetic, guesses a backend contract that does not exist
  yet, and is trivial to add centrally in the seam later if the backend ever wants it. Deferred.
- **Packaging: existing framework package + subpath entry, not a new package.** The integration ships
  from `@flareapp/react` at `@flareapp/react/tanstack-router`, matching the existing `./inject` subpath
  convention. (Correction 2026-07-07: Sentry's React SDK exports `tanstackRouterBrowserTracingIntegration`
  from the MAIN `@sentry/react` entry — its published exports map has no subpaths; the `/tanstackrouter`
  subpath convention appears in `@sentry/solid`. The subpath decision stands on the `./inject` precedent
  and on keeping TanStack-specific code out of the main entry, not on a Sentry React precedent.) No new
  published package.
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
    // caller-driven. `path` is the destination pathname as the router reports it
    // (e.g. TanStack's toLocation.pathname); when omitted it falls back to
    // location.pathname. Integrations should pass it: several routers fire their
    // nav-start hook BEFORE the URL updates (Vue Router beforeEach, SvelteKit
    // beforeNavigate), and TanStack's location masking makes window.location diverge
    // from the router's real location, so reading location.pathname at start is not
    // generally safe for the seam's future consumers. The parameterized name is
    // applied via setActiveRouteName once known.
    startNavigation(opts?: { path?: string }): void;
    // Rename the currently-active root (pageload OR navigation) to the parameterized route,
    // keep its flare.entry_point.handler.identifier attribute in lockstep with the name, and
    // set its source flag. Used both for the initial-pageload enrichment and to upgrade a
    // navigation root's name when the router resolves. No-op if no root is open / it ended.
    setActiveRouteName(route: RouteName): void;
    // Restore the default History-based navigation detection.
    unregister(): void;
};
```

Supporting changes in `browserTracing`:

- A module-level reference recording the currently-registered external navigation source. The History
  `pushState`/`replaceState`/`popstate` patches are ALWAYS installed by `startBrowserTracing`; the
  registration only gates the handler (`onUrlChanged` opens no root while a source is registered), so
  there is exactly one root per navigation. This makes registration **order-independent** (register
  before or after `startBrowserTracing`; only the flag matters) and makes `unregister()` trivially
  correct: it clears the flag and default detection resumes — nothing needs reinstalling. While
  suppressed, the handler still keeps `lastPath` current (and `unregister()` resyncs
  `lastPath = location.pathname` as a belt-and-braces), so post-unregister detection never compares
  against a stale path.
- Registration is **last-wins** and handles are **token-guarded**: a second `registerNavigationSource()`
  call replaces the prior source (debug-logged), and a handle's `unregister()` only clears the
  registration if that handle is still the active one. A stale handle's cleanup (e.g. an HMR-replaced
  bootstrap module re-running the wiring) therefore cannot tear down a newer registration. Cleanup stays
  safe to call zero or multiple times.
- A module-level reference to the **active tracing flare** (set in `startBrowserTracing`, cleared in
  `stopBrowserTracing`) and to the **current root span**, so `startNavigation` can open a root (reusing
  the existing `startRoot` machinery: end the current `IdleRootController`, create a `browser_navigation`
  root via `flare.startSpan`, wire a fresh `IdleRootController`) and `setActiveRouteName` can rename the
  current root.
- `startNavigation(opts?)` ends the current `IdleRootController` and opens a `browser_navigation` root
  named after `opts.path ?? location.pathname` (`source: 'url'`) with correct timing.
- `setActiveRouteName(route)` assigns `root.name = route.name`, rewrites the root's
  `flare.entry_point.handler.identifier` attribute to the same value (that attribute holds the raw
  pathname at open and is the identifier the backend reads — leaving it stale while renaming the span
  would ship two conflicting identifiers), and sets the source attribute, all on the currently-active
  root (pageload or navigation) **only while it is open** (guarded via the controller's `isEnded`); it
  no-ops otherwise. `Span.name` is a mutable field, so no core change is needed; the guard preserves the
  "don't mutate an ended span" invariant that `setAttribute`/`setStatus` already enforce.

Default behavior when no integration registers is unchanged, with one deliberate addition: every root the
orchestrator opens (pageload and navigation, integration or not) sets the provisional
`flare.route.source: 'url'` attribute at open, and `setActiveRouteName` flips it to `'route'`. The
attribute is therefore uniformly present on browser roots instead of only on integration-touched ones, so
the backend never has to treat absence as an implicit third state. Existing roots-slice tests gain the
corresponding assertion.

### 2. TanStack integration — `@flareapp/react/tanstack-router` (new subpath entry)

A new tsdown entry and `exports` map entry in `packages/react/package.json` (mirroring `./inject`). One
exported function:

```ts
import { traceTanStackRouter } from '@flareapp/react/tanstack-router';
const stop = traceTanStackRouter(router); // returns a cleanup fn
```

Behavior:

- Calls `registerNavigationSource()` from `@flareapp/js`.
- Subscribes to the TanStack router on **`onBeforeLoad`** (navigation start) and **`onResolved`** (route
  resolved). NOT `onBeforeNavigate`: TanStack suppresses that event once a loader redirect is pending
  (`router-core` gates the emit on `!stores.redirect`; TanStack/router#3920), so it does not fire for
  every navigation — Sentry's integration switched to `onBeforeLoad` for exactly this reason. Nav end is
  handled by the idle controller as today; the router supplies nav start + the name.
- **Skip gate** on `onBeforeLoad` (Sentry's, verified in its source): skip when
  `event.fromLocation === undefined` (the initial pageload — documented TanStack behavior, see below) or
  when `event.toLocation.state === event.fromLocation.state` (a no-op reload such as
  `router.invalidate()`, which re-runs `load()` on the same location). Everything else opens a navigation
  root. Deliberate policy: search-param and hash navigations DO get navigation roots — in TanStack they
  run loaders and are real navigations — which diverges from the History-based default (that dedupes by
  pathname and ignores them). The divergence is intentional; recorded here so the e2e work doesn't treat
  it as a bug.
- **Redirect chains**: a chain emits one `onBeforeLoad` per hop but a single `onResolved`. The
  integration keeps an in-flight latch: the first `onBeforeLoad` calls
  `startNavigation({ path: toLocation.pathname })` plus an immediate `setActiveRouteName` when a route
  match resolves; subsequent `onBeforeLoad` events while in flight only re-run `setActiveRouteName` for
  the new hop (no second root); `onResolved` applies the final name and clears the latch.
- **Route-name resolution** (shared by pageload enrichment, nav start, and resolve): call
  `router.matchRoutes(toLocation.pathname, toLocation.search, { preload: false, throwOnError: false })`
  and take the last match. A match list containing only `__root__` means nothing matched — treat it as no
  match. Name from the match's `fullPath`, falling back to `routeId`, else keep the URL name with
  `source: 'url'` (pathless/layout routes can yield an empty `fullPath` — research §8.2, TanStack issue
  #4892). Resolving via `matchRoutes` instead of reading `router.state.matches` works at any point in the
  lifecycle (no dependency on when router state commits) and matches Sentry.
- **Initial pageload**: at registration, resolve the current location through `matchRoutes` and call
  `setActiveRouteName` against the already-running pageload root immediately; the shared `onResolved`
  subscription corrects the name if a loader redirect changed the route, gated on
  `fromLocation === undefined` — a condition only the initial load produces (the router's resolved
  location is set from the first resolution onward), so the correction is effectively one-shot without
  separate listener bookkeeping. The `fromLocation === undefined` initial-load signal is confirmed by
  TanStack's docs ("fromLocation can be undefined on the initial load") and by Sentry's source (it uses
  exactly `!fromLocation` to skip the initial load in its navigation subscriber).
- Returns a cleanup that unsubscribes from the router and calls `NavigationSource.unregister()`
  (restoring default History detection; token-guarded, see the seam). Safe to call zero or multiple
  times.
- **No-ops safely when tracing is disabled**, and is order-independent relative to
  `configure({ enableTracing: true })`.
- The integration is actually React-agnostic (it only touches the TanStack router core); it ships from
  `@flareapp/react/tanstack-router` for discoverability. If Vue+TanStack is wanted later, extract; not now.

Dependencies: `@tanstack/react-router` (v1) becomes an **optional** peer dep scoped to this entry via
`peerDependenciesMeta`, so the main `@flareapp/react` entry is unaffected and apps not using TanStack pay
nothing. The supported range needs a floor, not just "v1": Sentry pins `>=1.64.0`; pin ours during
implementation after checking the APIs we touch (`subscribe` payload flags, the `matchRoutes` signature)
against that floor. Sentry avoids even a type-level dependency by vendoring structural types for the
router; do the same if the optional peer dep creates type-checking friction for non-TanStack consumers.
`@flareapp/js` is already a peer dependency of `@flareapp/react`.

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
  (`source: route`) immediately at registration, with a one-shot correction on the router's first
  `onResolved` if a loader redirect changed the route, while it is still open. Fetch/XHR spans nest under
  it unchanged.
- **Navigation**: each qualifying `onBeforeLoad` (not skipped by the initial-load / no-op-reload gate) →
  the integration opens one `browser_navigation` root (named from the event's destination path, correct
  timing) and upgrades its name to the parameterized route (`source: route`); redirect hops rename the
  same in-flight root; `onResolved` finalizes; the idle controller closes it as today. History-based
  detection is suppressed, so exactly one root per navigation.
- **No integration registered**: unchanged from the roots slice (URL-named roots), except roots now carry
  `flare.route.source: 'url'` explicitly (see the seam section).

## Route name & attributes

- The root span **name** is the parameterized route template as the router emits it (native `$id`
  syntax), or the raw URL path when no template is resolvable.
- The roots' existing `flare.entry_point.handler.identifier` attribute stays in lockstep with the name:
  it holds the raw pathname at open and `setActiveRouteName` rewrites it to the route template, so the
  identifier the backend reads never contradicts the span name.
- A **source flag** attribute distinguishes the two: proposed key `flare.route.source` with values
  `route | url`, set on every browser root at open (`url`) and flipped to `route` by
  `setActiveRouteName`. Both the key and the broader browser-perf attribute contract are **provisional** —
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
- Route-name reads are guarded: `matchRoutes` is called with `throwOnError: false` inside a try/catch,
  `__root__`-only match lists and empty `fullPath` / pathless routes fall back (`routeId` → keep URL
  name), and router shape reads are defensive against version drift.
- Registration is last-wins with token-guarded handles (see the seam); the returned cleanup is safe to
  call zero or multiple times.

## Testing (unit + e2e)

- **Unit — js seam** (`packages/js/tests`, alongside `browserTracing.test.ts`): registering a nav source
  suppresses History navigation detection; `startNavigation({ path })` opens a `browser_navigation` root
  named after the given path (falling back to `location.pathname`) and ends the prior one;
  `setActiveRouteName` renames the open active root (pageload or navigation) and flips its source
  attribute, and no-ops once it has ended; roots carry `flare.route.source: 'url'` at open with or
  without a registered source; a second registration replaces the first and a stale handle's `unregister`
  is a no-op (token guard); `unregister` restores default History detection with a resynced `lastPath`;
  all operations no-op with no active session.
- **Unit — TanStack integration** (`packages/react/tests`): with a minimal fake router (exposing
  `subscribe` + `matchRoutes`), assert `onBeforeLoad` → `startNavigation({ path })` then `onResolved` →
  `setActiveRouteName` with the parameterized name + `source: 'route'`; the skip gate (initial load via
  `fromLocation === undefined`; no-op reload via identical `state`); a redirect chain (two
  `onBeforeLoad`, one `onResolved`) produces exactly one root, renamed per hop; the initial pageload path
  (immediate `setActiveRouteName` at registration + one-shot `onResolved` correction); `__root__`-only
  and empty-`fullPath` fallbacks (`routeId` / URL); cleanup unsubscribes and unregisters. No React render
  needed (router-only).
- **E2e** (`playgrounds/react` + Playwright `react` project): the navigation/pageload assertions above
  against the fake-flare-server.

The existing pageload/navigation roots unit + e2e coverage must stay green (default URL-named behavior is
unchanged when no integration registers, modulo the one deliberate addition of the always-present
`flare.route.source` attribute, which those tests gain an assertion for).

## Items to verify during implementation

- **Resolved 2026-07-07 (review):** the initial-pageload signal `fromLocation === undefined` is confirmed
  by TanStack's docs and Sentry's source — no latch fallback needed (a "first event seen" latch would
  also misclassify the first real navigation whenever registration happens after the initial load
  resolved). The events question is likewise answered: `onBeforeNavigate` does NOT fire for every
  navigation (suppressed after loader redirects, TanStack/router#3920); the design uses `onBeforeLoad` +
  `onResolved` instead.
- **Minimum `@tanstack/react-router` version.** Pin the peer-dep floor after checking the `subscribe`
  payload flags and the `matchRoutes` signature against it (Sentry pins `>=1.64.0`).
- **No-op-reload gate form.** The spec adopts Sentry's state-identity check
  (`toLocation.state === fromLocation.state`); the event payload's `hrefChanged` flag is a plausible
  alternative. Validate the chosen gate against a real router (`invalidate()`, same-URL re-push,
  hash-only navigation) in the integration unit tests.
- **Seam function names** (`registerNavigationSource` / `startNavigation` / `setActiveRouteName`) are
  provisional; finalize in the plan.
- **`flare.route.source` attribute key** is provisional pending the backend attribute contract.

## Out of scope / follow-ups

- **Other routers** (React Router v7, Vue Router v4, SvelteKit 2 client) — each a follow-on slice reusing
  this seam.
- **SvelteKit server↔client correlation** (inbound `traceparent` in `handle`, SSR trace `<meta>` tags,
  client-side continuation) — net-new on both ends; its own slice (research §8.4).
- **Param-syntax canonicalization** across frameworks — deferred to the backend-contract work.
- **Route params as span attributes** (Sentry records `url.path.parameter.<name>` per match) — feeds the
  same backend attribute-contract discussion; not in this slice.
- **Multi-instance tracing ownership** (the deferred XHR-round Finding 5) — unrelated, still pending.
- **Backend taxonomy/attribute contract** for route names (B5/B9/P4) — the `flare.route.source` key and
  the parameterized-name semantics need backend agreement before real-product correlation.
