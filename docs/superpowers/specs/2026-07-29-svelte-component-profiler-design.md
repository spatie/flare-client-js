# Svelte Component Profiler — Design

Status: ready for planning
Date: 2026-07-29
Branch: `svelte-component-profiler` (off `performance-monitoring-and-tracing`, tip `53467c8`)

Revised 2026-07-29 after review. Four corrections, three of them from re-probing Svelte 5.56.1 rather
than from reasoning: the `{#await}` timing claim was backwards, the Goal example showed a tree only a
pageload produces, `resolveProfileName` was specified against path shapes a preprocessor never receives,
and the injection table conflated a per-config decision with a per-file one. The `@flareapp/core` move is
now an argued trade-off instead of a foregone conclusion.

## Goal

Record one `browser_component` span per matched Svelte component mount, nested as a true tree under the
active `browser_pageload` or `browser_navigation` root. This is the third and last framework profiler,
after React (PR #71) and Vue (PR #85).

Result for a SvelteKit app, on the initial load:

```
browser_pageload  /product/[id]        312ms
 └─ +layout                            290ms
     └─ product/[id]/+page             240ms
         └─ AddToCartButton             12ms
```

A later client-side navigation is flatter, and deliberately so. A SvelteKit layout does not re-mount
across navigation, which is its whole point, so it never re-runs the profile call and records no span
for that trace. The page re-mounts, finds the layout's marker frozen on the previous trace, and re-homes
to the live root:

```
browser_navigation  /product/[other]   180ms
 └─ product/[other]/+page              140ms
     └─ AddToCartButton                 11ms
```

Layout spans appear on the load where the layout mounts, not on every trace. See "Cross-trace re-homing"
under Edge cases for why re-homing is what keeps the page span alive at all.

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

The Svelte docs do not state parent/child ordering for `onMount`, so it was measured with throwaway
probes (since deleted) against Svelte 5.56.1. The first covered a parent with two static children plus one
`{#if}`-gated late child:

```
initial:  parent:init → childA:init → childB:init
          → childA:onMount → childB:onMount → parent:onMount
late:     late:init → late:onMount
```

A second round covered the shape SvelteKit actually generates. Its `root.svelte` renders the page as
children of the layout, so the probe mirrored that (`<Layout><Page /></Layout>`, with the layout doing
`{@render children()}`):

```
plain snippet:      layout:init → page:init (ctx=layout) → page:onMount → layout:onMount
inside {#if}:       layout:init → page:init (ctx=layout) → page:onMount → layout:onMount
inside <svelte:boundary>: layout:init → page:init (ctx=layout) → page:onMount → layout:onMount
inside {#await}:    layout:init → layout:onMount → page:init (ctx=layout) → page:onMount
```

What this pins down:

- The instance script body runs strictly top-down, so a parent has published its context before any child
  initializes. That is what makes reserved span ids work.
- Snippet children inherit the context of the component that **renders** the snippet, not the one that
  declares it. The Svelte 4 slot-context gotcha does not apply to Svelte 5 snippets. This is load-bearing:
  it is the only reason `+page` nests under `+layout` at all, since SvelteKit passes the page as children.
- `svelte:boundary` is transparent to both context and ordering, so the playground's `FlareErrorBoundary`
  sitting between layout and page changes nothing.
- `onMount` runs bottom-up **except across an `{#await}`**, where the parent does not wait for the pending
  branch. See "Time nesting is not guaranteed" below.
- A late-mounted child runs its own init/`onMount` pair and resolves against whatever root is live then.

Apart from the `{#await}` exception this is the same shape as Vue's `beforeMount`/`mounted` and React's
render/effect pair, so the model ports.

### Time nesting is not guaranteed

`parent_span_id` nesting is always correct: context is published at init, top-down, before any descendant
runs. Time nesting is not. With an `{#await}` between a parent and a child, the parent's `onMount` fires
immediately rather than waiting for the promise, so the parent span **ends before the child span starts**.
The child bar then sits entirely to the right of its parent's end in the waterfall.

Two consequences for the plan:

- Do not write a test that asserts the general "parent encloses child by time" rule. Assert the measured
  orderings above, including the `{#await}` inversion, so a Svelte scheduling change shows up as a failure
  rather than as a quietly wrong waterfall.
- Flare's waterfall has to tolerate a child whose range falls outside its parent's. Confirm that before
  shipping. If it clamps or renders oddly, that is a UI question, not something this slice can fix from
  the client, because the parent records first and cannot know what its subtree will do later.

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

**No change to `@flareapp/js` in this slice.** The only possible cross-package change is where the shared
matcher lives, which is an open trade-off rather than a settled move (see "Shared matcher").

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

### The input is an absolute path, the routesDir is not

The paths in the table above are written project-relative for readability. A preprocessor does not
receive them that way. `filename` arrives absolute, which this repo already had to deal with once:
`componentTree.ts:127` normalizes with `.replace(/^.*?\/src\//, 'src/')` for exactly this reason, and the
existing preprocessor test fixture is `/app/src/Button.svelte`.

So `resolveProfileName` cannot naively diff `filename` against a project-relative `routesDir` like
`src/routes`. It has to locate the routes directory inside an absolute path first. `process.cwd()` is not
a reliable anchor here, because a build in this monorepo does not always run from the project root.

Pick one rule and state it in the implementation:

- a segment search for the `routesDir` suffix inside the normalized absolute path, matching what
  `componentTree` already does, or
- an absolute root threaded through from `withFlareConfig`, which knows where the config was loaded from,
  and a `path.relative` against it.

The segment search is the smaller change and is consistent with the existing normalizer. Either way the
tests must use absolute fixture paths, since a relative fixture would pass while the real build fails.

Getting this wrong fails silently and lands on precisely the case this rule exists to prevent. The
directory prefix is dropped, every route resolves to a bare `+page`, and `/\+(page|layout)$/` still
matches, so profiling still happens and produces spans that are uniformly indistinguishable. There is no
error to notice.

### Deliberately kept separate from `extractComponentName`

`extractComponentName` (bare basename) feeds the error-reporting component tree and is already published.
Profiling gets the new route-aware name; error reports keep the basenames they ship today.

Unifying would arguably improve error reports too, since `product/[id]/+page` beats `+page` there as well.
It is rejected for this slice because it changes shipped behavior for existing users and drags the
component-tree tests into a profiling change. Revisit separately if wanted. The cost is two naming
functions in one preprocessor, which the plan should call out in a comment so it does not read as an
oversight.

## Injection

Two decisions at two different levels, which the plan should keep apart because they are easy to
conflate.

**Per config, in `withFlareConfig`.** Install the preprocessor unless both features are off. Only
`componentTracking === false` together with a falsy or empty `profileComponents` skips it entirely.

**Per file, in the hooks.** Given an installed preprocessor:

| `componentTracking` | matches `profileComponents` | injected                                                      |
| ------------------- | --------------------------- | ------------------------------------------------------------- |
| on                  | yes                         | both imports, `__flare_reg__(...)` then `__flare_prof__(...)` |
| on                  | no                          | today's registration only, unchanged                          |
| off                 | yes                         | `__flare_prof__(...)` only                                    |
| off                 | no                          | nothing                                                       |

That last row is reachable: `{ componentTracking: false, profileComponents: ['Foo'] }` installs the
preprocessor, and every file that is not `Foo` gets nothing. It is a per-file miss, not an uninstalled
preprocessor.

**`exclude` stays a global kill switch.** It short-circuits both hooks today, before anything is
injected, and it keeps doing that. An excluded file gets neither a registration nor a profile call,
whatever `profileComponents` says. The alternative, scoping `exclude` to the tree only, would mean a file
the user explicitly excluded still emits spans. Add a test row for it, since the option now has two
features to suppress rather than one.

Injected form for the first case:

```js
import { __flareRegisterComponent as __flare_reg__, __flareProfileComponent as __flare_prof__ } from '@flareapp/svelte';
const __flare_node__ = __flare_reg__('Name', '/app/src/routes/product/[id]/+page.svelte');
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

`createComponentMatcher` currently lives in `packages/vue/src/profileVueComponents.ts`. The Svelte slice
needs the same function at build time, so it has to be shared. Where it lands is the open question below.

This is a real dedup, not a cosmetic one: the function carries non-obvious logic (stripping `g` and `y`
flags into a copy, because a sticky regex carries `lastIndex` between calls and would make every other
`test()` miss). Copying that into the Svelte package would be copying a bug fix.

It cannot live in `@flareapp/js/browser` like the rest of the tracing seam, because the Svelte matcher
runs at build time inside `svelte.config.js`, where pulling in a browser bundle entry does not belong.

Core is the obvious remaining home, and both packages already depend on `@flareapp/core@2.6.0` directly,
but it is not free and the plan should decide with the cost visible rather than assume it away:

- `@flareapp/svelte/config` currently imports only `magic-string` and `svelte/compiler`. It is a clean,
  light Node build-time entry.
- Core has a single `.` export, no `sideEffects: false` declaration, and a built bundle around 60 KB ESM
  that carries `Flare`, `Api`, the tracer, stack parsing and `error-stack-parser`.
- Nothing tree-shakes here. `svelte.config.js` is evaluated by Node, not bundled. So every `vite dev`,
  `vite build`, `svelte-package` and `svelte-kit sync` would load the whole runtime error client to call
  a twenty-line pure function.

"No side effects at import" answers whether this is safe. It does not answer whether it is proportionate.
Three options, in order of preference:

1. Add a `@flareapp/core/util` subpath export so the build config pulls only the matcher. Costs one
   export map entry and one extra tsdown entry point.
2. Move it to core's root export as originally specified, and accept the load cost. Simplest, and the
   cost is milliseconds, but it couples the build config to the runtime client.
3. Duplicate the twenty lines in the Svelte package with a comment pointing at the Vue original and at
   the `lastIndex` reason. Rejected by the repo's own "shared utility" rule unless the first two turn out
   worse in practice.

Whichever is chosen, the `lastIndex` comment travels with the code. That is the part worth not losing.

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
  Re-homing keeps the page span alive, but it does not restore the nesting: the layout's marker stays
  frozen for the lifetime of the layout, so from the first navigation onward the page always attaches
  straight to the navigation root. The layout itself records nothing on those traces, because it never
  re-mounts. This is the flatter tree shown under Goal, and it is the steady state for a SvelteKit app,
  not a degraded corner case. Do not let a test assert layout nesting on a navigation trace.
- **Transparent bail.** A component that finds no live root sets no context, so descendants inherit the
  nearest profiled ancestor and re-validate against the live root themselves. Same transparency contract
  as React and Vue.
- **`{#await}` blocks.** A parent's span does **not** cover a wait in its subtree. Measured: the parent's
  `onMount` fires without waiting for the pending branch, so the parent span ends before the awaited child
  span starts (see "Time nesting is not guaranteed"). Read a parent's duration as "time to mount its own
  synchronous subtree", not as time-to-interactive. The `idleTimeout` risk belongs to the awaited child,
  not the parent: a wait long enough to close the root means the child's `recordComponentSpan` hits the
  live-root gate and drops, while the parent already recorded normally. Vue's async-`setup` behavior is
  the closer analogue for the child half of this, not for the parent.
- **Orphan degradation.** If an ancestor's span is dropped by the span cap, descendants point at a missing
  parent and Flare's tree builder reparents them to the root. Because `onMount` is bottom-up, the ancestor
  is normally buffered last, so the cap hits ancestors first. The `{#await}` inversion flips that for the
  awaited subtree, where the child buffers after its parent. Either way the tree builder handles it.
  Inherited from the React and Vue models.
- **Components with no instance script.** Already handled by the existing `markup` hook.

## Tests

In `packages/svelte/tests/`, using the existing `@flareapp/test-helpers` mocks that Vue's suite already
uses:

- `resolveProfileName.test.ts` — the naming rule, custom `routesDir`, non-route files, `+`-prefixed files
  outside the routes dir, Windows paths. **Every fixture path must be absolute**, matching the existing
  `FAKE_FILE = '/app/src/Button.svelte'` convention. A project-relative fixture would pass while the real
  build silently falls back to bare basenames.
- `preprocessor.test.ts` (extend) — the four per-file injection cases, the widened double-injection guard,
  the profile-only path, the no-instance-script path, and `exclude` suppressing the profile call as well
  as the registration.
- `preprocessor.test.ts` also covers `withFlareConfig` today; extend it there for `profileComponents`
  gating, the both-off early return, and the case that proves the install decision and the match decision
  are separate (`componentTracking: false` with a non-empty `profileComponents` still installs). There is
  no separate `config.test.ts` and this slice does not add one.
- `profileComponent.test.ts` — parent/child nesting by `parent_span_id`, bail with no live root,
  cross-trace re-homing, late/conditional mount, and that a throwing seam never propagates into the host.
- `profileComponent.test.ts` also pins the two measured Svelte behaviors the design rests on, because
  both are Svelte internals rather than documented contracts: a component passed as snippet children
  nests under the component that renders the snippet, and the `{#await}` ordering inversion. Assert the
  observed orderings, not a general "parent encloses child by time" rule, which is false.
- Assert the navigation shape as it actually is: page re-homed directly under the navigation root, no
  layout span on that trace. A test that expects layout nesting after a navigation encodes the wrong
  model and will pass only by accident.

`packages/vue/tests/profileVueComponents.test.ts` moves its matcher assertions to a new core test when
`createComponentMatcher` moves.

## Playground

`playgrounds/svelte/svelte.config.js` gets `profileComponents: [/\+(page|layout)$/, 'AddToCartButton']`.

That needs one small extraction. The add-to-cart button in
`playgrounds/svelte/src/routes/product/[id]/+page.svelte` is currently inline markup, and the React and
React Router playgrounds both profile an `AddToCartButton` leaf. Extracting it to
`playgrounds/svelte/src/lib/AddToCartButton.svelte` keeps the three playgrounds comparable and gives a
deep enough tree to actually see nesting. The existing `testIds.addToCart(product.id)` test id moves with
it, so the e2e suite is unaffected.

Manual check when wiring it up: load `/product/<id>` directly and confirm the full pageload tree
(`+layout` → `product/[id]/+page` → `AddToCartButton`), then navigate between two products and confirm
the flatter navigation tree with no layout span. Those are two different expected shapes, not a bug in
one of them. The layout also sits inside `<FlareErrorBoundary>` in this playground, which was measured to
be transparent to both context and ordering, so it should not appear in or disturb the tree.

## README

A component-profiling section in `packages/svelte/README.md` covering:

- setup through `withFlareConfig`, including the `componentTracking: false` combination.
- the allowlist forms, and the span-volume warning for `true`.
- the naming table, and that names are route-aware for `+`-prefixed files.
- that only matched components produce spans, and that unmatched ancestors are skipped in the nesting.
- that there are no update spans, with the runes reason, so nobody files it as a bug.
- that layouts appear on the load where they mount, so a navigation waterfall is flatter than a pageload
  one. Without this the first bug report will be "my layout span disappeared".
- that a parent's duration excludes waits in an `{#await}` subtree, and that such a child can appear after
  its parent ends in the waterfall.

## Out of scope

- Update, destroy and unmount spans.
- e2e coverage. No framework's component spans are covered by Playwright today; React's was explicitly
  deferred. Closing that gap is its own slice across all three packages.
- Unifying `extractComponentName` and `resolveProfileName`.
- Any change to `@flareapp/js` or the wire format.
