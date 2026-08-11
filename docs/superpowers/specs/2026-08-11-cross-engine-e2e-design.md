# Cross-engine e2e — Design

Status: ready for planning
Date: 2026-08-11
Branch: `performance-monitoring-and-tracing`

**Every claim in the "What was measured" section was produced by running the suite, not reasoned
about.** Two of my own starting assumptions did not survive that and are marked as corrections in
place rather than quietly dropped. The cause of the one bug found is still a hypothesis and is
labelled as such.

## Goal

Prove the JavaScript client behaves correctly on all three browser engines, and make that provable on
demand. Tracing is the part that has to be right. The engine axis is opt-in and defaults to Chromium;
wiring it into continuous integration so it re-proves itself automatically is not done (see "Out of
scope").

## How this started, and why the instrument changed

The original request was to make `scripts/seed-browser-traffic.mjs` run on Firefox, WebKit and
Chromium. That script is the wrong instrument for the stated goal, for two reasons.

1. It is a screenshot data generator. It drives a browser and produces traffic you look at in the
   Flare interface. It makes no claims and fails at nothing.
2. Its whole character is Chromium-only. Every network profile and processor throttle goes through
   `context.newCDPSession`, and the Playwright documentation is explicit that CDP sessions are only
   supported on Chromium-based browsers. Its `iphone` device profile cannot run on Firefox at all:
   `playwright-core` throws `options.isMobile is not supported in Firefox`. A three-engine seed run
   would produce data that is not comparable between engines.

The e2e suite is the right instrument. It already contains about 40 tests asserting exactly the
properties that must hold: pageload roots, navigation roots, fetch and XHR nesting under the active
root, parameterized route names, traceparent identifiers, span errors on 5xx, component trees,
hash-only navigations, and an aborted XHR releasing its root. It uses neither CDP nor mobile
emulation, so nothing blocks it from running on another engine.

The seed script is left alone. It stays a Chromium-only screenshot tool.

## What was measured

Playwright 1.60.0. Firefox 150.0.2 (playwright build v1522), WebKit 26.4 (playwright build v2287).
134 tests per engine, across all six framework projects.

| Engine   | Result    |
| -------- | --------- |
| Chromium | 134 / 134 |
| Firefox  | 134 / 134 |
| WebKit   | 133 / 134 |

WebKit's single failure was a non-deterministic test, not a client defect (see the retraction below).

The client is in far better shape across engines than expected. Fetch patching, XHR patching,
traceparent propagation, pageload and navigation roots, span nesting, parameterized route names,
component trees, span errors, aborted XHR handling and the keepalive flush on unload all work on all
three engines, in every framework integration.

### The WebKit failure (not a client bug — retracted)

> **Retracted 2026-08-11.** This is not a client defect. See "Spike result" below: the fetch is a
> hover-triggered SvelteKit preload fired by Playwright's own pointer movement, before the navigation
> starts. Attributing it to the page being left is correct. The defect was in the test, which did not
> control for preload; it is fixed by clicking without hovering. The paragraphs below are kept because
> the measurements in them are real, but their conclusion is wrong.

`e2e/specs/svelte.spec.ts:297`, "SvelteKit's load-provided fetch produces a browser_fetch span".

The failure is not deterministic. Instrumented over four WebKit runs, and six runs on each of the
other two engines:

```
webkit   run 1  parent= browser_navigation  name= /http     correct
webkit   run 2  parent= browser_pageload    name= /         wrong
webkit   run 3  parent= browser_navigation  name= /http     correct
webkit   run 4  parent= browser_pageload    name= /         wrong

chromium 6 / 6  parent= browser_navigation  name= /http     correct
firefox  6 / 6  parent= browser_navigation  name= /http     correct
```

The span is not orphaned and the trace identifier is consistent between child and parent. The defect
is attribution: on Safari, a SvelteKit load fetch fired during a client navigation is charged to the
page the user came from instead of the page they went to, roughly half the time.

**Hypothesis, not yet confirmed.** `traceSvelteKitRouter` opens the navigation root from a Svelte
effect watching `navigating.to` in `$app/state`. Effects flush asynchronously. Kit starts the load
function, and its fetch, at navigation start. On WebKit the fetch wins that race about half the time.
A spike must confirm this by measuring effect flush against fetch start on WebKit before the fix is
written.

**This corrects an earlier conclusion.** The note that the effect-batching risk for the SvelteKit
slice "was measured away with a playground probe" holds on Chromium. It does not hold on WebKit. That
probe only ever ran on one engine.

Using the History change as an earlier signal will not work. For a normal Kit navigation the address
bar updates after the load resolves, which is later still, not earlier. `traceSvelteKitRouter.svelte.ts`
already says as much in its own comments.

### Web vitals per engine

Measured by loading a page, clicking before the first navigation so INP exists, then unloading to
force the late vitals flush, and reading every `browser.web_vital.*` attribute that reached the fake
server.

| Engine   | ttfb | fcp | lcp | inp | cls    |
| -------- | ---- | --- | --- | --- | ------ |
| Chromium | yes  | yes | yes | yes | yes    |
| Firefox  | yes  | yes | yes | yes | **no** |
| WebKit   | yes  | yes | yes | yes | **no** |

**Correction.** I claimed at the start that LCP, INP and CLS are all Chromium-only. Measured, only
CLS is. Four of the five vitals arrive on every engine. The comment in `packages/js/src/tracing/webVitals.ts`
saying "CLS is Chromium-only" is correct, and the absent-rather-than-zero handling it describes is
doing real work on two engines today.

### Stack frames per engine

All three engines produce a correct top frame for the same thrown error: same file, same line 8,
`isApplicationFrame: true`, and a working code snippet. Sourcemap resolution will work on all three.

Only the function name on deeper frames differs, which is normal engine variation:

```
chromium   HTMLButtonElement.<anonymous>
firefox    renderBroken/</<           (plus an extra async frame marked with *)
webkit     Anonymous or unknown function
```

**What `error-stack-parser` does and does not guarantee.** It dispatches to a different parser per
engine, `parseV8OrIE` for Chromium and `parseFFOrSafari` for Firefox and WebKit, and returns the same
`StackFrame` schema from all of them. That is why frames parse correctly on all three engines. It
cannot supply data the engine never emitted, so it does not equalize the values:

- `Anonymous or unknown function` is not the parser's. It is our own fallback at
  `packages/core/src/stacktrace/createStackTrace.ts:32`, used when `functionName` is empty. WebKit
  gave no name for that frame.
- Firefox and Chromium use different naming notation for the same frame, and neither string converts
  into the other.
- Frame counts and positions differ: Firefox adds an async frame, and WebKit placed the handler frame
  at line 87 column 19 where the other two said line 89 column 12.

This is the argument for what the frames spec asserts. The schema is already the library's job and
needs no test. The values are what nothing verifies today.

### Coverage gaps found

The suite has **zero** tests touching web vitals and **zero** assertions on stack frame contents.
Error tests assert that a report arrived, never that its frames are right. Both areas work today, as
measured above, but nothing would notice if either regressed on any engine.

## Part one: the engine axis

Add an opt-in engine dimension to `playwright.config.ts`, following the `E2E_PROD` pattern already in
that file.

- `E2E_ENGINES=chromium,firefox,webkit` builds the cross product of the six framework projects and the
  listed engines.
- Default stays Chromium only. `npm run test:e2e` does not change in behaviour or runtime.
- Chromium projects keep their bare names (`js`, `svelte`), so `--project=svelte` and the commands
  documented in `CLAUDE.md` keep working. Other engines take a suffix: `svelte-firefox`,
  `svelte-webkit`.
- New root script `test:e2e:engines` for the full three-engine run. Roughly twelve minutes at
  `workers: 1`.

The project name guard already in the config, anchoring every `testMatch` on a path boundary, must be
preserved when the projects become generated rather than literal.

Contributors need `npx playwright install firefox webkit` once. Document that next to the new script.

## Part two: the WebKit failure (retracted — see below)

> **Retracted 2026-08-11.** Neither shape below was built. The spike in "Spike result (2026-08-11)"
> found the premise wrong: `beforeNavigate` is not the earliest signal available, because SvelteKit's
> hover-preload fires a `load` fetch before any navigation-lifecycle hook runs at all. There is no
> client bug to fix here; see "The WebKit failure (not a client bug — retracted)" above. The prose
> below is kept as the record of what was considered before the spike ruled it out.

Chosen direction: **an optional companion for the root layout.**

`traceSvelteKitRouter()` stays in `hooks.client.ts` and keeps doing the naming and settling. A new
export is called from the root `+layout.svelte` during component initialization, where it may legally
use `beforeNavigate` to open the navigation root synchronously at navigation start.

This shape is forced by SvelteKit's own constraint. The documentation for `beforeNavigate` states it
"must be called during component initialization and remains active while the component is mounted".
`hooks.client.ts` is not a component, so the early signal is simply not reachable from where the
integration lives today.

Why this over the alternatives:

- Moving the whole integration into the layout would fix it for everyone from one entry point, but it
  is a breaking change for existing users and a documentation rewrite.
- Re-parenting an in-flight child in core would fix this class of race for every framework, but it is
  a wide-blast-radius change to core and only works while the child has not been exported yet.
- Documenting it and leaving it leaves wrong data in customer traces.

The existing state machine already accommodates this. `syncNavigation` opens a root only when
`inFlight` is false, so a companion that sets `inFlight` and calls `startNavigation({ hold: true })`
early will be followed by the effect merely renaming the root, not opening a second one.

The companion needs the same guards `syncNavigation` applies: skip when the document will unload, skip
when the destination route identifier is null, skip when the origin differs. Those guards must be
extracted into one shared predicate used by both paths rather than duplicated.

### Open question that the spike must resolve

`traceSvelteKitRouter`'s documented behaviour is that it opens **no** navigation root for a navigation
a `beforeNavigate` guard cancelled. Opening the root at navigation start puts that guarantee at risk:
another handler may cancel after ours has already opened it.

`NavigationSource` in `packages/js/src/tracing/navigation.ts` currently offers only
`startNavigation`, `setActiveRouteName`, `settleNavigation` and `unregister`. **There is no way to
discard a root that was opened.** If the spike shows cancelled navigations do produce a stray root,
the fix needs a `discardNavigation()` on that seam, which is a change to the shared browser seam and
touches all four router integrations. That would materially change the size of this work, so resolve
it before planning the implementation.

**Answered by the spike below: moot.** Neither shape is being built. `beforeNavigate` itself lands
after the load fetch in most WebKit trials, so there is no earlier hook to open a root from in the
first place. See "Spike result (2026-08-11)".

## Part three: close the two coverage gaps

Two small specs, each locking in the measurements above so they become regressions when broken.

**Vitals spec.** Load a page, click before the first navigation, unload. Assert `ttfb`, `fcp`, `lcp`
and `inp` arrive on all three engines, and `cls` only on Chromium. Assert CLS is absent rather than
zero on Firefox and WebKit, which is the behaviour `webVitals.ts` promises in a comment and nothing
currently proves.

**Frames spec.** Trigger a known throw. Assert the top frame carries the right file, the right line
and `isApplicationFrame`. Deliberately assert nothing about function names, because they legitimately
differ per engine.

Per-engine expectations live in one small helper next to `e2e/specs/otlp.ts`, so engine differences sit
in a single place instead of being sprinkled through assertions. Both specs read the fake server
through the existing `fakeFlare` fixture and the existing `spansOf` / `stringAttr` helpers. No new
inspection machinery.

## Out of scope

- `scripts/seed-browser-traffic.mjs`. It stays Chromium-only.
- Continuous integration. The three-engine run stays a local opt-in script; wiring it into an
  automated pipeline is separate work.
- The Node and React Native suites. This is about browser engines.
- Sourcemap resolution end to end per engine. Frames are asserted; the upload and lookup path is not.

## Spike result (2026-08-11)

Probe: `startNavTimingProbe()` patched `window.fetch` to mark `loadFetchStart` when the URL matched
`kit-load-fetch`, plus marks from the root layout's `beforeNavigate` (synchronous), a
`queueMicrotask` fired from inside it (`microtask:navigatingSet` / `microtask:navigatingNull`
depending on whether `navigating.to` from `$app/state` was set by then), and the `$effect` watching
`navigating.to` (`effectSawNavigating`). Navigation was triggered the same way the failing test
triggers it: `page.getByRole('link', { name: 'HTTP' }).click()`.

### Raw ordering, WebKit, `.click()`, 8 runs (matches the failing test's gesture)

```
run 1  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct
run 2  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 3  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 4  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 5  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 6  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 7  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
run 8  loadFetchStart, beforeNavigate, microtask:navigatingSet, effectSawNavigating    wrong
```

7 of 8 runs: `loadFetchStart` lands before `beforeNavigate` itself, not just before the effect.

### Raw ordering, Chromium, `.click()`, 4 runs

```
run 1  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct
run 2  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct
run 3  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct
run 4  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct
```

4 of 4 correct.

### The hypothesis does not hold as stated, and the actual cause is different

The design's hypothesis was that the effect flush loses a race against Kit's load fetch. That does
not match the data above: on WebKit, `beforeNavigate` itself, a synchronous call, is frequently
_already too late_. A synchronous hook cannot be beaten by an async effect flush timing issue alone;
something starts the fetch before the click's own navigation machinery runs at all.

The playground's `app.html` sets `data-sveltekit-preload-data="hover"`. Playwright's `.click()`
moves the pointer over the element before clicking, firing `mouseenter`, which is exactly the trigger
SvelteKit's hover-preload listens for. Hover-preload calls the route's `load` function, including its
`fetch`, independently of any navigation lifecycle hook: it is not a navigation, so `beforeNavigate`
does not fire for it. When the click follows quickly enough that the actual navigation reuses the
already-in-flight preloaded `load` promise, the single `loadFetchStart` mark we see is the
preload's fetch, not one triggered by the click.

**Verification.** A diagnostic variant that dispatches a raw DOM `click()` via `page.evaluate`,
skipping the synthetic mouse-move/hover Playwright's `.click()` performs, produces the correct
order on WebKit in 8 of 8 runs:

```
run 1-8  beforeNavigate, microtask:navigatingSet, effectSawNavigating, loadFetchStart   correct (8/8)
```

That isolates the two mechanisms. With hover removed, the original hypothesis (effect flush vs. the
navigation's own load fetch) does not reproduce on WebKit at all in this sample: the effect always
wins. The failure that actually shows up in the e2e suite, and in real mouse users who hover before
clicking, is hover-preload's fetch racing ahead of the entire navigation lifecycle, not the effect
racing the fetch inside it.

### Cancelled-navigation check

`beforeNavigate` cancels the navigation after both marks are recorded, with `__cancelNext` set before
the click:

```
["beforeNavigate@1341", "microtask:navigatingNull@1341", "loadFetchStart@1358"]
```

`navigating.to` was correctly null at microtask time (no `effectSawNavigating` mark), so a cancelled
navigation is still distinguishable early, when the navigation reaches that point at all. But
`loadFetchStart` still appears after the cancellation, confirming hover-preload's fetch is entirely
decoupled from `beforeNavigate`'s cancel path: it already fired from the hover, before the click was
even evaluated, cancelled or not.

### Decision: outcome 3, STOP

`beforeNavigate` itself lands after `loadFetchStart` in 7 of 8 realistic (`.click()`) WebKit runs.
Per the brief's decision rule, this is outcome 3, not outcome 1 or 2: neither Shape A
(`queueMicrotask` in `beforeNavigate`) nor Shape B (synchronous open in `beforeNavigate`) can work,
because both hinge on `beforeNavigate` as the earliest signal, and it is demonstrably not the
earliest signal when hover-preload is involved. There is no navigation-lifecycle hook that fires
before a hover-triggered preload, because preloading is not a navigation.

Task 3 as scoped (implement Shape A or B) is void. This needs re-planning against a different
signal, something that can observe hover-preload starting a `load` call, not just navigation start.
Candidates worth investigating in that re-plan, not decided here: SvelteKit's `data-sveltekit-preload`
DOM attribute/event surface, or intercepting `router.preloadData` if such a seam exists, or accepting
that the fetch cannot be reliably attributed to a root before it fires and instead re-parenting it
after the fact once the navigation's identity is known.

This also corrects the design's earlier framing of the bug as effect-timing. The effect timing does
matter and the raw-click diagnostic shows the effect reliably wins that narrower race, but the
non-deterministic root observed in the actual failing test comes from hover-preload outracing
`beforeNavigate` itself, which is a different, larger problem than an effect-flush race.

**Concern about the design's earlier 4-run WebKit sample.** The design doc's own instrumented run
(2 correct / 2 wrong of 4) used the same `.click()` gesture and is consistent with this spike's data,
just a smaller sample. Nothing here contradicts it; it corrects the mechanism, not the observed
failure rate.

### Consequence for customers

With `data-sveltekit-preload-data="hover"` — SvelteKit's recommended default — a page's trace contains
the data fetches of pages the visitor hovered but never opened. That is a truthful record of what the
browser did, not a bug, but it means a SvelteKit page's waterfall can show requests for routes that were
never rendered. Worth a line in the SvelteKit integration documentation.
