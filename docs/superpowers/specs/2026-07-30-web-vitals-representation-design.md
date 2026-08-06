# Web Vitals Representation — Design (client + backend)

Status: ready for planning
Date: 2026-07-30

Supersedes the encoding half of `2026-07-29-browser-web-vitals-design.md`, which carries a retraction
block explaining why. Read that retraction first: it records the reasoning error this document exists
to correct. Everything in the older spec other than scope decision 4 and its "Encoding" section still
holds and is not repeated here.

**Two repositories, two branches.**

- Client: `flare-client-js`, existing branch `browser-web-vitals`. The feature is already implemented
  and reviewed there; this is a change to it, not a fresh build. The implementation tip is `c77786c`
  ("fix: collect LCP/CLS/INP mid-page and harden the vitals emit") — everything on the branch after it
  is documentation, including this file, so that hash stays correct as the spec is edited.
- Backend: `flareapp.io`, a **new branch cut off `feat/performance-monitoring-js`** (tip `44e2633d3`).
  **Do not commit the backend work directly onto `feat/performance-monitoring-js`.** That branch is
  the open browser-span-processing PR and must stay reviewable on its own.

Threshold constants below were read out of the vendored `web-vitals` source in this repo, not from
documentation, so the backend's colouring agrees with the client's own rating by construction.
ClickHouse schema claims were read from `~/srv/flareapp.io` migrations at the tip above.

**Every SQL statement and performance number in this document was executed against a live ClickHouse
26.1 instance**, not reasoned about. The DDL creates as written. Where a measurement is quoted, it came
from `system.query_log` on a 20M page-view dataset, and the layout it argues for was compared against
the alternatives rather than assumed. Three claims in the first draft did not survive that and are
marked as corrections in place rather than quietly edited out.

## Goal

Report the five Web Vitals per route, and show them at p75 against Google's thresholds, without
distorting either the trace waterfall or the client's data model.

```
Web Vitals                          (each cell carries its own sample count)
  Route            LCP      CLS      INP      FCP      TTFB
  /products        2.1s ●   0.08 ●   190 ●    1.2s ●   210 ●
                   n=1204   n=402    n=890    n=1204   n=1204
  /product/:id     4.3s ●   0.31 ●   620 ●    2.4s ●   890 ●
                   n=847    n=291    n=610    n=847    n=847

Trace view
  Page load - /product/p01                    553ms
    LCP 4.3s ●  CLS 0.31 ●  INP 620 ●              <- badges on the pageload row
    ├─ browser_fetch  GET /api/products/p01    88ms
    └─ React component - Layout                 6ms
```

## What the numbers mean

Worth stating plainly, because "p75" reads like something the SDK computes and it is not.

**The client never computes a percentile across users.** One page view produces one number per vital.
The percentile is a property of the population, computed by the backend over every page view of a
route in a range:

```
page view  ->  LCP 2140ms      one sample
page view  ->  LCP  890ms      one sample
page view  ->  LCP 4310ms      one sample
   ... 847 page views of /product/:id over 7 days ...

sort the 847 numbers, read the 636th   ->   p75 = 4.3s
```

So p75 LCP of 4.3s means 75% of real loads on real devices painted at or under 4.3s and 25% were
worse. It is not the typical load; the typical one is the median and will be markedly faster. This is
the opposite of a Lighthouse run, which is one simulated load on one simulated machine with no
distribution behind it.

**Two of the five are already aggregates within a single page view.** Read out of the vendored source,
not the documentation:

- **TTFB, FCP and LCP** are single measured moments. One page view, one event, one number.
- **CLS is a sum.** `LayoutShiftManager.ts:35-45` accumulates shift scores into a session window while
  each shift lands within 1000 ms of the previous and 5000 ms of the first, starting a new window
  otherwise. The reported value is the worst window's total, so one page view's CLS is already "the
  sum of the worst burst of layout instability on that page".
