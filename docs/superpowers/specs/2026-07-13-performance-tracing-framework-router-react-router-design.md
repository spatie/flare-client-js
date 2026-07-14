# Spec: performance tracing — framework router integration, React Router v7 (data mode)

Status: design approved 2026-07-13; **revised 2026-07-13 after review** — three deltas: (1) a navigation
**hold** so an in-flight nav root does not idle-close before it can be named (new `settleNavigation` seam
method + an `IdleRootController` hold flag); (2) REPLACE navigations now open a nav root; (3)
`state.historyAction` dropped from the open decision. **Corrected 2026-07-14 during planning** (4): RR
short-circuits loader-less navigations straight to `completeNavigation` with **no loading state** (verified
in `react-router` `router.ts`), so navigation detection cannot key on the `navigation.state` transition
alone — it must also detect a committed `state.location` change (see the two-shape logic in Component 2).
Branch: `react-router-v7-integration`.
Validated against Sentry's real React Router v7 data-router source (`getsentry/sentry-javascript`,
`packages/react/src/reactrouter-compat-utils/{instrumentation.tsx,utils.ts}`) before approval; where we
match it and where we deliberately diverge is recorded below.

Scope: the **second** framework router integration built on the `@flareapp/js` navigation-source seam —
**React Router v7 in data mode** (`createBrowserRouter` / `createHashRouter` / `createMemoryRouter`),
shipped from `@flareapp/react` at `@flareapp/react/react-router`. Also a small **extension to the shared
seam** so navigation roots carry the correct destination `url.full` (the carry-forward the TanStack slice
recorded). Vue Router v4, SvelteKit 2, and React Router's other modes (declarative `<Routes>`, `useRoutes`,
framework mode) are explicit follow-on slices and are out of scope here.

## Context

This continues the performance-tracing effort. The core foundation, browser fetch/XHR instrumentation, the
framework-agnostic `browser_pageload` / `browser_navigation` roots with a Sentry-style idle lifecycle, and
the **first** router integration (TanStack Router, PR #69) are all on `main` / merged. The TanStack slice
introduced the reusable
[navigation-source seam](2026-07-07-performance-tracing-framework-router-tanstack-design.md):
`registerNavigationSource()` in `@flareapp/js` (`startNavigation` / `setActiveRouteName` / `unregister`),
which suppresses History-based navigation detection while a router integration drives navigation and names
each root with the parameterized route template plus a `flare.route.source` (`route` | `url`) flag.

The goal here is identical in outcome to the TanStack slice — replace the raw-URL root name with the
router's **parameterized route template** (e.g. `/product/:id`) plus the source flag — but for React Router
v7. React Router is materially different from TanStack in two ways that drive this spec:

1. **URL commit timing.** In the RR data router the URL commits only _after_ loaders resolve. During a
   navigation, `router.state.navigation.state` is `'loading'` (or `'submitting'`) and `window.location`
   still shows the _previous_ page. This is exactly the carry-forward the TanStack spec recorded
   (§ Out of scope: "Vue Router `beforeEach` and SvelteKit `beforeNavigate` fire BEFORE the URL commits").
   TanStack did not hit it because its `onBeforeLoad` fires after the History commit. So this slice must
   thread the destination URL into the navigation root's context, or the root carries the previous page's
   `url.full`.
2. **No pre-joined route pattern.** TanStack hands you `match.fullPath` directly. RR gives no full pattern;
   the parameterized name (`/product/:id`) must be reconstructed by walking the matched route chain and
   joining each `match.route.path`. Sentry's `getNormalizedName` shows this join is non-trivial (index
   routes, splats, wildcards, basename).

Full research: `.claude/docs/research/performance-tracing.md` §8 (router interop). Sentry's real source was
consulted for both points; citations below.

## Approved decisions driving this spec

