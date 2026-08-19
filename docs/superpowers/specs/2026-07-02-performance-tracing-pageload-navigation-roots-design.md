# Spec: performance tracing — pageload & navigation roots (`@flareapp/js` + small `@flareapp/core` extension)

Status: design approved 2026-07-02. Scope: framework-agnostic pageload + SPA navigation root spans, an idle lifecycle, and fetch-parenting under the root. Branch: `research/performance-tracing`.

## Context

This is the third slice of the performance-tracing effort.

- [Core foundation](2026-06-15-performance-tracing-core-foundation-design.md) shipped the env-agnostic model: `Tracer`, `Span`, `SpanBuffer`, OTLP envelope, `Api.traces`, `traceparent`, and the `ActiveSpanHolder` (`getActive`/`withActive`).
- [Browser fetch instrumentation](2026-07-01-performance-tracing-fetch-instrumentation-design.md) auto-patches `window.fetch` and opens a `browser_fetch` span per request. Because there was no active span, **each fetch became its own single-span root trace** — a documented interim state.

This slice removes that interim state. It introduces **pageload** and **navigation** root spans that stay open (idle-span model) and act as the active parent, so the existing fetch spans nest under them automatically (shared `traceId`, `parentSpanId` = root's `spanId`). Head-sampling now happens once at the root and governs the whole page.

Full research: `.claude/docs/research/performance-tracing.md` (§6.1 idle-span model + backdating, §7.5 Navigation Timing, §8 router interop). This spec consumes the decisions there.

### Approved decisions driving this spec

- **Pageload + navigation roots, framework-agnostic.** Navigation is detected by patching the History API (`pushState`/`replaceState` + `popstate`). Route names are URL-path-based. Parameterized route names (`/products/:id`) and router-event integration are the separate per-framework slices (§8), out of scope here.
- **Full Sentry-style idle lifecycle.** The root stays open while children are active and ends after an idle gap (`idleTimeout`), trimmed to the last child's end time, with a hard cap (`finalTimeout`) and a stuck-child cap (`childSpanTimeout`).
- **Small `@flareapp/core` extension** (the load-bearing decision): a persistent "active root" on the `ActiveSpanHolder` plus a span-lifecycle observer on the `Tracer`. This makes children auto-nest via the existing `parent ?? holder.getActive()` logic — no change to the fetch wrapper — and gives the browser-side idle controller the child start/end signals it needs. The fetch slice deliberately avoided core changes; this slice needs them, and they are general (they also serve future render/manual child spans).
- **Navigation ends the prior root immediately**, not via idle (Sentry's behavior): a new navigation is a hard boundary.
- **Local validation only** (fake-flare-server), consistent with the prior two slices. Real-backend correlation stays blocked on B5/B9/P4.

### Explicitly out of scope

Parameterized route names + router-event integration (framework slices), native Navigation-Timing phase spans (DNS/TCP/TTFB), resource-timing children, web-vitals (LCP/CLS/INP), SSR meta-tag handoff, Node AsyncLocalStorage holder. Each is its own later slice.

## Architecture

Three layers. One small change in `@flareapp/core`; the rest is new browser code in `packages/js/src/tracing/`.

```
@flareapp/core
  ActiveSpanHolder: + setActiveRoot(span?)      persistent root slot; getActive() falls back to it
  Tracer:           + setActiveRoot(span?)      delegates to holder
                    + addSpanListener(fn): ()=>void   emits {phase,span} on start/end
  Config:           + idleTimeout, finalTimeout, childSpanTimeout

@flareapp/js/src/tracing/
  IdleRootController.ts   owns one root's idle lifecycle (timers + child tracking)
  browserTracing.ts       startPageloadRoot / navigation detection / start-stop orchestration
  navigationTiming.ts     backdating helper: pageload start time from PerformanceNavigationTiming
  (browser.ts)            configure() also starts/stops browser tracing on the tracing transition
```

### 1. Core extension (`@flareapp/core`)

**`ActiveSpanHolder` (context.ts).** Add a persistent root slot distinct from the `withActive` scope:

- `setActiveRoot(span: Span | undefined): void` — stores/clears the persistent root.
- `getActive()` returns the `withActive`-scoped span if one is currently on the stack, else the active root, else `undefined`. So a synchronous `withSpan` still wins within its callback, but otherwise children fall through to the root.

`InMemoryActiveSpanHolder` implements it with one extra field (`root`) alongside the existing `active`. The interface addition keeps the ALS-ready seam intact for a future Node holder.

**`Tracer` (Tracer.ts).**

- `setActiveRoot(span?: Span): void` — delegates to `holder.setActiveRoot`.
- `addSpanListener(fn: (e: { phase: 'start' | 'end'; span: Span }) => void): () => void` — registers a listener, returns an unsubscribe. `startSpan` calls listeners with `{ phase: 'start', span }` after the span is built; `onSpanEnd` calls them with `{ phase: 'end', span }`. Listener errors are swallowed (a listener must never break tracing). This is the only new coupling; the idle logic itself lives in `@flareapp/js`, so core stays env-agnostic and timer-free.

**`Config` (types.ts).** Add three optional fields with Sentry-like defaults applied in the browser layer (not core defaults, to keep core neutral):

- `idleTimeout?: number` (default 1000 ms) — idle gap after the last child ends before the root closes.
- `finalTimeout?: number` (default 30000 ms) — hard cap from root start.
- `childSpanTimeout?: number` (default 15000 ms) — if a child stays open this long, the root ends anyway.

No other core changes. Rooting, sampling, buffering, `withSpan`, and the fetch wrapper are untouched. A fetch created while a root is active inherits the root's `traceId` and sets `parentSpanId` to the root's `spanId` through the unchanged `resolveTrace` path.

### 2. Idle-root controller (`packages/js/src/tracing/IdleRootController.ts`)

One instance owns exactly one root's lifecycle. Constructed with the root `Span`, the `Tracer` (for `addSpanListener` + `setActiveRoot`), the resolved timeouts, and a `now()`/timer seam (injected for testability; defaults to real `setTimeout`/`clearTimeout` and the tracer's clock).

State:

- `openChildren: number` — children of this root's trace that are currently open.
- `lastChildEndTime: number` — end time (unix nanos) of the most recently ended child; the trim target.
- `finalTimer`, `idleTimer` — handles.
- `ended: boolean` — idempotency guard.

Behavior (subscribes to `tracer.addSpanListener`, filtering to `e.span.traceId === root.traceId && e.span !== root`):

- On construction: `tracer.setActiveRoot(root)`; arm `finalTimer` for `finalTimeout` from root start; arm the idle timer immediately (a root with no children should still close after `idleTimeout`).
- On child **start**: `openChildren++`; clear the idle timer; if the child is the first open one, nothing else. Also arm a per-child `childSpanTimeout` guard (a single shared timer re-armed to the oldest open child is sufficient; simplest correct form: when `openChildren` goes 0→1, arm a `childSpanTimeout` timer; on it firing, force-end).
- On child **end**: `openChildren--`; record `lastChildEndTime`; if `openChildren === 0`, arm the idle timer for `idleTimeout`.
- Idle timer fires (only meaningful when `openChildren === 0`): `end(lastChildEndTime ?? now())`.
- Final timer or child-timeout fires: `end(now())` (hard stop, not trimmed).
- `end(atTimeNano)`: guard on `ended`; set `ended`; `root.end(atTimeNano)`; `tracer.setActiveRoot(undefined)`; unsubscribe; clear both timers.
- `endNow()`: public method used by the orchestrator when a navigation supersedes this root — ends immediately at `now()`.

The controller never buffers or samples; it only drives timing. Sampling already happened at root creation; if the root is non-recording, its children are non-recording too (existing trace-state behavior) and nothing is sent, but the lifecycle still runs so `setActiveRoot` is cleared correctly.

### 3. Browser tracing orchestrator (`packages/js/src/tracing/browserTracing.ts`)

Module-level singleton state: the current `IdleRootController | null`, the history unpatch handle, and the tracer-listener unsubscribe.

- **`startBrowserTracing(flare)`**: called on the tracing enable transition. Creates the pageload root, patches history for navigation, and remembers how to undo both.
    - `startPageloadRoot()`: `root = flare.startSpan(name, { spanType: 'browser_pageload', startTimeUnixNano: pageloadStartNano(), attributes })` where `name = location.pathname`, `pageloadStartNano()` comes from `navigationTiming.ts`, and `attributes` are the entry-point/context set: `flare.span_type` is added by the tracer; plus `context.url` (full href), `context.route` (pathname), `context.user_agent` (`navigator.userAgent`), `context.viewport` (`${innerWidth}x${innerHeight}`), and `flare.entry_point.type = 'web'`. Hand `root` to a new `IdleRootController`.
    - Navigation detection: `fill`-patch `history.pushState` and `history.replaceState` so that after the native call runs, if `location.pathname` changed, fire `onNavigate()`. Add a `popstate` listener that does the same. (Patch via the existing `fill` helper for idempotent/reversible install; `popstate` is added/removed explicitly.)
    - `onNavigate()`: if a controller exists, `controller.endNow()`; then `startNavigationRoot()` = same as pageload but `spanType: 'browser_navigation'`, `startTimeUnixNano` = now (navigations are not backdated), name/attributes from the new URL. New `IdleRootController`.
- **`stopBrowserTracing()`**: called on the tracing disable transition. `controller?.endNow()`, unpatch history (`unfill` + remove `popstate`), unsubscribe listeners, reset module state. Idempotent.
- Environment guard: if `typeof window === 'undefined'` or History/Navigation Timing are unavailable, `startBrowserTracing` is a no-op (defensive for SSR/non-browser).

### 4. Backdating helper (`packages/js/src/tracing/navigationTiming.ts`)

`pageloadStartNano(): number` — the pageload root's start time in unix nanoseconds, backdated to navigation start. Reads the `PerformanceNavigationTiming` entry (`performance.getEntriesByType('navigation')[0]`); the navigation started at `timeOrigin + entry.startTime` (usually `entry.startTime === 0`, i.e. `timeOrigin`). Return `Math.round((performance.timeOrigin + (entry?.startTime ?? 0)) * 1e6)`. Falls back to the tracer's default clock (`now()`) when the API is unavailable. Isolated + injectable so the math is unit-testable without a real browser.

### 5. Wiring (`packages/js/src/browser.ts`)

Extend the existing `configure` override from the fetch slice. On the false→true tracing transition: `instrumentFetch(this)` (existing) **and** `startBrowserTracing(this)`. On true→false: `stopBrowserTracing()` **and** `unpatchFetch()`. Order: start browser tracing after fetch instrumentation so the pageload root exists before any fetch fires; on teardown, stop browser tracing (ends the root) before unpatching fetch. No constructor change (same reason as the fetch slice: the singleton enables tracing post-construction).

## Data flow (the payoff)

1. App calls `flare.configure({ enableTracing: true })` → fetch patched + pageload root created, backdated, set as active root.
2. A fetch fires → the wrapper's `startSpan` (no explicit parent) reads `holder.getActive()` → the pageload root → the fetch span inherits the root's `traceId` and sets `parentSpanId = root.spanId`. The `IdleRootController` sees the child start (idle timer cleared) and end (idle timer armed).
3. Page goes idle for `idleTimeout` → root ends (trimmed to the last fetch's end) → buffered/flushed. `setActiveRoot(undefined)`.
4. SPA navigation (`pushState`/`popstate`) → prior root `endNow()`, a `browser_navigation` root starts and becomes the new active parent.

## Config additions

`idleTimeout`, `finalTimeout`, `childSpanTimeout` (all optional, browser-layer defaults 1000 / 30000 / 15000 ms). Added to core `Config` type; defaults resolved in `browserTracing.ts` (`config.idleTimeout ?? 1000`, etc.), keeping core neutral.

## Observability plumbing (local validation)

The fake server already records `POST /api/traces` and the fixture has `waitForTrace`/`traces()` (fetch slice). No new server/fixture surface needed; assertions walk the OTLP body.

- **playground**: no new button strictly required — tracing is already enabled and the vanilla router already uses `history.pushState` for `data-link` navigations (`playgrounds/js/src/router.ts`), so a pageload root fires on load and a navigation root fires when a nav link is clicked. Keep the existing `trace-fetch` button for the nesting assertion.

## Testing

**Unit (js vitest, node env).**

- `ActiveSpanHolder`/holder: `setActiveRoot` makes `getActive()` return the root; a `withActive` scope takes precedence within its callback and restores to the root afterward; clearing the root returns `undefined`.
- `Tracer`: `addSpanListener` fires `start` on `startSpan` and `end` on span end; unsubscribe stops delivery; a throwing listener doesn't break span creation.
- `IdleRootController` (injected fake timers + fake tracer): idle timer ends the root trimmed to the last child end; a new child before idle fires cancels the pending close; `finalTimeout` hard-caps; `childSpanTimeout` force-ends with an open child; `endNow()` ends immediately; end is idempotent; `setActiveRoot(undefined)` on end.
- `navigationTiming.pageloadStartNano`: computes `timeOrigin + startTime` in nanos; falls back when the entry is absent.
- `browserTracing`: history `pushState`/`popstate` on a path change ends the prior root and starts a `browser_navigation` root; a same-path `pushState` does not; `stopBrowserTracing` ends the root and unpatches.

**E2e (Playwright, js project).**

- On load, a `browser_pageload` root envelope arrives (name = path, `flare.entry_point.type = web`).
- Click the `trace-fetch` button, then assert the `browser_fetch` span shares the pageload root's `traceId` and its `parentSpanId` equals the root's `spanId` — the key new behavior (fetch nesting).
- Click a `data-link` nav, assert a `browser_navigation` root envelope arrives with the new path.

## Files touched

- Edit: `packages/core/src/tracing/context.ts` (holder), `packages/core/src/tracing/Tracer.ts` (setActiveRoot + addSpanListener), `packages/core/src/types.ts` (config fields), `packages/core/src/index.ts` if new types need exporting.
- New: `packages/js/src/tracing/{IdleRootController,browserTracing,navigationTiming}.ts` + tests.
- Edit: `packages/js/src/tracing/index.ts` (barrel), `packages/js/src/browser.ts` (wiring).
- Edit: `e2e/specs/js.spec.ts` (pageload/nav/nesting assertions). Playground likely unchanged.

## Acceptance

- `npm run typescript` clean; `npm run test` green incl. new core + js tests; `npm run build` clean.
- `npx playwright test --project=js` green incl. the pageload/nav/nesting assertions.
- Manual: `npm run playgrounds:js`, load a page and navigate; observe a `browser_pageload` then `browser_navigation` root, and a fetch span nested under the active root (shared trace id, parent = root).

## External prerequisites (not blocking this slice)

Real-backend surfacing still needs B5 (browser `SpanType` aggregators incl. `browser_pageload`/`browser_navigation`), B9 (`/v1/traces` public key + CORS), P4 (laravel-flare inbound `traceparent`). This slice validates against the fake server only.
