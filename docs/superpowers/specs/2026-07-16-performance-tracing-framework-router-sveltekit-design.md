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
5. **Deliverables:** implementation + unit tests + playground wiring and e2e. **No README section**
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

`$app/state`'s `navigating` is a getter over `_navigating.current`, a `$state.raw` value
(`client/state.svelte.js`). Reading it requires an `$effect`, and Svelte flushes effects on a
microtask. Kit sets `navigating` non-null at client.js:1735 and null at client.js:2023, with
`await load_route(intent)` in between — so microtask FIFO ordering means the effect will observe the
non-null state in practice. But that is a guarantee resting on ordering between two libraries'
internals, and its failure mode is _silent_: a dropped span.

The containment: if an effect ever did coalesce non-null→null into one run, the committed `page.url`
would still have changed while `inFlight` is false. That is exactly the "loader-less navigation" case
`packages/react/src/react-router.ts:115-122` already handles — open the root un-held and name it
immediately. Worst case therefore degrades from _a silently dropped span_ to _an instant,
correctly-named navigation root_.

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

1. **Tracing gate.** `if (!flare.config?.enableTracing) return () => {};` — matches the `flareVue`
   gate added in `fdac544`, so passing tracing-off attaches no dead effect and no dead nav source.
2. **Idempotence.** A module-level `tracing` flag, mirroring `trackRouteContext`'s `tracking` flag.
   A second call returns a no-op cleanup.
3. **Browser only.** No-op when `typeof window === 'undefined'` (SSR import safety).

Internal state:

```ts
const nav = registerNavigationSource();
const keyOf = (url: URL): string => url.pathname + url.search; // hash EXCLUDED — see limitations
let lastKey = location.pathname + location.search; // the last committed location we accounted for
let inFlight = false;
```

`lastKey` is mutable and must be re-stamped on every commit the state machine accounts for (branches
5, 6 and 7 below). Anchoring on a frozen `initialKey` instead would make branch 7 fire on every
effect re-run after the first navigation, fabricating a spurious navigation root each time `page.data`
changed. This mirrors `lastLocationKey` in `react-router.ts`.

Route naming:

```ts
const routeNameFor = (routeId: string | null | undefined, url: URL): RouteName =>
    routeId ? { name: routeId, source: 'route' } : { name: url.pathname, source: 'url' };
```

The effect body is wrapped in `insulate`. **All four reactive reads — `navigating.to`,
`navigating.willUnload`, `page.route?.id`, `page.url` — must happen unconditionally at the top of the
effect, before any branching.** Svelte tracks dependencies as they are read, so an early `return`
placed before the `navigating.to` read would silently stop the effect from ever re-running on
navigation. This is the single easiest way to get this file wrong.

| #   | Condition                                              | Action                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `page.url.origin !== location.origin`                  | `return` — Kit's pre-hydration `a:` placeholder                                                                                                                                                                                                                                             |
| 2   | `to` set, and (`willUnload` or `to.route?.id == null`) | `return` — document will unload; the next document's pageload covers it                                                                                                                                                                                                                     |
| 3   | `to` set, `!inFlight`                                  | `inFlight = true`; `nav.startNavigation({ path: to.url.pathname, url: to.url.href, hold: true })`; then `nav.setActiveRouteName(routeNameFor(to.route.id, to.url))`                                                                                                                         |
| 4   | `to` set, `inFlight`                                   | `nav.setActiveRouteName(routeNameFor(to.route.id, to.url))` only — redirect hop, keep the single held root                                                                                                                                                                                  |
| 5   | `to` null, `inFlight`                                  | `inFlight = false`; `lastKey = keyOf(page.url)`; `nav.settleNavigation(routeNameFor(page.route?.id, page.url))`                                                                                                                                                                             |
| 6   | `to` null, `!inFlight`, `keyOf(page.url) === lastKey`  | `nav.setActiveRouteName(routeNameFor(page.route?.id, page.url))` — pageload naming; also re-runs harmlessly when `route.id` resolves late, or when `page.data` changes after a settle (the root is either still open and gets the same name, or already closed and `applyRouteName` no-ops) |
| 7   | `to` null, `!inFlight`, `keyOf(page.url) !== lastKey`  | **coalescing fallback**: `lastKey = keyOf(page.url)`; `nav.startNavigation({ path, url: page.url.href })` un-held, then `nav.settleNavigation(...)` immediately                                                                                                                             |

Branch 7 is the containment described above. It is expected to be dead code in practice; the e2e
suite is what proves that (see Testing).

Structure:

