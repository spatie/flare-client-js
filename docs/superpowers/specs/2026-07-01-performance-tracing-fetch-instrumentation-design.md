# Spec: performance tracing — browser fetch instrumentation (`@flareapp/js/src/tracing/`)

Status: design approved 2026-07-01. Scope: `window.fetch` instrumentation only. Branch:
`research/performance-tracing`.

## Context

This is the second slice of the performance-tracing effort. The [core foundation](2026-06-15-performance-tracing-core-foundation-design.md)
shipped the env-agnostic model: `Tracer` (rooting, sampling, buffering, `startSpan`/`withSpan`), `Span`, `SpanBuffer`,
the OTLP traces envelope, `Api.traces()`, W3C `traceparent` build/parse, and `Flare` wiring. All of that is dead code
in a real app today — nothing generates spans automatically. This slice makes the browser produce spans on its own by
instrumenting outgoing `fetch` calls.

Full research: `.claude/docs/research/performance-tracing.md` (§4.5 CORS, §4.6 correlation, §6.2 Sentry's request
instrumentation). This spec consumes the decisions locked there.

### Goal of this slice: a validation basis

The explicit goal is to **see tracing working end-to-end, locally**. Success is: click a button in the JS playground,
watch a well-formed `browser_fetch` span envelope arrive at the e2e fake-flare-server, with a `traceparent` injected on
the outgoing request. This is fully unblocked by the pending backend work (B5/B9/P4) because it validates against the
fake server, not the live Flare backend. Structure the transport so that pointing `tracesIngestUrl` at the real backend
is the only change needed once the backend lands.

### Approved decisions driving this spec

- **Steal Sentry's fetch mechanics, skip its indirection.** Sentry's `packages/browser-utils/src/instrument/fetch.ts`
  and `packages/core/src/fetch.ts` are MIT and battle-tested. Port the mechanics verbatim: the `fill()` monkeypatch
  helper, `supportsNativeFetch()`, and `addTracingHeadersToFetchRequest` (the three-shape header merge). **Do not** port
  the global handler registry (`triggerHandlers` / `addFetchInstrumentationHandler`). That indirection exists so
  breadcrumbs + tracing + failed-response capture can share one patch; Flare has exactly one consumer (tracing) today.
  Keep a single direct tracing consumer, structured so a registry drops in later without rework.
- **Fetch only.** XHR is a separate follow-on slice reusing this slice's span-shaping and header-injection code.
- **Auto-activation via `configure`.** Tracing is turned on after construction, not at it: the js singleton is
  `new Flare()` at module load with default config (`enableTracing: false`), and apps call
  `configure({ enableTracing: true, … })` later. So patch/unpatch is driven by the `enableTracing` transition inside
  the js `Flare.configure` override, never the constructor. No public `instrumentFetch` export in v1 (the module is
  still directly unit-testable).
- **Correlation via W3C `traceparent` only** (research §4.6). No `x-flare-trace-id`. Sampled flag emitted as exactly
  `01` / `00` for the PHP client's strict parse.
- **Same-origin propagation by default** (research §4.5). Injecting `traceparent` cross-origin forces a CORS preflight
  that can break previously-working requests, so cross-origin injection is opt-in via `tracePropagationTargets`.

### Explicitly out of scope

XHR, pageload/navigation roots, `PerformanceObserver` / web-vitals, SSR meta-tag handoff, the pub/sub handler registry,
and real-backend correlation (blocked on B5/B9/P4). Each is its own later slice.

## Trace model for this slice (known interim limitation)

There is no pageload or navigation root yet — that is a later slice. So with no active span present, `Tracer.startSpan`
creates a new root. **Each instrumented fetch therefore becomes its own single-span root trace**: one `traceId`, one
span, sampled independently at `tracesSampleRate`. This is coherent and visible (one trace per fetch in the fake
server), it simply is not parented under a pageload until that slice lands. If a caller has already established an
active span (via `withSpan`), the fetch span nests under it through the existing `Tracer` active-span holder — no new
context work here. Document this interim state in the module; it is a known state, not a bug.

