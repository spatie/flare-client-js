# Spec: performance tracing — browser XHR instrumentation (`@flareapp/js/src/tracing/`)

Status: design approved 2026-07-06. Scope: `XMLHttpRequest` instrumentation only. Branch:
`research/performance-tracing`.

## Context

This is a follow-on slice of the performance-tracing effort. The
[fetch instrumentation slice](2026-07-01-performance-tracing-fetch-instrumentation-design.md) shipped
`createFetchWrapper` + `instrumentFetch`/`unpatchFetch`, the `fill`/`unfill` monkeypatch helper, the shared propagation
utilities (`shouldPropagate`, `mergeTraceparentHeader`, `buildTraceparent`), and the `browser_fetch` span shape. The
[pageload/navigation roots slice](2026-07-02-performance-tracing-pageload-navigation-roots-design.md) shipped the idle
root lifecycle so request spans nest under a `browser_pageload` / `browser_navigation` root. That slice explicitly
deferred XHR — this spec closes that gap.

Fetch's own `instrumentFetch` deliberately leaves a polyfilled/XHR-backed fetch unpatched (`supportsNativeFetch()`
returns false), with a comment pointing at "the future XHR patch". This is that patch. Because a whatwg-fetch polyfill
routes fetch through XHR, patching XHR also incidentally traces apps whose fetch we skipped — as one `browser_xhr` span
per request, no double-counting.

Full research: `.claude/docs/research/performance-tracing.md` (§6.2 Sentry's request instrumentation, §6.2.1 how the
patching works). Sentry's real source was re-read during design (`packages/browser-utils/src/instrument/xhr.ts`,
`packages/browser/src/tracing/request.ts`) and this spec records where we match it and where we deliberately diverge.

### Goal of this slice

Reach fetch parity for XHR: every traced outgoing `XMLHttpRequest` opens a `browser_xhr` child span under the active
root, injects a W3C `traceparent` on propagation-eligible URLs, and ends the span with the right status. Validate via
unit tests plus manual exploration in the JS playground (raw XHR and library-backed XHR through axios).

### Approved decisions driving this spec

- **Mirror the `browser_fetch` span exactly.** Same attributes (`http.request.method`, redacted `url.full`,
  `server.address`, `server.port`, `http.response.status_code`), same error mapping (any network failure or `>= 500`
  → `code: 2`), same ingest-URL skip, same query redaction, same `traceparent` gates. No XHR-specific extras (no
  response body size, no request/response bodies).
- **Reuse `enableTracing`.** XHR patches on/off with the same `enableTracing` transition as fetch and the browser
  roots. No new config surface (`no traceXHR`/`traceFetch` flags).
- **Distinct `browser_xhr` span type.** Parallel to `browser_fetch`, so the backend/UI can distinguish the transport
  (same way `browser_pageload` and `browser_navigation` are already distinct). This is a new backend taxonomy value —
  see Follow-ups.
- **Steal Sentry's XHR mechanics, skip its indirection.** Port the parts that exist for correctness (three-method
  patch, `readyState === 4` completion, guarded `setRequestHeader`). Do not port the shared handler registry
  (`triggerHandlers` / `addXhrInstrumentationHandler`), the instance-property state key, or the `onreadystatechange`
  proxy — see "Deliberate divergences from Sentry" for why each is unnecessary here.

### Explicitly out of scope

`traceXHR`/`traceFetch` opt-out flags, XHR response-body-size capture, framework router integrations, an automated
Playwright/e2e spec for XHR (manual playground only), and real-backend correlation (blocked on B5/B9/P4). Each is its
own later slice or a deliberate non-goal.

## Validation of the design against Sentry

Sentry's XHR instrumentation was read in full during design. Summary of the comparison that shaped this spec:

**Matched (ported):**

- Patch `open` to capture method/URL, `send` to start the span, and trigger completion tracking off the XHR lifecycle.
- Span starts at `send` time. Header injection is gated independently of span creation (create-span vs attach-headers
  are two separate decisions).
- `setRequestHeader('traceparent', …)` wrapped in try/catch (it throws unless the object is in the OPENED state).
- Skip the SDK's own ingest requests. `http.method` / `url.full` / `server.address` attributes.

