# Spec: performance tracing — framework router integration, SvelteKit 2

## Context

Flare's browser performance tracing already emits `browser_pageload` and `browser_navigation` root
spans, plus nested `browser_fetch` / `browser_xhr` spans. Framework router integrations replace the
generic URL-based span name (`/product/p01`) with the parameterized route template (`/product/[id]`)
and set a `flare.route.source` attribute (`route` vs `url`). Three such integrations have shipped:

- `@flareapp/react/tanstack-router` — `traceTanStackRouter(router)` (PR #69).
- `@flareapp/react/react-router` — `traceReactRouter(router)` (PR #72).
- `@flareapp/vue` — wired through `app.use(flareVue, { router })` (PR #74).

All three build on the **navigation-source seam** in `@flareapp/js` (exported from
`@flareapp/js/browser` as `registerNavigationSource()`), which lets an integration drive navigation
instead of the built-in History-API detection:

- `startNavigation({ path, url?, hold? })` — `url` overrides the nav root's `url.full` (for routers
  that resolve the destination before the browser URL commits); `hold` opens the root idle-suppressed.
- `settleNavigation(route)` — names the root and releases the hold.
- `setActiveRouteName(route)` — (re)names the active root + `flare.route.source` in lockstep.
- `unregister()` — releases any hold and hands navigation back to the built-in detection.

This slice adds the **SvelteKit 2** client integration — the last router on the original
carry-forward list. **This slice requires no change to the seam**: `hold`, `url`, and
`settleNavigation` already exist from PR #72, and SvelteKit is exactly the pre-URL-commit shape they
were built for.

Reference: Sentry's `@sentry/sveltekit` `browserTracingIntegration` guided the approach. Where this
spec diverges from Sentry, the divergence is called out and justified — see
"Deliberate divergences from Sentry".

## Approved decisions driving this spec

1. **Client router only.** Server-side spans and server→client trace correlation are out of scope:
   `@flareapp/node` has no tracing instrumentation at all today (no spans, no traceparent), so there
   is no server trace to correlate a client pageload with. Sentry's `<meta name="sentry-trace">`
   injection via `transformPageChunk` has no Flare analog to build against yet.
2. **Seam = `navigating` from `$app/state`, observed with `$effect`.** Not `$app/stores` (Sentry's
   choice), not `beforeNavigate`/`afterNavigate`. Rationale in "Seam selection" below.
3. **Route names use SvelteKit's native bracket syntax verbatim** — `/product/[id]`, from
   `page.route.id`. No normalization to `:id`. Matches Sentry, and matches this repo's precedent of
   preserving each router's native template syntax (vue-router and react-router emit `:id` only
   because that is what those routers natively use).
4. **Public surface = `traceSvelteKitRouter()`**, a standalone export from `@flareapp/sveltekit/client`
   called from `hooks.client.ts`. SvelteKit has no router object to pass and no plugin system, so the
   vue `app.use(plugin, { router })` shape has no analog; a call at client init is the idiomatic
   SvelteKit equivalent, and it sits alongside the existing `trackRouteContext()` rather than changing
   what that already-published API does.
5. **No call-time `enableTracing` gate.** The call is order-independent with respect to
   `flare.configure()`, matching `traceReactRouter` ("Safe to call before or after tracing is enabled;
   no-ops when off"). Rationale in "Why no enableTracing gate" below.
6. **Deliverables:** implementation + unit tests + playground wiring and e2e. **No README section**
   (explicitly not selected). Limitations are documented in terse JSDoc on the export instead.

## Seam selection (decided; recorded because the reasoning is load-bearing)

Three candidate seams were evaluated against SvelteKit 2.67 source.

| Seam                                       | Wireable from `hooks.client.ts` | Synchronous         | Deprecated |
| ------------------------------------------ | ------------------------------- | ------------------- | ---------- |
| `navigating` from `$app/stores` (Sentry's) | yes                             | yes                 | yes        |
| `navigating` from `$app/state`             | yes                             | no (effect-batched) | no         |
| `beforeNavigate` / `afterNavigate`         | **no**                          | yes                 | no         |

- **`beforeNavigate`/`afterNavigate`/`onNavigate` were rejected**: all three go through
  `add_navigation_callback` (client.js:2213), which wraps `onMount`, so they require component context
  and can only be wired from a `+layout.svelte`. Separately, `onNavigate` fires at client.js:1884 —
  _after_ load functions have already run — so it cannot time a navigation's start. And a navigation
  cancelled by a later `beforeNavigate` guard would strand a held root until the 30s `finalTimeout`.
- **`$app/stores` was rejected despite being Sentry's choice.** Sentry's peer ranges explain why they
  use it: `@sentry/svelte` supports `svelte: 3.x || 4.x || 5.x` and `@sentry/sveltekit` supports
  `@sveltejs/kit: 2.x` down to 2.0. `$app/state` requires Svelte 5 **and** Kit 2.12+, so Sentry
  cannot use it — their source carries a `TODO(v11)` to migrate once Svelte 5 becomes their floor.
  `@flareapp/sveltekit` already peers `svelte: ^5.3.0` and `@sveltejs/kit: ^2.12.0`, so that
  constraint does not bind us. Copying `$app/stores` would mean adopting a deprecated API to solve a
  compatibility problem we do not have.
- **`$app/state` selected.** It is the API Kit's own docs mandate, and it matches the existing
  `trackRouteContext.svelte.ts`. Its one weakness — `$effect` batching, discussed next — is
  neutralized by a fallback branch already proven in `react-router.ts`.

### The batching risk, and why it is contained

`$app/state`'s `navigating` is a façade of flattened getters (`from`, `to`, `type`, `willUnload`,
`delta`, `complete`) defined in `runtime/app/state/client.js:36-54`, each reading `_navigating.current`
— a `$state.raw(null)` field on a class instance in `runtime/client/state.svelte.js:44-46`. Note the
façade deliberately exposes **no** `current`: `client.js:59-62` defines a `current` property that
throws in DEV. Reading any of the getters requires an `$effect`, and Svelte flushes effects on a
microtask. Kit sets `navigating` non-null at client.js:1735 and null at client.js:2023, with
`await load_route(intent)` in between — so microtask FIFO ordering means the effect will observe the
non-null state in practice. But that is a guarantee resting on ordering between two libraries'
internals, and its failure mode is _silent_: a dropped span.

The containment: if an effect ever did coalesce non-null→null into one run, the committed `page.url`
would still have changed while `inFlight` is false. That is exactly the "loader-less navigation" case
`packages/react/src/react-router.ts:115-122` already handles — open the root un-held and name it
immediately. Worst case therefore degrades from _a silently dropped span_ to _an instant,
correctly-named navigation root_.

## Why no `enableTracing` gate (decided; diverges from `flareVue`)

`flareVue` gates `traceVueRouter` on `flare.config?.enableTracing` at call time (`fdac544`). That gate
does not transfer here, and copying it would be a net loss.

- **Vue's rationale is host mutation.** `fdac544`'s stated reason is that `traceVueRouter` "attaches
  no-op guards to the host's router". Vue's integration reaches into an object the app owns and
  installs `beforeEach` / `afterEach` guards on it. SvelteKit has no router object to hand us and
  nothing to attach to: `traceSvelteKitRouter` owns its own `$effect.root` and touches nothing of the
  host's. There is no host-mutation cost to avoid, only one dead effect root and one dead nav source.
- **`traceReactRouter` is the closer analog and deliberately has no gate.** Its JSDoc reads "Safe to
  call before or after tracing is enabled; no-ops when off." This slice ports its branch logic; it
  should port its contract too.
- **The gate's failure mode is silent, and SvelteKit is the worst place for it.** `hooks.client.ts` is
  module scope, so import-evaluation order decides everything, and this package already does
  order-sensitive work at module scope (`src/client/handleError.ts:5` calls `trackRouteContext()` as
  an import side effect). Under a call-time gate, calling `traceSvelteKitRouter()` one line before
  `flare.configure()` yields no spans, forever, with no error and no warning. Trading a silent
  permanent misconfiguration for the avoidance of one no-op effect is the wrong way round.

The seam already no-ops when tracing is off, so an ungated call is inert rather than harmful. The
`enableTracing` check therefore moves **inside** the effect body (branch 0 below), which additionally
means an app that enables tracing after client init still gets named roots.

## SvelteKit lifecycle facts (verified against `@sveltejs/kit@2.67.0` source)

All line numbers refer to `node_modules/@sveltejs/kit/src/runtime/client/client.js`.

- **Navigation ordering in `navigate()`** (defined at :1689): `_before_navigate()` runs `beforeNavigate`
  callbacks (:1663) → `accept()` → `is_navigating = true` (:1732) →
  `stores.navigating.set((navigating.current = nav.navigation))` (:1735) → `await load_route(intent)`
  (:1738) → `history.pushState` / `history.replaceState` commits the URL (:1855) → `onNavigate`
  callbacks (:1884) → `is_navigating = false` (:2006) → `afterNavigate` callbacks (:2015) →
  `stores.navigating.set((navigating.current = null))` (:2023).
- **`navigating` emits before the URL commits.** `window.location` is still the _old_ URL when
  `navigating` goes non-null. The destination must be passed explicitly — this is what the seam's
  `url` override (PR #72) exists for.
- **The initial load never emits `navigating`**: guarded by `if (started && nav.navigation.type !== 'enter')`
  at :1734. Pageload therefore stays cleanly separate from navigation, with no `initialized`-style
  flag needed.
- **Cancelled navigations never emit `navigating`**: `cancel()` sets `should_block`, `_before_navigate`
  returns `null` (:1666), and `navigate()` early-returns before :1735. Nothing to strand.
- **`new URL('a:').origin` is the string `'null'`** (verified in node), so the branch-1 placeholder
  guard `page.url.origin !== location.origin` is sound.
- **`beforeNavigate` does not re-fire during redirects**: guarded by `if (!is_navigating)` (:1661).
  But `navigating` **re-emits a new non-null value with no `null` in between** on a redirect.
- **Shallow routing does not touch `page.url`.** `pushState` (:2477) sets `page.state` (:2508) and
  calls `history.pushState` (:2505), but never assigns `page.url`. A `page.url`-keyed fallback
  therefore cannot fire for shallow routing.
- **Hash navigation _does_ touch `page.url`.** `update_url()` (:2956) does `current.url = page.url = url`,
  called from :2766 / :2871 / :2906 for hash-only changes. This is why the fallback key must exclude
  the hash.
- **`page` is unpopulated before hydration.** `client/state.svelte.js` initializes `page.url` to
  `new URL('a:')` (a placeholder) and `page.route` to `{ id: null }`. An effect created in
  `hooks.client.ts` can run against this placeholder state.
- **`to.route.id` is `null` for routes SvelteKit does not own**, and `navigation.willUnload` is true
  for `'leave'` navigations and for `'link'` navigations where `to.route === null` (documented at
  :2237-2241). Both mean the document is about to unload.
- **`navigation.type` values**: `'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate'`. Both
  `goto()` and `redirect()` surface as `'goto'`.

## Components

### 1. `packages/sveltekit/src/client/traceSvelteKitRouter.svelte.ts` (new)

The whole integration. The `.svelte.ts` extension is required for runes and matches the existing
`trackRouteContext.svelte.ts`.

```ts
import { navigating, page } from '$app/state';
import { flare } from '@flareapp/js';
import { insulate, registerNavigationSource, safeInvoke, type RouteName } from '@flareapp/js/browser';
```

Signature:

```ts
export function traceSvelteKitRouter(): () => void;
```

Guards, in order:

1. **Idempotence.** A module-level `tracing` flag, mirroring `trackRouteContext`'s `tracking` flag.
   A second call returns a no-op cleanup.
2. **Browser only.** No-op when `typeof window === 'undefined'` (SSR import safety).

There is deliberately **no call-time `enableTracing` gate** — see "Why no `enableTracing` gate" above.
The check lives in branch 0 instead.

Internal state:

```ts
const nav = registerNavigationSource();
const keyOf = (url: URL): string => url.pathname + url.search; // hash EXCLUDED — see limitations
let lastKey = location.pathname + location.search; // the last committed location we accounted for
let inFlight = false;
```

`lastKey` is mutable and must be re-stamped on every commit the state machine accounts for (branches
5 and 7 below; branch 6 only fires when the key already matches, so it has nothing to stamp).
Anchoring on a frozen `initialKey` instead would make branch 7 fire on every effect re-run after the
first navigation, fabricating a spurious navigation root each time Kit reassigned `page.url`. This
mirrors `lastLocationKey` in `react-router.ts` — note that file stamps in three places (init,
`namePageload`, and both settle paths), because its pageload phase can also move the committed
location via an initial-load redirect.

Route naming:

```ts
const routeNameFor = (routeId: string | null | undefined, url: URL): RouteName =>
    routeId ? { name: routeId, source: 'route' } : { name: url.pathname, source: 'url' };
```

### Reads and branching are separate functions

**All four reactive reads — `navigating.to`, `navigating.willUnload`, `page.route?.id`, `page.url` —
must happen unconditionally, before any branching.** Svelte tracks dependencies as they are read, so
an early `return` placed before the `navigating.to` read would silently stop the effect from ever
re-running on navigation. This is the single easiest way to get this file wrong.

Rather than leave that as a comment someone must remember, the structure enforces it: the `$effect`
does nothing but take a snapshot, and a **pure, exported** function does all the branching.

```ts
export type NavSnapshot = {
    to: { url: URL; route?: { id: string | null } } | null;
    willUnload: boolean;
    routeId: string | null | undefined;
    url: URL;
};

/** Advance the state machine for one observed snapshot. Exported for unit tests; not public API. */
export function syncNavigation(snapshot: NavSnapshot): void;
```

The effect reads every field into the snapshot object literal, so the reads are structurally
unconditional — there is no control flow in the effect to short-circuit them. `syncNavigation` takes
plain data and never touches `$app/state`, so unit tests drive it directly with no Svelte scheduler,
no `flushSync`, and no fake runes. This is what makes the sixteen cases below cheap to write.

`syncNavigation` is exported from the module but **not** re-exported from `client/index.ts`, so it is
not public API.

The branch table below names the reads at their source (`page.url`, `page.route?.id`, `to`,
`willUnload`) because that is where the behaviour is easiest to reason about. In the implementation
these are the snapshot fields: `page.url` → `snapshot.url`, `page.route?.id` → `snapshot.routeId`.

| #   | Condition                                              | Action                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `!flare.config?.enableTracing`                         | `return` — tracing off; re-checked every run, so enabling tracing after client init still works                                                                                                                                                                                                                         |
| 1   | `page.url.origin !== location.origin`                  | `return` — Kit's pre-hydration `a:` placeholder                                                                                                                                                                                                                                                                         |
| 2   | `to` set, and (`willUnload` or `to.route?.id == null`) | `return` — document will unload; the next document's pageload covers it                                                                                                                                                                                                                                                 |
| 3   | `to` set, `!inFlight`                                  | `inFlight = true`; `nav.startNavigation({ path: to.url.pathname, url: to.url.href, hold: true })`; then `nav.setActiveRouteName(routeNameFor(to.route.id, to.url))`                                                                                                                                                     |
| 4   | `to` set, `inFlight`                                   | `nav.setActiveRouteName(routeNameFor(to.route.id, to.url))` only — redirect hop, keep the single held root                                                                                                                                                                                                              |
| 5   | `to` null, `inFlight`                                  | `inFlight = false`; `lastKey = keyOf(page.url)`; `nav.settleNavigation(routeNameFor(page.route?.id, page.url))`                                                                                                                                                                                                         |
| 6   | `to` null, `!inFlight`, `keyOf(page.url) === lastKey`  | `nav.setActiveRouteName(routeNameFor(page.route?.id, page.url))` — pageload naming; also re-runs harmlessly when `route.id` resolves late, or when Kit reassigns `page.url` / `page.route` to an equivalent value (the root is either still open and gets the same name, or already closed and `applyRouteName` no-ops) |
| 7   | `to` null, `!inFlight`, `keyOf(page.url) !== lastKey`  | **coalescing fallback**: `lastKey = keyOf(page.url)`; `nav.startNavigation({ path, url: page.url.href })` un-held, then `nav.settleNavigation(...)` immediately                                                                                                                                                         |

Branch 7 is the containment described above. It is expected to be dead code in practice; the e2e
suite is what proves that (see Testing).

**Branch 2's two conditions are one condition, not two.** `create_navigation` sets
`willUnload: !intent` (client.js:3334) and `to.route.id = intent?.route?.id ?? null` (:3329), so
`willUnload` is true exactly when `to.route.id` is null. The disjunction is belt-and-braces against
Kit's internals shifting, not two distinct cases; do not read it as covering `type: 'leave'`. Leave
navigations never reach the branch at all: the `'leave'` navigation object is built locally in the
`beforeunload` handler (:2641) and passed only to `before_navigate_callbacks` — it is never assigned
to `navigating.current`. The branch **is** reachable, via a `'link'` navigation to a route Kit does
not own, which does reach :1735 with `willUnload` true before Kit falls back to a native navigation.

Structure:

```ts
const dispose = $effect.root(() => {
    $effect(
        insulate(() =>
            // The reads are the whole effect body. No control flow here — see above.
            syncNavigation({
                to: navigating.to,
                willUnload: navigating.willUnload,
                routeId: page.route?.id,
                url: page.url,
            }),
        ),
    );
});

return () => {
    safeInvoke(dispose);
    safeInvoke(() => nav.unregister());
    tracing = false;
};
```

`nav.unregister()` releases any outstanding hold (per the seam's contract from PR #72), so a cleanup
mid-navigation cannot strand a held root until `finalTimeout`.

### 2. `packages/sveltekit/src/client/app-state.d.ts` (edit) — REQUIRED, not optional

This package builds standalone (`svelte-package -i src -o dist`, `tsc --noEmit`) with no SvelteKit app
around it, so there is no generated `.svelte-kit/ambient.d.ts`. This hand-written shim is the **only**
type source for `$app/state`, and it currently declares `page` alone:

```ts
declare module '$app/state' {
    const page: { url: URL; params: Record<string, string>; route: { id: string | null } };
}
```

`import { navigating } from '$app/state'` does not typecheck until `navigating` is added. Extend it to
match the real façade (`runtime/app/state/client.js:36-54`) — flattened getters, and **no `current`**:

```ts
declare module '$app/state' {
    const page: { url: URL; params: Record<string, string>; route: { id: string | null } };
    const navigating: {
        from: { url: URL; route: { id: string | null } } | null;
        to: { url: URL; route: { id: string | null } } | null;
        type: 'form' | 'leave' | 'link' | 'goto' | 'popstate' | null;
        willUnload: boolean;
        delta: number | null;
        complete: Promise<void> | null;
    };
}
```

Declare only what Kit really exposes. Adding a `current` field here would type-sanction a read that
throws at runtime in DEV.

### 3. `packages/sveltekit/src/client/index.ts` (edit)

Add one line:

```ts
export { traceSvelteKitRouter } from './traceSvelteKitRouter.svelte.js';
```

`syncNavigation` is **not** exported here — it is a test seam, not public API. No change to
`packages/sveltekit/src/index.ts` either; this is client-only, matching how `trackRouteContext` is
exposed only from `/client`.

### 4. `packages/sveltekit/package.json` (edit, pre-publish)

Raise the `@flareapp/js` peer floor from `^2.6.0` to the version shipping `insulate` / `safeInvoke` /
the nav seam. See "Pre-publish carry-forward".

## Trace model for this slice

Unchanged from the other router slices — this integration only _names_ roots that already exist:

- One `browser_pageload` root per document, named from `page.route.id` once hydration resolves it.
- One `browser_navigation` root per SvelteKit client navigation, opened **held** at `navigating`
  non-null (before load functions run), named from `to.route.id`, settled at `navigating` null.
- A redirect chain produces **one** navigation root, re-named to the final destination.
- `browser_fetch` / `browser_xhr` spans nest under whichever root is active, unchanged.

## Route name & attributes

- `flare.entry_point.handler.identifier` and the span name: `page.route.id` / `to.route.id` verbatim,
  e.g. `/product/[id]`, `/blog/[...slug]`, `/[[lang]]/about`.
- `flare.route.source`: `'route'` when a route id was available, `'url'` when it was not (falling back
  to `url.pathname`).
- No `routeLabel` toggle, no `custom` source, no per-param or per-query span attributes — consistent
  with the vue-router slice.

## Deliberate divergences from Sentry

| Topic                 | Sentry                                        | This spec                          | Why                                                                                                                                                                          |
| --------------------- | --------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seam                  | `$app/stores` (deprecated)                    | `$app/state`                       | Sentry supports Svelte 3/4 + Kit 2.0 and _cannot_ use `$app/state`; they have a `TODO(v11)` to switch. Our peers are already Svelte 5 + Kit 2.12+.                           |
| Redirects             | ends the first span, starts a second          | one held root, re-named            | Sentry's reason is a span-status artifact of their model, which Flare does not share. One root per user-perceived navigation matches the vue-router and react-router slices. |
| Query-only navigation | no span (pathname-only compare)               | real navigation span               | SvelteKit re-runs load functions for a query change, so it is real work. vue-router (`fullPath`) and react-router (`pathname+search+hash`) already count these.              |
| Pageload naming       | `page.subscribe` callback, never unsubscribed | scoped effect, disposed by cleanup | Sentry's subscription keeps firing after the pageload span has ended, calling `updateName` on a dead span. Our cleanup disposes the effect root.                             |

Matching Sentry deliberately: bracket-syntax route names, no span for shallow routing, no span for
hash-only navigation, no span for cancelled navigations, and `type: 'enter'` never producing a
navigation.

## Error handling

Identical to the vue and react slices — instrumentation must never throw into the host app:

- The effect body is wrapped in `insulate` (from `@flareapp/js/browser`), so a throw from
  `syncNavigation` can never escape into Kit's effect scheduler.
- Cleanup uses `safeInvoke` for both the effect-root dispose and `nav.unregister()`.
- `routeNameFor` reads are defensive (`page.route?.id`, `to.route?.id`); no assumption that Kit's
  state is well-formed.
- With tracing off, branch 0 returns before any seam call, so the attached effect is inert.

## Testing

### Unit — `packages/sveltekit/tests/client/traceSvelteKitRouter.test.ts` (new)

The split above is what makes this suite tractable: **cases 3-14 call `syncNavigation(snapshot)`
directly** with a plain object. No Svelte scheduler, no `flushSync`, no `$effect` in the test, and no
need to simulate rune reactivity. Only cases 1, 2 and 15 exercise `traceSvelteKitRouter()` itself
(registration, idempotence, cleanup).

`@flareapp/js/browser` is mocked to capture seam calls (the pattern the five react test mocks already
use — note they had to add `insulate`/`safeInvoke` to their mock factory, per the PR #74
carry-forward). `flare.config.enableTracing` is mocked true for cases 2-14.

The `tests/__mocks__/app-state.ts` alias mock needs `navigating` added for the cases that mount the
effect. Shape it as the real flattened façade (`to`, `willUnload`, …), **not** `{ current }`.
Backward compatibility with `getRouteContext.test.ts` is a non-issue: that file supplies its own
`vi.mock('$app/state', () => ({ page: mockPage }))` factory exporting only `page`, so it overrides the
alias entirely and cannot see a new export.

Because `syncNavigation` holds module-level state (`inFlight`, `lastKey`, `tracing`), each test needs
a fresh module — `vi.resetModules()` plus a dynamic import in `beforeEach`, or an exported reset.
Pick one and be consistent; a leaked `inFlight` between cases makes 3/4/5 pass or fail in file order.

Cases:

1. Tracing off at call time then enabled later → `registerNavigationSource` **is** called at call
   time, and a snapshot delivered after `enableTracing` flips true still names the root. This pins
   the order-independence decision; it is the inverse of the vue gate's test.
2. Second call is idempotent (no second nav source).
3. Pre-hydration placeholder `page.url` (`a:` origin) → no seam calls (branch 1).
4. Pageload naming from `page.route.id` → `setActiveRouteName({ name: '/product/[id]', source: 'route' })`.
5. Pageload with `route.id === null` → `source: 'url'`, name is the pathname.
6. Late-resolving `route.id` at the initial key → re-names the pageload root, opens no nav root.
7. Navigation start → `startNavigation` with `hold: true`, `url` = destination href, `path` =
   destination pathname; then named from `to.route.id`.
8. Navigation settle → `settleNavigation` with the committed `page.route.id`.
9. Redirect (non-null → non-null, no null between) → exactly **one** `startNavigation`, final name applied.
10. `willUnload` true → no `startNavigation` (branch 2).
11. `to.route.id == null` (external / unowned route) → no `startNavigation` (branch 2).
12. Hash-only `page.url` change while idle → no `startNavigation` (key excludes hash).
13. Coalescing fallback (branch 7): key changes while idle and not in flight → `startNavigation`
    **without** `hold`, followed immediately by `settleNavigation`.
14. **`lastKey` re-stamp regression**: after a navigation settles, a further snapshot at the same
    committed key must **not** call `startNavigation` again. This pins the bug that a frozen
    `initialKey` would have introduced. (In production this re-run arises from Kit reassigning
    `page.url` / `page.route` as fresh object references into `$state.raw`, not from `page.data`
    changing — the effect never reads `page.data`, so a data-only change cannot retrigger it.)
15. Cleanup → disposes the effect root and calls `nav.unregister()`.
16. **Branch 0 does not consume the transition**: with tracing off, a `to`-set snapshot followed by a
    `to`-null snapshot must leave `inFlight` false, so the next real navigation still opens a root.
    Guards against branch 0 returning after `inFlight` was already mutated.

### E2E — `e2e/specs/svelte.spec.ts` (edit)

This is the gate that answers the batching question against real SvelteKit, and it is the reason the
playground work is in scope rather than optional. Mirrors the react-router specs from PR #73, reusing
`e2e/specs/otlp.ts` (`spansOf`, `attr`, `hasSpanType`):

1. **Pageload root carries the parameterized route** — deep-link `/product/p01`, assert the
   `browser_pageload` root is named `/product/[id]` with `flare.route.source === 'route'`.
2. **Navigation root carries the parameterized route** — load `/`, click through to a product, assert
   a `browser_navigation` root named `/product/[id]` with `source: 'route'` and a correct `url.full`
   (this is what proves the `url` override works for Kit's pre-URL-commit emission).
3. **A hash-only change produces no navigation root.**
4. **An effect created at client init observes the non-null `navigating` state** — the batching gate.
   See below; this is the only one of the four that can fail for the reason this section exists.
5. **Regression**: the existing svelte error-scenario specs still pass with tracing enabled.

#### The span assertions cannot settle the batching question. A probe can.

An earlier draft of this spec claimed test 2 would expose batching, on the theory that a coalesced
navigation yields "an un-held, zero-duration root" distinguishable from "a held root spanning the
load". **That is wrong, and the reason is worth recording so nobody re-derives it.**

- **No playground route has a load function.** The whole tree is bare `+page.svelte` (`/`, `/broken`,
  `/cart`, `/checkout`, `/confirmation`, `/product/[id]`); the only load in the playground is
  `server-error/+page.server.ts`. So there is no load for a held root to span.
- **Both shapes therefore emit the same span.** Branch 3→5 and branch 7 produce one root, same name,
  same `url.full`. Both end via the same idle lifecycle, so their durations differ only by the
  navigation's load time — which is ~0 here.
- **`hold` is internal state.** It never reaches the wire, so no assertion can read it.

Note the absence of loads is not a defect to fix: a sub-millisecond non-null window is the _hardest_
case for batching, so it is the strongest test available. The problem is purely that spans cannot
report the outcome. So observe the transitions directly, in the playground, never in the SDK:
a `navProbe.svelte.ts` module with its own `$effect.root` that pushes each `navigating` transition
onto `window.__navStates`, mirroring the SDK's effect shape (an effect root created from a
`.svelte.ts` module invoked by `hooks.client.ts`). Test 4 clicks through to a product and asserts
`__navStates` contains `to:/product/p01` and settles back to `null`.

The probe's effect is not the SDK's effect, so this is evidence rather than proof — but it is the
only direct read available on the assumption the whole seam choice rests on, and it beats a green
suite that proves nothing. If the `to:` entry is absent, effect batching is real: branch 7 is
load-bearing rather than dead code, the span assertions stay green while doing so, and the seam
decision (`$app/state` vs `$app/stores`) must be revisited rather than silently shipping.

## Playground

`playgrounds/svelte` currently does **not** enable tracing (`src/lib/flare.client.ts` sets
`enableLogs` but no `enableTracing`). Enabling it is **not** a one-line change: mirror
`playgrounds/react-router/src/flare.ts` in full, or the e2e suite cannot pass regardless of whether
the integration works.

1. `playgrounds/svelte/src/lib/flare.client.ts` — inside the existing `if (url)` block (the
   fake-server override, e2e only), add the traces ingest and the e2e timing overrides:

```ts
flare.configure({
    ingestUrl: url,
    logsIngestUrl: url.replace('/v1/errors', '/v1/logs'),
    tracesIngestUrl: url.replace('/v1/errors', '/v1/traces'), // without this, spans go to the
    // production ingest and the fake server never sees them: every tracing assertion times out.
    // e2e-only timing: keep the root active long enough for a prompt Playwright click to nest under
    // it, then flush an ended root fast so arrival assertions don't wait out the 5s default.
    idleTimeout: 2000,
    spanFlushIntervalMs: 500,
});
```

and in the unconditional `flare.configure({ ... })` block, alongside `enableLogs: true`:

```ts
enableTracing: true,
tracesSampleRate: 1, // redundant (Flare.ts:58 already defaults to 1) but explicit, matching
// react-router: it pins full sampling against a future default change rather than leaving the
// suite's determinism resting on one.
```

`enableTracing` and `tracesSampleRate` go in the **unconditional** block, not the `if (url)` one,
so a manual `npm run playgrounds:svelte` run still exercises the tracer (spans just fail to send,
exactly as the error reports already do).

2. `playgrounds/svelte/src/lib/navProbe.svelte.ts` (new) — the batching probe described in the E2E
   section. An `$effect.root` over `navigating` that pushes each observed transition onto
   `window.__navStates`. The `.svelte.ts` extension is required for runes, and it must be its own
   module: `hooks.client.ts` is plain `.ts` and Svelte will not compile runes there.

3. `playgrounds/svelte/src/hooks.client.ts` — call `traceSvelteKitRouter()` and the probe:

```ts
import { initFlareClient } from '$lib/flare.client';
import { startNavProbe } from '$lib/navProbe.svelte';
import { handleErrorWithFlare, traceSvelteKitRouter } from '@flareapp/sveltekit/client';

initFlareClient();
traceSvelteKitRouter();
startNavProbe();

export const handleError = handleErrorWithFlare();
```

Ordering here is conventional, not required — there is no call-time gate, so an earlier call would
still work. Keep it after `initFlareClient()` for readability.

4. **Decide whether to expose `globalThis.__flare`.** `playgrounds/react-router/src/flare.ts` ends
   with `(globalThis as { __flare?: typeof flare }).__flare = flare;` so the suite can drive the
   tracer directly. The e2e tests above do not need it; add it only if one turns out to.

The existing `/product/[id]` route already provides the parameterized case; no new routes are needed.

## Documented limitations (JSDoc on the export, not README)

Lead with the contract, mirroring `traceReactRouter`'s: safe to call before or after tracing is
enabled, no-ops when off, returns a cleanup. Then the limitations:

- Shallow routing (`pushState` / `replaceState` from `$app/navigation`) produces no navigation root.
- Hash-only navigation produces no navigation root.
- Navigations cancelled by a `beforeNavigate` guard produce no navigation root.
- Navigations to routes SvelteKit does not own produce no navigation root; the resulting full document
  load surfaces as a pageload instead.

## Items to verify during implementation

1. **Does `$app/state`'s `navigating` actually reach a `$effect` created in `hooks.client.ts`?** The
   effect root is created outside any component. Confirm it flushes and observes both transitions —
   this is the core assumption, and the e2e navigation test is the proof. Encouraging precedent:
   `src/client/handleError.ts:5` already calls `trackRouteContext()` at module scope on import, so an
   effect root created from `hooks.client.ts` is a shape this package already ships. That proves the
   root runs; it does not prove `navigating`'s two transitions both survive batching.
2. **Is `page.url.origin !== location.origin` a sound placeholder guard?** `new URL('a:').origin` is
   the string `'null'`, so the guard should hold. Confirm against a real hydration, and confirm it
   does not misfire for hash-mode routing.
3. **Confirm branch 6 does not mis-handle an initial-load redirect.** A `redirect()` thrown from a
   load during hydration may route through `navigate()` and emit `navigating`, producing a pageload of
   the original URL plus a navigation root to the target. Decide whether that is acceptable (leaning:
   yes, it is arguably correct, and Sentry has the same shape) and document it.
4. **`page.route.id` reactivity vs. Kit's route proxy.** Sentry's server-side `getRouteId()` reads
   `route.id` via `untrack()` specifically to avoid triggering a proxy that invalidates server `load`
   data on every navigation. Verify that reading `page.route.id` inside a client `$effect` has no such
   side effect — the existing `trackRouteContext` already does it, which is reassuring but is not proof.
5. **Is `page.url` fully committed by the time `navigating` goes null?** Branch 5 reads `page.route.id`
   and `page.url` on the `to`-null run and settles with them, so it depends on Kit having committed
   both before :2023. The ordering strongly suggests yes (the URL commits at :1855-1856 and the render
   completes well before :2023), but there is a known skew window earlier in the cycle: the browser
   URL commits at :1856 while `page.url` updates later via `root.$set`, which is why `onNavigate`
   at :1884 observes stale `page.url`. Confirm the skew is closed by :2023. If it is not, branch 5
   must name from `to` rather than `page`.
6. **`svelte-package` output**: confirm the new `.svelte.ts` module is emitted and typed correctly, and
   that `scripts/verify-exports.mjs` still passes. See `.claude/docs/svelte-packaging` for the known
   ESM-extension and version-generation quirks. Also confirm the extended `app-state.d.ts` shim does
   not leak into `dist` in a way that conflicts with a consuming app's real `$app/state` types.

## Pre-publish carry-forward

- **Peer floor.** `@flareapp/sveltekit` peers `@flareapp/js: ^2.6.0`; published `@flareapp/js` is still
  2.6.0, which does not export `insulate` / `safeInvoke` / the nav seam. The floor must rise before
  release. This is the same coupling PRs #72 and #74 flagged across react, vue, svelte, and sveltekit —
  coordinate as one lockstep bump rather than per-slice.
- **Backend still gated.** `flare.route.source` and parameterized-name semantics need backend
  agreement (B5/B9/P4). `enableTracing` stays opt-in.

## Out of scope / follow-ups

- **An HTTP-calls page in the svelte playground, to verify `browser_fetch` / `browser_xhr` on
  SvelteKit.** Sequence this immediately after this slice; it depends on the `enableTracing` +
  `tracesIngestUrl` wiring the Playground section adds. No svelte playground route makes any HTTP call
  today, so fetch/XHR instrumentation is entirely unexercised on SvelteKit even though this slice
  claims those spans "nest under whichever root is active, unchanged".
    - **Shape**: a `/http` route mirroring `/broken` (one button per scenario, `testIds.*` selectors).
      Scenarios: plain global `fetch`; a 404/500 fetch; an XHR GET; a fetch fired mid-navigation (proves
      it nests under the `browser_navigation` root, not the pageload root); and a `+page.ts` using
      `load({ fetch })`.
    - **The `load({ fetch })` case is the valuable one.** It pins the finding below, which is currently
      reasoned-from-source but unproven at runtime.
    - **Assert on `parentSpanId`**, not duration: the fetch span's parent must be the active root's
      `spanId`. That is a structural signal rather than a timing one.
    - **Do not target Flare's own ingest URLs.** `isFlareIngestUrl()` deliberately drops those spans, so
      the test would fail looking like broken instrumentation. Add a `+server.ts` endpoint instead.
    - **Expect no span** for a hydration `initial_fetch` (it short-circuits to an inlined
      `<script type="application/json">` payload and returns a synthetic `Response` with no network
      call) or for a `subsequent_fetch` cache hit. Both are correct: a span would be a lie.

### SvelteKit's fetches ARE traced (recorded because the source invites the opposite conclusion)

`runtime/client/fetcher.js:9` captures `const native_fetch = window.fetch` at module scope, which
reads like Kit pinning the unpatched original before `hooks.client.ts` can install anything. It is
not. That reference is used **only inside Kit's own `window.fetch` wrapper** (`:66`, `:77`), which the
same module installs at eval time, so the wrapper cannot recurse into itself. Every path Kit exposes
reads `window.fetch` at **call** time: `initial_fetch` (`:117`), `subsequent_fetch` (`:137`),
`dev_fetch` (`:151`), and `load_data` (`client.js:3091`, carrying the comment "use window.fetch
directly to allow using a 3rd party-patched fetch implementation" — Kit designs for this).

Since `fetcher.js` evaluates before `hooks.client.ts` (`bundle.js` imports `./entry.js` before
`__sveltekit/manifest`), the resulting stack is `flarePatch -> kitWrapper -> native`, and a
`load({ fetch })` call does produce a `browser_fetch` span. **Do not add a "load fetches are untraced"
limitation to the JSDoc; it is false.** The follow-up above is what turns this from source-reading
into evidence.

- **Server-side tracing and server→client correlation.** Blocked on `@flareapp/node` having any
  tracing at all. When it lands, the SvelteKit side is a `handle` hook injecting traceparent meta tags
  (Sentry's `addSentryCodeToPage` + `transformPageChunk` shape) plus a client-side pickup in the
  pageload root. This is the largest remaining gap versus Sentry.
- **Load-function spans** (`wrapLoadWithSentry` / `wrapServerLoadWithSentry` analogs, and Sentry's
  acorn-based Vite auto-instrumentation plugin).
- **Svelte component tracking** — the `@flareapp/react/profiler` analog and Sentry's `trackComponents`
  preprocessor. Deferred by the vue-router slice for the same reason; needs its own spec. Note Sentry's
  `ui.svelte.update` span cannot work in Svelte 5 runes mode (no `beforeUpdate`/`afterUpdate`), so a
  Flare version would be init/mount-only.
- **Kit ≥ 2.31 native tracing.** SvelteKit now emits its own spans (`sveltekit.load`,
  `sveltekit.resolve`, …) and Sentry adopts Kit's root span rather than creating its own. Worth
  evaluating once Flare has server tracing; irrelevant to this client-only slice.
- **SvelteKit hash-mode routing** (`config.kit.router.type: 'hash'`) is untested by this slice.
