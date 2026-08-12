# PR #80: six tracing defects and their fixes

Found by adversarial review of the `performance-monitoring-and-tracing` branch on 2026-08-12, 47 checks
across unit, jsdom and real-Chromium-against-the-playground. Nine failed, covering the six defects below.

**All six fixes are implemented and verified in the working tree, not committed.** Gate after the fixes:
build and type check exit 0, oxlint 0 errors, 1719 unit tests, 136 end-to-end tests, all passing.

Two of them change behaviour the branch has tests for, so those tests were rewritten rather than deleted:
`packages/core/tests/tracerSpanContext.test.ts` (defect 3) and `packages/js/tests/browserTracing.test.ts`
(defect 5).

---

## 1. A pageload root can end before it started

**Files:** `packages/js/src/tracing/browserTracing.ts`, `packages/js/src/tracing/IdleRootController.ts`

`startRoot` gave every pageload root `endFloor: pageloadEndNano`, the Navigation Timing `loadEventEnd`
mark. But `resolvePageloadStartNano` starts the root at `now()` instead of navigation start whenever the
SDK boots more than `finalTimeout` (30s) after load, or whenever `pageloadTraced` is already set. The
floor is then in the past, so `trimmedEnd()` returns a timestamp before the root's own start.

Measured: **-1.34s** in Chromium after a `configure({enableTracing:false})` / `configure({enableTracing:true})`
cycle, **-58s** in a unit test for an SDK booting 60s after load.

Real triggers: a lazily imported SDK, a consent-gated `configure`, a page opened in a throttled background
tab, any disable/re-enable.

**Fix.** `StartRootOptions` gains a `backdated` flag that `startBrowserTracing` sets by comparing the
resolved start against the navigation-start it asked for. A pageload that could not be backdated gets a
navigation's floor (its own start) rather than the load-event mark:

```ts
endFloor: spanType === BrowserSpanType.Pageload && backdated ? pageloadEndNano : () => startTimeUnixNano,
```

`IdleRootController.finish` also clamps, so no future caller can reintroduce this from a different angle:

```ts
atTimeNano = Math.max(atTimeNano, this.deps.rootStartTime);
```

## 2. A shared attribute value freezes the tab, then exhausts the heap

**Files:** `packages/core/src/util/traversalBudget.ts` (new), `packages/core/src/logging/otel.ts`,
`packages/core/src/util/safeClone.ts`

`valueToOpenTelemetry` and `safeClone` both detect cycles by tracking the ancestor path. That is correct
(an object referenced twice in sibling branches is not a cycle) but it means a value holding the same
child under two keys costs `2^depth` to walk, and neither had a depth or node bound.

Measured before the fix: depth 20 froze the main thread for **1.1 seconds** inside `span.end()`; depth 30
exhausted the V8 heap and killed the worker.

The blow-up itself predates this PR, but the PR is what makes it dangerous: span attributes now go
through `valueToOpenTelemetry` on **every span end**, which for a fetch span runs synchronously inside the
application's own `fetch().then()`. The `try/catch` in `Tracer.onSpanEnd` cannot help, because neither a
freeze nor an out-of-memory is catchable.

**Fix.** One shared budget module, wired into both walkers:

```ts
export const MAX_TRAVERSAL_DEPTH = 24;
export const MAX_TRAVERSAL_NODES = 50_000;
export const TRUNCATED = '[truncated: too large]';
```

`valueToOpenTelemetry` keeps its public signature and delegates to an internal `convert(value, inPath,
depth, budget)`. `safeClone` takes `MAX_TRAVERSAL_DEPTH` as its json-mode depth cap (display mode keeps
its own tighter `maxDepth` and its nicer `[Object]` / `[Array]` placeholders) and spends a node per
container in both modes.

Depth 30 now serializes in under 300ms. No existing test changed.

## 3. Enabling tracing starts sending user identity with every page view

**File:** `packages/core/src/Flare.ts`

`getScopeAttributes()` returned the whole `pendingAttributes` bag, and the Tracer stamps it on every local
root. Confirmed on the wire: `user.email`, `client.address` (the IP), `user.attributes` and every
`context.*` bag rode on every `browser_pageload` and `browser_navigation` span.

Two problems. Errors are rare and carrying full context is their whole point; page views are not, and
nobody agreed to per-page-view PII. And the payload cost is real: 20 roots carrying a 200-key `addContext`
bag produced **194 KB** of trace traffic where the spans themselves are about 10 KB.

**Fix.** An allowlist. `user.id` is what "how many users saw this page" needs; nothing else earns a place
on a span:

```ts
const SPAN_SCOPE_KEYS: readonly string[] = [USER_FIELD_KEYS.id];
```

`getScopeAttributes()` now assembles as before and picks only those keys.

**Test churn.** `tracerSpanContext.test.ts` used `addContext` as its probe for the start-time snapshot, so
its three affected tests now probe with `setUser({ id })` instead. Their intent is unchanged. One test was
added asserting the allowlist directly.

**If a customer asks for more on spans**, the follow-up is a config key listing extra scope attributes to
carry, not widening this default.

## 4. Component spans could point at a parent that never shipped

**Files:** `packages/core/src/tracing/Tracer.ts`, `packages/core/src/types.ts`,
`packages/js/src/tracing/componentProfiler.ts`, and the three framework profilers

