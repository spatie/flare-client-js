# Inertia Navigation Tracing + Vue Component Profiler — Design

Status: ready for planning
Date: 2026-07-27
Branch: `inertia-tracing` (off `performance-monitoring-and-tracing`, tip `e8a1939`)
Ships as two slices, in order. Slice 1 is a prerequisite for slice 2 being useful to most users.

## Goal

Two things, brainstormed together because the second is nearly worthless without the first:

1. **Slice 1 — `@flareapp/inertia`.** A new package exposing `traceInertiaRouter(router)`, which opens
   `browser_navigation` roots for Inertia visits. Inertia apps currently get no navigation tracing at all,
   because the existing router integrations all cover routers Inertia replaces.
2. **Slice 2 — Vue component profiling.** A global mixin, allowlisted, recording one span per component mount,
   nested as a true tree under the active root. Plus a wire-format migration so React and Vue component spans
   share one span type.

Result for a Vue app, whether routed by vue-router or by Inertia:

```
browser_navigation  Products/Show  (312ms)
 └─ Products/Show           (240ms)
     ├─ ProductGallery      (180ms)
     ├─ ProductInfo          (32ms)
     └─ AddToCartButton      (12ms)
```

## Why slice 1 comes first

Component spans record only while a root span is live (`activeComponentRoot()` returns the holder's active
root, and `recordComponentSpan` drops anything whose root is no longer that root). Roots come from pageload
plus a registered navigation source. Inertia has its own router, and nothing in this repo wires it.

So on an Inertia app with only slice 2 shipped: the first hard page load records component spans, and every
Inertia visit after that records nothing at all, silently. Since most users of this SDK are on Vue with
Inertia rather than vue-router, shipping slice 2 alone would look broken rather than limited.

## Scope decisions (locked during brainstorm)

- **Instrumentation model:** a global `app.mixin`, gated by an allowlist. Not per-component wrapping. Vue,
  unlike React, has a global lifecycle seam, so components need no edits.
- **Capture scope:** mount only. No update, create, activate or unmount spans in v1.
- **Allowlist:** `boolean | (string | RegExp)[]`, matched on `getComponentName()`.
- **Wire format:** one generic `browser_component` span type for every framework, with
  `flare.component.name` and `flare.component.framework`. React migrates onto it in the same slice.
- **API surface:** `profileComponents` as an option on `flareVue`, matching how `router` is already wired.
- **Inertia placement:** its own package, not a `@flareapp/js` export and not a `@flareapp/vue` option.
- **Inertia page naming:** documented `defineOptions({ name: 'Products/Show' })` recommendation, with bare
  filenames as the fallback behavior. No code that couples the Vue package to Inertia.
- **Nesting:** a true tree by `parent_span_id`, same as the React profiler and for the same reason: Flare's
  waterfall nests structurally, so a flat model renders as a flat list.

---

# Slice 1 — `@flareapp/inertia`

## Why a package rather than an export

Considered putting `traceInertiaRouter` in `@flareapp/js/browser` next to `registerNavigationSource`. It is
about 100 lines, imports nothing from Inertia (the router is duck-typed), and every browser user already has
`@flareapp/js` installed, so a package buys no dependency management. It loses anyway:

- The repo already has this exact shape. `@flareapp/sveltekit` is a meta-framework package that pairs with a
  renderer package, duck-types its host, and ships a `./client` entry. Inertia is the same category: a layer
  on top of Vue, React or Svelte.
- Discoverability. Someone on Laravel searching npm for "flare inertia" finds a package. An export inside
  `@flareapp/js/browser` is invisible unless they read the right README section.
- Room to grow. Navigation roots are the first thing Inertia can give us, not the last: page-component error
  context, page props as context, prefetch and deferred-props spans. None of that belongs in the browser core.
- Honest ownership. It cannot live in `@flareapp/vue` without cutting off Inertia plus React, and
  `@flareapp/js` is the browser core, not a bag of integrations.