- **Data mode only.** The integration takes the object returned by `createBrowserRouter` /
  `createHashRouter` / `createMemoryRouter` (all share the RR `DataRouter` interface) and drives tracing
  from `router.subscribe` + `router.state`. This is the direct analog of `traceTanStackRouter(router)`.
  Declarative `<Routes>` mode, `useRoutes`, and framework mode (Remix-style full-stack, server-side) are
  explicit follow-on slices — they have no router handle and would require a second hook-based API plus a
  runtime `react-router` import. Data mode is the modern recommended RR v7 usage, and framework mode runs a
  data router underneath, so these primitives are the reusable foundation for a later framework slice.
- **Seam extension: thread the destination URL so nav roots get the right `url.full`.** `startNavigation`
  gains an optional `url` (the destination href). `startRoot` stamps the navigation root's URL-derived
  context (`url.full`, `flare.entry_point.value`, `flare.entry_point.handler.identifier`) from that URL
  instead of the stale live `location`. This is the primitive Vue Router and SvelteKit will reuse. The
  pageload path is unchanged (the live location is correct at pageload).
- **Name from `router.state.matches`, reconstructed by walking the chain — no `matchRoutes` import.**
  Because data mode already exposes the fully-resolved matched chain in `router.state.matches` at
  completion (lazy routes included by then), we read it directly instead of re-matching via a passed-in
  `matchRoutes`. This is a deliberate divergence from Sentry (whose shared code path re-matches to support
  lazy routes, declarative/useRoutes modes, and descendant routes) and is what keeps this entry free of a
  runtime `react-router` dependency and free of passed-in React hooks. The join rules (below) port the
  substance of Sentry's `getNormalizedName`.
- **Open the nav root at navigation start, name it at resolve.** We open the `browser_navigation` root at
  the first `idle → non-idle` transition (correct timing: captures loader duration, nests loader-issued
  fetches) using the destination path/URL from `state.navigation.location`, then set the parameterized name
  once at the `non-idle → idle` transition when `state.matches` is final. This is deliberately different
  from Sentry, which creates the span at completion (`historyAction === 'PUSH'`, `navigation.state ===
'idle'`) using the committed `state.location` — Sentry's RR navigation span therefore _starts after
  loaders finish_ and misses loader time and loader fetches. Our open-at-start + seam URL threading gets
  both correct timing and a correct `url.full`. No placeholder-span / name-upgrade machinery is needed
  (Sentry needs it because it names early against not-yet-loaded lazy routes; we name once, late, against
  final matches).
