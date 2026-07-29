# Browser Web Vitals — Design

Status: ready for planning
Date: 2026-07-29
Branch: `browser-web-vitals` (to be cut off `performance-monitoring-and-tracing`, tip `da64213`)

Every claim about the Flare backend in this document was checked against the working copy at
`~/srv/flareapp.io`, branch `feat/performance-monitoring-js`, tip `aa76da879`. Claims about Sentry come
from reading `packages/browser-utils/src/metrics/` in `getsentry/sentry-javascript`, not from their docs.
Where the two disagree, the source wins and the disagreement is noted.

## Goal

Collect the five Web Vitals in the browser and report them per route, automatically, with no
configuration in any framework package.

```
browser_pageload  /product/:id                    312ms
 └─ browser_fetch  GET /api/products/p01           88ms

browser_page_vitals  /product/:id                          <- emitted at pagehide
   flare.web_vital.cls = 0.08
 ├─ ttfb  [ origin .. origin+210ms  ]
 ├─ fcp   [ origin .. origin+890ms  ]
 ├─ lcp   [ origin .. origin+2140ms ]
 └─ inp   [ t_click .. t_click+190ms ]
```

The vitals span is parented to the pageload root but flushed much later, in its own batch. That split is
the whole design problem, and everything below follows from it.

## Why the vitals cannot ride the pageload span

Our pageload root closes on idle: `IdleRootController` ends it after `idleTimeout` (1s by default) with no
open children. The vitals do not agree with that schedule.

| Vital | Final when                                      |
| ----- | ----------------------------------------------- |
| TTFB  | Immediately, off the navigation entry           |
| FCP   | Usually within the first second or two          |
| LCP   | First interaction, or page hide                 |
| CLS   | Never, it accumulates for the page's whole life |
| INP   | Page hide                                       |

So at the moment the pageload root closes, only TTFB is reliably final. Writing the rest onto that span
means writing numbers that were still moving.

Sentry hit this and rewrote for it. Their dev docs say most vitals are "accumulated while the pageload
span is active and captured when we _end_ the pageload span", and then admit this "leads to discrepancies
for vitals that are still changing after the pageload span ends, particularly for LCP and CLS". Their fix
was `trackLcpAsSpan()` and `trackClsAsSpan()` in `webVitalSpans.ts`, which hold the value and emit a
separate span on a report event. We are taking the same shape, applied to all five at once rather than
splitting three vitals across two mechanisms.

## What we take from Sentry, and what we do not

**Taken: the report trigger.** `listenForWebVitalReportEvents()` fires on whichever comes first of page
hide or the first soft navigation, once only. That rule is right and we copy it.

**Taken: vendoring the measurement code.** Sentry does not hand-roll observers. They vendor a fork of
Google's `web-vitals` v5.1.0 (commit `e22d23b`, Apache 2.0). Their fork README lists the changes: bfcache
logic and multi-report removed because they report once per pageload, LCP finalization restricted to
`isTrusted` user events, a selector fallback added.

**Not taken: per-interaction INP spans.** Sentry emits one span per interaction, op
`ui.interaction.click|pointer|keyboard`, named after the element, with a map of the last ten interactions
to resolve the element after the fact. We take the single final INP value instead. Their model exists to
support element attribution, which we are not shipping.

**Not taken: element attribution.** No LCP element selector, no CLS shift sources, no INP target. Values
only. This is the largest single saving in the vendored fork.

**Not taken: their measurement mechanism.** Sentry's values land as either `setMeasurement()` calls or
`browser.web_vital.<name>.value` attributes on the pageload span. Neither works for us, for a reason
specific to our backend that is set out under "Encoding" below.

## Scope decisions (locked during brainstorm)

1. **Delivery.** One span emitted late, parented to the pageload root by `traceId` and `spanId`. Requires
   the backend to treat it as a container span type. See "Backend changes".
2. **Source.** A trimmed, vendored fork of `web-vitals`, not an npm dependency and not hand-rolled.
3. **Payload.** Five values, no element attribution. The attribute namespace stays open so attribution can
   be added later without a wire-format change.
4. **Encoding.** Timing vitals as child spans with real start and end times; CLS as an attribute.
5. **Electron.** No special handling. Documented as a known gap, see "Electron".

## Encoding: why timing vitals are spans

This is the least obvious decision in the design, so the reasoning is recorded in full.

Aggregated numbers on the backend come from `SpanAggregationMetricsQuery.php:210-214`:

```sql
quantilesTDigestMerge(0.5, 0.90, 0.95, 0.99)(quantiles) AS quantiles
sumMap(statistics) as statistics
```