The package depends on `@flareapp/js` (peer) and on nothing from Inertia. Router types are vendored, matching
`packages/vue/src/vendor/vueRouterTypes.ts`, so there is no `@inertiajs/*` peer dependency to satisfy and no
version coupling to Inertia releases.

## Public API

```ts
export function traceInertiaRouter(router: unknown): () => void;
```

Returns a cleanup that removes every listener and unregisters the navigation source. Inert for a value that
is not shaped like an Inertia router (no `on` function). Never throws into the host.

Called once at boot, exactly like `traceSvelteKitRouter`:

```js
import { createInertiaApp, router } from '@inertiajs/vue3'; // or '@inertiajs/react'
import { flare } from '@flareapp/js';
import { traceInertiaRouter } from '@flareapp/inertia';

flare.configure({ enableTracing: true, tracesSampleRate: 1 });
flare.light('YOUR_FLARE_API_KEY');

traceInertiaRouter(router);
```

The same call works for every Inertia adapter; only the import specifier differs. Verified against
inertiajs.com: `router` is exported from `@inertiajs/vue3` and `@inertiajs/react`, and `router.on(name, cb)`
returns a removal callback.

## Event mapping

Inertia's documented visit sequence is `before → start → [progress] → success/error → finish → navigate`.
History navigation (back/forward) bypasses `before`/`start`/`finish` and fires `navigate` alone.

| Inertia event                   | Action                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `start`                         | `startNavigation({ url: visit.url, hold: true })`, set `inFlight`                               |
| `navigate` while `inFlight`     | `settleNavigation({ name: page.component, source: 'route', url: page.url })`, clear `inFlight`  |
| `navigate` while not `inFlight` | back/forward or history restore: `startNavigation({ url, hold: true })` then settle immediately |
| `finish` while still `inFlight` | terminal failure with no `navigate`: settle to the current location, clear `inFlight`           |

`hold: true` plus `settleNavigation` is the pattern the seam already grew for React Router v7, where the
destination is not known when the navigation opens. Inertia is the same case: at `start` only the request URL
is known, and the page component name arrives with the response.

The `finish` row is the failure backstop. `finish` fires for successful and unsuccessful requests alike, so by
the time it runs a successful visit has already settled via `navigate` and cleared `inFlight`. A visit that
errored, was cancelled, or hit `httpException` never fires `navigate`, and without this row its held root
would stay idle-suppressed until the 30s `finalTimeout`.

A new `start` arriving while a previous visit is in flight needs no special handling: `startNavigation` ends
the prior root itself (`controller.endNow()`).

`location` (a forced full page reload) needs no handling either. The document is about to be replaced, so the
root dies with the page.

## Root naming

Named from the page object's `component` key, which the Inertia protocol documents as "the name of the
JavaScript page component" (`"component": "User/Edit"`). That is exactly the low-cardinality identifier the
other router slices produce from route templates, so `Products/Show` aggregates the way `/product/:id` does.
`source: 'route'`. Falls back to the URL path with `source: 'url'` when `page.component` is missing.

`url` is carried on every `RouteName`, so a visit that redirects reports the page it landed on rather than
the one it opened with. Same reasoning as `traceVueRouter`.

## Ordering and gating

No call-time `enableTracing` gate, following the SvelteKit slice rather than `flareVue`. The call must be
order-independent with respect to `flare.light()`, because the natural place for it is module scope, before
the app boots.

Verified in `browserTracing.ts`: `navSource` is module state that only `registerNavigationSource` sets and
only `unregister` clears. Neither `startBrowserTracing` nor `stopBrowserTracing` touches it, so registering
before tracing starts survives. With tracing off, `startNavigation` no-ops on the null `activeFlare`, so the
whole integration is inert rather than broken.

Registering a navigation source disables the built-in History-based root detection. That is intended: Inertia
becomes the sole source of navigation roots, which is why the back/forward row above is mandatory rather than
a nicety.

## Re-instrumentation

A `WeakMap` keyed on the router object holds the cleanup, and a second `traceInertiaRouter` call on the same
router tears down the first. Without it, Vite HMR against a persistent router appends another listener set
every cycle. Copied from `traceVueRouter`, which solves the identical problem.

