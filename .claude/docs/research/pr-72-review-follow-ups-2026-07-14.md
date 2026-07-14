# PR #72 review follow-ups (2026-07-14)

Source: full review of https://github.com/spatie/flare-client-js/pull/72 (React Router v7 data-mode
tracing + carry-forward dedup commits). The two blocking items and the two major test gaps from that
review are already handled: the PR description now names all four peer-floor raises and the
release-notes plan, and the search/hash + held-child-during-hold tests were added to the branch.

This doc holds every remaining minor and nit so they can be handed to agents later. Each item says
exactly what to change, where, and how to verify. Items are independent unless noted. None of them
block merging PR #72.

Severity legend: minor = real but low-impact defect or gap; nit = hygiene/documentation.

---

## A. Tracing seam (`@flareapp/js`)

### A1. Redirect/superseded navigation keeps the first destination's `url.full` (minor, needs a decision)

- Files: `packages/js/src/tracing/browserTracing.ts` (`settleNavigation`, `applyRouteName`),
  `packages/react/src/react-router.ts` (the `inFlight && idle` settle branch),
  `docs/superpowers/specs/2026-07-13-performance-tracing-framework-router-react-router-design.md`.
- Problem: a held navigation root opens with `url.full` and `flare.entry_point.value` stamped from
  the first destination. A loader redirect (or a navigation superseding it) settles the same root
  with the final route's name, so the span name says `/new` while `url.full` still says `/old`.
- Change (pick one):
    1. Re-stamp at settle: extend `settleNavigation(route)` to `settleNavigation(route, url?)`.
       When `url` is set, recompute `url.full` and `flare.entry_point.value` on `currentRoot` from it,
       running through `redactUrlQuery(url, activeFlare.config.urlDenylist)` exactly like
       `collectBrowserSpanContext` does (reuse its `resolveHref` normalization; ignore unparseable).
       The RR integration then passes `hrefOf(state.location)` at settle.
    2. Or document in the spec that `url.full` is the initiated destination and the name is the
       settled route, as a deliberate contract.
- Verify: unit test in `packages/js/tests/navigationSource.test.ts` (start with url A, settle with
  url B, assert final `url.full`), plus an integration test in
  `packages/react/tests/react-router.integration.test.ts` with a loader returning `redirect('/other')`.

### A2. `unregister()` during a held navigation leaves the root held until `finalTimeout` (minor)

- Files: `packages/js/src/tracing/browserTracing.ts` (`registerNavigationSource().unregister`),
  `packages/js/tests/navigationSource.test.ts`.
- Problem: if the framework integration is cleaned up (route-provider unmount, HMR) while a held
  navigation root is open, nothing ever calls `releaseHold`, so the root idles suppressed until the
  30 s `finalTimeout` force-close.
- Change: in `unregister()`, when `controller && !controller.isEnded`, call
  `controller.releaseHold()` (guarded try/catch like the other seam paths). A childless root then
  closes at unregister time; one with an open child returns to the normal idle lifecycle.
- Verify: new unit test: register, `startNavigation({ hold: true })`, `unregister()`, advance
  `idleTimeout`, assert the root closed (and did not wait for `finalTimeout`).

### A3. `endNow()` on a childless held root reports ~0 duration (minor)

- Files: `packages/js/src/tracing/IdleRootController.ts` (`endNow`),
  `packages/js/tests/idleRootController.test.ts`.
- Problem: `endNow()` (pagehide, superseding registration, stop) trims a childless root to
  `endFloor`, which for navigation roots is the root's own start. A held root is by definition
  mid-loader-window, so the trace records ~0 duration for work that genuinely ran.
- Change: in `endNow()`, treat a held root like one with open children:
  `this.finish(this.openChildren > 0 || this.held ? this.deps.now() : this.trimmedEnd())`.
- Verify: unit test: held root, no children, `setClock(5000 * 1e6)`, `endNow()`, assert
  `root.end` called with `5000 * 1e6` (today it gets the floor, `0`).

### A4. `childSpanTimeout` backstop on a held root is untested (minor, test only)

- Files: `packages/js/tests/idleRootController.test.ts`.
- Problem: the `held` doc comment in `IdleRootController.ts` promises both backstops still fire, but
  only the `finalTimeout` half has a test. A held root with a stuck open child must force-end at
  15 s, not hang to 30 s.
- Change: add a test: held root, `h.emit('start', child)`, `h.advance(15000)`, assert ended.
- Verify: test passes against current code (it should; this pins the behavior).

### A5. Redaction wiring on the `hrefOverride` path is untestable as written (minor, test only)