The t-digest is built over span **duration**. The `statistics` map is only ever **summed**. So a value
parked in `statistics` or in a plain attribute yields a total, and an average if you divide by count, but
never a percentile.

Web Vitals are reported at p75 everywhere that matters: Google's own thresholds, CrUX, PageSpeed Insights,
and Sentry's Web Vitals module. An average hides exactly the tail that CLS and INP exist to expose. A
vitals feature that can only show an average is materially weaker.

Four of the five vitals genuinely are durations anchored at the page's time origin. TTFB, FCP and LCP are
"time from navigation start until X". INP is the length of one interaction. Encoding them as spans with
real timestamps is honest about what they are, gives p75 through the existing pipeline with no ClickHouse
work, and renders as a readable waterfall in the trace view. Sentry does the same for LCP:
`startTime: timeOrigin, endTime: timeOrigin + entry.startTime`.

CLS is the exception. It is a unitless score, not a duration, and there is no honest way to put it on a
duration axis. It rides the container span as an attribute and is reported as an average. **p75 CLS needs
a dedicated t-digest column on the backend and is explicitly out of scope.**

## Architecture

Everything lives in `@flareapp/js`. Nothing is added to `@flareapp/react`, `@flareapp/vue`,
`@flareapp/svelte` or `@flareapp/sveltekit`.

That is the correct boundary rather than a shortcut. Vitals are a document-level browser concern, and
`startBrowserTracing()` is already called from the browser `Flare.configure()` override
(`packages/js/src/browser.ts:50`) the moment `enableTracing` flips on. All four framework packages sit on
that same singleton, so all four get vitals with no code and no config. The `/inject` entries used by
Electron renderers are untouched for the same reason.

New files:

- `packages/js/src/tracing/webVitals.ts` — collection, report trigger, span emission
- `packages/js/src/tracing/webvitals/` — the vendored Apache 2.0 fork

Changed files:

- `packages/js/src/tracing/browserTracing.ts` — start collection, emit on the existing teardown path,
  track the current route name for the emit
- `packages/js/src/tracing/spanTypes.ts` — two new `BrowserSpanType` values

## Lifecycle

When `startBrowserTracing()` creates the pageload root it also starts the observers and keeps a reference
to that root `Span` object. Collection is passive: each callback records the latest value into a
module-level record. Nothing is emitted until the report fires.

The report fires once, on whichever comes first:

- the page is hidden (`pagehide` or `visibilitychange`), or
- the first SPA navigation opens a new root.

After it fires the observers are torn down and no second report is possible.

### Two ordering rules

Both come from reading the existing code. Getting either wrong produces a bug that unit tests catch only
if they are written for it.

**The emit must run inside the existing teardown path, not from its own listener.**
`startBrowserTracing()` already registers `pagehide` and `visibilitychange` handlers that force-end the
root and then keepalive-flush (`browserTracing.ts:173-198`). A separate listener registered later fires
after that flush has already gone out, so the vitals spans sit in the buffer and die with the page.

**The emit must run after `controller.endNow()`, not before.** `IdleRootController.trimmedEnd()`
(`IdleRootController.ts:146`) takes `max(endFloor, settleTime, lastChildEndTime)`. If the vitals spans end
while the pageload root is still open, `lastChildEndTime` drags the root's end out to pagehide and every
fast-hidden page reports an inflated pageload duration. Ending the root first is safe: parenting needs
only the parent's ids and its recording flag, and `Tracer.resolveTrace()` does not care whether the parent
has ended.

So the order at page hide is: end the root, emit the vitals spans, flush.

### Sampling

Pass the actual pageload root `Span` as `parent`, not a bare `{ traceId, spanId }` pair. `resolveTrace()`
then reads `parent.isRecording` directly (`Tracer.ts:223`) instead of re-rolling the sampler, so an
unsampled page emits no vitals at all. A manually stitched id pair would re-run `resolveSampling()` and
could reach the opposite decision.

A late span on a finished trace still buffers correctly: `onSpanEnd()` (`Tracer.ts:326`) uses `rootEnded`
only to evict trace state, never to gate buffering.

### When there is no pageload root

If tracing started after the pageload window closed, or the document was already traced, no root exists
and no vitals are emitted. Navigations never carry vitals, see "Limitations".

## Wire format

### Container: `browser_page_vitals`

| Field  | Value                                                           |
| ------ | --------------------------------------------------------------- |
| name   | the route, copied from the pageload root at emit time           |
| parent | the pageload root's `traceId` and `spanId`                      |
| start  | the earlier of the pageload root's start and the earliest child |
| end    | the report moment                                               |

The container's start is a minimum, not simply the root's start.
`resolvePageloadStartNano()` (`navigationTiming.ts`) falls back to `now` when tracing began after the
final cap or the document was already traced, while the children are always anchored at
`performance.timeOrigin`. Taking the root's start unconditionally would produce children that begin
before their parent.

