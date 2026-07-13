# React Component Profiler — Design

Status: revised post-review — ready for planning
Date: 2026-07-10 (revised 2026-07-10 after design review)
Branch: `feat/react-component-profiler` (off `research/tracing-framework-routers`, tip `10d91ce`)
Supersedes: the uncommitted POC (`packages/react/src/profiler.ts` + playground wiring), which is a reference only.

Revision (2026-07-10, post-review): closed three timing/sampling gaps found in review. (1) `recordComponentSpan`
now gates on the live root (`tracer.getActiveSpan()` still matching the reserved `traceId`) and drops the span
otherwise, so a late / racing / post-idle mount can never seed a fresh `TraceState` and re-sample — the
no-re-sample invariant now holds by construction. (2) A `hasRecorded` ref guards the mount effect so StrictMode's
replayed setup cannot buffer a duplicate `spanId`; dev and production both emit one span (the earlier "two spans in
dev" note is dropped). (3) Suspense is a documented v1 limitation, not engineered around.

## Goal

Give `@flareapp/react` users an opt-in profiler so that each wrapped component records one
`browser_react_component` span for its mount, nested as a true tree (by `parent_span_id`) under the active
`browser_pageload` / `browser_navigation` root. The result is a per-navigation mount waterfall of the component
subtree:

```
browser_navigation  /product/$id  (312ms)
 └─ ProductPage            (240ms)
     ├─ ProductGallery     (180ms)
     ├─ ProductInfo         (32ms)
     └─ AddToCartButton     (12ms)
```

This is the client half only. The flareapp.io backend must officially recognize the `browser_react_component`
SpanType (map, label, render the component name). That is a hard dependency tracked separately (see
[Backend dependency](#backend-dependency)); today it exists only as a local uncommitted tweak.

## Scope decisions (locked during brainstorm)

- **What we capture:** mount timing only. Re-render / update / render-lifetime spans (Sentry's `ui.react.update`
  and `ui.react.render`) are the natural next slice and are out of scope for v1.
- **How components are instrumented:** manual opt-in. No build-time / Babel plugin. Users wrap the components
  they care about.
- **API surface:** a `<FlareProfiler name>` component (the primitive) and a `withFlareProfiler(Component, { name? })`
  HOC (thin sugar). No `useFlareProfiler` hook in v1.
- **Nesting:** a true component tree via `parent_span_id`. This deliberately exceeds Sentry, which keeps mount
  spans flat under the transaction. It is required here because Flare's trace waterfall nests structurally by
  `parent_span_id` (`resources/js/domain/perf-monitoring/components/sp-agg-traces/helpers.ts`), so a flat model
  would render as a flat list, not a tree.
- **Backend:** client-only branch; backend SpanType support is a tracked dependency.

## Why not just copy Sentry

Validated against `getsentry/sentry-javascript` `packages/react/src/profiler.tsx` (verbatim source):

- Sentry's `render()` returns `this.props.children` directly, with no `withActiveSpan` wrap, and creates the mount
  span in the **constructor** via `startInactiveSpan({ op: 'ui.react.mount', onlyIfParent: true })`. That parents
  every mount span to whatever is active at render time — always the transaction. So Sentry's component spans are
  **flat siblings under the transaction**, nested only by time, not structurally. We diverge here on purpose.
- Sentry has **no StrictMode handling**; its constructor-created span leaks for the discarded StrictMode instance.
  That is harmless for Sentry because a transaction drops unfinished child spans on close. Flare cannot copy this:
  `IdleRootController` blocks idle-close on open children, which is exactly the POC's 15006ms `childSpanTimeout`
  bug. Our record-in-effect model (start and end together) is therefore mandatory, not a nicety.
- We do adopt Sentry's proven choices: name resolution (`name || displayName || name || Unknown`), root-gating
  (Sentry's `onlyIfParent`), and mount-first scope with updates as a follow-up.

## Architecture

Three pieces, with the tracer coupling isolated to a single seam module.

### 1. Core: one new field (`packages/core`)

`SpanOptions` gains `spanId?: string`. `Tracer.startSpan` uses `opts.spanId ?? makeSpanId()`. `parent`
(already accepts `{ traceId, spanId }`), `startTimeUnixNano`, and `.end(endTime)` already exist, so this single
field is the entire core cost. It is a general manual-stitching primitive, not profiler-specific.

Current shape (`packages/core/src/types.ts`):

```ts
export type SpanOptions = {
    parent?: Span | { traceId: string; spanId: string };
    attributes?: Attributes;
    startTimeUnixNano?: number;
    spanType?: string;
    forceRoot?: boolean;
    spanId?: string; // NEW: explicit span id for manual stitching
};
```

### 2. `@flareapp/js/browser` seam (`packages/js/src/tracing/componentProfiler.ts`)

A side-effect-free module (imported like `registerNavigationSource`) that hides all tracer coupling behind three
functions bound to the singleton browser tracer:

```ts
export type ComponentTraceContext = { traceId: string; parentSpanId: string };

// The active pageload/navigation root a top-level component should nest under, read
// from `tracer.getActiveSpan()` (the holder's active root, which IdleRootController
// clears on close). Returns null when tracing is off, no root is active, or the root
// is not recording.
export function activeComponentRoot(): ComponentTraceContext | null;

// A 16-hex span id a component reserves for itself, so its descendants can reference
// it as their parent before this component's span is actually recorded.
export function reserveSpanId(): string;

// Record a completed mount span (spanType 'browser_react_component'). Records ONLY
// while the reserved root is still the live, recording active root (its traceId still
// matches `tracer.getActiveSpan()`); otherwise it DROPS the span. That is what makes
// the "reuse the root's decision, never re-sample per component" guarantee hold: it
// either records under the live root (whose TraceState still exists, so the decision
// is reused) or records nothing. No-op when tracing is off.
export function recordComponentSpan(span: {
    name: string;
    spanId: string;
    parent: ComponentTraceContext;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    attributes?: Record<string, unknown>;
}): void;
```

`recordComponentSpan` first gates on the live root: `const root = tracer.getActiveSpan(); if (!root || root.traceId
!== parent.traceId || !root.isRecording) return;`. `getActiveSpan()` returns the holder's active root, which
`IdleRootController.finish` clears to `undefined` on close, so a matching `traceId` proves the reserved root is still
open (unlike the module-global `currentRoot`, which is not nulled on idle-close). Exposing it means widening the
`BrowserTracingFlare.tracer` `Pick` to include `getActiveSpan` (the runtime object is a full `Tracer`).

When the gate passes, the root's `TraceState` is still in `traceStates`, so `tracer.startSpan(name, { spanId,
parent: { traceId, spanId: parentSpanId }, spanType: 'browser_react_component', startTimeUnixNano, attributes
}).end(endTimeUnixNano)` reuses that state and its recording decision — the plain `{ traceId, spanId }` parent path
in `resolveTrace` finds existing state and does not re-sample.

When the gate fails — the root idle-closed during a mount gap, or a later navigation replaced it — the span is
dropped. This is deliberate: without the gate, `startSpan` would find no `TraceState` for the dead trace, seed a
fresh one, and re-sample it independently via `resolveSampling`, producing a re-sampled, root-detached phantom child
of an already-shipped root. Dropping keeps the per-component no-re-sample invariant true by construction.

The common case is not dropped: each recorded component span is a start+end pair, and `IdleRootController` re-arms
the root's idle timer every time a child span ends, so a continuously-mounting subtree keeps its own root alive.
Only a mount gap longer than `idleTimeout` (typically a Suspense data wait) or a subsequent navigation trips the
drop path.

### 3. `@flareapp/react/profiler` (`packages/react/src/profiler.ts`)

`createElement`-based (no JSX), importing only `react` and `@flareapp/js/browser` — Electron-safe, matching
`tanstack-router.ts`.

- `FlareProfilerContext`: a React context carrying `ComponentTraceContext | null`.
- `<FlareProfiler name>` (function component):
    - Resolves its parent once into a ref: `resolvedParent = context ?? activeComponentRoot()`, where `context` is
      the value of `FlareProfilerContext`. A non-null context means a profiled ancestor exists; a null context at
      the top of a profiled subtree falls back to the active root.
    - **If `resolvedParent` is null** (no profiled ancestor and no active recording root), the component is fully
      transparent: it reserves nothing, records nothing, and passes the null context through unchanged so its
      descendants also no-op. It still renders its children.
    - **Otherwise** it reserves its own `spanId` (`reserveSpanId()`) and captures `startNano` at first render (both
      in lazy refs), provides `{ traceId: resolvedParent.traceId, parentSpanId: ownSpanId }` to children, and in a
      mount `useLayoutEffect` (falling back to `useEffect` under SSR, to match `componentDidMount` timing while
      preserving bottom-up ordering) records its span exactly once — a `hasRecorded` ref guards the effect body so
      StrictMode's replayed setup does not buffer a second span under the same reserved id (see
      [StrictMode](#strictmode-and-leak-safety)) — calling `recordComponentSpan(...)` with `resolvedParent`, its
      reserved id, `startNano`, and the current time as end.
- `withFlareProfiler(Component, { name? })`: renders `<FlareProfiler name={resolvedName}>` around `Component`.

## Timing and nesting model (the crux)

- `startNano` is captured at first render (the component begins mounting). `endNano` is captured in the mount
  effect (the subtree has mounted).
- React renders top-down (a parent's `startNano` precedes its children's) and fires mount effects bottom-up (a
  child's `endNano` precedes its parent's). Within a single synchronous commit a parent `[start, end]` therefore
  encloses every child both by time and by `parent_span_id`, and the waterfall nests correctly. This holds only
  within a synchronous commit; a `<Suspense>` boundary inside the subtree can break enclosure (see
  [Suspense](#suspense)).
- Reserved ids solve the ordering trap: a child records in its own effect _before_ its parent's effect runs, but
  it already knows the parent's reserved id from render-time context, so the structural link is available even
  though the parent's span object does not exist yet.
- Unprofiled intermediate components are transparent: the context passes through unchanged, so a child nests
  under the nearest _profiled_ ancestor.
- Orphan degradation: if a profiled ancestor's span is dropped (sampling or `maxSpansPerTrace`), its descendants'
  `parent_span_id` points at a missing span. Flare's tree builder treats that as an orphan and reparents it to the
  root (`sp-agg-traces/helpers.ts:74`). Acceptable; covered by a test. Because effects fire bottom-up, an ancestor
  is recorded after its descendants and so is the more likely victim of a `maxSpansPerTrace` cap; orphaning is the
  designed-for degradation, not a rare edge.
- Late-mount drop: a component records only while its reserved root is still the live active root (the seam's
  live-root gate). A subtree that finishes mounting after the root idle-closed, or whose root a later navigation
  replaced, records nothing rather than re-sampling and attaching to a dead trace.

## Suspense

`<Suspense>` inside a profiled subtree is a documented v1 limitation, not engineered around. There is no
Suspense-specific code: the live-root gate already covers the one case that needs handling (a child that resumes
after its root closed is dropped, not re-sampled). Two behaviors to note in the docs so they are not read as bugs:

- A suspended child's `startNano` is captured before it suspends, so its span covers the suspense wait. Read the
  duration as "time to mount, including data waits in the subtree."
- A `<Suspense>` boundary between a profiled parent and child can end the parent span before the child resumes, so
  the child may render outside its parent in the waterfall, or (if the wait exceeds `idleTimeout`) be dropped.

## StrictMode and leak-safety

Start and end are recorded together in the mount effect, so only committed fibers ever touch the tracer. There is
no open-span leak. This is mandatory: `IdleRootController` blocks idle-close on open children (the POC's 15006ms
`childSpanTimeout`), unlike Sentry's transaction which drops unfinished spans.

Record-once guard: under React `<StrictMode>` in development React runs the mount effect twice on the same fiber
(setup → cleanup → setup) to surface effect bugs. The reserved `spanId` and `startNano` live in refs that persist
across that replay, so an unguarded effect would buffer the span **twice with the same `spanId`** — a span-id
collision in the trace, not two distinct spans. A `hasRecorded` ref makes the effect record exactly once per
committed fiber: the first setup records and sets the flag; the replayed setup no-ops. A genuine unmount/remount is
a new fiber with a fresh ref and correctly records a new span. Dev and production both emit one span per mount, so
there is no duplicate dev behavior to document.

## Config, gating, overhead

- Gated on `enableTracing` and an active, recording root: `activeComponentRoot()` returns null otherwise and the
  component records nothing.
- Follows the root's sampling decision, never re-sampling per component: a component span is either recorded under
  the live root (reusing its `TraceState` and decision) or dropped (the seam's live-root gate; see [Timing and
  nesting model](#timing-and-nesting-model-the-crux)). No code path samples a component independently.
- No separate `enableReactProfiler` flag or profiler-specific sample rate in v1 (YAGNI). Wrapping a component is
  the opt-in.
- Cost when not recording: one context read plus a null check per profiled component; no span work.

## Naming

Resolution order: explicit `name` prop / `options.name` > `Component.displayName` > `Component.name` > `'Unknown'`
(matches Sentry and the POC). Written to the attribute `flare.react.component` and to `span.name`. The backend
label falls back to `span.name`, so the component name surfaces even without the attribute.

Production minification can mangle `Component.name`. The docs recommend passing an explicit `name` or setting
`displayName` for production builds. Build-plugin auto-naming is out of scope.

## Error handling

Every seam call and every effect body is wrapped so instrumentation never throws into the host application (the
`tanstack-router` discipline). The seam functions additionally no-op internally when tracing is off or no root is
active.

## Testing

- `packages/react/tests/profiler.test.tsx` (vitest + @testing-library/react + jsdom; already devDependencies):
    - single component records one span with the correct name, `browser_react_component` type, parent equal to the
      active root, and a non-negative duration;
    - nested components: a child's `parent_span_id` equals its parent's reserved span id;
    - a transparent (unprofiled) middle component: a grandchild nests under the nearest profiled ancestor;
    - no active root: nothing recorded, children still render;
    - tracing disabled: nothing recorded;
    - name precedence (explicit > displayName > name);
    - never throws when the seam throws (inject a throwing seam);
    - StrictMode: the record-once guard emits exactly one span per mount in development (not two) with no duplicate
      `spanId`;
    - orphan: a child whose profiled parent's span is absent still records with a `parent_span_id` (graceful);
    - late mount: a component whose reserved root has already ended when its mount effect runs records nothing (no
      re-sample, no root-detached span);
    - Suspense boundary: a suspended child records under its profiled ancestor when it resumes within the root
      window (documents the timing behavior).
- `packages/js/tests/componentProfiler.test.ts`:
    - `activeComponentRoot()` returns the root context when a recording root is active; null when tracing is off,
      no root is active, or the root is not recording;
    - `recordComponentSpan(...)` buffers a `browser_react_component` span with the right ids, parent, and times, and
      follows the root's recording decision (no re-sample);
    - `recordComponentSpan(...)` drops the span (nothing buffered, no re-sample) when `tracer.getActiveSpan()` no
      longer matches the parent's `traceId` — the root idle-closed or a new navigation root took over.
- `packages/core`: `startSpan` honors an explicit `spanId`.
- Playground: wire a handful of components in `playgrounds/react` (for example ProductsPage, ProductPage,
  ProductGallery, AddToCartButton) to exercise the tree for manual and e2e runs. The local-only `flare.ts` test
  tweaks (pointing at `flareapp.io.test`) stay out of commits.
- e2e: one `react` spec asserting that component spans arrive nested under the navigation root via the fake
  server. This is the largest-effort item; it is included but may be deferred if the plan grows too long.

## File structure

- `packages/core/src/types.ts` — add `spanId?` to `SpanOptions`.
- `packages/core/src/tracing/Tracer.ts` — `opts.spanId ?? makeSpanId()`.
- `packages/core/tests/…` — explicit-`spanId` test.
- `packages/js/src/tracing/componentProfiler.ts` — the seam (new).
- `packages/js/src/tracing/browserTracing.ts` — widen the `BrowserTracingFlare.tracer` `Pick` to expose
  `getActiveSpan` for the seam's live-root gate.
- `packages/js/src/browser.ts` — export the seam.
- `packages/js/tests/componentProfiler.test.ts` — seam tests (new).
- `packages/react/src/profiler.ts` — `FlareProfiler` + `withFlareProfiler` + context (rewrites the POC file).
- `packages/react/tests/profiler.test.tsx` — component tests (new).
- `packages/react/package.json` — `./profiler` export and build entry are already wired.
- `playgrounds/react/*` — wiring.
- README section for `@flareapp/react/profiler`.

## Backend dependency

Handled separately in flareapp.io, not in this branch:

- add a `browser_react_component` case to the monitoring `SpanType` enum;
- map/label it and render the component name in the trace waterfall (the current local tweak, done properly).

Until this lands, component spans store as `unknown` for other users. The feature is not end-to-end without it.

## Out of scope (v1)

- Automatic build-plugin (Babel/SWC) instrumentation.
- Update / re-render / render-lifetime spans (Sentry's `ui.react.update` / `ui.react.render`) — the clean next
  slice.
- `useFlareProfiler` hook.
- Per-component enable flag.
- Suspense-boundary-aware timing. v1 documents the distortion (see [Suspense](#suspense)) instead of resetting or
  clamping spans across boundaries.