**Corrected after reading the real source (my initial plan was wrong):**

1. **Completion signal is `readystatechange` + `readyState === 4`, not `loadend`.** Sentry reads `this.status` at DONE
   inside a try/catch ("touching statusCode on some platforms throws"). `loadend` is **not reliably dispatched for
   synchronous XHR**, whereas the DONE `readystatechange` always fires. Using DONE also lets us derive the error state
   from `this.status` in a single listener — dropping the separate `error`/`timeout`/`abort` listeners the initial plan
   had.
2. **Patch `setRequestHeader` as well — for correctness, not just header capture.** There is no `getRequestHeader`
   API, so intercepting `setRequestHeader` is the only way to know whether the app already set its own `traceparent`.
   Without that knowledge, a second `setRequestHeader('traceparent', …)` **merges** into one malformed header
   (`traceparent: v1, v2`; the spec merges repeat calls with the same name). This is exactly the duplicate-header case
   the fetch `mergeTraceparentHeader` already strips. So XHR must patch three prototype methods, not two.
3. **Bail in `open` when method or URL is missing** (passthrough, record no state). The initial plan omitted this.

### Deliberate divergences from Sentry (and why they are safe here)

- **`WeakMap<XMLHttpRequest, XhrState>` instead of Sentry's instance property (`__sentry_xhr_v3__`).** Sentry uses a
  direct string property because it hands the `xhr` object to an external handler registry whose subscribers read that
  property. Flare has no such registry — a module-level WeakMap is strictly cleaner (no instance pollution, GC-friendly)
  and every consumer (the `setRequestHeader` patch, the completion listener) is in this module.
- **`fill`/`unfill` + an `installed` flag instead of Sentry's `new Proxy` + external `maybeInstrument`.** Reuses exactly
  what our fetch patch uses, with the same idempotency and leaked-wrapper guard.
- **No `onreadystatechange`-property proxy.** `addEventListener('readystatechange', …)` coexists with an app's
  `xhr.onreadystatechange` without clobbering it, so Sentry's property-proxy path is unnecessary. Each completion
  listener closes over its own request's `state`, so a reused XHR instance cannot cross-end another request's span.

## Trace model for this slice

An XHR request becomes one `browser_xhr` child span of whatever root the `IdleRootController` currently holds active
(`browser_pageload` or `browser_navigation`), identical to how `browser_fetch` nests today. If no root is active
(tracing enabled but no root — e.g. after `finalTimeout`), `startSpan` still produces a span per the core `Tracer`'s
existing rules; XHR does nothing special about it. The span carries a `traceparent` on the wire only when the URL is
propagation-eligible and the app has not already set its own `traceparent`.

## Components

### 1. `packages/js/src/tracing/httpRequestSpan.ts` (new — shared extraction)

Extract the logic currently private inside `instrumentFetch.ts` so fetch and XHR share one copy. No behavior change to
fetch.

- `safeAbsolute(url: string, origin: string): URL | null` — moved verbatim.
- `isFlareIngestUrl(url: string, origin: string, config: Config): boolean` — moved verbatim.
- `requestSpanAttributes(method: string, abs: URL | null, url: string, config: Config): Attributes` — returns the
  shared attribute object:
    ```ts
    {
        'http.request.method': method,
        'url.full': redactUrlQuery(abs ? abs.href : url, config.urlDenylist),
        ...(abs ? { 'server.address': abs.hostname } : {}),
        ...(abs && abs.port ? { 'server.port': Number(abs.port) } : {}),
    }
    ```
- `type HttpTracer = { readonly config: Config; startSpan(name: string, opts?: SpanOptions): Span }` — the structural
  subset both wrappers need. `FetchTracer` in `instrumentFetch.ts` becomes `export type FetchTracer = HttpTracer` so the
  existing export keeps working.

`instrumentFetch.ts` is refactored to import these three helpers and the type; its own copies are deleted. The fetch
unit tests must stay green unchanged — this is the proof the extraction is behavior-preserving.

### 2. `packages/js/src/tracing/instrumentXHR.ts` (new)

Module-level per-request state:

```ts
type XhrState = {
    method: string;
    url: string;
    span?: Span;
    hasAppTraceparent: boolean;
    ended: boolean;
};
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();
```

Three prototype-method factories (pure, so they can be unit-tested against a fake XHR without a browser), plus the
install/uninstall pair.

**`open(method, url, ...rest)` wrapper:**

- If `method` or `url` is missing/empty → call original, record no state.
- Else `xhrState.set(this, { method: String(method).toUpperCase(), url: String(url), hasAppTraceparent: false, ended: false })`,
  then call original with all args (preserve `async`/`user`/`password`).
- `String(url)` handles URL objects and other stringifiers, matching Sentry's `parseXhrUrlArg`.

**`setRequestHeader(name, value)` wrapper:**

- If a state exists for `this` and `String(name).toLowerCase() === 'traceparent'` → set `state.hasAppTraceparent = true`.
- Always call original.

**`send(body)` wrapper:**

1. `const config = tracer.config; const state = xhrState.get(this);`
2. If `!config.enableTracing` or `!state` → passthrough.
3. If `isFlareIngestUrl(state.url, origin, config)` → passthrough.
4. `const abs = safeAbsolute(state.url, origin); const pathname = abs ? abs.pathname : state.url;`
5. `const span = tracer.startSpan(\`${state.method} ${pathname}\`, { spanType: 'browser_xhr', attributes: requestSpanAttributes(state.method, abs, state.url, config) });`
`state.span = span;`
6. If `shouldPropagate(abs ? abs.href : state.url, origin, config.tracePropagationTargets)` **and**
   `!state.hasAppTraceparent`: `try { this.setRequestHeader('traceparent', buildTraceparent(span.traceId, span.spanId, span.isRecording)); } catch { /* wrong ready-state */ }`.
7. `this.addEventListener('readystatechange', onDone)` where `onDone` closes over `state` (see completion below).
8. Call original `send`. Wrap in try/catch: on a synchronous throw, remove the `readystatechange` listener (it never
   fires on a sync send throw, so cleanup stays symmetric with the happy path), `span.setStatus({ code: 2, message })`,
   end the span (guarded by `state.ended`), and rethrow.

**Completion listener (`onDone`, closure over `state`):**

```ts
if (this.readyState !== 4 || state.ended) return;
state.ended = true;
let status = 0;
try {
    status = this.status;
} catch {
    /* some platforms throw */
}
try {
    state.span!.setAttribute('http.response.status_code', status);
    if (status === 0 || status >= 500) state.span!.setStatus({ code: 2 });
    state.span!.end();
} catch {
    /* instrumentation must never throw into the host app */
}
```

`status === 0` at DONE means no HTTP response was received (network failure, CORS block, abort, or timeout) — the XHR
analog of a fetch promise rejection, which fetch maps to `code: 2`. `status >= 500` mirrors fetch's server-error
mapping. Everything else ends `Unset`. The `http.response.status_code` attribute is emitted unconditionally, including
the `0`, matching Sentry (`setHttpStatus(span, status_code)` fires whenever `status_code` is defined, and `this.status`
is always a number). This is a minor, deliberate divergence from strict fetch parity: a fetch network-failure span
carries no `status_code` (fetch rejects before a response exists), whereas an XHR network-failure span carries
`status_code: 0` — truthful for XHR, and it distinguishes "never got a response" from a real HTTP error.

**Install / uninstall:**

```ts
let installed = false;

export function instrumentXHR(tracer: HttpTracer): void {
    if (installed) return;
    const X = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    if (typeof X !== 'function' || !X.prototype) return;
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
    const proto = X.prototype as unknown as Record<string, unknown>;
    fill(proto, 'open', (o) => createXHROpen(o as XhrOpen));
    fill(proto, 'setRequestHeader', (o) => createXHRSetRequestHeader(o as XhrSetHeader));
    fill(proto, 'send', (o) => createXHRSend(tracer, o as XhrSend, origin));
    installed = true;
}

export function unpatchXHR(): void {
    /* unfill all three; clear installed like unpatchFetch */
}
```