- **INP is itself a percentile, within the page view.** `InteractionManager.ts:74-99` keeps the ten
  longest interactions and reports the one at index `min(list.length - 1, floor(interactionCount / 50))`:
  the single worst interaction under 50 interactions, the second worst from 50, the third from 100.
  It approximates the 98th percentile of that user's own interactions on that page.

For INP the full stack is therefore p75, across page views, of an approximate p98, within each page
view. That is Google's definition rather than a mistake, but it is worth recording because
"INP 620 ms" reads like one slow click and is not.

**It is p75 across page views, not across users.** One person reloading a route fifty times on a fast
laptop contributes fifty samples and pulls its p75 down. That washes out on a high-traffic route and
does not on a quiet one, or during your own testing. This is normal for RUM and differs from Google's
CrUX, which weights differently. It is a further argument for the per-cell sample count.

**Percentiles do not average**, which is why the schema stores sketches. The p75 of Monday's p75 and
Tuesday's p75 is not the p75 of both days, and no arithmetic recovers it from those two numbers.
Hence `value_quantiles` holding an `AggregateFunction(quantilesTDigest(...))` rather than a number, and
the roll-up views merging digest states with `quantilesTDigestMergeState` rather than combining
results.

## Why the vitals travel as a span at all

Asked directly during design, and worth recording because the answer is "pragmatic", not "correct".

**For:**

- The transport, storage and query layers already exist: `Api.traces()`, `SpanBuffer` with its
  keepalive flush at page hide, the OTLP envelope, project scoping, TTL, and `spans_2` with a
  queryable attribute map. Emitting a vitals span costs no new plumbing on either side.
- **Trace linkage is a product feature, not a technicality.** `traceId` and `parentSpanId` let you go
  from "this route's p75 LCP is 4.3s" to the page load that produced it, with its fetches and
  component mounts. A pure metrics pipeline gives a number with nothing behind it. This is the
  strongest argument, and it is why Sentry's Web Vitals module works this way.
- Sampling, resource attributes and user context come along for free.

**Against:**

- A span means work that took time; a vital is a point-in-time measurement. Zero duration is honest
  about the value not being an interval, but it is still an event wearing a span's clothes. That
  mismatch is what produced the retracted encoding, and it is why the trace view has to special-case
  the type instead of just drawing it.
- Vitals inherit `tracesSampleRate` (see "Known limitations").
- Span-shaped storage is heavy for five floats: trace ids, four attribute maps, an events array.
- They compete for `maxSpansPerTrace`, the span buffer, and the 60 KB keepalive envelope.

**The alternative** is an OTLP metrics signal, which is the semantically correct model. Flare has
three ingest signals today (`ingestUrl`, `logsIngestUrl`, `tracesIngestUrl`) and no metrics one.
Adding a fourth is a platform decision an order of magnitude larger than this work, and it loses the
linkage unless it carries a trace id anyway, at which point it is a thin span again.

**What makes spans defensible is the hedge:** because the values live in attributes rather than in
the duration, the five numbers are already in the shape a metrics pipeline would want. Moving them
later is a transport change with the same keys and units, no client re-derivation and no backend
re-interpretation. The retracted encoding would have required decoding a lie to migrate.

## The contract

One span per page view.

**`browser_web_vitals`** replaces both `browser_page_vitals` and `browser_web_vital`. Neither ever
reached the backend enum, so there is no wire compatibility to preserve and no migration to write.

| Field             | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| `flare.span_type` | `browser_web_vitals`                                              |
| name              | the route                                                         |
| parent            | the pageload root's `traceId` and `spanId`                        |
| start, end        | **both the pageload root's start**, so the span has zero duration |

Attributes:

| Key                                    | Type             | Notes                            |
| -------------------------------------- | ---------------- | -------------------------------- |
| `flare.web_vital.lcp`                  | number, ms       |                                  |
| `flare.web_vital.fcp`                  | number, ms       |                                  |
| `flare.web_vital.ttfb`                 | number, ms       |                                  |
| `flare.web_vital.inp`                  | number, ms       |                                  |
| `flare.web_vital.cls`                  | number, unitless | raw float, never scaled          |
| `flare.entry_point.handler.identifier` | string           | the route                        |
| `flare.route.source`                   | string           | `route` or `url`                 |
| `url.full`, `flare.entry_point.value`  | string           | from `collectBrowserSpanContext` |

