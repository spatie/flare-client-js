# Svelte Component Profiler — Design

Status: ready for planning
Date: 2026-07-29
Branch: `svelte-component-profiler` (off `performance-monitoring-and-tracing`, tip `53467c8`)

## Goal

Record one `browser_component` span per matched Svelte component mount, nested as a true tree under the
active `browser_pageload` or `browser_navigation` root. This is the third and last framework profiler,
after React (PR #71) and Vue (PR #85).

Result for a SvelteKit app:

```
browser_navigation  /product/[id]      312ms
 └─ +layout                            290ms
     └─ product/[id]/+page             240ms
         └─ AddToCartButton             12ms
```

## Feasibility, and what we deliberately do not build

Sentry ships Svelte component tracking with two span types, `ui.svelte.init` and `ui.svelte.update`. We
build the equivalent of the first and not the second.

**Init tracking is cheap here because the infrastructure already exists.** Sentry's whole apparatus is a
Svelte preprocessor that injects a tracking call into every component's `<script>`. This repo already ships
exactly that: `packages/svelte/src/preprocessor.ts` injects `__flareRegisterComponent(name, file)` for the
error-reporting component tree, wired through `withFlareConfig`, handling the awkward cases (no instance
script, module-only script, double injection in the markup-then-script pass).

**Update tracking is out of reach on Svelte 5 and is dropped.** It requires `beforeUpdate`/`afterUpdate`,
which Svelte 5 disallows in runes mode. Sentry's own code wraps it in a try/catch that warns _"This is
likely because you're using Svelte 5 in Runes mode. Set `trackUpdates: false`"_, and they have since
flipped that default to `false`. Our peer range is `svelte ^5.3.0`, so runes mode is the norm for our
users, not an edge case.

The obvious workaround does not survive scrutiny. A preprocessor-injected `$effect` only re-runs for the
reactive values it actually reads, and injected code reads nothing. Catching all updates would mean
reading every reactive value in the component, which a preprocessor cannot do reliably. Dropping updates
costs nothing anyway: the React and Vue profilers are already mount-only, so this keeps parity rather than
creating a gap.

Sources: [Sentry Svelte component tracking](https://docs.sentry.io/platforms/javascript/guides/svelte/features/component-tracking),
[Sentry `performance.ts`](https://github.com/getsentry/sentry-javascript/blob/develop/packages/svelte/src/performance.ts),
[Svelte 5 lifecycle hooks](https://svelte.dev/docs/svelte/lifecycle-hooks),
[Svelte 5 migration guide](https://svelte.dev/docs/svelte/v5-migration-guide).

## Timing model, measured

The Svelte docs do not state parent/child ordering for `onMount`, so it was measured with a throwaway
probe (a parent with two static children plus one `{#if}`-gated late child, since deleted):

```
initial:  parent:init → childA:init → childB:init
          → childA:onMount → childB:onMount → parent:onMount
late:     late:init → late:onMount
```

Three properties this pins down:

- The instance script body runs strictly top-down, so a parent has published its context before any child
  initializes. That is what makes reserved span ids work.
- `onMount` runs strictly bottom-up, so a parent's `[start, end]` encloses every descendant's both by time
  and by `parent_span_id`, and the waterfall nests correctly.
- A late-mounted child runs its own init/`onMount` pair and resolves against whatever root is live then.

This is the same shape as Vue's `beforeMount`/`mounted` and React's render/effect pair, so the model ports
without change.

## Scope decisions (locked during brainstorm)

- **Instrumentation model:** build-time injection by the existing preprocessor, gated by an allowlist.
  Svelte has no global lifecycle seam, which is why Sentry uses a preprocessor too.
- **Capture scope:** mount only. No update spans, for the reason above.
- **Allowlist:** `boolean | (string | RegExp)[]`, evaluated at build time against the profile name.
- **Naming:** route-aware, so SvelteKit's `+page.svelte` files do not all collapse to `+page`.
- **Independence:** `profileComponents` and `componentTracking` gate separately.
- **Wire format:** unchanged. `recordComponentSpan` already stamps `flare.component.name` and the span
  type is already the generic `browser_component`.
- **Ship scope:** package plus unit tests plus playground wiring plus README. No e2e, matching what the
  React and Vue slices shipped.

## Architecture

Three layers. The preprocessor stands in for the global seam React has via context and Vue has via
`app.mixin`.

1. **Build time.** `withFlareConfig` builds a matcher from `profileComponents` and passes it to
   `flarePreprocessor`. For each `.svelte` file the preprocessor computes the profile name, tests it, and
   injects `__flareProfileComponent('<name>')` only into matches. Unmatched components get nothing and
   cost zero at runtime.
2. **Runtime.** New `packages/svelte/src/profileComponent.ts`. Called during init: resolves its parent,
   reserves a span id, publishes its own marker with `setContext`, and registers an `onMount` that records.
3. **Seam.** `@flareapp/js/browser` is untouched. `activeComponentRoot`, `resolveComponentParent`,
   `reserveSpanId`, `nowNano` and `recordComponentSpan` all work as-is.

**No change to `@flareapp/js` in this slice.** The only cross-package change is moving one shared utility
into `@flareapp/core` (below).

## Public API

```js
// svelte.config.js
import { withFlareConfig } from '@flareapp/svelte/config';
import adapter from '@sveltejs/adapter-node';

export default withFlareConfig(
    { kit: { adapter: adapter() } },
    { profileComponents: [/\+(page|layout)$/, 'AddToCartButton'] },
);
```

`WithFlareConfigOptions` gains `profileComponents?: boolean | (string | RegExp)[]`, the same type
`flareVue` already accepts.

- absent or `false`: nothing injected.
- `true`: every component. Documented as a debugging aid, with the warning that a real page will hit
  `maxSpansPerTrace` (1024) and bury the useful spans among icons and list items.
- `(string | RegExp)[]`: strings match exactly, regexes by `test()`. Mixed arrays are the expected usage.

Matching happens against the profile name, so the allowlist and the span always agree on the string. A
renamed or moved file silently stops being profiled; that is inherent to name-based matching and is
documented rather than worked around, exactly as in the Vue slice.

### Only matched components produce spans

The preprocessor injects per file. A sub-component of a matched page is not profiled unless its own name
also matches. This has a nesting consequence worth stating in the README: a matched descendant nests
under the nearest **matched** ancestor, skipping unmatched components in between. With
`[/\+(page|layout)$/, 'AddToCartButton']`, an `AddToCartButton` three levels deep inside unprofiled
wrappers still attaches directly to the page span. The tree reflects profiled components, not the real
component tree.

### Independence changes one existing line

`withFlareConfig` currently returns the config untouched when `componentTracking` is false. That becomes
"untouched only when both features are off", so `{ componentTracking: false, profileComponents: [...] }`
still installs the preprocessor and injects only the profile call.

## Naming

New `resolveProfileName(filename, routesDir)`:

1. Normalize backslashes, take the basename, drop `.svelte`.
2. If the basename starts with `+`, prefix the directory path relative to `routesDir`.

| File                                   | Profile name         |
| -------------------------------------- | -------------------- |
| `src/lib/ProductGallery.svelte`        | `ProductGallery`     |
| `src/routes/+page.svelte`              | `+page`              |
| `src/routes/product/[id]/+page.svelte` | `product/[id]/+page` |
| `src/routes/product/+layout.svelte`    | `product/+layout`    |

Without this rule every route in a SvelteKit app profiles as `+page` or `+layout`, the allowlist cannot
target one route, and the waterfall cannot tell them apart. That is the Svelte equivalent of the Inertia
naming problem from the Vue slice, and it is worse, because there the fallback was merely ambiguous while
here it is uniform.

`routesDir` comes from `config.kit?.files?.routes ?? 'src/routes'`. `withFlareConfig` already receives the
whole config, so it reads this and passes it into `flarePreprocessor` options. Plain Svelte apps have no
`kit` key and effectively never have `+`-prefixed filenames, so the rule is inert there. A `+`-prefixed
file outside the routes dir falls back to the basename.

### Deliberately kept separate from `extractComponentName`

`extractComponentName` (bare basename) feeds the error-reporting component tree and is already published.
Profiling gets the new route-aware name; error reports keep the basenames they ship today.

Unifying would arguably improve error reports too, since `product/[id]/+page` beats `+page` there as well.
It is rejected for this slice because it changes shipped behavior for existing users and drags the
component-tree tests into a profiling change. Revisit separately if wanted. The cost is two naming
functions in one preprocessor, which the plan should call out in a comment so it does not read as an
oversight.

## Injection

Four cases, driven by the two independent options:

| `componentTracking` | matches `profileComponents` | injected                                                      |
| ------------------- | --------------------------- | ------------------------------------------------------------- |
| on                  | yes                         | both imports, `__flare_reg__(...)` then `__flare_prof__(...)` |
| on                  | no                          | today's registration only, unchanged                          |
| off                 | yes                         | `__flare_prof__(...)` only                                    |
| off                 | no                          | preprocessor not installed                                    |

Injected form for the first case:

```js
import { __flareRegisterComponent as __flare_reg__, __flareProfileComponent as __flare_prof__ } from '@flareapp/svelte';
const __flare_node__ = __flare_reg__('Name', '/src/routes/product/[id]/+page.svelte');
__flare_prof__('product/[id]/+page');
```

Two details:

- **The double-injection guard has to widen.** It currently tests `content.includes('__flare_node__')`,
  which a profile-only injection does not contain. Without widening it to cover either token, the
  markup-then-script pass injects twice for a profile-only component.
- **Prepending is load-bearing.** The call runs before the user's script body, so the span covers the
  component's own init work, and both `setContext` and `onMount` land inside component initialization,
  where Svelte requires them.

Both hooks (`markup` for components with no instance script, `script` for the rest) need the profile path,
same as the registration path today.

## Runtime module

`packages/svelte/src/profileComponent.ts`:

```ts
const PROFILE_KEY = '__flare_component_profile';

export function __flareProfileComponent(name: string): void {
    try {
        const inherited = getContext<ComponentTraceContext>(PROFILE_KEY) ?? null;
        const parent = resolveComponentParent(inherited, activeComponentRoot());
        if (!parent) return; // tracing off, no live root, or SSR

        const spanId = reserveSpanId();
        const startNano = nowNano();
        setContext(PROFILE_KEY, { traceId: parent.traceId, parentSpanId: spanId });

        onMount(() => {
            recordComponentSpan({ name, spanId, parent, startTimeUnixNano: startNano, endTimeUnixNano: nowNano() });
        });
    } catch {
        // instrumentation must never break the host
    }
}
```

Exported from `packages/svelte/src/index.ts` next to `__flareRegisterComponent`, because the injected
import specifier resolves to the package root.

This is simpler than both React's and Vue's versions: Svelte's context gives the parent marker directly,
so there is no parent-chain walk and no `Symbol` stashed on an internal instance. It uses its own context
key, separate from the component tree's, because the two need different chains. The tree links every
registered component; the profiler links only profiled ones.

## Shared matcher

`createComponentMatcher` currently lives in `packages/vue/src/profileVueComponents.ts`. Move it to
`@flareapp/core` as `util/componentMatcher.ts`, export it from core's index, and have Vue import it from
there.

This is a real dedup, not a cosmetic one: the function carries non-obvious logic (stripping `g` and `y`
flags into a copy, because a sticky regex carries `lastIndex` between calls and would make every other
`test()` miss). Copying that into the Svelte package would be copying a bug fix.

Two facts make core the right home. Both packages already depend on `@flareapp/core@2.6.0` directly, and
core's entry is pure re-exports with no side effects at import, so loading it from a Node build config is
safe. It cannot live in `@flareapp/js/browser` like the rest of the tracing seam, because the Svelte
matcher runs at build time inside `svelte.config.js`, where pulling in a browser bundle entry does not
belong.

## Edge cases

- **SSR.** `activeTracingFlare()` is plain module state and is null on the server, so `activeComponentRoot()`
  returns null and the function returns before reserving a span id or registering `onMount`. No
  `typeof window` guard is needed and server cost is one function call. `onMount` never fires on the
  server anyway.
- **Cross-trace re-homing.** The Critical the React branch's final review caught, and SvelteKit hits it
  hardest. A persistent `+layout.svelte` around a swapped page body freezes its marker under the pageload
  trace. When the pageload root closes and a navigation opens a new root, a page component mounting under
  that still-alive layout would inherit the dead trace and the live-root gate in `recordComponentSpan`
  would silently drop it. Net effect: every navigation after the first records zero component spans.
  `resolveComponentParent` re-homes to the live root when trace ids differ. A layout around a swapped page
  body is the default SvelteKit structure, so this is the common path and gets a dedicated regression test.
  It depends on the nav-root-stays-open-past-settle fix, already in this branch via `6df1b52`.
- **Transparent bail.** A component that finds no live root sets no context, so descendants inherit the
  nearest profiled ancestor and re-validate against the live root themselves. Same transparency contract
  as React and Vue.
- **`{#await}` blocks.** The span covers the wait, so read the duration as "time to mount, including waits
  in the subtree". A wait longer than `idleTimeout` closes the root, and the live-root gate drops the span
  rather than re-sampling it onto a dead trace. Identical to Vue's async-`setup` behavior.
- **Orphan degradation.** If an ancestor's span is dropped by the span cap, descendants point at a missing
  parent and Flare's tree builder reparents them to the root. Because `onMount` is bottom-up, the ancestor
  is buffered last, so the cap hits ancestors first. Inherited from the React and Vue models.
- **Components with no instance script.** Already handled by the existing `markup` hook.

## Tests

In `packages/svelte/tests/`, using the existing `@flareapp/test-helpers` mocks that Vue's suite already
uses:

- `resolveProfileName.test.ts` — the naming rule, custom `routesDir`, non-route files, `+`-prefixed files
  outside the routes dir, Windows paths.
- `preprocessor.test.ts` (extend) — the four injection cases, the widened double-injection guard, the
  profile-only path, the no-instance-script path.
- `preprocessor.test.ts` also covers `withFlareConfig` today (5 assertions); extend it there for
  `profileComponents` gating and the both-off early return. There is no separate `config.test.ts` and this
  slice does not add one.
- `profileComponent.test.ts` — parent/child nesting by `parent_span_id`, bail with no live root,
  cross-trace re-homing, late/conditional mount, and that a throwing seam never propagates into the host.

`packages/vue/tests/profileVueComponents.test.ts` moves its matcher assertions to a new core test when
`createComponentMatcher` moves.

## Playground

`playgrounds/svelte/svelte.config.js` gets `profileComponents: [/\+(page|layout)$/, 'AddToCartButton']`.

That needs one small extraction. The add-to-cart button in
`playgrounds/svelte/src/routes/product/[id]/+page.svelte` is currently inline markup, and the React and
React Router playgrounds both profile an `AddToCartButton` leaf. Extracting it to
`playgrounds/svelte/src/lib/AddToCartButton.svelte` keeps the three playgrounds comparable and gives a
three-level waterfall instead of a two-span one. The existing `testIds.addToCart(product.id)` test id moves
with it, so the e2e suite is unaffected.

## README

A component-profiling section in `packages/svelte/README.md` covering:

- setup through `withFlareConfig`, including the `componentTracking: false` combination.
- the allowlist forms, and the span-volume warning for `true`.
- the naming table, and that names are route-aware for `+`-prefixed files.
- that only matched components produce spans, and that unmatched ancestors are skipped in the nesting.
- that there are no update spans, with the runes reason, so nobody files it as a bug.

## Out of scope

- Update, destroy and unmount spans.
- e2e coverage. No framework's component spans are covered by Playwright today; React's was explicitly
  deferred. Closing that gap is its own slice across all three packages.
- Unifying `extractComponentName` and `resolveProfileName`.
- Any change to `@flareapp/js` or the wire format.