## Unknowns to verify empirically before implementing

Both get a playground probe, the way the SvelteKit slice measured its effect-batching risk rather than
reasoning about it:

1. **Does `navigate` fire on the initial page load?** If it does, the handler must not open a navigation root
   for it, since the pageload root already covers that window. It should name the pageload root instead, via
   `setActiveRouteName`. If it does not, the pageload root needs its name from the initial page object read
   at call time.
2. **Is `visit.url` a string or a `URL` in the installed Inertia version?** Determines whether the handler
   needs `String(url)` normalization before `absoluteHref`.

## Testing

### The fake router is its own module

`packages/inertia/tests/helpers/fakeInertiaRouter.ts`, re-exported from a `tests/helpers/index.ts` barrel.
One file a developer can open to see exactly what the mock does, reusable across every test file in the
package. This follows the split the repo already uses: cross-package mocks live in `@flareapp/test-helpers`
(`browserSeamMock`, `FakeApi`), while host-side fakes for one package's integration live in that package's
`tests/helpers/` — `packages/vue/tests/helpers/index.ts` holds `createMockRouter` and is imported by nine
suites.

It fakes the router, not the seam. The seam side already has a shared helper (`browserSeamMock` +
`FakeNavigationSource` from `@flareapp/test-helpers`), which these tests use unchanged.

The fake drives whole visits rather than exposing a bare `on()`, so a test reads as one line of intent
instead of four hand-fired events in a hand-maintained order:

```ts
const router = createFakeInertiaRouter();
const cleanup = traceInertiaRouter(router);

router.visit({ url: '/products/42', component: 'Products/Show' }); // start -> navigate -> finish
router.failedVisit({ url: '/checkout' }); // start -> finish, no navigate
router.historyVisit({ url: '/products', component: 'Products/Index' }); // navigate alone
router.emit('start', { visit: { url: '/raw' } }); // escape hatch for odd orderings

router.listenerCount(); // 0 after cleanup(), so removal is assertable
```

Surface: `on(event, cb)` returning a working remover, `emit(event, detail)`, the three visit drivers, and
`listenerCount(event?)`.

The real reason to centralize it is correctness, not tidiness. The documented visit sequence
(`before → start → success/error → finish → navigate`) is an assumption this whole integration rests on, and
the empirical probe listed above may adjust it. Encoded in one module, that finding changes one file instead
of every test that hand-fires events. If Inertia support later grows past navigation roots, the same fake
serves those suites; if a second package ever needs it, it gets promoted to `@flareapp/test-helpers` then,
not speculatively now.

### Cases

- `start` opens a held navigation root with the visit URL
- `navigate` settles with `page.component` as a `route`-sourced name and `page.url`
- `navigate` without a preceding `start` (back/forward) opens and settles
- `finish` after a failed visit settles to the current location, releasing the hold
- `finish` after a successful visit is a no-op (already settled)
- a second `start` while in flight supersedes the first
- `page.component` missing falls back to a `url`-sourced name
- a non-router value returns an inert cleanup and registers nothing
- the returned cleanup removes every listener and unregisters
- calling twice on the same router tears down the first instrumentation
- a throwing listener never propagates into the host

No playground. A real Inertia playground needs a server that responds with page objects, which is a
disproportionate amount of machinery for one integration; a manual smoke test against a real Laravel app
covers it better. This is a deliberate coverage gap, recorded here so it is not mistaken for an oversight.

## File structure

```
packages/inertia/
  package.json          @flareapp/inertia, lockstep version, peer @flareapp/js
  tsconfig.json
  vitest.config.mts
  .release-it.json
  README.md
  src/index.ts                    re-exports traceInertiaRouter
  src/traceInertiaRouter.ts
  src/vendor/inertiaTypes.ts      minimal duck-typed router/page/event shapes
  tests/helpers/fakeInertiaRouter.ts   the fake router, visit drivers, listener bookkeeping
  tests/helpers/index.ts               barrel
  tests/traceInertiaRouter.test.ts
scripts/release-all.mjs           add 'inertia' to LOCKSTEP_PACKAGES + a LOCKSTEP_REFS entry
CLAUDE.md                         monorepo table row
```

