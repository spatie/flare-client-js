# PR #80: low-severity tracing findings

Findings 1, 7 and 9 are fixed; 8 is retracted. The rest are left unfixed from the adversarial review of `performance-monitoring-and-tracing` on 2026-08-12. The six
real defects and their fixes are in `pr80-tracing-defects-and-fixes.md`. Everything here is either a
deliberate design choice worth writing down, a footgun that needs a config to hit, or a decision rather
than a bug. Line numbers reference the branch state at review time and will drift.

## 1. The logs and traces keepalive budgets could not both fit on page hide (fixed)

`packages/core/src/api/Api.ts`, `packages/core/src/telemetry/TelemetryBuffer.ts`.

`MAX_PENDING_KEEPALIVE_BYTES` and `Config.keepaliveMaxBytes` were both 60,000, so each buffer packed a
full 60 KB believing it had the whole allowance. Both flush on page hide, so the first fitted and the
second was over the gate in `send()` and silently degraded to a cancellable fetch.

**Fixed** by making the Api the single source of truth. New `Api.keepaliveBudgetRemaining()` reports what
is actually left, and both buffer policies pass it through the new `TelemetryBuffer` policy hook
`keepaliveBudget`, so `packForKeepalive` packs against the remainder rather than the config value.

The signal that finds no room keeps its records and re-arms its timer, which is the buffer's existing
behaviour for anything that does not fit a keepalive envelope and is the right one here too: on a plain
tab background the records ship on the next flush, and on a real unload a non-keepalive request would have
been cancelled anyway. A fallback that drained and sent them regardless was written and then dropped,
because it contradicted that design and broke three tests that pin it.

Covered by `packages/core/tests/keepaliveBudgetSharing.test.ts`, which fails without the wiring.

## 2. Query-string and hash-only navigations open no root

`packages/js/src/tracing/browserTracing.ts`, `onUrlChanged` compares `location.pathname` only.

`/products` to `/products?page=2` is not a navigation as far as tracing is concerned. Confirmed by test: a
faceted-search or paginated SPA gets one root for the whole session. Once that root idles out, later
fetches have no active root and open their own single-span `browser_fetch` traces.

Probably deliberate (a query change is not a route change, and the route name would not move). Worth an
explicit line in the docs either way, because the visible effect is "my filter clicks produce no page
timings".

**If ignored:** nothing breaks; a class of interaction is invisible in the product.

**Verified:** by test, in jsdom.

## 3. `browserEntryPoint` reports `web` under SSR where it used to report `server`

`packages/js/src/browser/context/collectBrowser.ts`.

On `main` the no-window branch returned `'flare.entry_point.type': 'server'`. On the branch it returns
`'web'`. `@flareapp/js` does run during SSR in a SvelteKit universal `load`, so this is reachable.

**If ignored:** SSR-time errors from the browser package are classified as web entry points.

**Not verified:** whether anything downstream reads `flare.entry_point.type` in a way that cares. Worth a
minute of backend checking before deciding it is harmless.

## 4. Re-issuing a `Request` drops its referrer state

`packages/js/src/tracing/propagation.ts`, `mergeTraceparentHeader`.

The wrapper injects `traceparent` by returning an init rather than rebuilding the `Request`, which is the
right call: it keeps a single-shot body intact. But per the Fetch specification, `fetch(request, init)`
with a non-empty init resets the request's referrer to `"client"` and its referrer policy to the empty
string. An app that sets `referrer` or `referrerPolicy` on a `Request` object loses them. The same
settings passed in an `init` survive, because the descriptor copy carries them.

**If ignored:** a narrow class of app loses referrer control on traced requests.

**Verified in Chromium:** body, `AbortSignal` (including a signal carried only on the `Request`), abort
behaviour, and a caller-set `traceparent` all survive correctly. The referrer reset is from the
specification text, **not** measured.

## 5. `internalRequestInit` is a plain property on the init object

`packages/js/src/tracing/internalRequest.ts`.

`__flare_internal_request__: true` marks Flare's own snippet fetches so they are not traced. Any
application could set the same key and silently opt a request out of tracing. Harmless, but it is an
undocumented public escape hatch. A `Symbol` would not survive the object spread, so the string key is a
reasonable choice; this is a note, not a request to change it.

## 6. An ingest URL that prefixes app routes silently disables tracing for them