- Files: `packages/js/tests/collectBrowserSpanContext.test.ts`.
- Problem: the test config's denylist is `/(?!)/` (matches nothing), so a regression where the
  override path bypasses `redactUrlQuery` (in `request.ts` or `collectBrowser.ts`) fails no test.
  That bypass would leak denylisted query values into `url.full` on every framework navigation root.
- Change: add one case with a denylist that matches a query param in the override URL, e.g.
  override `https://app.test/checkout?token=secret&x=1` with denylist `/token/i`; assert both
  `url.full` and `flare.entry_point.value` show the redaction placeholder for `token`.
- Also: strengthen the "non-URL keys reflect the live document" assertion by checking
  `http.request.referrer` and `document.ready_state` explicitly, not just `user_agent.original`.

### A6. Unconsumed `redactObjectValues` re-export (nit)

- Files: `packages/js/src/util/index.ts` (line ~10).
- Problem: the re-export was added but nothing in `packages/js` imports it from there; the js root
  `index.ts` re-exports it straight from `@flareapp/core`.
- Change: remove it from `util/index.ts`, or keep it and note it is deliberate public surface.
  Either way make it intentional.
- Verify: `npm run typescript && npx vitest run` in `packages/js`.

---

## B. React Router integration (`@flareapp/react`)

### B1. Registration-order dependency for pageload naming (minor, docs at minimum)

- Files: `packages/react/src/react-router.ts` (doc comment on `traceReactRouter`), future README.
- Problem: if `traceReactRouter(router)` runs before flare's browser tracing has started (no root
  exists yet), the registration-time `setActiveRouteName` no-ops. For a router that is already
  `initialized` (the common loader-less case) no later subscriber fire re-names the pageload, so it
  stays URL-named with `flare.route.source: 'url'`.
- Change (minimum): document the required boot order (initialize flare with `enableTracing` before
  creating/tracing the router). Optional hardening: make `setActiveRouteName` remember the last
  route name while no root exists and apply it when the pageload root starts; that is a seam change
  in `browserTracing.ts`, decide deliberately.
- Verify (if hardening): unit test in `navigationSource.test.ts`: register + `setActiveRouteName`
  before `startBrowserTracing`, then start it, assert the pageload root got the name.

### B2. Loader-that-throws (error boundary) settle is untested (minor, test only)

- Files: `packages/react/tests/react-router.integration.test.ts`.
- Problem: real RR commits `location` + destination `matches` + `errors` via `completeNavigation`
  when a loader throws, so the settle should carry the destination route name. Nothing pins this;
  an RR change in error-path matches would silently change or drop the settle name.
- Change: add a route `{ path: 'boom', loader: () => { throw new Error('x'); }, errorElement: ... }`
  (errorElement optional for a memory router; an `errors`-committing navigation is enough), navigate
  to `/boom`, assert one `startNavigation` (held) and a settle with `{ name: '/boom', source: 'route' }`.

### B3. Fetcher traffic is untested against the real router (minor, test only)

- Files: `packages/react/tests/react-router.integration.test.ts`.
- Problem: the claim "fetchers/revalidation open no navigation roots" rests on a hand-rolled mock
  emit. Real `router.fetch(...)` loads and fetcher submissions flip `state.revalidation` /
  `state.fetchers` but keep `navigation.state` idle and the location unchanged.
- Change: add a test using `router.fetch(key, routeId, href)` for a GET load and one fetcher POST
  submission; assert `nav.startNavigation` was never called.

### B4. Initial-hydration path untested against the real router (minor, test only)

- Files: `packages/react/tests/react-router.integration.test.ts`.
- Problem: `createMemoryRouter` auto-initializes, and the current suite only boots loader-less index
  routes, so `sawInitialSettle === true` at registration in every integration test. The deferred
  pageload naming and initial-load redirect attribution (`react-router.ts` init comment's claims
  about RR init ordering) are mock-verified only.
- Change: two tests: (1) initial route with an async loader: assert pageload re-named after init,
  no navigation root; (2) initial loader returning `redirect('/other')`: assert the pageload gets
  the redirect target's route name and `startNavigation` is never called.

### B5. Unit-test mock hygiene (nit)

- Files: `packages/react/tests/react-router.test.ts`.
- Problems and changes:
    1. The fake `unsubscribe` (`unsub = vi.fn()`) never disconnects the callback, so the cleanup test
       only proves `unsubscribe()` was invoked. Wire it to null out `cb`, then emit after `stop()` and
       assert no further `startNavigation`/`settleNavigation` calls.
    2. The comment "mutate the shared state object (as RR does)" is wrong: real RR replaces the state
       object each update (`state = { ...state, ...newState }`). Fix the comment (the mock behavior
       itself is fine today because the source never holds a state reference across fires).
    3. Add call-order assertions (`mock.invocationCallOrder`) between `startNavigation` and
       `settleNavigation` in the loader-nav tests so a swapped order cannot pass.