Skeleton modelled on `packages/sveltekit`. It joins the lockstep set because it consumes the `@flareapp/js`
navigation seam, so its peer range must be rewritten on every release like the other four.

---

# Slice 2 — Vue component profiler

## Wire format migration

`BrowserSpanType.ReactComponent = 'browser_react_component'` becomes `BrowserSpanType.Component =
'browser_component'`, shared by both frameworks. The single attribute `flare.react.component` becomes two:

```
flare.component.name       'ProductGallery'
flare.component.framework  'react' | 'vue'
```

`span.name` stays the component name, so the backend's fallback label keeps working.

This is a breaking wire-format change, done now because it is still free. `browser_react_component` is not in
the wild: the published `@flareapp/react@2.6.0` exposes only `.` and `./inject`, with no `./profiler` and no
router entries, so the entire tracing feature set is unreleased. It has 6 references in this repo and one
draft backend PR. Waiting until after a release turns a rename into a migration.

`recordComponentSpan` gains a required `framework` field and stamps both attributes. `activeComponentRoot`,
`reserveSpanId`, `nowNano` and the live-root gate are untouched; the seam stays framework-agnostic, which is
the whole point of it. React's `profiler.ts` passes `framework: 'react'` and changes in no other way.

## The mixin

New internal module `packages/vue/src/profileVueComponents.ts` exporting
`createComponentProfilerMixin(matcher)`. Not a public entry, same as `traceVueRouter`.

**`beforeMount`:**

1. Resolve the name with the existing `getComponentName()` (`__name` from the SFC compiler, then `name`, then
   `AnonymousComponent`). Reusing it means the allowlist matches exactly the string the span reports and the
   error context already uses.
2. Not matched: do nothing. No state, no marker. An unprofiled component costs one name resolution and one
   match, and stays transparent to the tree.
3. Matched: resolve the parent. Walk the parent chain for a stored marker. Use a found marker only while its
   `traceId` still equals the live root's; otherwise re-home to `activeComponentRoot()`. Both null means stay
   transparent.
4. Reserve a span id, capture `startNano`, and store `{ spanId, startNano, parent }` plus the marker
   `{ traceId, parentSpanId: ownSpanId }` on the instance.

**`mounted`:** read the stored state, call `recordComponentSpan({ framework: 'vue', ... })` with `nowNano()`
as the end, then clear the state so nothing can record twice.

State lives on the internal instance object (`this.$`) under a module-level `Symbol`, so nothing is written
through Vue's public-instance proxy: no devtools noise, no `$`-prefix warnings, no collision with user
properties. The parent walk uses the same internal chain.

The walk only runs for allowlisted components, so an unprofiled app pays nothing and a profiled tree walks a
handful of levels.

## Timing and nesting model

Measured with a throwaway probe (global mixin over a three-level tree, since deleted):

```
beforeMount:Parent      parent=VTU_ROOT  parentMark=marked:VTU_ROOT
beforeMount:Child       parent=Parent    parentMark=marked:Parent
beforeMount:GrandChild  parent=Child     parentMark=marked:Child
mounted:GrandChild → mounted:Child → mounted:Parent
```

Three properties this pins down:

- `beforeMount` is strictly top-down, and a component's parent has already run its own `beforeMount` by the
  time the child's fires. The parent's reserved span id is therefore readable when the child needs it, which
  is what makes reserved ids work without a provide/inject context.
- `mounted` is strictly bottom-up, so a parent's `[start, end]` encloses every descendant's both by time and
  by `parent_span_id`, and the waterfall nests correctly.
- Functional components get no mixin hooks at all, so they are transparent and the parent walk skips over
  them. Nothing to implement.

This is the same ordering the React profiler relies on (render top-down, effects bottom-up), so the model
ports without change.

## Cross-trace re-homing

Step 3's `traceId` check is not defensive coding. It is the Critical the React branch's final review caught,
and Vue hits it harder.