**Any vital the browser did not report omits its key entirely. Never zero.** CLS is Chromium-only, so
a zero from Firefox would be indistinguishable from a page with no layout shift.

### Why zero duration at the pageload's start, specifically

Not only so it cannot overflow its parent. `spans_2` buckets on `start_time_unix_nano`, so timestamping
at the report moment would drop a tab-left-open-for-forty-minutes page view into a minute forty minutes
after the page loaded. Bucketing at the pageload's start makes the Web Vitals time series line up with
when pages were actually loaded.

### No `.value` suffix

`flare.web_vital.lcp` and a future `flare.web_vital.lcp.element` are distinct keys in a flat map, so
element attribution can be added later without touching these.

### The ordering rule stops being load-bearing

A span ending at the root's own start can no longer push `IdleRootController.trimmedEnd()` outward, so
the emit-after-`endNow()` rule no longer holds back a bug. **Keep the ordering and its tests** as
insurance against a future timestamp change, but rewrite the justifying comment so nobody believes it
is still preventing the inflation it used to prevent.

## Client changes

All on `browser-web-vitals`. Mostly deletion.

- `packages/js/src/tracing/spanTypes.ts` — one type where there were two.
- `packages/js/src/tracing/webVitals.ts` — `buildVitalsSpanPlan` becomes `buildVitalsSpan`: no
  children, no start-floor or end-ceiling clamps, five optional attributes and a route. The clamp
  tests go with them.
- `packages/js/src/tracing/browserTracing.ts` — `emitWebVitals` creates one span and ends it at the
  same timestamp. The container-ends-last rule and its scope-attribute reasoning disappear with the
  children, and the `finally` / `restoreWebVitals` failure handling simplifies because there is no
  partial-emit state left to strand.

**Untouched and still required:** the late-emit lifecycle and its three call sites, sampling
inheritance by passing the parent `Span` object, route and context pinning to the pageload root, the
vendored fork, and `{ reportAllChanges: true }` on `onLCP`/`onCLS`/`onINP`. That last one is not
optional: without it upstream's `bindReporter` only fires on a forced report, and a
navigation-triggered emit ships TTFB and FCP alone.

## Backend

On a new branch off `feat/performance-monitoring-js`.

### The enum, and deliberately nothing else in the aggregation machinery

```php
case BrowserWebVitals = 'browser_web_vitals';
```

**Do not add it to `isContainerSpanType()`.** Add a new predicate instead:

```php
public function isDetachedSpanType(): bool
{
    return $this === self::BrowserWebVitals;
}
```

and check it in `FindContainerSpanAction::execute()`, immediately before the `MissingContainer`
fallthrough and _after_ the parent lookup:

```php
if ($parentSpan = $report->findParentSpan($span)) {
    $this->execute($report, $parentSpan);
    $span->container_span_id = $parentSpan->container_span_id;

    return;
}

if ($span->type->isDetachedSpanType()) {
    return; // no container, and that is fine
}

$report->reportProcessingFailure = ReportProcessingFailureType::MissingContainer;
```

The problem being solved is real: a vitals span that arrives late, alone, finds no parent in the
batch and flags the whole report `MissingContainer`. But `isContainerSpanType()` is the wrong lever,
for two reasons found by reading the call graph rather than the name.

1. **Its branch runs before the parent lookup.** So it does not only rescue the late arrival, it
   changes the common case too: a vitals span in the _same_ batch as its pageload would stop
   inheriting the pageload's `container_span_id` and become its own container.
2. **`spans_container_cache_mv` selects `WHERE container_span_id != ''` and groups by it.** A vitals
   span that is its own container therefore writes its own row — a container with zero children, one
   per page view, roughly doubling that table's rows for JS projects.