### B6. Integration-test hygiene (nit)

- Files: `packages/react/tests/react-router.integration.test.ts`.
- Problems and changes:
    1. The `// @vitest-environment jsdom` pragma sits after an import; it only works because
       `vitest.config.ts` already sets jsdom. Move it above all imports or delete it.
    2. `boot()` calls `router.initialize()`, but `createMemoryRouter` auto-initializes; the call and
       its comment imply the test controls init timing. Remove the call or fix the comment.
    3. The async-loader test asserts via `mock.calls.at(-1)` without `toHaveBeenCalledTimes(1)`;
       add the count assertion.
    4. `boot()` returns `stop` but no test calls it; either use it in an afterEach or drop it.

### B7. Hash-router `url.full` behavior is unpinned (nit, test only)

- Files: `packages/react/tests/react-router.integration.test.ts` (or a small unit test on `hrefOf`
  via exported behavior).
- Problem: the documented limitation (fragment-encoded URL not reconstructed for `createHashRouter`)
  has no test locking today's output, so a silent change in either direction goes unnoticed.
- Change: add a test pinning the current output for a hash-router-style location and reference the
  limitation comment in `react-router.ts`.

### B8. Hash-only navigations open roots (nit, decision/documentation)

- Files: `packages/react/src/react-router.ts` (`keyOf`), spec doc.
- Problem/observation: `keyOf` includes `hash`, so `#anchor`-only changes open navigation roots.
  This matches TanStack's event-driven behavior but is noisier than the built-in history fallback
  (pathname-only). On anchor-heavy apps this inflates navigation counts.
- Change: document the decision in the spec (or exclude hash-only changes deliberately; if so,
  update the new hash-only integration test accordingly).

### B9. `react-router` peer floor `>=7.0.0` is verified against 7.18 only (minor, decision)

- Files: `packages/react/package.json`.
- Problem: the two-shape detection relies on RR internals (loader-less `completeNavigation`
  short-circuit). The mechanism is old (6.4-era) so risk is low, but nothing exercises 7.0.x.
- Change: either add a periodic/manual check installing `react-router@7.0.x` and running
  `tests/react-router.integration.test.ts`, or raise the peer floor to the oldest minor actually
  verified. Decide and record in the spec.

### B10. No user-facing docs for `traceReactRouter` (nit, blocked on backend contract)

- Files: `packages/react/README.md`.
- Problem: neither `traceReactRouter` nor `traceTanStackRouter` is documented in the README. Both
  are provisional pending the backend contract, so this is deliberate for now.
- Change: when the backend contract lands, document both entries (usage snippet, data-mode-only
  caveat, boot order from B1, hash/basename limitations).

---

## C. Dedup / carry-forward slice (core, sveltekit, svelte, nextjs, react)

### C1. `safeClone` accumulator skips the PR's own `__proto__` hardening (minor)

- Files: `packages/core/src/util/safeClone.ts` (line ~51), `packages/core/tests/safeClone.test.ts`.
- Problem: the clone accumulator is a plain `{}`, so an own `__proto__` key (e.g.
  `JSON.parse('{"__proto__":{"x":1}}')` passed to `addContext` or glow metadata) hits the prototype
  setter and the value is silently dropped from the report. Same behavior as pre-PR, but this PR
  added `Object.create(null)` + tests to `redactObjectValues` and `cookie()` for exactly this case,
  and `safeClone` handles the most attacker-influenced data.
- Change: use `Object.create(null)` for the object accumulator (JSON serialization output is
  unchanged), and add a test cloning `JSON.parse('{"__proto__":{"x":1}}')` asserting the key's
  value survives as data.
- Verify: `packages/core` and `packages/vue` suites (vue's `serializeProps` tests exercise the same
  code path in display mode).

### C2. `stripUserinfo` misses protocol-relative URLs (minor)

- Files: `packages/core/src/util/redactUrl.ts` (line ~101), `packages/core/tests/redactUrl.test.ts`.
- Problem: the strip requires `scheme://`, so `redactUrlQuery('//user:pass@host/path', ...)` leaks
  the credentials. Internal callers pass absolute URLs today, but `redactUrlQuery` is public API on
  core and js.
- Change: extend the pattern to also match scheme-relative input (leading `//`).
- Verify: new test case for `//user:pass@host/path` asserting userinfo is stripped.