## Architecture

New code lives in `packages/js/src/tracing/`. One config field is added to core `Config`. No changes to the core
`Tracer`/`Span`/`SpanBuffer` — this slice only calls the existing `Tracer.startSpan` surface.

### Module layout (`packages/js/src/tracing/`)

- **`fill.ts`** — `fill(source, name, replacer)`, ported from Sentry. Swaps `source[name]` with `replacer(original)`,
  copies own properties onto the wrapper, and tags it with a non-enumerable `__flare_original__` pointing at the
  original. Idempotent: if `source[name].__flare_original__` is already set, do nothing. Exposes the original so a
  matching `unpatch` can restore it (needed for disable and for test isolation).
- **`supportsNativeFetch.ts`** — ported from Sentry. Returns false when `fetch.toString()` does not contain
  `[native code]` (a polyfill such as `whatwg-fetch`, which is XHR-backed). Includes the hidden-iframe fallback that
  reads an untouched `contentWindow.fetch.toString()` when another library has already wrapped `fetch`. In this
  fetch-only slice there is no XHR patch yet, so a polyfilled fetch cannot double-count; `instrumentFetch` still gates
  its install on it (see below) to (a) avoid instrumenting a fetch that is really XHR under the hood and (b) be correct
  the moment XHR lands.
- **`propagation.ts`**
    - `shouldPropagate(url, targets)` — true for same-origin and relative URLs by default; when `tracePropagationTargets`
      is set, a URL matches if it satisfies a string-includes or `RegExp.test` against any entry (Sentry semantics).
      `targets: []` disables all injection.
    - `addTracingHeadersToFetchRequest(input, init, traceparent)` — the three-shape merge (research §6.2.2). Resolves the
      header source (prefer `init.headers`, else `input.headers` if `input` is a `Request`, else none), branches on its
      type (`Headers` → clone + `set`; array of tuples → spread + push; plain object → spread + key), and returns a new
      `init` object. **Never mutates the caller's `Request` or `init`.** Returns `{ ...init, headers }` so the fetch
      spec's override semantics put the new header on the wire while the caller's `Request` is left intact (avoids
      "body already consumed" on single-shot request bodies).
- **`instrumentFetch.ts`** — `instrumentFetch(flare)` and `unpatchFetch()`. `instrumentFetch` bails out (no-op) when
  the environment has no callable `fetch` (`typeof globalThis.fetch !== 'function'`) or when `supportsNativeFetch()`
  returns false (a polyfilled, XHR-backed `fetch` must not be instrumented as if it were native). Otherwise it uses
  `fill(globalThis, 'fetch', …)` to install the wrapper described below; because `fill` is idempotent, a second call is
  a no-op rather than a double-wrap. `unpatchFetch()` restores `__flare_original__`.
- **`index.ts`** — barrel for the above (internal; not re-exported from the package public surface in v1).

### Wiring

In `packages/js/src/browser.ts`, the js `Flare` overrides `configure`. It captures
`wasTracingEnabled = this.config.enableTracing` (public getter, `Flare.ts:267`), calls `super.configure(config)` (which
does the core work, including clearing the tracer buffer on an enabled->disabled transition, `Flare.ts:328`), then acts
on the transition:

- `false → true`: `instrumentFetch(this)`.
- `true → false`: `unpatchFetch()`.
- no change: touch neither.

Only transitions act, so a `configure` call that leaves `enableTracing` untouched never patches or unpatches. Repeated
`configure({ enableTracing: true })` calls are safe because `instrumentFetch`/`fill` are idempotent. Do NOT patch in the
constructor: at construction the singleton still holds the default `enableTracing: false`, so a constructor patch never
fires, and an unconditional one would monkeypatch global `fetch` for every app that merely imports `@flareapp/js`. The
non-browser / `fetch`-less guard lives inside `instrumentFetch` (above), so `configure` can call it unconditionally on
the enable transition.

