# XHR instrumentation review findings

Findings from the multi-agent review of the XHR instrumentation slice (last 9 commits on
`research/performance-tracing`, tip `b3f641c`, reviewed 2026-07-06). Every finding below was
adversarially verified against the source; verdicts are noted per item. Line numbers reference
the branch state at review time and may drift.

Files in scope: `packages/js/src/tracing/instrumentXHR.ts`, `httpRequestSpan.ts`,
`instrumentFetch.ts`, `propagation.ts`, `packages/js/src/browser.ts`, tests, and the design doc
`docs/superpowers/specs/2026-07-06-performance-tracing-xhr-instrumentation-design.md`.

## High: fix before this slice ships

### 1. Re-opening an in-flight XHR cross-ends the previous span

`packages/js/src/tracing/instrumentXHR.ts:29` (`createXHROpen` overwrite) and `:91` (`onDone`).
CONFIRMED with a runtime repro (vitest with a spec-accurate fake XHR).

Per the WHATWG spec, `open()` on an in-flight request terminates the ongoing fetch WITHOUT
firing a DONE readystatechange (readyState goes to 1), so the first request's `onDone` listener
(removed only at readyState 4) stays attached with its `state.ended` still false, while
`createXHROpen` overwrites the WeakMap entry with fresh state. Sequence:

```js
xhr.open('GET', '/a');
xhr.send();
// mid-flight, cancel-and-retry pattern:
xhr.open('GET', '/b');
xhr.send();
```

When `/b` reaches DONE, both listeners fire. The `/a` listener ends the `GET /a` span with
`/b`'s `http.response.status_code` (repro showed the `/a` span ending with `/b`'s 404) and an
end time spanning both requests. If the app re-opens but never re-sends, the `/a` span is never
ended at all. This contradicts the design doc's claim that a reused instance cannot cross-end
another request's span. The existing guards (line 69 `state.ended` pass-through, line 38
`xhrState.delete` on invalid args) do not cover mid-flight re-open.

Fix sketch: when `createXHROpen` finds existing not-ended state for the instance, finish or
discard the prior span and remove its listener before overwriting. The listener would need to be
reachable from the state entry (store the handler, or end via a per-state abort flag the old
`onDone` checks).

### 2. Stuck `installed` flag permanently kills XHR tracing after a partial unpatch

`packages/js/src/tracing/instrumentXHR.ts:175` (`unpatchXHR` keys `installed` on `send` alone)
and `:145` (early return). CONFIRMED by code trace.

`unpatchXHR` unconditionally unfills `open` and `setRequestHeader` but decides
`installed = false` only from `send`. If a third party (zone.js, another APM) wraps
`XMLHttpRequest.prototype.send` on top of Flare's wrapper:

1. Disable tracing: `open`/`setRequestHeader` restore to native (ours are current, tagged);
   `unfill('send')` no-ops (top wrapper lacks `__flare_original__`); `installed` stays true.
2. Re-enable tracing: `instrumentXHR` early-returns on `installed`. `open` is never re-patched,
   so `xhrState` is never populated, and the leaked send wrapper passes every request through on
   `!state`. Zero `browser_xhr` spans, silently, until page reload.

Fetch's identical flag design is safe because its single leaked wrapper still does the whole
job; XHR's three-method patch is not. Warning for the fix: naively resetting `installed` is
worse. Re-filling `send` would stack a second Flare wrapper sharing the module-level `xhrState`;
both start a span per request and the outer one is never ended (the inner `onDone` sets
`state.ended` first). The three methods need to install and restore atomically.

Fix sketch: a shared `createPatcher({ target, methods, wrap })` helper (in `fill.ts` or next to
it) that owns the installed flag for the whole method set, applies/reverts atomically, and
reports whether restore succeeded. This also deduplicates the capture-before-unfill idiom copied
from `unpatchFetch` (see finding 12) and gives the future router/web-vitals slices a mechanism
instead of a third hand-rolled copy.

### 3. Status 0 mapped to error is wrong for non-HTTP(S) schemes

`packages/js/src/tracing/instrumentXHR.ts:106`. CONFIRMED.