### C3. `redactParams` in sveltekit duplicates `redactObjectValues` (minor)

- Files: `packages/sveltekit/src/redactQueryParams.ts` (lines ~14-22).
- Problem: a hand-rolled near-duplicate of `redactObjectValues` was added in the same PR that
  hoisted `redactObjectValues` into core; the duplicate also lacks the null-prototype guard.
- Change: replace the local helper with `redactObjectValues` imported from `@flareapp/js` (already a
  dependency and already re-exports it), casting the result if needed for the `Record<string,
string>` shape.
- Verify: `packages/sveltekit` suite.

### C4. `configure({ replaceDefaultUrlDenylist: true })` without `urlDenylist` resets a custom denylist (nit, pre-existing edge)

- Files: `packages/core/src/Flare.ts` (denylist guard, lines ~201-209).
- Problem: the raw custom regex is never stored, so a later `configure` call passing only
  `replaceDefaultUrlDenylist: true` re-resolves against `undefined` and lands on the default list.
  Only reachable when denylist config is explicitly passed; the common reconfigure case is fixed.
- Change: store the raw configured `urlDenylist` and re-resolve from it, or document the edge in the
  config type's doc comment. Decide; do not silently leave it.
- Verify: extend the existing denylist-reconfigure regression tests in core.

### C5. Core-level `safeClone` display coverage relies on vue's suite (nit, test only)

- Files: `packages/core/tests/safeClone.test.ts`.
- Problem: `objectKeyCap`, string truncation, and circular handling in display mode are covered only
  via `packages/vue/tests/serializeProps.test.ts`. A future core-only change could pass core tests
  and break vue.
- Change: duplicate the display-mode cases (key cap, truncation string, circular placeholder) at the
  core level.

### C6. `verify-inject-no-root.mjs` comment is stale (nit)

- Files: `packages/react/scripts/verify-inject-no-root.mjs` (line ~8); check the svelte/vue
  equivalents for the same wording.
- Problem: the comment says `@flareapp/js/browser` is "type-only, erased in JS", but the inject
  graph now runtime-imports it (via `resolveFlare.ts` importing `createFlareResolver`). The check
  itself is still correct because `browser.ts` has no import-time side effects.
- Change: update the comment to say the specifier is allowed because it is runtime-imported but
  side-effect-free, and that `index.ts` (the root singleton) remains forbidden.

### C7. Svelte preprocessor `isModuleScriptAttributes` scans raw attribute text (minor)

- Files: `packages/svelte/src/preprocessor.ts` (line ~109), `packages/svelte/tests/preprocessor.test.ts`.
- Problem: the module detection regexes over the raw attribute string, so an instance script whose
  attribute value contains the standalone word "module" (e.g. `<script lang="ts" data-note="a module b">`)
  is misclassified as module-only; the markup hook then injects a second instance script and Svelte
  fails to compile ("a component can only have one instance-level script"). Contrived input, but a
  compile-breaking false positive.
- Change: detect the module context from parsed attributes (the script hook directly above already
  receives Svelte's parsed `attributes` object; mirror that approach) instead of regexing raw text.
- Verify: regression test with an instance script whose attribute value contains "module".

### C8. React legacy component-stack lines still fall to the fallback (nit, pre-existing)

- Files: `packages/react/src/parseComponentStack.ts`, `packages/react/tests/parseComponentStack.test.ts`.
- Problem: the new `REACT_LEGACY_STACK_REGEX` work stopped one shape short: legacy production lines
  in the `in ComponentName (created by X)` form (no `__source`) still hit the fallback and keep the
  `in ` prefix in the reported name.
- Change: add the `(created by X)` shape to the legacy regex (strip the prefix, keep the component
  name), with a test using a real legacy-format stack sample.

---

## D. Release-time checklist (already in the PR description, repeated here for the release agent)

1. Bump `@flareapp/js` minor (new seam: `settleNavigation`, `startNavigation` `url`/`hold`,
   `createFlareResolver`/`toCustomContext` exports).
2. Raise the `@flareapp/js` peer floor in **all four**: `@flareapp/react`, `@flareapp/vue`,
   `@flareapp/svelte`, `@flareapp/sveltekit` (they runtime-import the new exports).
3. GitHub release notes get a "changed for security reasons" section covering: `redactUrlQuery`
   userinfo stripping, denylist-matching cookie redaction, and the `@flareapp/nextjs`
   `removeSourcemaps` default flip to `true` (minor breaking; `removeSourcemaps: false` restores
   the old behavior).
4. Update the version table in `CLAUDE.md` after releasing (standard flow).
