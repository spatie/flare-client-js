# Browser Web Vitals — Design

Status: **SUPERSEDED on the encoding question. Do not implement from this document as it stands.**
Date: 2026-07-29
Branch: `browser-web-vitals` (implemented and reviewed, deliberately left unmerged)

## Retraction, 2026-07-30: the encoding is wrong

Scope decision 4 and the whole "Encoding: why timing vitals are spans" section below are retracted.
Everything else in this document still holds: the late-emit lifecycle, the ordering rules, the
sampling inheritance, the vendored fork and its limitations, and the `reportAllChanges` dependency.

**What went wrong.** The reasoning was: the backend can only compute percentiles from a t-digest over
span duration (`SpanAggregationMetricsQuery.php:210`) and only ever sums `statistics` (`:214`), so an
attribute-carried value can never yield p75, so the value has to be a duration. The first half is a
correct reading of the backend. The conclusion does not follow. It is an argument for adding a column
to a backend that is still an unmerged draft PR, not for bending the client's data model.

**What it produced.** Rendered in the real trace view, a 553 ms `browser_pageload` contained a
3,905 ms vitals container, with 712 / 580 / 137 ms children also overflowing it. The container's
duration was time origin to the report moment, which is dwell time on the page, not a performance
number. The children were origin-anchored with duration equal to the metric, and LCP and FCP land
after `loadEventEnd`, where the pageload root closes. A follow-up note in the plan already said
"p75 `browser_page_vitals` reads as p75 time-on-page" and nobody drew the visual consequence.