## The fetch wrapper

`fill(globalThis, 'fetch', (original) => function (input, init) { … })`. Per call, in order:

1. **Resolve `method` and `url`** from the overloaded signature (`input: string | URL | Request`, optional `init`).
   Method precedence: `init?.method` → `input.method` (when `Request`) → `"GET"`. URL: `input.url` (when `Request`) →
   `String(input)`. Normalize to an absolute URL against `location.href` for origin comparison.
2. **Recursion guard.** If the URL targets Flare's own `ingestUrl`, `logsIngestUrl`, or `tracesIngestUrl` (compare by
   origin + path prefix), call `original` with the untouched arguments and return — no span, no headers. Prevents the
   traces POST from instrumenting itself.
3. **Create the span.** `span = flare.startSpan(name, { spanType: 'browser_fetch', attributes })` where
   `name = `${method} ${pathname}``and`attributes`follow OTel HTTP client semconv:`http.request.method`, `url.full`, `server.address` (host). Span creation always happens when tracing is on,
   independent of the header gate (Sentry's two-gate model, research §6.2).
4. **Header injection (independent gate).** If `shouldPropagate(url, config.tracePropagationTargets)`, build
   `traceparent` from the span (`buildTraceparent(span.traceId, span.spanId, span.isRecording)`) and pass `input` +
   `init` through `addTracingHeadersToFetchRequest`. Inject even when the span is not recording (sampled flag `00`) so
   the sampling decision propagates downstream — matches Sentry and the PHP client's inheritance.
5. **Invoke** `original.call(this, input, mergedInit)` inside a `try`. `fetch` normally surfaces failures as a rejected
   promise, but it can also throw synchronously (e.g. a `TypeError` on a malformed `Request`). If the call throws
   before returning a promise, run the same failure path as step 7 (`setStatus({ code: 2, message })`, `span.end()`),
   then rethrow. Without this the span never ends, so `onSpanEnd` never runs and the per-fetch root `TraceState` leaks
   until LRU eviction (`Tracer.ts:250-258`).
6. **On resolve:** set `http.response.status_code`; if the status is `>= 500`, `span.setStatus({ code: 2 })`
   (error); otherwise leave unset (OTLP `UNSET`). `span.end()`. Return the response untouched.
7. **On reject** (network error, abort): `span.setStatus({ code: 2, message })`, `span.end()`, rethrow. Never swallow.

Every exit path (resolve, reject, synchronous throw) ends the span exactly once. Span timing uses the `Tracer`'s clock
(start at `startSpan`, end at `.end()`), so no new time source here.

## Config additions

Add one optional field to core `Config` (`packages/core/src/types.ts`). It has three meaningful states, so it MUST stay
`undefined` when unset: leave it OUT of the `DEFAULT_CONFIG` literal (`Flare.ts:36-66`) rather than seeding it with `[]`
or any array.

- `tracePropagationTargets?: (string | RegExp)[]` — controls `traceparent` injection targets. `shouldPropagate` branches
  on the three states:
    - `undefined` (unset): same-origin + relative only.
    - `[]`: never inject.
    - non-empty: opt in the cross-origin URLs matching any entry (string-includes or `RegExp.test`).

    Defaulting it to `[]` would collapse "unset" into "never" and silently kill all propagation; defaulting it to a
    populated array would force always-on cross-origin injection. Document it alongside the CORS caveat (the target server
    must return `Access-Control-Allow-Headers: traceparent`).

No other config changes; `enableTracing`, `tracesSampleRate`, `tracesIngestUrl` already exist from the core slice.

## Observability plumbing (so the slice is demoable + testable)

1. **fake-flare-server** (`e2e/fake-flare-server/`): add a `traces` endpoint mirroring the existing `logs` handling —
   `POST /api/traces` records the body under a new `'traces'` endpoint type; extend `reset()` to clear traces; add a
   `traces()` accessor and, if needed, a `waitForTrace` predicate path analogous to the reports one. Update
   `types.ts` (`FakeFlareEndpoint`, the recorder interface).
2. **e2e fixture** (`e2e/fixtures/fake-flare.ts`): expose `traces()` and `waitForTrace({ predicate })`.
3. **playground js** (`playgrounds/js/src/flare.ts`): when `VITE_FLARE_URL` is set, add
   `tracesIngestUrl: url.replace('/api/reports', '/api/traces')`, `enableTracing: true`, `tracesSampleRate: 1`
   (mirrors the existing `logsIngestUrl` override). Add a button (a `/broken`-style trigger, or a small dedicated
   control) that fires a same-origin `fetch` at a playground route so a span is generated and shipped.
4. **e2e spec**: click the button → `waitForTrace` asserting a `browser_fetch` span envelope arrives with the expected
   `name`, `http.request.method`, and `http.response.status_code` attributes.

## Testing

**Unit (js vitest, jsdom).** Prefer a fake `fetch` installed on a scratch object so `fill`/`unpatch` are exercised in
isolation:

- `fill`: wraps, exposes `__flare_original__`, is idempotent on second call, `unpatch` restores the original.
- Wrapper: creates a span with the right `name`/`spanType`/attributes; records `http.response.status_code`; marks
  error status on `>= 500`; marks error and rethrows on a rejected fetch; marks error, ends the span, and rethrows when
  the underlying `fetch` throws synchronously (span still ends exactly once); recursion guard skips Flare's own ingest
  URLs (no span).
- `configure` wiring: `enableTracing` `false → true` installs the patch; `true → false` restores it; a repeated
  `enableTracing: true` does not double-wrap (fill idempotency); a `configure` that does not flip `enableTracing` leaves
  the patch state unchanged.
- `instrumentFetch` gate: no-op when `supportsNativeFetch()` is false (polyfilled `fetch` left untouched) and when
  `globalThis.fetch` is not callable.
- `addTracingHeadersToFetchRequest`: all three header shapes (`Headers`, array of tuples, plain object) plus the
  `Request`-input path; asserts the caller's original `Request`/`init` is not mutated and the merged `init` carries the
  `traceparent`.
- `shouldPropagate`: same-origin and relative → true; cross-origin → false when unset (`undefined`); `[]` → false
  (distinct from unset); matches a `tracePropagationTargets` string and `RegExp`.
- Not-sampled path still injects `traceparent` with flag `00`.
- `supportsNativeFetch`: true for a native-looking `toString`, false for a polyfill string.

**E2e (Playwright, js project).** The playground round-trip above.

## Files touched

- New: `packages/js/src/tracing/{fill,supportsNativeFetch,propagation,instrumentFetch,index}.ts` + tests under
  `packages/js/tests/`.
- Edit: `packages/js/src/browser.ts` (`configure` override that patches/unpatches on the `enableTracing` transition),
  `packages/core/src/types.ts` (add optional `tracePropagationTargets`; deliberately NOT added to `DEFAULT_CONFIG`).
- Edit: `e2e/fake-flare-server/{server,types}.ts`, `e2e/fixtures/fake-flare.ts`, `playgrounds/js/src/flare.ts`, a js
  playground page/button, and a js e2e spec.

## Acceptance

- `npm run test` (js unit suite) green, including the new fetch tests.
- `npm run typescript` clean.
- `npx playwright test --project=js` green, including the new fetch-span spec.
- Manually: `npm run playgrounds:js`, click the fetch trigger, observe a `browser_fetch` span reach the fake server and
  a `traceparent` header on the outgoing request (network panel).

## External prerequisites (not blocking this slice)

Real-backend correlation still depends on B5 (backend browser `SpanType` aggregators), B9 (`/v1/traces` accepts the
public key + CORS), and P4 (customer `laravel-flare` version reads inbound `traceparent`). This slice validates against
the fake server and does not require any of them. When they land, flip the playground `tracesIngestUrl` to the live
backend to confirm real correlation — a documented follow-up check, not part of this spec's acceptance.