Successful XHRs to `file://` and legacy Electron custom protocols
(`protocol.registerFileProtocol` / `registerBufferProtocol`) report `status 0` with a full
response body in Chromium. Nothing upstream filters non-HTTP URLs (`isFlareIngestUrl` only
excludes Flare endpoints; `shouldPropagate` only gates the header), and
`packages/electron`'s `RendererFlare` extends the browser `Flare`, so Electron renderers inherit
this instrumentation. Every successful local-resource XHR in a `file://`-hosted app is emitted
as a failed span with status_code 0, polluting error rates. The code comment's claim that status
0 at DONE "always means network/CORS failure or abort" only holds for http(s).

Fix sketch: gate the zero-is-error branch on the resolved URL's scheme (`abs?.protocol` is
`http:`/`https:`); for other schemes leave the span status unset when status is 0. Update the
comment and the design doc's status-0 section to match. Practical exposure is narrowed by modern
`protocol.handle` returning real statuses and default `webSecurity` blocking file-to-file XHR,
but `webSecurity: false` apps and legacy protocols are a real population.

## Medium

### 4. Fetch and XHR resolve an app-set traceparent with opposite winners

`packages/js/src/tracing/propagation.ts:70` (and `:66`, `:78`, `:83-86`) vs
`instrumentXHR.ts:81`. CONFIRMED.

Fetch's `mergeTraceparentHeader` strips any caller-supplied `traceparent` (every branch) and
installs Flare's; XHR's `hasAppTraceparent` defers to the app's header and skips injection. An
app doing its own distributed tracing gets its header preserved on XHR/axios but clobbered on
fetch, so upstream services see inconsistent trace lineage depending on which HTTP client a
library uses. XHR physically cannot overwrite (repeat `setRequestHeader` calls merge into one
malformed header, and there is no `getRequestHeader`), so the only consistent policy is
caller-wins. The design doc frames the two as equivalent solutions without acknowledging the
winner differs.

Fix sketch: make `mergeTraceparentHeader` (or its call site) detect an existing caller
traceparent and skip Flare's injection, matching XHR. Update the fetch spec doc and the
duplicate-header tests accordingly.

### 5. Any instance disabling tracing unpatches globally

> DEFERRED (2026-07-07, review-fixes round): not fixed this round by decision. It is Medium and
> pre-existing (not introduced by the XHR slice), and a robust fix needs an instrumentation
> registry that reworks the fetch/XHR wrapper tracer binding and `browserTracing.ts` root
> ownership. Tracked as its own follow-on slice. The multi-instance case is more than
> hypothetical because `@flareapp/electron`'s `RendererFlare` extends the browser `Flare`.

`packages/js/src/browser.ts:46` (disable branch). CONFIRMED; pre-existing for fetch, extended to
XHR by this slice.

The enableTracing transition drives module-global `stopBrowserTracing` / `unpatchFetch` /
`unpatchXHR` from per-instance config, with no ownership or refcount. Two Flare instances in one
bundle (the class is publicly exported alongside the singleton): B enabling then disabling
tracing restores native prototype methods while A still has `enableTracing: true`. A's spans and
propagation stop mid-session, undetectably.

Fix sketch: solve at the instrumentation-registry level, not per call site. An
`installBrowserInstrumentation(flare)` / `uninstallBrowserInstrumentation(flare)` pair that
tracks the owning/active instances (or simply refcounts) would also collapse the growing
install/teardown pair list in `configure` (each future slice currently adds two more lines that
must stay mirrored across the two branches).

### 6. `hasAppTraceparent` set before the native call can throw

`packages/js/src/tracing/instrumentXHR.ts:53`. PLAUSIBLE (narrow but reachable).

The wrapper sets `state.hasAppTraceparent = true` before `original.call`. If the native
`setRequestHeader` throws (SyntaxError for a value with forbidden characters, e.g. a stray
newline from interpolation) and the app catches it, the app's header never landed but the flag
is set, so `send()` skips Flare's injection and the request goes out with no traceparent at all.

Fix: call `original` first; set the flag only after it returns.

## Low

### 7. `xhr.open('GET', '')` is a legal request but is untraced

`packages/js/src/tracing/instrumentXHR.ts:28`. CONFIRMED, low severity.

An empty-string URL resolves against the document base URL and performs a real request, but the
`String(url) !== ''` guard records no state: no span, no traceparent. The identical `fetch('')`
IS traced (`safeAbsolute('', origin)` parses to the origin root), so this is also a fetch/XHR
asymmetry. The design doc's "missing/empty" premise mislabels a performable request.