**What Sentry actually does**, from their docs rather than inference. The
[Web Vitals Module dev doc](https://develop.sentry.dev/sdk/telemetry/traces/modules/web-vitals/)
represents LCP, FCP, TTFB and CLS as measurements carrying the value, in `measurements.lcp`,
`measurements.fcp`, `measurements.ttfb` and `measurements.cls`, each with a unit, and states
plainly: **"No span timestamps involved."** INP is a measurement on an interaction span. Where their
newer mode does emit standalone spans, the value still travels in `browser.web_vital.<name>.value`
and the timestamps only place the span on the timeline: in `webVitalSpans.ts` the CLS span is emitted
with no end time, so `span.end(endTime ?? startTime)` gives it **zero duration**.

The principle: **span duration is for elapsed work. A vital's value belongs in an attribute.**

**Decision (Dries, 2026-07-30): stop and redesign the client and backend representation together**,
rather than guess a second time at what the aggregation can support. The branch stays unmerged with
its spans still emitted, as a working harness to design against. The next pass must cover the client
wire format, the `SpanType` cases and the container rule, the per-vital aggregation columns, and the
Web Vitals UI surface, as one design. Tasks 2 and 5 of the implementation plan are then re-cut.

Every claim about the Flare backend in this document was checked against the working copy at
`~/srv/flareapp.io`, branch `feat/performance-monitoring-js`, tip `aa76da879`. Claims about Sentry come
from reading `packages/browser-utils/src/metrics/` in `getsentry/sentry-javascript`, not from their docs.
Where the two disagree, the source wins and the disagreement is noted.

Reviewed 2026-07-29 against this repo at `dc79c4e` and the backend at the tip above. Every client and
backend claim below was re-checked against source. The CLS display-precision claim was checked against
the Lighthouse source and the `Intl.NumberFormat` spec defaults, cited where it is used. The Sentry
claims and the `web-vitals` v5 browser support table were not re-checked: neither package is present
locally and neither was fetched. Treat those as the only unverified statements in the document.

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

On the wire CLS stays a plain float attribute. The backend cannot store it as-is: the `statistics` map is
`Map(String, UInt64)`, so a score of 0.08 truncates to 0. It is scaled by 1000 on the way into storage and
unscaled on read, which is a backend concern and is specified under "Backend changes". The client sends
the real number.

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
  stop collection in `stopBrowserTracing()`, hold the pageload root's start time and route name for the
  emit
- `packages/js/src/tracing/spanTypes.ts` — two new `BrowserSpanType` values
- `.oxfmtrc.json` and `.oxlintrc.json` — ignore the vendored fork, see "Vendored fork"

`webVitals.ts` sits next to `componentProfiler.ts` and follows the same rule: every reference to the
tracer stays on the browserTracing side. The two differ on one point and it needs a comment, because they
look alike. `recordComponentSpan()` deliberately **drops** a span whose root is no longer the live
recording root. Vitals does the opposite: it writes to a root that has already ended, on purpose. Anyone
copying one into the other will get it wrong.

## Lifecycle

When `startBrowserTracing()` creates the pageload root it also starts the observers and keeps a reference
to that root `Span` object. Collection is passive: each callback records the latest value into a
module-level record. Nothing is emitted until the report fires.

That is only true for all five vitals because LCP, CLS and INP are subscribed with
`{ reportAllChanges: true }`. Upstream's `bindReporter` only calls back on a forced report otherwise
(`bindReporter.ts:40-42`), and those three only force-report from a bfcache restore or a soft-navigation
entry, neither of which this SDK uses. TTFB and FCP need no such option: they already force their one and
only report. Without it, the module-level record for LCP, CLS and INP would still be empty at the moment
of the more common trigger, a SPA navigation.

The report fires once, on whichever comes first:

- the page is hidden (`pagehide` or `visibilitychange`), or
- the first SPA navigation opens a new root.

After it fires the observers are torn down and no second report is possible.

### Teardown on disable

`stopBrowserTracing()` must tear the observers down too. It is a separate path from the pagehide one and
nothing else reaches it.

`configure({ enableTracing: false })` runs `super.configure()` first, which calls `_tracer.clear()`
(`Flare.ts:223`) and bumps the tracer epoch, and only then calls `stopBrowserTracing()`
(`browser.ts:51`). The stashed pageload root is stale from that moment on. Observers that survive the
disable still hold it, so a later re-enable followed by a page hide emits against a stale parent:
`resolveTrace()` drops it (`Tracer.ts:213`), the container becomes a fresh root with a new trace id and a
re-rolled sampling decision, and the backend accepts it as a parentless container. A floating vitals span
attached to no pageload.

`pageloadTraced` already guards this exact disable/re-enable path for the pageload root. Vitals needs its
own equivalent: drop the stashed root on stop, and refuse to emit without one.

### Ordering rules

Two rules, the second of which has to be applied in three separate places. All of it comes from reading
the existing code. Getting any of it wrong produces a bug that unit tests catch only if they are written
for it.

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

**The same rule applies to the navigation trigger, in two places.** Both navigation entry points already
end the old root and then open a new one: `onUrlChanged()` (`browserTracing.ts:115-116`) and
`registerNavigationSource().startNavigation()` (`browserTracing.ts:272-273`). The emit belongs between
those two calls, in both. It only bites when a navigation lands inside the pageload's idle window, since
after that the controller has already closed, but that is the same inflated-duration bug as above and it
is easy to wire the emit into one path and forget the other.

Emitting after the new root is open is not a correctness problem for that root: the vitals spans carry the
pageload trace id, and `IdleRootController` filters child events on trace id (`IdleRootController.ts:97`).
The risk is entirely to the root being closed.

### Sampling

Pass the actual pageload root `Span` as `parent`, not a bare `{ traceId, spanId }` pair. `resolveTrace()`
then reads `parent.isRecording` directly (`Tracer.ts:223`) instead of re-rolling the sampler, so an
unsampled page emits no vitals at all. A manually stitched id pair would re-run `resolveSampling()` and
could reach the opposite decision.

A late span on a finished trace still buffers correctly: `onSpanEnd()` (`Tracer.ts:326`) uses `rootEnded`
only to evict trace state, never to gate buffering.

Two consequences of that eviction, neither harmful, both worth knowing before reading a payload:

- By the time the emit runs, the pageload's `TraceState` is usually gone, so the container seeds a new
  one and counts as its local root. `Tracer.makeSpan()` (`Tracer.ts:299`) therefore stamps it with
  `getScopeAttributes()`, the same user and custom context a pageload root carries. That is extra payload
  on every sampled page view. Accepted, but it is a choice, not an accident.
- Seeding fresh state also resets `startedSpanCount`, so the vitals spans never hit `maxSpansPerTrace`.
  Irrelevant at five spans, but it means the cap does not protect this path.

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

**The root's start cannot be read back off the span.** The public `Span` interface
(`packages/core/src/types.ts:204-215`) exposes `endTimeUnixNano` and no start; only the concrete
`SpanImpl` carries `startTimeUnixNano`. Do not cast through the interface to get at it.
`startBrowserTracing()` already computes the value at `browserTracing.ts:136`, so stash it in module state
next to the root reference and hand both to the emit.

**The container's duration is dwell time, not a performance number.** It spans time origin to page hide,
so as a container span type it gets its own t-digest over that duration and p75 `browser_page_vitals`
reads as p75 time-on-page. That is a defensible metric, but it is not what the name suggests, and whoever
builds the frontend view needs to know before it shows up in a "slowest pages" list.

Attributes:

- `flare.span_type` = `browser_page_vitals`
- `flare.entry_point.handler.identifier` — the route
- `flare.route.source` — `route` or `url`
- the url keys from `collectBrowserSpanContext(config)`
- `flare.web_vital.cls` — the unscaled float as the browser reported it, **omitted entirely when
  unreported**. The backend scales it for storage, see "Backend changes"

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
The `Span` interface exposes no attribute getter, so `browserTracing.ts` must keep the route name and
source in module state alongside the renaming it already performs.

Anchor that state to the pageload root, not to "current". `applyRouteName()` renames whatever `currentRoot`
happens to be (`browserTracing.ts:228-247`), and `currentRoot` becomes the navigation root the moment one
opens. A plain "latest route wins" variable only produces the right answer because the emit happens to run
before the new root is named. That is an accident of ordering, not a property. Pin route updates to the
pageload root's identity, the way `resolveComponentParent()` already pins component context to a trace id.

**An unreported vital omits its key.** Never zero. A zero CLS from a Firefox user is indistinguishable
from a genuinely perfect page and would drag every route's average down. The backend must treat absent as
absent.

### Volume

Up to five extra spans per sampled page view, on top of the pageload root and its children. They inherit
the pageload trace's recording decision, so `tracesSampleRate` governs them.

Those five land in the keepalive envelope at page hide, which is capped at `keepaliveMaxBytes`
(60 KB default). `packForKeepalive()` (`SpanBuffer.ts:124-136`) walks the buffer newest first, so the
vitals get first claim on that budget and the older fetch and XHR children of the same pageload are the
first thing squeezed out. Unlikely to bite at these span sizes, but it is a new way for an existing page's
spans to go missing, and it only shows up under load.

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
`ReportProcessingFailureType::MissingContainer` (`FindContainerSpanAction.php:48`).

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
4. **CLS lifted from attribute into `statistics`** in `CalculateSpanStatisticsAction`, **multiplied by
   1000** on the way in and divided by 1000 on every read. `sumMap` gives a total, so average CLS is sum
   over count, then unscaled. It cannot be stored as the raw float, see below.
5. **Migration** for the detail columns, and a frontend Web Vitals view.

### Severity

The deferred link is a nice-to-have. It powers the parent-to-child aggregation edge in the service map.
The vitals themselves aggregate correctly whether or not it ever resolves, because `AggregateSpanAction`
runs per span and does not depend on container assignment.

### CLS is stored scaled by 1000

**Decision: the client sends the real float, the backend multiplies by 1000 on the way into
`statistics`, and every read divides by 1000.**

#### Why it cannot go in raw

The obvious route is the Livewire precedent in `appendLivewireComponentStatistics()`
(`CalculateSpanStatisticsAction.php:60-75`), which assigns values straight from attributes into
`$span->statistics`. That does not work for CLS. The column is:

```
statistics Map(String, UInt64)
```

(`database/migrations/2025_11_21_091623_better_spans.php:35`, and every aggregation materialized view
since.) The Livewire values are nanosecond timings, so they are already integers. CLS is a score between
roughly 0 and 1, and a typical good value is 0.05. Written into a `UInt64` map it truncates to 0. Every
CLS below 1.0 reads as zero, which is the exact failure the client's "omit, never send zero" rule exists
to prevent, arriving through the back door.

There is no float escape hatch in this schema. Every aggregation input column is an integer, including
the one that looks like a counterexample: `error_rate` is `AggregateFunction(avg, UInt8)` fed by
`avgState(failed)` on a 0/1 boolean, so ClickHouse produces the fraction from integer inputs. CLS cannot
borrow that shape, because it is a per-span fraction rather than a per-span boolean. Scaling is the only
option short of adding a column.

#### Why 1000

1000 gives three decimal places, which is exactly the precision Google's own tooling reports CLS at.
That is a hard cap in Lighthouse, not an observation. Its CLS audit formats the value as:

```js
displayValue: cumulativeLayoutShift.toLocaleString(context.settings.locale),
```

(`core/audits/metrics/cumulative-layout-shift.js`, checked 2026-07-29.) There is no `toFixed` and no
granularity option, so it inherits the `Intl.NumberFormat` default, where `maximumFractionDigits` for
plain decimal formatting is "the larger of `minimumFractionDigits` and 3", and `minimumFractionDigits`
defaults to 0. Three decimals, always. PageSpeed Insights runs Lighthouse, so it shows the same.

That makes 1000 the exactly-right factor rather than a safe guess. 10000 would store a digit no reference
tool displays. The four-decimal values on web.dev (`0.1875`) are the layout-shift-score arithmetic, not
the reported metric.

100 would also work for a two decimal display: the rounding error is bounded at 0.005 per span and
partly cancels across the sum, so the average stays right to two places. It loses one case. A site whose
CLS sits under 0.005 on every page view stores 0 on every row and averages to exactly 0.00,
indistinguishable from a page with no layout shift at all. That is invisible at two decimals and only
bites if the view ever shows three.

1000 removes that for nothing. A catastrophic CLS of 5.0 scales to 5000 per page view, so a billion page
views sums to 5×10¹² against a `UInt64` ceiling of 1.8×10¹⁹. Seven orders of magnitude of headroom.

#### Why the backend and not the client

The client keeps sending the real float on `flare.web_vital.cls`. Scaling is a storage concern, not a
wire-format one, and moving it to send time costs more than it saves:

- The raw span attribute is displayed. A CLS of 80 on a span reads as a catastrophically broken page.
- The factor becomes unchangeable. There is no version marker on the attribute, so old clients would keep
  sending the old scale forever and the column would hold two scales with no way to tell the rows apart.
  Backend-side it is one constant and a backfill that can be reasoned about.
- Third parties inherit the convention: `beforeSubmit` hooks, any OTLP export, and customers reading
  their own span payloads.
- It saves no work. `CalculateSpanStatisticsAction` already has to lift the attribute into `statistics`,
  so the multiply is one expression in code that is being written anyway.

#### Make the factor a constant

A comment is not enough. A mis-scaled CLS is a plausible-looking number, not a crash, so the failure is
silent. Name the factor once and have both the write path and every read path reference it, the same way
`BrowserSpanType` is the single source of truth for the wire strings rather than a literal repeated per
call site.

## Vendored fork

`packages/js/src/tracing/webvitals/`, with Apache 2.0 headers retained on each file and a README recording
the upstream version and commit, the way Sentry's fork does.

Upstream is five metric modules (~34 KB of TypeScript) plus ~21 `lib/` files (~33 KB). Sentry's trimmed
fork keeps around 17 lib files. Compressed the result is roughly 3 KB, but it is around 20 files of
third-party code that we own from then on, including the browser-quirk fixes upstream keeps shipping.

Dropped from upstream, because we report values once per pageload: bfcache, soft navigations, load state,
selectors, and the entire attribution build.

**Keep `metric.entries`.** INP is the one vital whose span needs a start timestamp of its own, taken from
the interaction's `PerformanceEventTiming`. Attribution normally surfaces that, and attribution is being
dropped, so confirm the trim leaves `metric.entries` intact before assuming the INP span can be placed on
the timeline at all. If it cannot, INP falls back to origin-anchored like the other three, or to an
attribute.

**Exclude the fork from lint and format.** `.oxfmtrc.json` currently ignores only `dist`, and the
pre-commit hook runs `oxlint --fix` plus `oxfmt` over everything staged. Without explicit ignore entries
in `.oxfmtrc.json` and `.oxlintrc.json`, the first commit reformats all ~20 upstream files and every
future sync with upstream becomes a diff fight against our own formatter.

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
(`packages/electron/src/renderer/RendererFlare.ts:14`) and its `configure()` delegates to
`super.configure()`, so `enableTracing: true` in a renderer already calls `instrumentFetch()`,
`instrumentXHR()` and `startBrowserTracing()`. Vitals ride along with no new wiring.

**But traces cannot leave an Electron renderer today, and this feature does not change that.**
`RendererFlare` overrides `sendReport()` to push errors over the IPC bridge, because the renderer
deliberately holds no API key. It does not override the tracer's transport, and the IPC receiver exposes
exactly one channel, `onReport: (report: Report)` (`packages/electron/src/main/ipcReceiver.ts:7-12`).
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
- the route reflects the pageload root, not a navigation root that opened before the emit
- **the pageload root's end time is unaffected by the vitals spans**, the ordering rule above, which is
  the regression most likely to slip in
- the same, on the navigation trigger: a navigation inside the idle window must not inflate the pageload
  root either, through `onUrlChanged` and through `startNavigation`
- `stopBrowserTracing()` stops collection, and a disable followed by a re-enable and a page hide emits
  nothing rather than a parentless container on a fresh trace

An e2e scenario in the playgrounds is possible, but LCP and CLS are timing-dependent under headless
Chromium. Keep any e2e assertion to the shape of the arriving span, never to its values.

## Out of scope

- Element attribution: LCP element, CLS sources, INP target. The namespace stays open for it.
- p75 CLS. Needs a t-digest column on the backend.
- Vitals on soft navigations.
- Bridging traces over IPC for Electron.
- Long tasks, long animation frames, resource timing spans and navigator connection info, all of which
  Sentry collects alongside vitals.