- **Hold the navigation root open until RR settles.** The parameterized name is only available at resolve
  (`state.matches` still holds the previous route at navigation start), so the root must survive the whole
  loader window. Without a hold, a navigation whose loaders run past `idleTimeout` (default 1s) without
  emitting a traced child span idle-closes early; the resolve-time name-set then no-ops against a closed root,
  silently degrading the root to the raw URL name **and** trimming its duration to ~0 (the childless-close
  floor). So `startNavigation` opens the navigation root in a **held** state that suppresses idle-close until
  an explicit settle, with `finalTimeout` / `childSpanTimeout` still applying as stuck-navigation backstops.
  The resolve step (`settleNavigation`) names the root and releases the hold, closing at the settle time when
  childless (so the root's duration spans start→settle, capturing loader time) or handing back to the idle
  controller when trailing fetches are still open. The hold is opt-in per navigation source; TanStack does not
  use it (it names at start, so an early idle-close keeps its name). This is the one `@flareapp/js` behavioral
  change beyond the URL threading; still no `@flareapp/core` change.
- **Emit RR-native `:id` syntax; no param-syntax normalization.** Same rationale as TanStack — internally
  consistent within an app, matches Sentry, and cross-framework canonicalization guesses a backend contract
  that does not exist yet. Deferred to the backend-contract work.
- **Packaging: existing package + subpath entry.** Ships from `@flareapp/react` at
  `@flareapp/react/react-router`, mirroring `./inject` and `./tanstack-router`. No new published package.
  `react-router` is an **optional** peer dep scoped to this entry; the main `@flareapp/react` entry is
  unaffected. Electron-safe: the entry imports `@flareapp/js/browser` (side-effect-free), never the root
  singleton.
- **No `@flareapp/core` change.** As with TanStack, `Span.name` is mutable; the whole slice lives in
  `@flareapp/js` + `@flareapp/react`.
- **Validation: real-router integration tests, not a new playground.** There is no React Router playground
  (the React playground uses TanStack), and building a fifth webshop + Playwright project is
  disproportionate for one tracing slice. Instead, add `react-router` as a devDependency and drive a real
  `createBrowserRouter` through real navigations in the test suite, plus fake-router unit tests for edge
  cases. This validates the risky matches-join against real RR shapes without a playground.

## Components

### 1. Navigation-source seam extension — `@flareapp/js`

The seam from the TanStack slice already exists
(`registerNavigationSource` / `startNavigation` / `setActiveRouteName` / `unregister` in
`src/tracing/browserTracing.ts`). This slice extends it three ways: `startNavigation` carries a destination
URL (threaded through root context collection) and an optional `hold`; a new `settleNavigation` names the
root and releases the hold; and `IdleRootController` gains a hold flag. All are additive — the TanStack
integration opts into none of them and is unchanged.

- **`NavigationSource.startNavigation(opts?: { path?: string; url?: string; hold?: boolean })`** — add two
  optional fields. `url` is the destination href (e.g. `origin + navigation.location.pathname + search +
hash`); when provided, `startRoot` derives the navigation root's URL context from it instead of the live
  `location`. `hold: true` opens the root with idle-close **suppressed** until `settleNavigation` releases it
  (`finalTimeout` / `childSpanTimeout` still apply). Both are additive; the TanStack integration passes
  neither and keeps its current behavior.
- **`NavigationSource.settleNavigation(route: RouteName)`** (new) — set the final route name (same effect as
  `setActiveRouteName`) **and** release the hold: with no child span in flight, close the root at the settle
  time (capturing the full loader duration of a childless navigation); otherwise resume the normal idle
  lifecycle so trailing fetches keep the root open and then close it as today. No-ops when there is no
  active/held root.
- **`IdleRootController` hold flag** — a `held` boolean that suppresses the idle-timer close while set; the
  `finalTimeout` and `childSpanTimeout` timers are unchanged (they stay the stuck-navigation backstop).
  Releasing the hold closes-at-`now` when childless, else re-arms idle. This lives in `@flareapp/js`
  (`src/tracing/IdleRootController.ts`), so the "no `@flareapp/core` change" decision holds.
- **`startRoot(flare, spanType, startTimeUnixNano, name, urlOverride?, hold?)`** — pass the override to
  context collection and open the controller held when `hold` is set. The `browser_pageload` path passes
  neither (live location correct at pageload, no hold); only `startNavigation` does.
- **`collectBrowserSpanContext(config, hrefOverride?)`** → threads to **`browserEntryPoint(config,
hrefOverride?)`** and **`request(urlDenylist, hrefOverride?)`**. `url.full` and `flare.entry_point.value`
  are `redactUrlQuery(hrefOverride ?? window.location.href, …)`; `flare.entry_point.handler.identifier` is the
  pathname of that href (parsed via `new URL(hrefOverride)` inside a try/catch that falls back to the live
  location on a malformed URL). The non-URL keys (`user_agent.original`, `http.request.referrer`,
  `document.ready_state`) stay live — they are not destination-dependent. (`host.name` is not on the span-
  context path at all: `collectBrowserSpanContext` already excludes it, so the override never touches it.)

Note the `flare.entry_point.handler.identifier` from the override is the _pathname_, immediately
overwritten by `setActiveRouteName` with the parameterized route name once resolved — same lockstep the
TanStack slice established. Threading the URL only fixes the pre-resolve/`url.full` window.

Everything else in the seam (last-wins registration, token-guarded handles, `setActiveRouteName` lockstep,
`unregister` resync) is unchanged and reused as-is.

### 2. React Router v7 integration — `@flareapp/react/react-router` (new subpath entry)

A new tsdown entry and `exports` map block in `packages/react/package.json` (mirroring `./tanstack-router`).
One exported function:

```ts
import { traceReactRouter } from '@flareapp/react/react-router';
const stop = traceReactRouter(router); // router = createBrowserRouter(...); returns a cleanup fn
```

Behavior:

- Calls `registerNavigationSource()` from `@flareapp/js/browser`.
- **Pageload enrichment**: read `router.state.matches`, resolve the parameterized name (below), and call
  `setActiveRouteName` against the already-running pageload root. RR resolves `state.matches` **synchronously**
  at `createBrowserRouter` (path matching is sync; only loaders and lazy component/loader resolution are
  async), so the name is normally available at registration. If it is not yet (`state.matches` empty, e.g. a
  not-yet-initialized router), a `pageloadNamed` latch defers naming to the first subscribe fire where
  `state.initialized` is true and `state.matches` is non-empty; that fire names the pageload root and
  explicitly does **not** open a navigation root. The latch flips once, so the pageload is named exactly once.
- Subscribes once via **`router.subscribe((state) => …)`** and tracks `state.navigation.state`, a committed
  **location key** (`pathname + search + hash`, per Sentry's `computeLocationKey`), an `inFlight` latch, and
  `lastLocationKey` (the last committed location). React Router commits a navigation in one of **two shapes**,
  and both must be detected — keying only on the `navigation.state` transition would miss the common one:
    - **Loader navigation** — RR runs loaders/middleware, so it publishes a non-idle `state.navigation`
      (`loading` / `submitting`) with the destination in `state.navigation.location` **before** the URL and
      `state.matches` commit, then a final `idle` fire that commits them. Detected on the **`idle → non-idle`**
      transition (only once the pageload has settled — see the initial-load guard): `dest =
state.navigation.location`; `nav.startNavigation({ path: dest.pathname, url: hrefOf(dest), hold: true })`.
      The root opens URL-named and **held** (`startRoot` sets `name = path`, `source: 'url'`; the hold
      suppresses idle-close until settle) — `state.matches` still holds the _previous_ route here, so no name
      is available yet. The parameterized name is set once, at resolve.
    - **Loader-less navigation** — when there is nothing to load, RR **short-circuits straight to
      `completeNavigation` and never sets a loading state** (verified in `react-router`'s `router.ts`
      `handleLoaders`, which returns before `updateState({ navigation: loadingNavigation })` when no matched
      route `shouldLoad`; likewise hash-only changes and 404s short-circuit in `startNavigation`). Location +
      `state.matches` commit in a **single `idle` fire**, so a `navigation.state` transition is never observed.
      Detected instead by the committed `state.location` key differing from `lastLocationKey` while idle and
      not in-flight: `nav.startNavigation({ path: state.location.pathname, url: hrefOf(state.location) })`
      (**no hold** — the name is available immediately) followed at once by `nav.settleNavigation({ name,
source })`. The root then lives on the normal idle lifecycle, capturing any fetches the newly-mounted
      route's effects fire (a hold here would close it before those start).
    - **Redirect / superseding hop** (loader navigation, non-idle while `inFlight`): do **not** open a second
      root; the hold keeps the single in-flight root alive across the hops. One root per in-flight sequence,
      matching the TanStack redirect-chain behavior; the final name is applied once at resolve.
    - **Resolve** (`non-idle → idle` while `inFlight`): set `lastLocationKey`, resolve the parameterized name
      from the now-committed `state.matches`, and call `nav.settleNavigation({ name, source: 'route' })`
      (falling back to `{ name: state.location.pathname, source: 'url' }` when no route-derived name is
      available). `settleNavigation` sets the name and releases the hold, closing the root at the settle time
      (childless) or handing it back to the idle controller (trailing fetches still open).
- **Initial-load guard** (the role Sentry's `isInitialPageloadComplete` plays): do not open a navigation root
  until the pageload has settled — gated on the `pageloadNamed` latch above (equivalently, `state.initialized
=== true` plus the first observed `idle`). RR's initial load and any hydration-time subscribe are thereby
  attributed to the pageload root, never a spurious navigation root. **After** the pageload has settled, every
  `idle → non-idle` transition opens exactly one navigation root — **PUSH, POP (back/forward), and REPLACE
  alike**. We deliberately do **not** gate the open decision on `state.historyAction`: (1) `state.navigation`
  goes non-idle only for real navigations (revalidation lives on `state.revalidation`, fetcher traffic on
  `state.fetchers`), so every post-settle non-idle _is_ a navigation and a REPLACE navigation must not be
  dropped; and (2) `state.historyAction` is committed at navigation _end_, so at the `idle → non-idle` (start)
  moment it can still hold the _previous_ navigation's action — it is not a reliable per-navigation signal at
  open time. (Redirect/superseding REPLACE hops _within_ an in-flight nav are already absorbed by the latch,
  so only standalone user-initiated REPLACE navigations are affected by admitting REPLACE here.)
- **Dedup**: the `inFlight` latch plus the location-key check prevent the many repeated `subscribe` fires
  within one navigation cycle (and fetcher/revalidation state changes, which leave `navigation.state`
  `idle`) from double-opening roots. `router.revalidate()` sets `state.revalidation`, not
  `state.navigation.state`, so revalidation opens nothing — correct by construction.
- Returns a cleanup that unsubscribes from the router and calls `NavigationSource.unregister()`. Safe to
  call zero or multiple times.
- **No-ops safely when tracing is disabled**, and is order-independent relative to
  `configure({ enableTracing: true })` (the seam handles this).
- All `subscribe` work is wrapped so a tracing error never escapes into the router's state dispatch.

**Route-name resolution** (`routeNameFromMatches(matches)`) — the one piece with no TanStack analog. Walk
`state.matches` and join each `match.route.path`, porting the substance of Sentry's `getNormalizedName`:

- Skip a match with no `route.path` (pathless layout route) and an index route's empty contribution.
- An **absolute** `route.path` (starts with `/`) resets the accumulator; a relative one appends (inserting a
  `/` separator when needed).
- Keep splat/wildcard segments (`*`, `files/*`) in the name, matching Sentry (`transactionNameHasWildcard`
  keeps them; they are legitimate route templates).
- Normalize with a `trimSlash`-style collapse so a `/` root plus `product/:id` yields `/product/:id`, not
  `//product/:id`.
- Return `[name, 'route']` when a non-empty template is built, else `[state.location.pathname, 'url']`.

Because we read the exact matched chain from `state.matches` (not a re-match against a route superset), we do
**not** need Sentry's per-branch location-pathname stop condition, its `matchRoutes` dependency, or its
descendant-route handling. **basename** is a **known limitation for v1**: names are basename-relative (Sentry
makes basename stripping an opt-in `stripBasename`). Recorded in follow-ups.

Wrapped in try/catch; any throw → `[location.pathname, 'url']` fallback.

### 3. Vendored structural router types — `packages/react/src/vendor/reactRouterTypes.ts`

Mirroring `vendor/tanstackRouterTypes.ts`: a structural subset of the RR v7 `DataRouter` so the entry needs
no runtime `react-router` import and non-RR consumers of `@flareapp/react` type-check cleanly.

```ts
export type RRLocation = { pathname: string; search?: string; hash?: string; state?: unknown };
export type RRRoute = { path?: string; index?: boolean; id?: string };
export type RRMatch = { route: RRRoute; pathname: string; params?: Record<string, string | undefined> };
export type RRNavigation = { state: 'idle' | 'loading' | 'submitting'; location?: RRLocation };
export type RRRouterState = {
    location: RRLocation;
    matches: RRMatch[];
    navigation: RRNavigation;
    // `initialized` gates the initial-load guard. `historyAction` is intentionally NOT typed
    // or read: the open decision keys on the navigation.state transition, not the committed action.
    initialized?: boolean;
};
export type RRDataRouter = {
    subscribe(cb: (state: RRRouterState) => void): () => void;
    state: RRRouterState;
};
```

Verify against the pinned floor before the next `@flareapp/react` publish, as the TanStack vendor file notes.

## Trace model for this slice

- **Pageload**: `configure({ enableTracing: true })` starts the backdated `browser_pageload` root URL-named
  (`source: url`); the integration renames it to the parameterized initial route (`source: route`)
  immediately at registration from `state.matches`. Live location is correct at pageload, so `url.full` is
  correct without the seam override. Fetch/XHR spans nest under it unchanged.
- **Navigation**: each navigation past the initial-load guard (PUSH / POP / REPLACE alike) opens one
  `browser_navigation` root, with `url.full` stamped from the destination URL via the seam extension. A
  **loader navigation** (non-idle loading window) opens the root **held**, timed from navigation start; the
  hold suppresses idle-close across the loader window (and any redirect hops, which rename the same in-flight
  root); the resolving `idle` fire sets the parameterized name (`source: route`) from the committed
  `state.matches` and releases the hold, closing at the settle time (childless) or after trailing fetches
  drain. A **loader-less navigation** (committed in a single `idle` fire, no loading state) opens the root
  **unheld** and names it immediately, then closes on the normal idle lifecycle. History-based detection is
  suppressed by the seam, so exactly one root per navigation.
- **No integration registered**: unchanged (URL-named roots, `flare.route.source: 'url'`).

## Route name & attributes

Identical contract to the TanStack slice: the root **name** is the parameterized route template in RR-native
`:id` syntax (or the raw URL path when unresolvable); `flare.entry_point.handler.identifier` stays in
lockstep with the name; `flare.route.source` (`route` | `url`) distinguishes the two and is set on every
browser root at open (`url`) and flipped by `setActiveRouteName` (pageload / redirect refresh) or
`settleNavigation` (navigation resolve). The key and the broader browser-perf attribute contract remain
**provisional** pending the backend decision (B5/B9/P4).

## Error handling

Instrumentation must never break the host app or its router:

- `router.subscribe` callbacks are wrapped so a tracing error never escapes into RR's state dispatch,
  mirroring the TanStack integration and `browserTracing`'s defensive boundaries.
- Seam operations no-op when there is no active tracing session or no active root. With the navigation hold
  in place, an in-flight navigation root no longer idle-closes mid-load, so `settleNavigation` finds it open
  in the normal slow-loader case. The only residual name-drop window is a navigation that exceeds
  `finalTimeout` (default 30s) or is force-closed by `childSpanTimeout` (a stuck child): the backstop closes
  the root early and `settleNavigation` no-ops, leaving the URL name. That is a genuinely stuck navigation,
  not the common slow-loader case the hold now covers.
- Route-name resolution is guarded: `routeNameFromMatches` runs in a try/catch; empty/pathless/index-only
  match chains fall back to the URL name; router shape reads are defensive against version drift.
- The seam's `new URL(hrefOverride)` parse is guarded and falls back to the live location on a malformed
  URL, so a bad destination href can never throw into root creation.
- Registration is last-wins with token-guarded handles (from the seam); the returned cleanup is safe to
  call zero or multiple times.

## Testing (real-router integration + unit)

- **Unit — js seam extension** (`packages/js/tests`, alongside `browserTracing.test.ts`):
  `startNavigation({ path, url })` opens a `browser_navigation` root whose `url.full` /
  `flare.entry_point.value` reflect the passed destination URL, not the live `location`; a malformed `url`
  falls back to the live location without throwing; the pageload root is unaffected (no override); omitting
  `url` and `hold` preserves the prior live-location + idle-close behavior (TanStack path stays green). With
  `hold: true`: the root does **not** idle-close after `idleTimeout` with no child spans; `settleNavigation`
  then closes a childless root at (approximately) the settle time — its duration spans start→settle, not ~0 —
  and sets the route name; with a child span still open at settle, `settleNavigation` hands back to the idle
  controller and the root closes after the child drains; `finalTimeout` still force-closes a held root that
  never settles.
- **Integration — real react-router** (`packages/react/tests/react-router.integration.test.ts`, adds
  `react-router` devDependency, seam mocked): build a real `createBrowserRouter` and drive real navigations
  via `router.navigate(...)`; assert:
    - `/product/p01` → `startNavigation` once with the destination `url` and `hold: true`, then
      `settleNavigation({ name: '/product/:id', source: 'route' })`.
    - An **index route** (`/`) names `/`, not `//` or `/:index`.
    - A **splat / catch-all** (`path: '*'`, and a nested `files/*`) keeps the wildcard in the name.
    - **Nested params** (`/stores/:storeId/products/:productId`) reconstruct the full template.
    - An **absolute-path child route** exercises the accumulator-reset join branch.
    - A **`POP`** back-navigation (via `router.navigate(-1)` / history) opens a nav root and names it.
    - A **`REPLACE`** navigation (`router.navigate(to, { replace: true })`) opens a nav root and names it
      (REPLACE is not dropped).
    - A navigation with a **slow loader that issues no traced fetch** (an `await` on a timer past
      `idleTimeout`) still lands its parameterized name — the hold kept the root open to settle.
    - The initial pageload names the current route at registration (`source: route`).
- **Unit — fake-router edge cases** (`packages/react/tests/react-router.test.ts`, seam mocked): the
  initial-load guard (a subscribe fire before `state.initialized`/first idle opens no root and does not
  double-name the pageload); a redirect/superseding sequence produces exactly one `startNavigation` and one
  `settleNavigation`; `routeNameFromMatches` throwing → URL fallback; a `__root__`/pathless-only chain → URL
  fallback; revalidation (`navigation.state` stays idle) and a fetcher submission open nothing; cleanup
  unsubscribes and unregisters.
- **Entry test** (`packages/react/tests/react-router.entry.test.ts`, mirrors the TanStack entry test):
  importing `@flareapp/react/react-router` does NOT evaluate the `@flareapp/js` root singleton and does not
  set `window.flare`; the entry exports `traceReactRouter`.

The existing pageload/navigation roots and TanStack unit + entry tests must stay green (the seam extension is
additive; the `url` param is optional and defaults to the prior live-location behavior).

## Items to verify during implementation

- **`react-router` peer-dep floor.** Pin `>=7.0.0 <8` and verify the `DataRouter` surface we read
  (`subscribe` callback signature, `state.navigation.state` values, `state.matches[].route.path`) against
  the pinned floor before publishing. Add `react-router` as a devDependency at the current 7.x.
- **`submitting` handling.** The design treats `submitting` like `loading` (both are `state.navigation`
  transitions that end in a URL change — a `<Form>` action navigation). Confirm against the real router that
  a form-action navigation opens exactly one root named for its final destination, and that a `useFetcher`
  submission (which lives in `state.fetchers`, leaving `state.navigation.state` idle) opens none.
- **Absolute-nested-path join.** The accumulator-reset rule for absolute child `route.path`s is the fiddliest
  branch; cover it explicitly in the integration test with an absolute-path child route.
- **`state.initialized` as the initial-load signal.** Confirm the flip to `true` fires a subscribe and that
  `state.matches` is populated at that point (and synchronously at `createBrowserRouter` for the sync case),
  so the `pageloadNamed` latch names the pageload exactly once and no nav root opens for the initial load.
  Confirm too that RR's initial load does not itself drive `state.navigation.state` non-idle (if it does, the
  guard must still suppress it).
- **Loader-less navigation detection.** Verified in source that a navigation with nothing to load short-
  circuits to `completeNavigation` with no loading state, so detection must also fire on a committed
  `state.location` change (not only the `navigation.state` transition). The real-router integration test uses
  **loader-less** routes for most cases (exercising this path) plus one async-loader route (exercising the
  held path); keep both. Confirm a loader-less nav opens the root **unheld** and a follow-up same-location
  fire (scroll restoration, etc.) does not double-open (guarded by `lastLocationKey`).
- **Navigation hold vs the backstops.** Confirm a held root that never settles is still closed by
  `finalTimeout` / `childSpanTimeout`, that releasing the hold with an open child re-arms idle correctly (no
  double-close, no leaked timer), and that `endNow` (pagehide / superseding registration) on a held root
  behaves. This is the one behavioral change to `IdleRootController`; cover it in `IdleRootController.test.ts`.
- **Hash router `url.full`.** For `createHashRouter`, `origin + navigation.location.pathname` does not
  reconstruct the fragment-encoded URL (`https://app/#/product/1`, not `https://app/product/1`); decide
  whether to serialize via the router's history or accept a known limitation (recorded in follow-ups).
- **basename.** Confirmed as a v1 limitation (names are basename-relative). Decide in a later slice whether to
  port Sentry's opt-in `stripBasename`.
- **Seam function/param names** (`startNavigation({ url, hold })`, `settleNavigation(route)`,
  `collectBrowserSpanContext(config, hrefOverride)`) are provisional; finalize in the plan.

## Out of scope / follow-ups

- **React Router other modes**: declarative `<Routes>` and `useRoutes` (need a hook-based API + a runtime
  `react-router` import + passed-in hooks, à la Sentry's `withSentryReactRouterV7Routing` /
  `wrapUseRoutesV7`), and **framework mode** (Remix-style full-stack; its own SDK-shaped slice with
  server-side instrumentation, à la `@sentry/react-router`). Each reuses this data-mode foundation.
- **Other routers**: Vue Router v4, SvelteKit 2 client (+ its server↔client `traceparent` correlation) —
  each a follow-on slice reusing the seam. The `startNavigation({ url })` extension from this slice is the
  primitive they need for their own pre-commit-URL nav events.
- **basename stripping** — port Sentry's opt-in `stripBasename` if apps need basename-absolute names.
- **Lazy routes** (`patchRoutesOnNavigation`): handled implicitly because we name at resolve (matches
  final), but Sentry's placeholder/upgrade machinery is deliberately not ported; revisit if a real lazy-
  route app shows a naming gap.
- **Hash-router `url.full` fidelity** — a fragment-encoded destination href for `createHashRouter`; note it as
  a known limitation for v1 or serialize via the router's history in a follow-up.
- **Shared integration scaffolding** — the `guard` wrapper, cleanup composition, and in-flight latch are
  near-identical to `tanstack-router.ts`; a shared helper is a candidate cleanup (cf. the theme-B client-SDK
  dedup) but out of scope here.
- **TanStack duration robustness** — TanStack could opt into the same navigation `hold` to capture loader
  duration for its own childless navigations; not changed in this slice (TanStack names at start, so only its
  duration, not its name, is exposed).
- **Route params as span attributes** (Sentry records `url.path.parameter.<name>` per match) — feeds the
  backend attribute-contract discussion; not in this slice.
- **Param-syntax canonicalization** across frameworks — deferred to the backend-contract work.
- **Backend taxonomy/attribute contract** for route names (B5/B9/P4) — the `flare.route.source` key and the
  parameterized-name semantics need backend agreement before real-product correlation; `enableTracing`
  stays opt-in until then.