```ts
const dispose = $effect.root(() => {
    $effect(
        insulate(() => {
            /* branches 1-7 */
        }),
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

### 2. `packages/sveltekit/src/client/index.ts` (edit)

Add one line:

```ts
export { traceSvelteKitRouter } from './traceSvelteKitRouter.svelte.js';
```

No change to `packages/sveltekit/src/index.ts` — this is client-only, matching how
`trackRouteContext` is exposed only from `/client`.

### 3. `packages/sveltekit/package.json` (edit, pre-publish)

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

- The effect body is wrapped in `insulate` (from `@flareapp/js/browser`).
- Cleanup uses `safeInvoke` for both the effect-root dispose and `nav.unregister()`.
- `routeNameFor` reads are defensive (`page.route?.id`, `to.route?.id`); no assumption that Kit's
  state is well-formed.
- The `enableTracing` gate means an app with tracing off attaches nothing at all.

## Testing

### Unit — `packages/sveltekit/tests/client/traceSvelteKitRouter.test.ts` (new)

The existing `packages/sveltekit/tests/__mocks__/app-state.ts` mock exports a static `page` object.
It must be extended to export a drivable `navigating` and to let tests mutate `page` — and, because
the mock is aliased for the whole package (`vitest.config.mts` maps `$app/state` to it), the change
must stay backward-compatible with `getRouteContext.test.ts`, which already depends on it.

Because the production code uses `$effect`, tests drive the state machine directly rather than
through Svelte's scheduler; `@flareapp/js/browser` is mocked to capture seam calls (the pattern the
five react test mocks already use — note they had to add `insulate`/`safeInvoke` to their mock
factory, per the PR #74 carry-forward).

Cases:

1. `enableTracing` falsy → no `registerNavigationSource` call, cleanup is a no-op.
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
14. **`lastKey` re-stamp regression**: after a navigation settles, a further effect run at the same
    committed key (e.g. `page.data` changed via `invalidate()`) must **not** call `startNavigation`
    again. This pins the bug that a frozen `initialKey` would have introduced.
15. Cleanup → disposes the effect root and calls `nav.unregister()`.

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
4. **Regression**: the existing svelte error-scenario specs still pass with tracing enabled.

If test 2 shows the fallback shape (an un-held, zero-duration root) instead of a held root spanning
the load, effect batching is real — we learn it loudly, and the seam decision gets revisited rather
than silently dropping spans in production.

## Playground

`playgrounds/svelte` currently does **not** enable tracing (`src/lib/flare.client.ts` sets
`enableLogs` but no `enableTracing`). Two edits:

1. `playgrounds/svelte/src/lib/flare.client.ts` — add `enableTracing: true`, matching
   `playgrounds/react-router/src/flare.ts:26`.
2. `playgrounds/svelte/src/hooks.client.ts` — call `traceSvelteKitRouter()` after `initFlareClient()`:

```ts
import { initFlareClient } from '$lib/flare.client';
import { handleErrorWithFlare, traceSvelteKitRouter } from '@flareapp/sveltekit/client';

initFlareClient();
traceSvelteKitRouter();

export const handleError = handleErrorWithFlare();
```

The existing `/product/[id]` route already provides the parameterized case; no new routes are needed.
Note that `traceSvelteKitRouter()` must be called after `initFlareClient()`, since the
`enableTracing` gate is read at call time — this ordering constraint belongs in the export's JSDoc.

## Documented limitations (JSDoc on the export, not README)

- Shallow routing (`pushState` / `replaceState` from `$app/navigation`) produces no navigation root.
- Hash-only navigation produces no navigation root.
- Navigations cancelled by a `beforeNavigate` guard produce no navigation root.
- Navigations to routes SvelteKit does not own produce no navigation root; the resulting full document
  load surfaces as a pageload instead.

## Items to verify during implementation

1. **Does `$app/state`'s `navigating` actually reach a `$effect` created in `hooks.client.ts`?** The
   effect root is created outside any component. Confirm it flushes and observes both transitions —
   this is the core assumption, and the e2e navigation test is the proof.
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
5. **Extending the shared `$app/state` mock must not break `getRouteContext.test.ts`.**
6. **`svelte-package` output**: confirm the new `.svelte.ts` module is emitted and typed correctly, and
   that `scripts/verify-exports.mjs` still passes. See `.claude/docs/svelte-packaging` for the known
   ESM-extension and version-generation quirks.

## Pre-publish carry-forward

- **Peer floor.** `@flareapp/sveltekit` peers `@flareapp/js: ^2.6.0`; published `@flareapp/js` is still
  2.6.0, which does not export `insulate` / `safeInvoke` / the nav seam. The floor must rise before
  release. This is the same coupling PRs #72 and #74 flagged across react, vue, svelte, and sveltekit —
  coordinate as one lockstep bump rather than per-slice.
- **Backend still gated.** `flare.route.source` and parameterized-name semantics need backend
  agreement (B5/B9/P4). `enableTracing` stays opt-in.

## Out of scope / follow-ups

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
