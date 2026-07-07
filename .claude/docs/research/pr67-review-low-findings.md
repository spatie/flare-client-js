# PR #67 review: low-severity follow-ups

Deferred findings from the tracing PR review (2026-07-06). The high/medium findings were fixed on the branch; these are real but low-urgency and can be picked up later. Line numbers reference the branch state at review time and may drift.

## Core (`@flareapp/core`)

### 1. LRU eviction of a still-live trace corrupts per-trace bookkeeping

`packages/core/src/tracing/Tracer.ts` (`createState` eviction + `onSpanEnd`).

If `maxLiveTraces` (default 1000) evicts a trace that still has open spans, the next child on that `traceId` re-seeds state via `getOrSeedState` with itself as `localRootSpanId`, so a mid-trace child becomes `isLocalRoot: true` (gets scope attributes, duplicate root semantics). Old spans from the evicted trace ending afterwards decrement the new state's `openSpanCount` below zero, and the `openSpanCount <= 0` delete removes the new state while its spans are still open, cascading the corruption instead of self-healing.

Fix sketch: prefer evicting traces with `openSpanCount === 0`; clamp the decrement at zero; or tag spans with a state generation the way epoch already works for `clear()`.

### 2. SpanBuffer byte accounting is O(n squared) and mixes units

`packages/core/src/tracing/SpanBuffer.ts` (`estimateBytes` / `bufferBytes` / `trim`).

Every `add` re-serializes the entire buffer (`bufferBytes` maps `flatJsonStringify` over all spans), and `trim`'s while-loop re-serializes per iteration. With a 100-span buffer that is thousands of serializations inside the host's `span.end()` hot path. Additionally `estimateBytes` uses `.length` (UTF-16 code units) while `packForKeepalive` uses `TextEncoder` (bytes), so the flush threshold and the keepalive budget are measured in different units and multibyte attribute content is undercounted.

Fix sketch: compute a per-span byte size once at `add` time (with `TextEncoder`), cache it alongside the span, and keep a running total.

### 3. SpanBuffer `timerActive` latch can stick

`packages/core/src/tracing/SpanBuffer.ts` (`flush` early returns vs `armTimer`).

The `!config.enableTracing` and `buffer.length === 0` early returns in `flush()` happen before `clearTimer()`. If the interval timer fires into one of those paths, `timerActive` stays true with no pending timer and `armTimer` never re-arms, permanently killing interval flushing. Unreachable today only because `Flare.configure` calls `_tracer.clear()` on disable; it is one refactor away from live. Cheap fix: reset `timerActive` at the top of the timer callback.

### 4. Future-version traceparent headers are rejected wholesale

`packages/core/src/tracing/traceparent.ts` (`parseTraceparent`).

`parts.length !== 4` and `version !== '00'` reject e.g. `01-<trace>-<span>-01-extra`. W3C Trace Context says a version-00 implementation should parse higher-version headers by taking the first four fields (only version `ff` is invalid). Restarting the trace is spec-permitted, so not a violation, but continuity silently breaks the day an upstream proxy or SDK emits version `01`.

Fix sketch: accept `parts.length >= 4` when version is valid hex and not `00`/`ff`; keep strict 4-field parsing for version `00`.

### 5. OTLP envelope deviations (decide before real data exists)

`packages/core/src/tracing/envelope.ts` + `OtelSpan` in `types.ts`.

- No `kind` field: every span arrives as `SPAN_KIND_UNSPECIFIED`. Fetch spans should plausibly be `CLIENT`, roots `INTERNAL`. Adding it later is a backend contract change.
- `parentSpanId: null` and `*UnixNano` as JSON numbers deviate from the proto3 JSON mapping (omit or empty string for parent; int64 as string). Nanosecond values around 1.77e18 exceed 2 to the 53rd, so numbers quantize to roughly 256 ns.

Both match the existing logs envelope and Flare owns the ingest, so informational, but worth an explicit decision.

### 6. Public `Span` interface asymmetry

`packages/core/src/types.ts`.

`Span` exposes `endTimeUnixNano` but not `startTimeUnixNano`. Anything wanting duration or start time from the public interface must cast to `SpanImpl`, which already has it as `readonly`. Exposing it is free.

## Browser (`@flareapp/js`)

### 7. Ingest-URL exclusion is a prefix match

`packages/js/src/tracing/instrumentFetch.ts` (`isFlareIngestUrl`).

`abs.href.startsWith(u)` means a self-hosted `ingestUrl: https://example.com/flare` silently excludes `https://example.com/flareapp-assets/logo.png` from tracing (no span, no traceparent). Match on a path boundary: exact, or prefix followed by `/` or `?`.

### 8. `supportsNativeFetch` can leak its sandbox iframe

`packages/js/src/tracing/supportsNativeFetch.ts`.

If anything throws between `appendChild` and `removeChild` (sandboxed or CSP-restricted documents where `contentWindow` access throws), the hidden iframe stays in `<head>` for the page lifetime. Bounded (one-shot per instrumentation), but it mutates the customer's DOM. Move `removeChild` into a `finally`.

### 9. Childless backdated pageload inflates duration on deferred SDK init

`packages/js/src/tracing/navigationTiming.ts` + `IdleRootController` idle finish.

`resolvePageloadStartNano` only rejects backdating beyond `finalTimeout` (30 s). An SDK lazy-loaded 10 s after navigation start on a page that loaded in 1 s and issues no fetches produces a `browser_pageload` root of roughly SDK-init-delay plus idleTimeout (about 11 s). There is no anchor to `loadEventEnd` for the childless case.

Fix sketch: when the root idles out with no children, trim the end time to a Navigation Timing signal (`loadEventEnd`) when available.

## Test coverage gaps

### 10. `packForKeepalive` partial packing untested

`packages/core/tests/tracingBuffer.test.ts` covers all-fit and none-fit, but not the case the tail-first loop exists for: only the newest N spans fit the keepalive budget, older ones are dropped from the envelope but retained in the buffer. A regression that drops everything when one span exceeds budget would pass the current suite.

### 11. `Request`-input branch of the fetch wrapper untested

`packages/js/tests/instrumentFetch.test.ts` passes only string URLs through `createFetchWrapper`. If `resolveRequest` regressed to `String(input)`, span names would become `GET [object Request]` and propagation would silently break with all tests green.

### 12. `popstate` navigation path untested

`packages/js/tests/browserTracing.test.ts` exercises only `pushState`. The `popstate` listener wiring and its removal on uninstall have no coverage; jsdom can dispatch a `PopStateEvent` synchronously.

### 13. Span test fixture omits required `scopeAttributes`

`packages/core/tests/tracingSpan.test.ts` `init()` fixture omits `SpanInit.scopeAttributes`. Harmless now, but tests are not type-checked (`tsconfig` includes only `src`), so the fixture silently diverges from the constructor contract.