Neither is catastrophic. `spans_container_cache` has a 30-minute TTL, so the phantom rows are a
rolling window rather than growth, and `FetchContainerSpansViaCacheAction` discards them anyway
(it keeps only rows with a non-empty `span_aggregation_type`, which a vitals span never has). The
reason to use the detached predicate is not damage control, it is that the container claim is false
and cheap to avoid. Code added later will read `isContainerSpanType()` and believe it.

The detached version is also better behaved on both paths: same batch, the span inherits the
pageload's container correctly; late arrival, it exits without a failure flag and stays out of the
container cache entirely.

Checked and unaffected either way: `ModifyContainerSpanStartTimesAction` will not rewrite the
timestamps (it only touches spans with a `PhpApplication` ancestor, which a browser trace has not),
`span_aggregation_traces_from_spans_mv` excludes the span via its empty aggregation hash, and
`SpanRepository::findForTrace` filters on `trace_id`, not `container_span_id`, so the trace-view
annotation finds the span regardless of which choice is made.

No `SpanAggregationType` case and no aggregator: Web Vitals has its own table. The consequence,
accepted knowingly: with a null `span_aggregation_uuid`, `FindSpanLinksAction` returns early and writes
no `missing_span_links` row, so there is no service-map edge. None is wanted; drill-down uses
`trace_id` and `parent_span_id`.

### Why a dedicated table rather than columns on `span_aggregation_metrics`

One reason, and it is sufficient: five `AggregateFunction` columns on the shared hot metrics table
would be empty for every PHP aggregation row, across three roll-up tables and their views.

> **Retracted, because it is false.** An earlier draft gave a second reason: "the existing t-digest
> has no p75, its state is parameterised `(0.5, 0.9, 0.95, 0.99)`". Those levels are only the
> defaults applied at _finalize_. The stored state is the complete sketch, and any quantile can be
> read back from it at merge time. Verified against ClickHouse 26.1 on a state declared with exactly
> those levels:
>
> ```
> quantilesTDigestMerge(0.75)(q)  ->  [749.5]     -- values 0..999, exact answer 749.25
> ```
>
> So p75 _is_ available from the existing column. The dedicated table is still right, on the column-
> sparsity reason alone. This is recorded rather than deleted so the decision is not reopened on the
> strength of a premise that does not hold.

The enabling fact, and the one that dissolves the retracted design's premise:
`spans_2.attributes` is `Map(LowCardinality(String), String)`, so a view can build a t-digest from
`toFloat64OrNull(attributes['flare.web_vital.lcp'])`. "Percentiles only work over duration" was a
property of `span_aggregation_metrics_mv`, never a platform limit.

### Schema

```sql
CREATE TABLE web_vital_metrics (
    project_id      UInt32,
    route           String,
    route_source    LowCardinality(String),
    vital           LowCardinality(String),
    date            DateTime,
    value_quantiles AggregateFunction(quantilesTDigest(0.5, 0.75, 0.90, 0.95), Float64),
    count           AggregateFunction(count)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(date)
ORDER BY (project_id, route, route_source, vital, date)
```

One row per route per vital, long rather than wide.

### Partition daily, not monthly

`toYYYYMMDD(date)`, matching `spans_2`. An earlier draft used `toYYYYMM(date)`, which is actively
harmful: with a 30-day TTL the whole table is one or two monthly partitions, so partition pruning
does nothing, and because `date` is the last sort key it cannot be used for index pruning either
once `route` is unconstrained. Every query then reads the project's entire retention.

Measured on ClickHouse 26.1, 20M page views across 20 projects and 150 routes over 30 days, querying
one project on the minute table:

| Layout                           | Storage     | 1-hour query    | 1-day query     | 7-day query     |
| -------------------------------- | ----------- | --------------- | --------------- | --------------- |
| Monthly partition, `date` last   | 549 MiB     | 30 ms / 606 MiB | 29 ms / 617 MiB | 33 ms / 694 MiB |
| **Daily partition, `date` last** | **474 MiB** | 10 ms / 24 MiB  | 12 ms / 24 MiB  | 36 ms / 171 MiB |
| Daily partition, `date` early    | 587 MiB     | 6 ms / 2.7 MiB  | 15 ms / 24 MiB  | 34 ms / 171 MiB |