Once `startedSpanCount` reached `maxSpansPerTrace`, `startSpan` silently made the span non-recording. The
profilers reserve a span id at mount-start and publish it to descendants, but only record the span at
mount-end, and every framework records bottom-up (Vue `mounted`, React layout effects, Svelte `onMount`).
So descendants shipped first and their ancestors were dropped by the cap, leaving orphan
`browser_component` spans with a dangling `parentSpanId`.

Reachable with the 1024 default on any large profiled list, which `profileComponents: true` opts into.

**Fix.** Pay for the slot when the id is published, not when the span records. New on `Tracer`:

```ts
claimSpanSlot(traceId: string): boolean
```

It returns false once the trace is full, and `SpanOptions` gains `claimed?: boolean` so the matching
`startSpan` skips both the cap check and the increment.

`reserveSpanId` takes the trace id and returns `string | null`:

```ts
export function reserveSpanId(traceId?: string): string | null {
    if (traceId !== undefined && !activeTracingFlare()?.tracer.claimSpanSlot(traceId)) {
        return null;
    }
    return makeSpanId();
}
```

A null is the profiler's cue to stay transparent, which all three already handle: descendants then nest
under the live root instead of a phantom ancestor. The framework changes are one line each. Nothing
outside the seam changed, so the argument stays optional and old callers still compile.

`BrowserTracingFlare`'s `tracer` Pick gains `claimSpanSlot`.

**Known cost, measured.** React drops a suspended fiber and re-renders it with fresh refs, so one mount
under `<Suspense>` reserves three times and records once. Those two extra claims are spent budget that
never becomes a span. A plain mount reserves exactly once, and at the 1024 default a page would need
several hundred suspended profiled components before it matters, so this is accepted rather than fixed:
under-reporting is the safe direction, and the alternative is releasing claims React gives us no hook to
detect. Pinned by "reserves once per plain mount, but once per discarded render under Suspense" in
`packages/react/tests/profiler.test.tsx`.

## 5. Web vitals were emitted too early, so most SPA sessions reported no INP

**Files:** `packages/js/src/tracing/browserTracing.ts`

`emitWebVitals` ran on the first SPA navigation as well as on page hide, and `takeWebVitals()` latches
once per document. On a real app the first route change is often a second after load, so that early emit
was also the last one: every later INP and the final CLS were dropped. Combined with the known "INP needs
a pre-navigation click", a user whose first action is a nav link reported no INP for the session.

**Fix.** Keep one `browser_web_vital` span per document and move the only emit to page hide. The two
navigation call sites (`onUrlChanged` and the navigation source's `startNavigation`) no longer emit;
`endRootAndFlush` still does. `webVitals.ts` is unchanged: the latch was never the problem, the trigger
was.

**Decided 2026-08-12.** The alternative was to let a moved LCP or a late INP ship as a correction, which
means more than one vitals span per page view. The backend cannot reliably treat a later value as
replacing an earlier one for the same page view today, so **one span per document stands, and losing
vitals on a page whose hide event never fires is accepted.**

Worth knowing about the trigger that remains: `endRootAndFlush` runs on `pagehide` and on
`visibilitychange: hidden`, and the second fires on a plain tab switch. So the practical capture point is
whichever comes first, which for a user who tabs away early is still an incomplete INP, just far later
than a route change. Restricting the emit to `pagehide` alone would capture more per page at the cost of
a higher miss rate. That is a one-line change in `startBrowserTracing` if the miss rate turns out to be
lower than expected in production.

**Test churn.** `browserTracing.test.ts`: the two tests asserting a navigation emit now assert the
opposite, the pair asserting emit ordering on navigation is gone (the page-hide ordering test already
covers the invariant), the failed-emit retry test retries on a second hide rather than a navigation, and
one test was added proving a vital that only reports after a navigation still reaches the hide-time span.

## 6. `url.full` was unbounded, so a `data:` URL fetch shipped its whole payload

**Files:** `packages/core/src/util/urlAttributes.ts`, `packages/js/src/tracing/httpRequestSpan.ts`

`urlAttributes` put the resolved href in `url.full` with no length limit, and redaction only touches the
query string. `fetch(dataUrl)` for a canvas round-trip put the entire inline payload in the span.

**Fix.** Two parts. A cap in `urlAttributes`, well past any routable URL:

```ts
export const MAX_URL_LENGTH = 2048;
```

And `startHttpRequestSpan` returns null for the schemes that are not network traffic in the first place,
so the request passes through untraced:

```ts
const INLINE_SCHEMES = new Set(['data:', 'blob:']);
```

---

## Regression tests

Each fix has coverage on the branch now:

| Fix | Where                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/js/tests/browserTracing.test.ts`, "does not backdate a pageload root past a load event that already fired" |
| 2   | `packages/core/tests/attributeTraversalBudget.test.ts` (new)                                                         |
| 3   | `packages/core/tests/tracerSpanContext.test.ts`, "a root inherits only the allowlisted scope keys"                   |
| 4   | `packages/js/tests/componentSpanCap.test.ts` (new)                                                                   |
| 5   | `packages/js/tests/browserTracing.test.ts`, the rewritten navigation and page-hide tests                             |
| 6   | `packages/js/tests/httpRequestSpan.test.ts`, the `data:`/`blob:` and truncation tests                                |

The wider adversarial suites stay outside the repo. They were scratch: broad sweeps over the state
machine, the HTTP wrappers and the browser lifecycle, most of which duplicates coverage the branch
already has.