Fix sketch: drop the empty-string check (keep the null/undefined bail) so `''` flows through
`safeAbsolute` like fetch does. While there, stringify `url` once (the guard and the state
literal currently call `String(url)` twice, which double-invokes a URL-like's `toString`).

## Cleanup (no behavior change intended)

### 8. The `httpRequestSpan.ts` extraction stopped one layer short

`instrumentXHR.ts:103-107` vs `instrumentFetch.ts:69-71`, `instrumentXHR.ts:121-124` vs
`instrumentFetch.ts:55-56` (plus `core/src/tracing/Tracer.ts:132-133`), `instrumentXHR.ts:80-89`
vs `instrumentFetch.ts:49-51`. CONFIRMED.

Three pieces are still duplicated per transport:

- completion mapping: `setAttribute('http.response.status_code')` + `>= 500` to
  `setStatus({ code: 2 })` + `end()`
- error finish: `setStatus({ code: 2, message: error instanceof Error ? ... })` + `end()`
  (a third copy lives in core's `Tracer.withSpan`)
- propagation gate + header build: `shouldPropagate(abs ? abs.href : url, ...)` then
  `buildTraceparent(span.traceId, span.spanId, span.isRecording)`

Fix sketch: `endHttpRequestSpan(span, status, { zeroIsError })`,
`finishHttpSpanError(span, error)`, and `traceparentFor(span, abs, url, origin, config)` in
`httpRequestSpan.ts`. The XHR-only status-0 branch becomes the `zeroIsError` option (which is
also where finding 3's scheme guard belongs, one shared fix). Core `Span.end()` is idempotent,
so XHR's `state.ended` guard around `end()` stays call-site bookkeeping. Deduplicating the core
Tracer copy requires core to export the helper; optional.

### 9. `state.span = span` is a dead write that pins ended spans

`packages/js/src/tracing/instrumentXHR.ts:78` (field declared at `:14`). CONFIRMED.

Nothing reads `state.span` (onDone and the sync-throw catch use the closure-captured local; the
WeakMap is module-private). The state entry must outlive the request for the `ended` re-send
guard, so the field keeps one ended `Span` reachable per long-lived/pooled XHR instance.
Fix: delete the `span?: Span` field and the assignment.

### 10. Fake span/tracer test helpers exist in triplicate

`packages/js/tests/instrumentXHR.test.ts:9` (verbatim copy of `instrumentFetch.test.ts:8-46`)
plus a strict-subset copy in `instrumentXHR.prototype.test.ts:8-30`. CONFIRMED.

`packages/js/tests/helpers/` already hosts `FakeApi.ts` and is imported by four other suites.
Fix: move `fakeSpan`/`makeTracer` to `tests/helpers/fakeTracer.ts` (typed against `HttpTracer`)
and import in all three files.

### 11. Same URL parsed up to three times per traced request

`httpRequestSpan.ts:20` (inside `isFlareIngestUrl`), `instrumentXHR.ts:72` /
`instrumentFetch.ts:40` (caller's `safeAbsolute`), `propagation.ts:5` (`isSameOrigin`, default
propagation path only). CONFIRMED, minor.

Fix sketch: parse once and thread `URL | null` through: `isFlareIngestUrl(abs, config)`; let
`shouldPropagate`'s default path compare `abs.origin === origin` directly. Null-abs maps to
false in both, matching current failure semantics exactly. Squeezed out of the review's finding
cap; worth folding into finding 8's refactor rather than doing standalone.

### 12. Barrel exports the three `createXHR*` factories against the spec

`packages/js/src/tracing/index.ts:2`. CONFIRMED, minor.

The design doc's export section (spec section 3) limits the barrel to `instrumentXHR`,
`unpatchXHR`, `HttpTracer`. Nothing imports the factories from the barrel (tests import the
module directly), and the tracing barrel is not re-exported from the package's public entries,
so this is spec drift plus dead exports rather than real API widening.
Fix: drop the three factory exports. The related `FetchTracer = HttpTracer` alias can go in the
same pass (rename its two consumers to `HttpTracer`).

## Suggested fix order

1 and 2 first (both touch the send/open lifecycle; 2's atomic patcher is also the foundation
for 5). Then 3 + 4 together with the finding-8 extraction, since the shared
`endHttpRequestSpan`/`traceparentFor` helpers are where the scheme guard and the caller-wins
policy naturally land. 6, 7, 9, 10, 11, 12 are independent small fixes in any order.