Attributes:

- `flare.span_type` = `browser_page_vitals`
- `flare.entry_point.handler.identifier` — the route
- `flare.route.source` — `route` or `url`
- the url keys from `collectBrowserSpanContext(config)`
- `flare.web_vital.cls` — number, **omitted entirely when unreported**

### Children: `browser_web_vital`

One per timing vital that reported, named `ttfb`, `fcp`, `lcp` or `inp`.

Attributes:

- `flare.span_type` = `browser_web_vital`
- `flare.web_vital.name` — `ttfb` | `fcp` | `lcp` | `inp`
- `flare.entry_point.handler.identifier` and `flare.route.source`

Times: origin to origin plus value for TTFB, FCP and LCP; interaction start to interaction start plus
value for INP.

The route attributes are repeated on every child rather than inherited. `AggregateSpanAction::execute()`
receives one `SpanRow` at a time and has no access to the parent, so an aggregator keyed on route can only
read what is on the span in front of it.

### Two details that are easy to get wrong

**The route must be read at emit time, not at root creation.** A framework router renames the root
afterwards through `applyRouteName()`, so a route captured at creation is the raw path, not the template.
The `Span` interface exposes no attribute getter, so `browserTracing.ts` must keep the current route name
and source in module state alongside the renaming it already performs.

**An unreported vital omits its key.** Never zero. A zero CLS from a Firefox user is indistinguishable
from a genuinely perfect page and would drag every route's average down. The backend must treat absent as
absent.

### Volume

Up to five extra spans per sampled page view, on top of the pageload root and its children. They inherit
the pageload trace's recording decision, so `tracesSampleRate` governs them.

## Backend changes

All in `~/srv/flareapp.io`, on top of `feat/performance-monitoring-js`. This section is written for
whoever picks up that side; nothing here is done by the client work.

### The one line that makes or breaks it

`app/Domain/Monitoring/Enums/SpanType.php:58-66`:

```php
public function isContainerSpanType(): bool
{
    return $this === self::PhpRequest
        || $this === self::PhpCommand
        || $this === self::LaravelJob
        || $this === self::BrowserPageload
        || $this === self::BrowserNavigation
        || $this === self::BrowserPageVitals;   // new
}
```

Without it, the vitals span arrives in its own batch, `findParentSpan()` returns null because the pageload
root was flushed earlier, and `FindContainerSpanAction::execute()` falls through to
`ReportProcessingFailureType::MissingContainer` (`FindContainerSpanAction.php:47`).

The report is still stored. `ProcessTraceScopeAction.php:56` returns early only on `MissingSpanEnd`, so a
`MissingContainer` report is written to ClickHouse regardless. What is lost is the container assignment:
the span lands with `container_span_id = null`, and `FindSpanLinksAction.php:34-38` then refuses to queue
the deferred link, because that branch requires both `isContainerSpanType()` and a non-null
`container_span_id`. The row exists and is never connected to anything.

With the line, `handleContainerSpan()` sets `container_span_id` to the span's own id, the missing parent
stops being a failure, and `FindSpanLinksAction` writes a `missing_span_links` row keyed on `trace_id` and
`parent_span_id`. `LinkMissingSpanLinksJob` retries it after 15 seconds, up to 6 attempts. That mechanism
was built for exactly this frontend-to-backend cross-batch join.

The `browser_web_vital` children arrive in the same batch as their container, so they resolve normally
through the recursive parent walk and need no special handling.

### The rest

1. **Two new `SpanType` cases**: `BrowserPageVitals = 'browser_page_vitals'` and
   `BrowserWebVital = 'browser_web_vital'`, plus the container line above.
2. **A `BrowserWebVitalsSpanAggregator`**, modelled on `BrowserPagesSpanAggregator`, keyed on route plus
   `flare.web_vital.name`. Registered in the `AggregateSpanAction` constructor list
   (`AggregateSpanAction.php:30-38`). **The container needs its own aggregation too, not just the
   children**: `FindSpanLinksAction.php:16-18` returns early on a null `span_aggregation_uuid`, so an
   unaggregated container never queues its deferred link.
3. **A `SpanAggregationType` case**, tagged `[browser]` in `technologies()`.
4. **CLS lifted from attribute into `statistics`** in `CalculateSpanStatisticsAction`, following the
   Livewire precedent in `appendLivewireComponentStatistics()`, which assigns values straight from
   attributes. Plus a `SpanStatistic` case. `sumMap` gives a total, so average CLS is sum over count.
5. **Migration** for the detail columns, and a frontend Web Vitals view.

### Severity