Daily partitioning is smaller on disk _and_ reads 25x less. It is strictly better; take it.

Moving `date` earlier in the `ORDER BY` buys sub-day pruning on top, at 24% more storage and at the
cost of diverging from the `span_aggregation_metrics` key shape. Not worth it unless the page grows a
sub-day range selector. Revisit then, not now.

### Long, not wide — settled

Long. But not for the reason the earlier draft gave, and the performance argument in it was wrong in
both directions.

**Performance does not decide this.** Both formats were built at the scale above from identical source
data and measured:

|                     | Rows  | Compressed | 5-vital page query | Single-vital query |
| ------------------- | ----- | ---------- | ------------------ | ------------------ |
| Long, minute table  | 87.4M | 549 MiB    | 36 ms              | 23 ms              |
| Wide, minute table  | 18.5M | 440 MiB    | 31 ms              | 12 ms              |
| Long, daily roll-up | 450k  | 273 MiB    | **42 ms**          | 30 ms              |
| Wide, daily roll-up | 90k   | 261 MiB    | 54 ms              | **14 ms**          |

Long carries 4.7x the rows but almost the same bytes, because the t-digest states dominate and are the
same measurements either way: 347 MiB of state in long against 339 MiB in wide. The whole difference is
repeated key columns, which compress well, and at the daily roll-up the gap closes to 5%. Each format
wins something — wide wins single-vital queries, long wins the five-vital page query on the daily
roll-up, which is the one this page actually runs.

**Two claims from the earlier draft are corrected.**

- _"At the cost of the page query pivoting five rows into one display row"_ overstated a non-issue.
  `quantilesTDigestMergeIf(0.75)(value_quantiles, vital = 'lcp')` works, and costs about 1 ms over the
  unpivoted form. The pivot is free.
- _"Adding a sixth vital never needs a migration"_ is too strong. The view hardcodes the five-element
  array, so a sixth vital needs `ALTER TABLE web_vital_metrics_mv MODIFY QUERY`. Verified: the swap
  succeeds and a sixth vital flows through immediately, with the table, both roll-up tables and both
  roll-up views untouched and no backfill. Wide would need `ADD COLUMN` twice across three tables plus
  three view rewrites. Say "one view swap, no table change" — still decisively the better story.

What survives intact is the reasoning that prompted the question: wide needs a **sample count per
vital as well**, not one per route. A Firefox page view contributes LCP, FCP, TTFB and INP but no CLS,
so a single `count` would mean "page views", not "CLS samples", and the page must show per-cell counts
precisely because CLS coverage is materially lower. Long gets per-vital counts for free from its
grouping. That, plus the one-view-swap migration story, is the case for long. Schema flexibility, not
speed.

**`route_source` belongs in the `ORDER BY`, not only in the column list.** An `AggregatingMergeTree`
merges rows by its sorting key, so a column that is grouped in the view but absent from the key would
have one of its values picked arbitrarily at merge time. It is in the view's `GROUP BY` below, so it
has to be in the key here.

Retention matches the existing `span_aggregation_metrics` tables, so aggregated browser metrics expire
on one policy rather than two. Read at the tip: all three of them — minute, hourly and daily — carry
`TTL toDate(date) + toIntervalDay(30)`. Two things follow that are worth stating rather than
discovering:

- **The roll-ups buy query speed, not history.** All three expire at 30 days, so the daily table does
  not extend the range the page can show. Nobody should expect a year of vitals from it.
- **None of the existing tables declares `PARTITION BY` at all.** So the daily partitioning above is a
  deliberate departure from that pattern, not a copy of it. It is the one place this schema should not
  mirror `span_aggregation_metrics`, for the reasons measured above.