A profiled component that persists across navigations, such as a layout wrapping `<router-view>`, froze its
marker under the pageload trace. When the pageload root closes and a client navigation opens a new root with
a new `traceId`, a page component mounting under that still-alive layout would inherit the dead trace, and
the live-root gate in `recordComponentSpan` would silently drop it. Net effect: every navigation after the
first records zero component spans.

Preferring an inherited marker only while its `traceId` matches the live root, and re-homing to the live root
otherwise, fixes it by construction. A persistent layout around a swapped page body is the default structure
in both vue-router and Inertia apps, so this is the common path, not an edge case. It gets a dedicated
regression test.

## Allowlist matching

`profileComponents?: boolean | (string | RegExp)[]` on `FlareVueOptions`.

- `false` or absent: no mixin registered at all.
- `true`: every component with a resolvable name. Documented as a debugging aid, with the warning that a real
  page will hit `maxSpansPerTrace` (1024) and bury the useful spans among icons and list items.
- `(string | RegExp)[]`: strings match exactly, regexes by `test()`. Mixed arrays are the expected usage.

Matching by name follows the existing config idiom in this codebase (`tracePropagationTargets`,
`propsDenylist` both accept regexes). The matcher is built once at install, not per component.

Both naming spaces stay honest: a renamed component silently stops being profiled, whichever form is used.
That is inherent to name-based matching and is documented rather than worked around.

## Naming in Inertia apps

The two ecosystems name things differently and the README must say so.

Navigation roots take their name from Inertia's `page.component`, so the waterfall root reads
`Products/Show`. The mixin matches on `getComponentName()`, which prefers the SFC compiler's `__name` — the
**bare filename**. `./Pages/Products/Show.vue` is `Show`, not `Products/Show`, and `Pages/Orders/Show.vue` is
also `Show`.

Documented recommendation for Inertia page components, one line per page:

```vue
<script setup>
defineOptions({ name: 'Products/Show' });
</script>
```

The span then reads the same as its root. Without it, the fallback behavior is bare filenames, which is
usually still readable because the root span disambiguates: a `Show` span under a `Products/Show` root is not
really ambiguous.

Explicitly rejected: special-casing the Inertia page component inside the mixin. It would require
`@flareapp/vue` to know about Inertia, which is exactly the coupling the separate package avoids.

## Edge cases

All inherited from the React model, all documented rather than engineered around:

- **Async `setup()` and `<Suspense>`:** the span covers the data wait, so read the duration as "time to mount,
  including waits in the subtree". A wait longer than `idleTimeout` closes the root, and the live-root gate
  drops the span rather than re-sampling it onto a dead trace.
- **`<KeepAlive>`:** reactivation fires `activated`, not `mounted`, so a restored subtree records no span.
- **Orphan degradation:** if an ancestor's span is dropped by the span cap, descendants point at a missing
  parent and Flare's tree builder reparents them to the root. Because `mounted` is bottom-up, the ancestor is
  the likelier victim, so this is the designed-for degradation rather than a rare edge.
- **SSR:** `beforeMount` and `mounted` never run server-side, and the seam no-ops without a browser tracer,
  so SSR is inert by construction. Nuxt is not a target and gets no test.

## Gating, overhead, error handling

The mixin is registered only when `profileComponents` is set and `flare.config?.enableTracing` is true,
inside the same try/catch as the router wiring in `flareVue`. The existing `installedApps` WeakSet already
makes a second `app.use(flareVue)` a no-op, so no double mixin.

Component spans never sample independently. They either record under the live root, reusing its `TraceState`
and its decision, or they are dropped. No code path re-samples per component.

Every hook body is wrapped so instrumentation cannot throw into the host, matching the `traceVueRouter`
discipline.

## Testing

### Shared seam mock first

`packages/react/tests/profiler.test.tsx` currently hand-rolls the whole component-profiler seam inline in a
`vi.hoisted` block: a counter-backed `reserveSpanId`, a fixed `activeComponentRoot`, and stubs for
`recordComponentSpan` and `nowNano`. The Vue suite needs the identical fake, so this slice extracts it to
`packages/test-helpers/src/componentProfiler.ts` as `componentProfilerMock(...)` and converts the React suite
onto it.