The `installed` flag mirrors `instrumentFetch`: if a third party wraps a method on top of ours, `unfill` cannot restore
and the leaked wrapper stays inert (the `send` wrapper re-checks `enableTracing`; `open`/`setRequestHeader` only touch
the WeakMap, which is harmless). `origin` is injected (the node test env has no `location`) so the factories are
directly unit-testable.

### 3. `packages/js/src/tracing/index.ts`

Add exports: `instrumentXHR`, `unpatchXHR`, and the `HttpTracer` type. The `httpRequestSpan` helpers
(`safeAbsolute`, `isFlareIngestUrl`, `requestSpanAttributes`) stay module-internal — `instrumentFetch.ts` and
`instrumentXHR.ts` import them directly, they are not part of the package's public surface.

### 4. `packages/js/src/browser.ts`

In the `configure` override's `enableTracing` transition, alongside the existing fetch calls:

```ts
if (!wasTracing && nowTracing) {
    instrumentFetch(this);
    instrumentXHR(this);
    startBrowserTracing(this);
} else if (wasTracing && !nowTracing) {
    stopBrowserTracing();
    unpatchFetch();
    unpatchXHR();
}
```

## Testing (unit only)

`packages/js/tests/instrumentXHR.test.ts`, mirroring `instrumentFetch.test.ts`. A `fakeXHR()` helper implements
`open`/`send`/`setRequestHeader`/`addEventListener`, a settable `status` and `readyState`, and a `fireDone()` that sets
`readyState = 4` and dispatches `readystatechange`. A `makeTracer()` helper returns a fake span + config identical to
the fetch test's.

Cases:

- Creates a `browser_xhr` span with method/url attributes and the `${method} ${pathname}` name.
- Redacts denylisted query params in `url.full`.
- Injects `traceparent` same-origin (default), and does **not** inject cross-origin by default (span still created).
- Injects with flag `00` when the span is not recording; injects for a relative same-origin URL when
  `tracePropagationTargets` is set.
- **App-set `traceparent` suppresses ours**: when the app calls `setRequestHeader('traceparent', …)` before `send`, our
  injection is skipped (no second `setRequestHeader('traceparent')` call).
- Marks `code: 2` on `status >= 500`; marks `code: 2` on `status === 0` **and emits `http.response.status_code: 0`**;
  ends `Unset` on a normal 2xx.
- Sets `http.response.status_code` from `this.status` at DONE (including `0`); guards a throwing `status` getter.
- Skips Flare ingest URLs entirely (no span, passthrough).
- Passes through untouched when tracing is disabled.
- Ends the span and rethrows when the underlying `send` throws synchronously.
- Bails in `open` when method or URL is missing (no state, passthrough on `send`).
- `instrumentXHR` / `unpatchXHR` on the real `XMLHttpRequest.prototype`: patches the three methods, is idempotent, and
  restores on unpatch; a reused XHR instance does not cross-end a prior request's span.

The fetch suite (`instrumentFetch.test.ts`) must remain green after the shared-helper extraction.

## JS playground (manual exploration only)

- Add `axios` as a dependency to `playgrounds/js`.
- Add two **JS-playground-only** local trigger buttons (not shared `coverageFor()` scenarios, so the other three
  playgrounds and the e2e suite are untouched): a raw `XMLHttpRequest` GET and an axios GET, both to a same-origin path
  so a `traceparent` is injected and a `browser_xhr` span nests under the active root. Axios's default browser adapter
  is `XMLHttpRequest`, so the axios button exercises the patch through a real library.
- Purpose: manual verification via `npm run playgrounds:js`. No Playwright spec.

## Follow-ups to record

- **`browser_xhr` is a new backend taxonomy value.** The backend team must be told it is coming (same category as
  `browser_fetch`), so `SpanType`/`SpanAggregator` handling accounts for it.
- **No automated real-browser coverage.** XHR nesting under pageload/nav roots is verified only manually in the JS
  playground this slice; a future e2e slice can add a JS-project Playwright spec asserting `browser_xhr` envelopes reach
  the fake-flare-server.
- **Response-body-size** and other XHR-specific attributes are intentionally omitted for fetch parity; revisit only if
  a concrete need appears.