`spans_2`'s own 30-day TTL is separate and unaffected, and it is why the raw span behind a p75
disappears before the p75 does.

```sql
CREATE MATERIALIZED VIEW web_vital_metrics_mv TO web_vital_metrics
AS SELECT
    project_id,
    attributes['flare.entry_point.handler.identifier'] AS route,
    attributes['flare.route.source']                   AS route_source,
    measurement.1                                      AS vital,
    toStartOfMinute(fromUnixTimestamp64Nano(start_time_unix_nano)) AS date,
    quantilesTDigestState(0.5, 0.75, 0.90, 0.95)(assumeNotNull(measurement.2)) AS value_quantiles,
    countState()                                       AS count
FROM spans_2
ARRAY JOIN [
    ('lcp',  toFloat64OrNull(attributes['flare.web_vital.lcp'])),
    ('cls',  toFloat64OrNull(attributes['flare.web_vital.cls'])),
    ('inp',  toFloat64OrNull(attributes['flare.web_vital.inp'])),
    ('fcp',  toFloat64OrNull(attributes['flare.web_vital.fcp'])),
    ('ttfb', toFloat64OrNull(attributes['flare.web_vital.ttfb']))
] AS measurement
WHERE type = 'browser_web_vitals'
  AND route_source = 'route'
  AND measurement.2 IS NOT NULL
GROUP BY project_id, route, route_source, vital, date
```

**`assumeNotNull` is required, not stylistic.** Without it the view does not create at all:

```
Code: 70. DB::Exception: Conversion from
AggregateFunction(quantilesTDigest(0.5, 0.75, 0.9, 0.95), Nullable(Float64)) to
AggregateFunction(quantilesTDigest(0.5, 0.75, 0.9, 0.95), Float64) is not supported
```

`toFloat64OrNull` returns `Nullable(Float64)` and that nullability propagates into the aggregate
state's type signature. The `WHERE` does not strip it, because the column type is fixed before the
filter runs. Wrapping in `assumeNotNull` is safe precisely because the `WHERE` has already dropped the
NULLs. The corrected view was verified to create and aggregate correctly on ClickHouse 26.1.

**The client's "absent, never zero" rule survives end to end without extra code.** A missing key reads
as `''`, `toFloat64OrNull` yields `NULL`, and the `WHERE` drops that row. Verified end to end: a
Firefox-shaped span with no CLS key produced one CLS sample against two for every other vital, with no
special handling anywhere.

### Why the view is gated on `route_source = 'route'`

`route` is unbounded when it is not a real route name. `browserTracing.ts:74` starts every root with
`'flare.route.source': 'url'` and a name of `location.pathname`; only a registered router integration
renames it. Without one, `route` is the raw path, so `/product/p01`, `/product/p02` and so on each
become their own aggregate key — and `route` is the second element of the sorting key.

Cardinality is the lesser problem. **The real one is PII.** `redactUrlQuery` cleans the query string
only; it returns early when the URL has no `?`, so path segments are never touched. A path like
`/reset-password/eyJhbGciOiJIUzI1NiJ9…` or `/invite/someone@example.com` would land verbatim in
`route`, which is an aggregate key on a 30-day retention — outliving the raw span in `spans_2`.

The gate is one condition and it fails safe. URL-sourced page views still land in `spans_2` and still
appear in the trace view; they just do not create metric rows. A project with no router integration
sees an empty Web Vitals page telling it to connect one, which is better than a page of thousands of
single-sample rows keyed on someone's password-reset token.

Do **not** solve this in the SDK with heuristic path normalization. The client cannot tell
`/product/p01` from `/blog/why-clickhouse-is-fast` without a route table, and a wrong guess shipped
into a customer's browser cannot be re-run; a server-side rule can. The SDK's job here is the honest
`flare.route.source` label, which it already does. Sentry reached the same split: Relay strips ids and
hashes on ingest and a clusterer discovers rules from observed traffic, while the client-side story is
router integrations. See "Follow-ups" for serving the ungated projects properly.