This one belongs in `@flareapp/test-helpers`, unlike the Inertia router fake, because two packages consume
it. Same precedent as `browserSeamMock`, and the same shape as the vue-router slice, which extracted
`insulate` and `safeInvoke` into `@flareapp/js/browser` and converted the React integrations onto them rather
than copying.

Built on `importOriginal` and spreading the real module, like `browserSeamMock`, for two reasons. A
hand-written stand-in silently drifts from the code it stands in for. And the Vue suite needs the module's
other real exports anyway, since `flareVue` imports `resolveFlare` and `insulate` from it — the React suite's
current wholesale module replacement would not work here.

The React suite is being edited in this slice regardless, for the renamed span type and attributes, so the
conversion adds no extra file churn.

### Cases

`packages/vue/tests/profileComponents.test.ts`:

- one allowlisted component records one span with the right name, `browser_component` type, `vue` framework,
  parent equal to the active root, and a non-negative duration
- nested allowlisted components nest: the child's `parent_span_id` is the ancestor's reserved id
- an unprofiled middle component is transparent: the grandchild nests under the nearest profiled ancestor
- non-matching components record nothing
- regex entries match; mixed string and regex arrays work
- `true` profiles everything with a resolvable name
- no active root: nothing recorded, the app still renders
- tracing disabled: no mixin registered
- cross-trace re-homing: a persistent parent plus a new root re-homes the child to the live root
- a throwing seam does not break mounting

Updated: `packages/js/tests/componentProfiler.test.ts` and `packages/react/tests/profiler.test.tsx` for the
renamed type and attributes.

Playground: wire `profileComponents: ['Layout', 'ProductsPage', 'ProductPage', 'CartPage']` in
`playgrounds/vue`. e2e deferred, as it was for React.

## File structure

```
packages/js/src/tracing/spanTypes.ts            ReactComponent -> Component
packages/js/src/tracing/componentProfiler.ts    framework field + two attributes
packages/js/tests/componentProfiler.test.ts     updated
packages/test-helpers/src/componentProfiler.ts  new: shared seam mock (react + vue)
packages/test-helpers/src/index.ts              export it
packages/react/src/profiler.ts                  pass framework: 'react'
packages/react/tests/profiler.test.tsx          updated + converted onto the shared mock
packages/react/README.md                        renamed attribute
packages/vue/src/profileVueComponents.ts        new: the mixin factory
packages/vue/src/flareVue.ts                    register the mixin
packages/vue/src/types.ts                       profileComponents option
packages/vue/tests/profileComponents.test.ts    new
packages/vue/README.md                          profiling section + the Inertia naming note
playgrounds/vue/src/main.ts                     wiring
```

---

## Backend dependency

Handled in flareapp.io, not in this repo, and the feature is not end-to-end without it. Draft PR #2501
currently has `SpanType::BrowserReactComponent`. It needs:

- the enum case renamed to `BrowserComponent` with value `browser_component`
- the label mapped off `flare.component.name` rather than `flare.react.component`
- its lock-in tests updated to match

Until that lands, component spans store as `unknown`. Note this is a rename inside an unreleased draft, not a
migration of production data. I have not re-verified the current state of that PR in this session.

## Out of scope

- Update, re-render, create, activate and unmount spans. Update spans specifically need an interaction root
  span type that does not exist: our roots idle-close about a second after activity, so a user-triggered
  re-render would be dropped by the live-root gate exactly when it is most interesting.
- A `useFlareProfiler` composable. The mixin covers the same ground without per-component edits.
- Component profiling for Svelte, and any Inertia error-context enrichment.
- An Inertia playground, and Inertia e2e coverage.
- A backend aggregation page for component spans. The React slice deliberately left these out of
  `SpanAggregationType::fromSpanType`, so they appear in the trace waterfall only. Changing that is a product
  decision, not a client one.
