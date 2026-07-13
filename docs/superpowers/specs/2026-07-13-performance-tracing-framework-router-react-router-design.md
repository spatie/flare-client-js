# Spec: performance tracing — framework router integration, React Router v7 (data mode)

Status: design approved 2026-07-13. Branch: `react-router-v7-integration`. Validated against Sentry's real
React Router v7 data-router source (`getsentry/sentry-javascript`,
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
`src/tracing/browserTracing.ts`). This slice extends `startNavigation` to carry a destination URL and
threads it through root context collection.

- **`NavigationSource.startNavigation(opts?: { path?: string; url?: string })`** — add `url`, the
  destination href (e.g. `origin + navigation.location.pathname + search + hash`). When provided,
  `startRoot` derives the navigation root's URL context from it instead of the live `location`.
- **`startRoot(flare, spanType, startTimeUnixNano, name, urlOverride?)`** — pass the override to context
  collection. The `browser_pageload` path never passes it (live location correct at pageload); only
  `startNavigation` does.
- **`collectBrowserSpanContext(config, hrefOverride?)`** → threads to **`browserEntryPoint(config,
hrefOverride?)`** and **`request(urlDenylist, hrefOverride?)`**. Each uses `hrefOverride ??
window.location.href` for the URL-derived keys (`url.full`, `flare.entry_point.value`, and the pathname
  for `flare.entry_point.handler.identifier`, parsed via `new URL(hrefOverride)` inside a try/catch that
  falls back to the live location on a malformed URL). The non-URL keys (`user_agent.original`,
  `http.request.referrer`, `document.ready_state`, `host.name`) stay live — they are not destination-
  dependent.

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
- **Pageload enrichment** at registration: read the current `router.state.matches`, resolve the
  parameterized name (below), and call `setActiveRouteName` against the already-running pageload root
  immediately. Guarded so it no-ops if the router is not yet initialized (`state.matches` empty) — the
  first settle then supplies the name.
- Subscribes once via **`router.subscribe((state) => …)`** and tracks the `state.navigation.state`
  transition (`idle` ↔ `loading`/`submitting`), plus a **location key** (`pathname + search + hash`, per
  Sentry's `computeLocationKey`) and an `inFlight` latch:
    - **`idle → non-idle`** (navigation start, latch opens): `dest = state.navigation.location`;
      `nav.startNavigation({ path: dest.pathname, url: hrefOf(dest) })`. This opens the root already
      URL-named (`startRoot` sets `name = path`, `source: 'url'`), so no separate `setActiveRouteName` is
      made here — the committed `state.matches` still reflects the _previous_ route at this point, so no
      parameterized name is available yet. The parameterized name is set once, at resolve.
    - **non-idle while latched, destination changed** (redirect / superseding nav): do **not** open a second
      root. One root per in-flight sequence, matching the TanStack redirect-chain behavior; the final name is
      applied once at resolve from the committed matches (an optional URL-name refresh to the new destination
      is possible but not required).
    - **`non-idle → idle`** (navigation resolved, latch closes): resolve the parameterized name from the now-
      committed `state.matches` and call `setActiveRouteName({ name, source: 'route' })`, falling back to
      `state.location.pathname` / `source: 'url'` when no route-derived name is available. The idle controller
      closes the root as today.
- **Initial-settle guard** (ported from Sentry's `isInitialPageloadComplete` / `hasSeenPopAfterPageload`):
  ignore `navigation.state` transitions until the first `idle` state after registration has been observed,
  so RR's hydration-time subscribe (which can arrive as a `POP`/`REPLACE`) is not mistaken for a
  navigation. Only a `PUSH`, or a `POP` after the initial pageload, opens a nav root. The pageload
  enrichment above handles naming the initial route; this guard only prevents a spurious _navigation_ root.
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
    historyAction?: 'POP' | 'PUSH' | 'REPLACE';
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
- **Navigation**: each qualifying `idle → non-idle` transition (past the initial-settle guard) opens one
  `browser_navigation` root, timed from navigation start, with `url.full` stamped from the destination URL
  via the seam extension; the `non-idle → idle` transition sets the parameterized name (`source: route`)
  from the committed `state.matches`; redirect/superseding hops rename the same in-flight root; the idle
  controller closes it. History-based detection is suppressed by the seam, so exactly one root per
  navigation.
- **No integration registered**: unchanged (URL-named roots, `flare.route.source: 'url'`).

## Route name & attributes

Identical contract to the TanStack slice: the root **name** is the parameterized route template in RR-native
`:id` syntax (or the raw URL path when unresolvable); `flare.entry_point.handler.identifier` stays in
lockstep with the name; `flare.route.source` (`route` | `url`) distinguishes the two and is set on every
browser root at open (`url`) and flipped by `setActiveRouteName`. The key and the broader browser-perf
attribute contract remain **provisional** pending the backend decision (B5/B9/P4).

## Error handling

Instrumentation must never break the host app or its router:

- `router.subscribe` callbacks are wrapped so a tracing error never escapes into RR's state dispatch,
  mirroring the TanStack integration and `browserTracing`'s defensive boundaries.
- Seam operations no-op when there is no active tracing session or no active root; `setActiveRouteName`
  no-ops if the active root already closed (e.g. a slow load past the idle timeout), leaving the URL name.
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
  `url` preserves the prior live-location behavior (TanStack path stays green).
- **Integration — real react-router** (`packages/react/tests/react-router.integration.test.ts`, adds
  `react-router` devDependency, seam mocked): build a real `createBrowserRouter` and drive real navigations
  via `router.navigate(...)`; assert:
    - `/product/p01` → `startNavigation` once with the destination `url`, then
      `setActiveRouteName({ name: '/product/:id', source: 'route' })`.
    - An **index route** (`/`) names `/`, not `//` or `/:index`.
    - A **splat / catch-all** (`path: '*'`, and a nested `files/*`) keeps the wildcard in the name.
    - **Nested params** (`/stores/:storeId/products/:productId`) reconstruct the full template.
    - A **`POP`** back-navigation (via `router.navigate(-1)` / history) opens a nav root and names it.
    - The initial pageload names the current route at registration (`source: route`).
- **Unit — fake-router edge cases** (`packages/react/tests/react-router.test.ts`, seam mocked): the
  initial-settle guard (a hydration `POP` before the first idle opens no root); a redirect/superseding
  sequence produces exactly one root, renamed once at resolve; `routeNameFromMatches` throwing → URL
  fallback; a `__root__`/pathless-only chain → URL fallback; revalidation (`navigation.state` stays idle)
  opens nothing; cleanup unsubscribes and unregisters.
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
- **basename.** Confirmed as a v1 limitation (names are basename-relative). Decide in a later slice whether to
  port Sentry's opt-in `stripBasename`.
- **Seam function/param names** (`startNavigation({ url })`, `collectBrowserSpanContext(config, hrefOverride)`)
  are provisional; finalize in the plan.

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
- **Route params as span attributes** (Sentry records `url.path.parameter.<name>` per match) — feeds the
  backend attribute-contract discussion; not in this slice.
- **Param-syntax canonicalization** across frameworks — deferred to the backend-contract work.
- **Backend taxonomy/attribute contract** for route names (B5/B9/P4) — the `flare.route.source` key and the
  parameterized-name semantics need backend agreement before real-product correlation; `enableTracing`
  stays opt-in until then.