Plus minute → hour → day roll-up tables and views mirroring the existing `span_aggregation_metrics`
pattern (`web_vital_metrics` → `_hourly` → `_daily`, each roll-up view reading the tier below it and
merging with `quantilesTDigestMergeState`), so long-range queries do not scan minutes. The roll-up
views are vital-agnostic: they group by `vital` and never name one, which is why a sixth vital touches
only the ingest view.

Create all three tiers in the same migration. A materialized view is an insert trigger and does not
backfill, so a roll-up added after the minute table has been taking traffic starts empty and stays
blind to everything already ingested.

### PHP layer

A `WebVital` enum holding each vital's name, unit and threshold pair, and a repository returning p75
and sample count per route per vital over a range.

**p75 is approximate and not perfectly stable.** ClickHouse's own documentation says of
`quantileTDigest`: "The result depends on the order of running the query, and is nondeterministic."
Two identical page loads can therefore show p75 values that differ slightly. That is fine for the
product, but the number should not be presented with more precision than it has — round to the same
resolution the thresholds use, and do not build anything that asserts exact equality on it.

| Vital | good ≤  | poor >  | read from      |
| ----- | ------- | ------- | -------------- |
| LCP   | 2500 ms | 4000 ms | `onLCP.ts:37`  |
| CLS   | 0.1     | 0.25    | `onCLS.ts:36`  |
| INP   | 200 ms  | 500 ms  | `onINP.ts:37`  |
| FCP   | 1800 ms | 3000 ms | `onFCP.ts:31`  |
| TTFB  | 800 ms  | 1800 ms | `onTTFB.ts:28` |

Rating rule, matching `bindReporter.ts:26-30`: above the second value is poor, above the first is
needs-improvement, otherwise good.

## Surfaces

### Web Vitals page

In the monitoring nav for JS projects. One row per route, five p75 columns each coloured against its
thresholds, plus a **sample count**, so a route with nine page views is visibly not evidence.

### Trace-view annotation

When rendering a trace, the `browser_web_vitals` span whose `parentSpanId` matches a pageload span is
**not drawn as a waterfall row**. Its attributes render as badges on that pageload's row.

**The badges carry a label and a colour. They are not positioned on the timeline.** Three reasons,
recorded so the bug is not reintroduced:

1. Only three of five have a meaningful moment. TTFB, FCP and LCP are measured from navigation start,
   so their moment is derivable; CLS has no single moment, and INP's is the interaction, which this
   design deliberately stops sending.
2. The one you would most want to place is the one that does not fit: LCP routinely lands after
   `loadEventEnd`, where the pageload root closes.
3. The trace view scales its axis to the **root span**, not the trace extent. Observed in the
   screenshot that prompted this redesign: the axis ran 0 to 553 ms matching the page load exactly,
   while a 3,905 ms row clipped at full width. Anything past the root is unrepresentable on that axis.

Timeline placement would need an explicit per-vital timestamp on the wire and a decision about axis
scaling. It is out of scope, not deferred-by-accident.

## Sequencing

One spec, two implementation plans, because the repositories release independently and a single plan
cannot be executed as one unit.

1. **Client first.** It is small and mostly deletion, and it is what makes real
   `browser_web_vitals` spans exist to develop the backend against. Until it lands, the backend has
   nothing to ingest but hand-written fixtures.
2. **Backend enum second, on its own.** Two lines. Once `isContainerSpanType()` knows the type, spans
   from the playground stop reading `Unknown` and start landing correctly, which is the fastest way to
   confirm the contract end to end before any storage work.
3. **Storage and aggregation third**, then the two surfaces.

**Both surfaces are in the first cut.** The trace-view annotation is not a follow-up. Without it the
vitals span keeps rendering as a stray row in the waterfall, which is the defect that prompted this
redesign, so shipping the Web Vitals page alone would leave the visible problem in place while adding
a second thing to look at.