`packages/js/src/tracing/httpRequestSpan.ts`, `matchesIngestHref`.

The match is a prefix with a path boundary, so `ingestUrl: 'https://app.test/api'` also swallows
`https://app.test/api/products` and every other app request under `/api`. Correct behaviour for the
boundary rule, and it needs an odd proxy configuration to hit, but the failure is invisible: requests are
simply never traced.

**Options:** leave it and document the constraint on proxying ingest, or warn in debug mode when an ingest
URL matches more than a handful of distinct request URLs.

## 7. `BrowserFlushScheduler` listened to `visibilitychange` only (fixed)

`packages/js/src/browser/BrowserFlushScheduler.ts`.

Traces had a second chance because `startBrowserTracing` registers its own `pagehide` handler. Logs did
not, so on the browsers where `pagehide` fires with no preceding `visibilitychange`, buffered logs were
lost. Predates this PR.

**Fixed** by registering both events. Flushing an already-drained buffer is a no-op, so the overlap costs
nothing. Covered by "flushes on pagehide too, for the browsers that skip visibilitychange" in
`packages/js/tests/browserFlushScheduler.test.ts`.

## 8. React reserving its span start during render (retracted, could not reproduce)

`packages/react/src/profiler.ts`.

The claim was that `ownRef.current = { spanId, startNano: nowNano() }` runs during render while the span
ends in the mount effect, so a component React renders long before it commits would report the deferral as
mount duration. That was reasoned from React's rendering model and is **wrong in practice**.

Measured with a probe against a real `<Suspense>` boundary: `reserveSpanId` is called **three times** for
one committed mount, and the span that records carries the third id. React discards the suspended fiber
and re-renders from scratch with fresh refs, so the start is already re-captured on the render that
actually commits. There is nothing to fix.

A re-stamp fix was written and then reverted, because the test intended to prove it passed identically
with and without it.

The probe did surface something real, which is now recorded against defect 4 in
`pr80-tracing-defects-and-fixes.md`: those discarded renders each claim a `maxSpansPerTrace` slot that
never becomes a span.

## 9. Sourcemap upload errors hid their cause (fixed)

`packages/flare-api/src/FlareApi.ts`.

`postWithRetry` built its message from `error.message`. For any Node `fetch` failure that string is always
the bare `fetch failed`, with the real reason on `error.cause.code`. The `cause` was correctly attached to
the thrown error, but `packages/vite/src/index.ts:131` logs only `${reason}`, so it never reached anyone.

The practical effect: a server being down, DNS not resolving, and a certificate Node does not trust all
printed identically. This cost real time during the review, where a repo-root `npm run build` reported
`Network error after 3 attempts: fetch failed` against a local `flareapp.io.test` that was in fact up and
answering, because Node ships its own CA bundle and ignores the macOS keychain that `curl` reads.

**Fixed** by a `describeNetworkError` helper that appends the cause's `code` and message when present.
Verified against the real local endpoint:

```
Network error after 3 attempts: fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate)
```

Two tests added to `packages/flare-api/tests/FlareApi.test.ts`, one for the cause and one for the plain
fallback.

**Still open, for the machine and not the code:** Node needs `NODE_EXTRA_CA_CERTS` pointing at the local
Herd/Valet root CA before any Node-to-local-Flare call will work. Until then every playground build burns
three attempts with 1s + 2s backoff, roughly fifteen seconds added to a repo-wide build. Uploading is on
because each vite playground's gitignored `.env.local` sets both `VITE_FLARE_URL` and
`FLARE_UPLOAD_SOURCEMAPS=1`, and `flareSourcemapsForPlayground` opts in on either.

## 10. Deliberately left alone

| Item                                                       | Why                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-instance ownership of the tracing module state       | Already a known deferred finding; the browser tracing module is page-global by design and a second `Flare` silently gets no roots. Confirmed by test, unchanged.                                                                            |
| `unpatchFetch` / `unpatchXHR` are process-global           | Same root cause as above: disabling tracing on one instance unpatches for every instance.                                                                                                                                                   |
| `withSpan`, prune / re-seed, LRU eviction, epoch staleness | Held up under everything thrown at them: double `end()`, `clear()` mid-flight, a stale-epoch parent, a re-seeded closed trace, a malformed `traceparent`, and a sampler that throws, returns `NaN`, or returns a string. No changes wanted. |