The deferred link is a nice-to-have. It powers the parent-to-child aggregation edge in the service map.
The vitals themselves aggregate correctly whether or not it ever resolves, because `AggregateSpanAction`
runs per span and does not depend on container assignment.

## Vendored fork

`packages/js/src/tracing/webvitals/`, with Apache 2.0 headers retained on each file and a README recording
the upstream version and commit, the way Sentry's fork does.

Upstream is five metric modules (~34 KB of TypeScript) plus ~21 `lib/` files (~33 KB). Sentry's trimmed
fork keeps around 17 lib files. Compressed the result is roughly 3 KB, but it is around 20 files of
third-party code that we own from then on, including the browser-quirk fixes upstream keeps shipping.

Dropped from upstream, because we report values once per pageload: bfcache, soft navigations, load state,
selectors, and the entire attribution build.

**The fork ships in every bundle**, including builds with `enableTracing: false`, if `webVitals.ts` is
imported statically by `browserTracing.ts`. Splitting it behind a dynamic import is possible but awkward
across the CJS and ESM outputs, so the ~3 KB is accepted.

## Browser support and limitations

From the `web-vitals` v5 README, verified rather than assumed:

- `onFCP`, `onLCP`, `onTTFB`, `onINP` — Chromium, Firefox, Safari
- `onCLS` — **Chromium only**
- Vitals for soft navigations — Chromium 151+

So CLS is absent for a meaningful share of real traffic. This is the reason absent vitals must omit their
key rather than send zero.

Two deliberate limitations, both matching Sentry:

- **No vitals on navigations, only on the initial pageload.** Soft-navigation vitals need Chromium 151+
  and upstream's `reportSoftNavs`, which the fork does not include.
- **No second report after a bfcache restore.** Sentry strips bfcache handling from their fork for the
  same reason.

## Electron

Electron renderers already start browser tracing. `RendererFlare extends BrowserFlare`
(`packages/electron/src/renderer/RendererFlare.ts:15`) and its `configure()` delegates to
`super.configure()`, so `enableTracing: true` in a renderer already calls `instrumentFetch()`,
`instrumentXHR()` and `startBrowserTracing()`. Vitals ride along with no new wiring.

**But traces cannot leave an Electron renderer today, and this feature does not change that.**
`RendererFlare` overrides `sendReport()` to push errors over the IPC bridge, because the renderer
deliberately holds no API key. It does not override the tracer's transport, and the IPC receiver exposes
exactly one channel, `onReport: (report: Report)` (`packages/electron/src/main/ipcReceiver.ts:9-13`).
There is no span or trace channel. Spans therefore flush through `SpanBuffer.flush()` → `Api.traces()` →
`fetch(ingestUrl)`, and `SpanBuffer.flush()` bails on `assertKey(config.key)`
(`packages/core/src/tracing/SpanBuffer.ts:54`). Every flush discards the buffer silently.

Tracing in an Electron renderer is currently a no-op that looks like it works. The `@flareapp/electron`
README does not mention tracing or spans at all, so this is undocumented rather than deliberate. It
predates this feature and applies equally to the fetch and XHR spans already shipping.

**Decision: no special handling.** Vitals behave in Electron exactly as fetch and XHR spans already do.
The cost is a few idle `PerformanceObserver`s in a process where the data cannot ship. Bridging traces
over IPC is the real fix and is separate work.

Three smaller notes for whoever picks that up:

- On a `file://` or custom-protocol origin, LCP, FCP, CLS and INP still measure correctly. TTFB becomes
  meaningless, since there is no network request to time.
- On app quit Electron can tear the renderer down without a clean unload, so the report trigger may never
  fire.
- The vendored fork ships in the renderer bundle regardless.

## Tests

Unit tests in `packages/js/tests/`, driving fake `PerformanceObserver` entries:

- the report fires once and only once
- both triggers work: page hide, and the first navigation
- an unsampled pageload emits nothing
- a vital that never reported omits its key rather than sending zero
- CLS lands on the container, timing vitals land as children with the expected start and end
- the route is read at emit time, so a router rename is reflected
- **the pageload root's end time is unaffected by the vitals spans** — the ordering rule above, which is
  the regression most likely to slip in

An e2e scenario in the playgrounds is possible, but LCP and CLS are timing-dependent under headless
Chromium. Keep any e2e assertion to the shape of the arriving span, never to its values.

## Out of scope

- Element attribution: LCP element, CLS sources, INP target. The namespace stays open for it.
- p75 CLS. Needs a t-digest column on the backend.
- Vitals on soft navigations.
- Bridging traces over IPC for Electron.
- Long tasks, long animation frames, resource timing spans and navigator connection info, all of which
  Sentry collects alongside vitals.