The order matters for one non-obvious reason: steps 1 and 2 together are enough to see real data in
`spans_2` and to sanity-check the attribute keys and the zero-duration timestamping against a real
browser. Getting that wrong after the materialized views are written means rewriting views, which is
more expensive than rewriting a client attribute name.

Nothing here blocks merging the client branch: a `browser_web_vitals` span with no backend support is
stored as `SpanType::Unknown` and ignored, exactly as today.

## Known limitations

- **Vitals inherit `tracesSampleRate`.** The default is `1`, so every page view reports out of the
  box, but a customer who lowers it to control trace volume reduces vitals volume proportionally.
  Accepted: a sampled-out page view has no trace to attach vitals to. Revisit if a customer samples
  traces hard and needs full vitals coverage.
- **No vitals on SPA navigations, only the initial pageload.** Unchanged from the previous spec.
- **No second report after a bfcache restore.** Unchanged.
- **No element attribution.** The attribute namespace is left open for it.
- **CLS is Chromium-only**, so its sample count will be materially lower than the other four. The page
  must show per-vital sample counts rather than one per route, or CLS coverage will read as a bug.
- **No vitals for projects without a router integration.** The consequence of the
  `route_source = 'route'` gate. Those page views still produce spans and still appear in the trace
  view; they produce no metric rows. The Web Vitals page must say so explicitly rather than render an
  empty table, or it reads as a broken feature. See "Follow-ups".
- **p75 wobbles.** `quantilesTDigest` is documented as nondeterministic across query runs.

## Testing

**Client:** the existing suite minus the child-span and clamp assertions. Keep the real-observer
regression test that pins `reportAllChanges`, which is the one that caught the collector shipping two
of five vitals.

**Backend:** a test that feeds a `browser_web_vitals` span with a partial attribute set through
ingestion and asserts the view produces rows only for the vitals present, which is the "absent, never
zero" invariant at the storage layer. Plus three more, each pinning a decision made above rather than
an implementation detail:

- A `browser_web_vitals` span whose parent is absent from the batch must not flag the report
  `MissingContainer`.
- A `browser_web_vitals` span whose parent **is** in the batch must inherit the pageload's
  `container_span_id`, not its own. This is the assertion that fails if someone later "simplifies" the
  detached predicate back into `isContainerSpanType()`.
- A span carrying `flare.route.source = 'url'` must produce **no** rows in `web_vital_metrics`. This is
  the PII gate; it should fail loudly if the condition is ever dropped from the view.

**End to end:** the vendored fork producing real numbers in a real browser is still unproven by any
automated test. The react-router playground at port 5185 already has `enableTracing: true` and
`tracesSampleRate: 1`, so it is the harness.

## Follow-ups

Not in this cut, but created as issues alongside it.

- **Serve projects that have no router integration.** The `route_source = 'route'` gate leaves them
  with an empty page. The fix is server-side path normalization on ingest, in the shape Sentry's Relay
  uses: strip UUIDs, integer ids and hashes from path segments, then discover replacement rules from a
  sample of observed traffic. Server-side because a rule can be re-run over history and a heuristic
  shipped into a browser cannot. Explicitly _not_ an SDK change.
- **A per-project route cardinality cap** with an `other` bucket, if normalization proves insufficient.
- **An SDK hook letting users supply their own route normalizer**, for people on a router Flare does
  not integrate with. An escape hatch, not a heuristic imposed by default.

## Out of scope

- An OTLP metrics signal for Flare. Recorded above as the correct long-term model.
- Timeline placement of vitals badges.
- Element attribution for LCP, CLS and INP.
- A composite performance score. Considered and dropped: the weighting is an opinion to defend, and it
  hides which vital is bad until you read the columns anyway.
- **Pre-existing, worth its own issue:** the trace view's axis scales to the root span, so any span
  outliving its root clips at full width. A `browser_fetch` that outlives the pageload root does this
  today. Not introduced by this work.
- **Pre-existing, worth its own issue:** oxlint's `ignorePatterns` is not inherited through `extends`,
  so the repo's root `dist` ignore has never worked for any package with its own config.
