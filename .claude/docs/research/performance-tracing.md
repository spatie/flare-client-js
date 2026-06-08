# Research: Performance Monitoring & Tracing for the Flare JS clients

Status: research only. No implementation decisions are final. Date: 2026-06-05. Branch: `research/performance-tracing`.

This document gathers everything needed to design frontend performance monitoring and distributed tracing for
`@flareapp/*`. It is sourced from four places: the Flare backend (`/Users/driesheyninck/srv/flareapp.io`), the existing
`flare-client-php` + `flare-daemon`, the Sentry JavaScript SDK, and the relevant web standards / framework docs. Every
significant claim is cited to a file path, a spec URL, or a docs page. Where something could not be verified, it is
flagged explicitly in-line and collected under "Open questions" at the end of each section.

The headline finding: **most of the hard contracts already exist.** The Flare backend already ingests OpenTelemetry
(OTLP/JSON) spans at `POST /v1/traces`. The PHP client already implements a full tracing model (spans, span events,
status, W3C trace IDs, `traceparent` generation and parsing). The JS `@flareapp/core` already has an OTel logging
pipeline (envelope builder, attribute serializer, batching, flushing, keepalive) that is structurally identical to what
a traces pipeline needs. This means the JS work is largely about (a) porting a known data model, (b) adding browser
instrumentation, and (c) deciding the correlation story, rather than inventing a backend contract.

---

## 1. Executive summary

### What we want (restating the brief)

1. Intercept all outgoing requests, emit spans to Flare, and link a frontend request to the backend request it
   triggered via a correlation ID.
2. Rendering-performance insight for React, Vue, Svelte.
3. Interop with react-router, TanStack Router, vue-router, SvelteKit (pageload + navigation traces).

### What the research establishes

- **Wire format is settled: OTLP/JSON.** The backend ingress validates an OTLP-shaped JSON body
  (`resourceSpans -> scopeSpans -> spans`) at `POST /v1/traces` with an `x-api-token` header. The PHP client already
  produces exactly this. The JS client should produce byte-compatible payloads.
  Source: `flareapp.io/app/Http/Api/Controllers/Ingress/Local/LocalTraceIngressController.php`,
  `app/Domain/Monitoring/Actions/PerformanceReport/`, and
  `flare-client-php/src/Exporters/OpenTelemetryJsonExporter.php`.

- **Correlation mechanism is settled at the standard layer: W3C `traceparent`.** The PHP/Laravel integration already
  reads an inbound `traceparent` request header and continues that trace
  (`vendor/spatie/laravel-flare/src/FlareServiceProvider.php:197`). So the browser SDK injecting
  `traceparent: 00-<traceId>-<spanId>-<flags>` on outgoing requests is sufficient for the existing backend to stitch
  the trace. **Caveat:** the backend itself does not parse `traceparent`; it relies on the SDKs to put matching
  `traceId`/`spanId`/`parentSpanId` into the OTLP spans each side emits. See §4 and §6.

- **The JS core already has the plumbing.** `@flareapp/core/src/logging/` is a working OTel envelope + batch + flush +
  keepalive pipeline. A `tracing/` sibling can reuse the same attribute serializer (`logging/otel.ts`) verbatim and the
  same flush strategy. See §5.

- **Rendering perf should be layered: native `PerformanceObserver` base + framework hooks as enrichment.** Framework
  render-timing APIs are uneven (React `<Profiler>` has production caveats, Vue's is dev-only, Svelte has none). The
  reliable foundation is the browser Performance API + Google's `web-vitals` library. See §7.

- **Router interop has a clear per-router pattern** for pageload vs navigation and for extracting a _parameterized_
  route name (needed so the backend's `SpanAggregators` can group). See §8.

### Biggest open risk (flagged loudly)

**There is no JS/browser span taxonomy on the backend yet.** Flare's backend aggregates spans by a `flare.span_type`
attribute, and every existing `SpanType` value plus every `SpanAggregator` is PHP/Laravel-flavored
(`php_request`, `php_query`, ...). A browser span emitting an unknown `flare.span_type` lands as `SpanType::Unknown`
and is **not picked up by any existing aggregator**, so it would store but not surface in the performance UI. New
backend enum cases + aggregators (e.g. for pageloads, navigations, fetch spans) are required to make JS performance
visible. This is a backend coordination dependency, not something the JS client can solve alone.
Source: `flareapp.io/app/Domain/Monitoring/Enums/SpanType.php`, `app/Domain/Monitoring/SpanAggregators/`,
`app/Domain/Monitoring/Actions/PerformanceReport/ProcessSpanAction.php:38`.

### Also unresolved: the production ingress path

In production, `POST /v1/traces` is fronted by a Cloudflare worker. The Laravel `TraceIngressController` does **not**
receive raw OTLP in prod; it receives a `{files, api_key, ip}` envelope from the worker, authed with a Cloudflare shared
secret, and the raw OTLP body is staged to object storage upstream. The raw-OTLP inline path
(`LocalTraceIngressController`) only runs in local/testing. We could not find the Cloudflare worker source in the repo,
so it is unverified whether a browser POSTs raw OTLP that the worker intercepts, or whether a different public ingress
host is involved. **This must be confirmed before implementation.**
Source: `flareapp.io/routes/ingress.php`,
`app/Http/Api/Controllers/Ingress/TraceIngressController.php:16-38`.

---

## 2. The Flare backend: how tracing/performance already works

Researched from the local checkout at `/Users/driesheyninck/srv/flareapp.io`.

### 2.1 Ingestion endpoint and auth

- Routes: `POST v1/traces` (alongside `v1/errors`, and locally `v1/logs`) on a dedicated ingress domain
  (`ingress.flareapp.io` prod, `ingress-staging.flareapp.io` staging). `routes/ingress.php:12-31`.
- Throttle: `throttle:trace-ingress` (the generic `throttle:api` is explicitly removed). Limiter defined at
  `app/Providers/RouteServiceProvider.php:200` (exact rate values not read — flagged).
- Auth header: `x-api-token` carries the customer's project key, read by `ApiKey::fromRequest`
  (`app/Domain/Project/Support/ApiKey.php:34-43`), with a `key` body field as fallback.
- Local/testing controller validates and processes inline; production controller expects a Cloudflare-worker envelope
  (see §1, "production ingress path"). `LocalTraceIngressController.php:14-32`, `TraceIngressController.php:16-38`.

### 2.2 Wire payload: OTLP/JSON

The authoritative contract is `app/.../PerformanceReport/.../ValidateTraceIngressPayloadAction.php`. It validates an
OTLP/JSON envelope with camelCase field names:

```
{
  "resourceSpans": [{
    "resource":   { "attributes": [...], "droppedAttributesCount": int },
    "scopeSpans": [{
      "scope": { "name": str, "version": str|num, "attributes": [...], "droppedAttributesCount": int },
      "spans": [{
        "traceId": str, "spanId": str, "parentSpanId": str|null,
        "name": str,
        "startTimeUnixNano": int, "endTimeUnixNano": int,
        "status": { "code": int, "message": str|null },
        "attributes": [...], "droppedAttributesCount": int,
        "events": [{ "name": str, "timeUnixNano": int, "attributes": [...], "droppedAttributesCount": int }],
        "droppedEventsCount": int
      }]
    }]
  }]
}
```

Key validation rules (`ValidateTraceIngressPayloadAction.php`):

- `traceId`/`spanId`/`name` required non-empty strings; `parentSpanId` string or null.
- `startTimeUnixNano`/`endTimeUnixNano` must be JSON **integers** (lines ~166-180). Note: this is a tension with
  JavaScript, where nanosecond integers exceed `Number.MAX_SAFE_INTEGER` (2^53). The PHP path sends real integers; a JS
  client emitting nanos as JSON numbers risks precision loss, and OTLP/JSON convention is actually to send 64-bit ints
  as **strings**. **Flagged conflict** — confirm whether the validator accepts numeric strings for the time fields, or
  whether it strictly requires JSON integers. If strict, the JS client cannot use the OTLP/JSON string convention and
  must send numbers (capped precision) — a real design constraint. (Unverified; needs a backend check or a test POST.)
- Attributes use **OTLP AnyValue encoding**, not plain maps: each is
  `{"key": "...", "value": {"stringValue"|"boolValue"|"intValue"|"doubleValue"|"arrayValue"|"kvlistValue": ...}}`.
  The backend decoder (`OpenTelemetryAttributeMapper.php:76-141`) even auto-JSON-decodes a `stringValue` that looks like
  an object.
- Fail-fast guard: a span missing `endTimeUnixNano` drops the **whole** report
  (`ProcessSpanAction.php:19-23`), unless the resource attribute `telemetry.sdk.version === '1.0.0'`
  (`ProcessSpanAction.php:96-100`). Implication: only send finished spans, or the report is silently discarded.

### 2.3 Internal span model and storage (ClickHouse)

The in-flight model is `SpanRow` (`app/Domain/Monitoring/Data/Rows/SpanRow.php:27-54`). The current storage table is
`spans_2` (`database/migrations/2025_11_21_091623_better_spans.php:11-53`). Notable columns:

```
project_id UInt32
trace_id String, span_id String, parent_span_id String, container_span_id String   -- IDs stored as String, not binary
name String
type LowCardinality(String)                       -- the SpanType, derived from the flare.span_type attribute
start_time_unix_nano UInt64, end_time_unix_nano UInt64
original_start_time_unix_nano UInt64, original_end_time_unix_nano UInt64
status_code String, status_message String
attributes Map(LowCardinality(String), String)
scope_attributes / resource_attributes / context_attributes  Map(...)
statistics Map(LowCardinality(String), UInt64)
failed UInt8
events.time_unix_nano / events.name / events.type / events.attributes   -- column-wise parallel arrays
span_aggregation_uuid UUID, span_aggregation_hash String, span_aggregation_type LowCardinality(String)
```

Engine MergeTree, `PRIMARY KEY (project_id, trace_id)`, `ORDER BY (project_id, trace_id, span_id)`, 30-day TTL, bloom
filter on `trace_id`. IDs are stored as **lowercase-hex strings** (the legacy Postgres table used `binary(16)`/`binary(8)`
but is dropped). Match OTel hex convention to be safe: trace_id = 32 hex chars, span_id = 16 hex chars.

There is no OTel `SpanKind` field. Flare replaces "kind" with its own span **type**, carried in the attribute
`flare.span_type` and mapped to the `SpanType` enum (`ProcessSpanAction.php:38`).

### 2.4 Span types and aggregation (the part that needs JS-side backend work)

- `SpanType` enum (`app/Domain/Monitoring/Enums/SpanType.php`): all PHP/Laravel values — `php_request`,
  `php_controller`, `php_query`, `php_http_request`, `php_view`, `php_command`, `laravel_job`,
  `laravel_livewire_component`, etc. "Container" types (`PhpRequest`, `PhpCommand`, `LaravelJob`) are the root unit of
  work; everything else is a child.
- `SpanAggregators` (`app/Domain/Monitoring/SpanAggregators/`) turn raw spans into the performance product: routes,
  queries, external HTTP, commands, views, jobs, Livewire. Each only aggregates spans whose `flare.span_type` it
  understands, keyed by a stable `aggregation_hash` → `span_aggregation_uuid`. Example: `PhpRequestSpanAggregator`
  aggregates on `http.request.method` + entry-point class + `http.route` (`PhpRequestSpanAggregator.php:19-69`).
- Metrics surfaced per aggregation: **p50/p90/p95/p99** (tDigest), average, count, and error_rate
  (`span_aggregation_metrics`, recreated in `2026_02_05_120901_recreate_span_aggregation_mvs_from_spans_2.php`).
- The MCP performance tools (`app/Mcp/Tools/Performance/`) confirm the product model: "slowest routes",
  per-route time-series + trend, query performance, query details — all keyed by `aggregation_uuid`.

**Consequence for JS:** to make browser performance show up, the backend needs new `SpanType` cases (e.g.
`browser_pageload`, `browser_navigation`, `browser_fetch`, `browser_render`) and matching `SpanAggregator`s, plus
agreement on the attribute keys the JS client will emit (route name, http method, url, etc.). Without that, JS spans
store as `Unknown` and never aggregate.

### 2.5 Correlation internals

- No W3C `traceparent`/`tracestate` handling anywhere in `app/` (grep confirms). Correlation uses raw OTel IDs.
- Within a trace: parent→child via `parentSpanId`, rebuilt in-memory (`ProcessSpanAction.php:62-64`).
- Container assignment: `FindContainerSpanAction` stamps each span with its nearest container ancestor.
- Cross-aggregation edges (service map): `FindSpanLinksAction` records parent/child aggregation UUID pairs into
  `span_aggregation_links`.
- **Deferred cross-batch correlation:** when a span's parent is not in the current batch, it is queued in the relational
  `missing_span_links` table with `trace_id` + `parent_span_id` + `child_span_id` and retried later by
  `LinkMissingSpanLinksCommand` (`StorePerformanceReportAction.php:29-33`). This is how Flare joins a parent and child
  that arrive from different services / in different batches — exactly the frontend↔backend case. **The browser child
  span must carry the same `traceId` and set its `parentSpanId` to the backend root span's id** for this to link.

### 2.6 What `otel-collector.yml` / `grafana-agent.yml` are (and are not)

- `otel-collector.yml` configures an OTLP-HTTP receiver → batch → **Zipkin** exporter
  (`endpoint: http://zipkin:9411/api/v2/spans`). This is **not** the customer trace path; it appears to be infra
  self-observability and exports to Zipkin, not ClickHouse. (Stated as "appears unrelated", not proven dead — flagged.)
- `grafana-agent.yml` is Prometheus/Loki host metrics + log shipping. Unrelated to customer traces.

### Open questions (backend)

1. Production ingress path via Cloudflare worker — does a browser POST raw OTLP, or hit a different host? Worker source
   not in repo. (Blocking.)
2. Do the time fields accept numeric strings (OTLP/JSON convention) or strictly JSON integers? Affects nanosecond
   precision strategy in JS. (Blocking-ish.)
3. Exact ID format enforcement at ingress (hex length) — validator only checks non-empty string. Match OTel hex anyway.
4. Whether to set `telemetry.sdk.version: '1.0.0'` to bypass the missing-end-time guard (probably not — send finished
   spans).
5. `throttle:trace-ingress` exact limits.
6. Semantics of `context.*` attributes (split into `context_attributes`) for a browser client.

---

## 3. The existing PHP client and daemon (the reference implementation)

Researched from the vendored copy at `/Users/driesheyninck/srv/flareapp.io/vendor/spatie/flare-client-php` (version
`1.3.x-dev`, snapshot dated ~May 2025 — may drift from GitHub `main`, flagged) and `spatie/flare-daemon` on GitHub.

**flare-client-php already has full tracing.** This is the single best reference for the JS port.

### 3.1 Span model

`src/Spans/Span.php`:

```php
new Span(
  string  $traceId,
  string  $spanId,
  ?string $parentSpanId,
  string  $name,
  int     $start,   // unix nanoseconds
  ?int    $end,     // unix nanoseconds, null = open
  array   $attributes = [],
  int     $droppedEventsCount = 0,
  ?SpanStatus $status = null,
)
// plus: array $events  (SpanEvent[])
```

- Span "type" is not a field; it is the attribute `flare.span_type` (enum `src/Enums/SpanType.php`). Same for events:
  `flare.span_event_type` (`src/Enums/SpanEventType.php`).
- `SpanStatus` wraps `SpanStatusCode` (`Unset=0, Ok=1, Error=2`) — exactly OTel status codes. Message only allowed when
  `Error`.
- `SpanEvent`: `name`, `timestamp` (unix nanos), `attributes`.

### 3.2 Time

`src/Time/SystemTime.php`: `(int)(microtime(true) * 1_000_000_000)` — wall-clock unix **nanoseconds**, deliberately not
`hrtime` (they want the values to double as display timestamps). JS equivalent: `Math.round((performance.timeOrigin +
performance.now()) * 1e6)` for monotonic-ish wall time, or `Date.now() * 1e6` (coarser).

### 3.3 IDs and W3C traceparent

`src/Support/Ids.php` — the key file to port:

- trace id: `bin2hex(random_bytes(16))` → 32 hex chars (W3C compliant).
- span id: `bin2hex(random_bytes(8))` → 16 hex chars (W3C compliant).
- `traceParent($traceId, $parentSpanId, $sampling)` → `"00-{traceId}-{parentSpanId}-" . ($sampling ? '01' : '00')`.
- `parseTraceparent()` accepts only version `00`, reads the sampled flag with a strict `=== '01'` equality (not a
  bitmask `& 0x01`). **Quirk to decide on:** a spec-compliant flag like `03` would be read as not-sampled. For
  browser→PHP interop the JS client must emit exactly `01`/`00`, or improve both sides to a bitmask.
- No `tracestate`, no `baggage` anywhere in the PHP client.

How a trace continues from an inbound header (`Tracer::startTrace(... traceParent:)` → `startFromTraceparent()`): it
adopts the incoming `traceId`, sets the first local span's parent to the incoming `parentSpanId`, and **inherits the
upstream sampling decision** (sampled-in forces sampling on). The Laravel integration reads it at
`vendor/spatie/laravel-flare/src/FlareServiceProvider.php:197`
(`request()->hasHeader('traceparent') ? request()->header('traceparent') : null`).

### 3.4 Export and transport

- `src/Exporters/OpenTelemetryJsonExporter.php` builds the exact `resourceSpans -> scopeSpans -> spans` OTLP/JSON shown
  in §2.2 (`exportSpan()` includes `links: []`, `droppedLinksCount: 0`, `status`).
- `src/Support/OpenTelemetryAttributeMapper.php` is the AnyValue encoder (nested arrays → `kvlistValue`, lists →
  `arrayValue`, enums unwrapped, fallthrough → JSON string). **Most reusable single concept to port** — and the JS core
  already has an equivalent (`logging/otel.ts`, see §5).
- Endpoint: base `https://ingress.flareapp.io`, `POST /v1/traces`, header `x-api-token` (CurlSender also sends `key` in
  the body). `src/Api.php`, `src/Senders/CurlSender.php`.
- Client-side limits (`src/Tracer.php`): `max_spans = 1024`, `max_attributes_per_span = 128`,
  `max_span_events_per_span = 128`, `max_attributes_per_span_event = 128`.
- Sampling (`src/Sampling/`): `RateSampler` (default 0.1), `Always`, `Never`, `DynamicSampler` (per URL/route/command,
  deferred until route resolves). Inbound sampled traceparent overrides local sampling.

### 3.5 flare-daemon

A long-running local PHP/ReactPHP sidecar (not an OTel collector, not Zipkin). Listens `127.0.0.1:8787`, accepts the
**same OTLP/JSON** on `POST /v1/{errors,traces,logs}`, returns `202 {"status":"accepted"}`, buffers per API-key×type
(~256 KB or 10 s), forwards to `https://ingress.flareapp.io`. Headers read: `x-api-token`, `x-flare-test`. Relevant to a
**Node** Flare SDK (could send to the daemon); irrelevant to a **browser** SDK (always goes direct to ingress).

### 3.6 What the PHP side does NOT do (gaps the JS side may need to fill)

- No outbound `traceparent` injection. The PHP `ExternalHttpRecorder` records outgoing HTTP as spans but does not add a
  `traceparent` header. So PHP→external propagation is not wired. The browser SDK injecting `traceparent` on fetch/XHR
  is therefore the primary frontend↔backend link, and it is a net-new mechanism on the client side.
- No `tracestate`, no W3C `baggage`. Queue propagation uses a private payload key `_flare_trace_parent`, not HTTP.

### Open questions (PHP client)

1. Version drift: vendored snapshot vs current GitHub tag — confirm against the tag we target.
2. The `=== '01'` sampled-flag quirk — replicate or fix to a bitmask? Browser must emit exactly `01`/`00` to interop
   with current PHP.
3. Is there an internal Flare design doc / PRD for the frontend↔backend linking story?
   (`vendor/spatie/flare-client-php/prd.json` was not fully read.)

---

## 4. Distributed tracing standards (W3C) and OTel browser tooling

### 4.1 W3C `traceparent` (the interop header)

Source: https://www.w3.org/TR/trace-context/ §3.2. Format (lowercase hex, hyphen-delimited):

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             └┬┘ └──────────────┬─────────────┘ └───────┬──────┘ └┬┘
            version           trace-id (16B/32hex)   parent-id (8B/16hex)  trace-flags (1B/2hex)
```

- version `00` current; trace-id all-zeroes is invalid; parent-id all-zeroes is invalid.
- trace-flags: only LSB defined — `01` = sampled, `00` = not. (Spec allows bitmask; current Flare PHP reads `=== '01'`.)
- The browser is normally the **root**: it generates `trace-id` + its own root `span-id`, and emits `traceparent` with
  its span-id in the `parent-id` position so the backend's server span becomes the child.

### 4.2 W3C `tracestate` and `baggage`

- `tracestate` (https://www.w3.org/TR/trace-context/ §3.3): vendor key/value list, max 32 members. Optional for us; if
  present inbound, preserve it; we likely don't need to emit one initially.
- `baggage` (https://www.w3.org/TR/baggage/): comma-separated `key=value` list for correlation values (user id, session,
  release). Propagation limits: ≤64 members and ≤8192 bytes. Values with special chars must be percent-encoded. Sentry
  uses this to carry its Dynamic Sampling Context (see §6); Flare PHP does not use baggage at all today.

### 4.3 OTLP trace JSON payload

Source: OTLP spec (https://opentelemetry.io/docs/specs/otlp/) + trace.proto. POST to `/v1/traces`, content-type
`application/json` (or `application/x-protobuf`). JSON encoding renders trace/span IDs as **case-insensitive hex strings**
(not base64), enums as ints, field names lowerCamelCase. Structure matches §2.2. SpanKind:
`UNSPECIFIED=0, INTERNAL=1, SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5` — browser fetch spans = CLIENT(3),
pageload/navigation = INTERNAL(1). Note Flare's backend ignores `kind` in favor of `flare.span_type` (§2.3), so we set
`flare.span_type` regardless.

**Nanosecond timestamps:** OTLP/JSON convention emits 64-bit ints as JSON strings (JS loses precision past 2^53). This
collides with the Flare validator requiring JSON integers (§2.2 open question). Must be resolved.

### 4.4 OTel JS browser packages (the "use a library" option)

- `@opentelemetry/sdk-trace-web` — `WebTracerProvider`.
- `@opentelemetry/instrumentation-fetch` / `-xml-http-request` — auto-create CLIENT spans and inject `traceparent` via
  `propagation.inject`, gated by `propagateTraceHeaderCorsUrls`.
- `@opentelemetry/context-zone` — `ZoneContextManager` (zone.js) keeps the active span correct across async callbacks.
  Heavy bundle cost.
- `@opentelemetry/exporter-trace-otlp-http` — OTLP exporter.

Browser `RandomIdGenerator` actually uses `Math.random()`, not `crypto` — see
`packages/opentelemetry-sdk-trace-base/src/platform/browser/RandomIdGenerator.ts`. For Flare we should prefer
`crypto.getRandomValues` (with a `Math.random` fallback for insecure non-HTTPS contexts where `crypto` may be absent):

```js
function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    if (buf.every((b) => b === 0)) buf[bytes - 1] = 1; // forbid all-zeroes (W3C)
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const traceId = randomHex(16); // 32 hex
const spanId = randomHex(8); // 16 hex
```

### 4.5 The CORS constraint (load-bearing)

`traceparent` is a non-safelisted request header. Adding it to a **cross-origin** request forces a CORS preflight
`OPTIONS`; the target server must return `Access-Control-Allow-Headers: traceparent` (+ `tracestate`/`baggage` if used)
or the browser blocks the actual request. So **injecting `traceparent` can break previously-working cross-origin calls**.

OTel's rule (verified in `sdk-trace-web/src/utils.ts shouldPropagateTraceHeaders`): same-origin → always inject;
cross-origin → only if the URL matches an explicit allow-list (`propagateTraceHeaderCorsUrls`). Flare must mirror this:
default same-origin only, expose an allow-list for the customer's own API origins, never auto-inject to third parties.
Also the OTLP export endpoint itself, if cross-origin, needs CORS configured to accept the POST.

### Build vs buy decision (flagged, not decided)

OTel's web SDK is correct but heavy (zone.js especially). The PHP client shows a hand-rolled OTLP/JSON exporter is
straightforward, and `@flareapp/core` already has the serializer + batching. Leaning toward **hand-rolling a minimal
traceparent injector + OTLP/JSON exporter** to control bundle size, accepting that we then lose `ZoneContextManager` and
must pass span context explicitly across `await` (the browser has no `AsyncLocalStorage`). To be decided.

---

## 5. What `@flareapp/*` already has (reuse map)

Researched in `/Users/driesheyninck/projects/flare-client-js`.

### 5.1 Directly reusable

- **OTel attribute serializer** — `packages/core/src/logging/otel.ts`: `valueToOpenTelemetry()` /
  `attributesToOpenTelemetry()` already produce the AnyValue `KeyValue[]` encoding (stringValue/boolValue/intValue/
  doubleValue/arrayValue/kvlistValue) with circular-ref guarding. **Usable for span attributes verbatim.**
- **Envelope builder pattern** — `packages/core/src/logging/envelope.ts`: `buildLogsEnvelope()` builds
  `resourceLogs -> scopeLogs -> logRecords` with resource attributes (service.name, telemetry.sdk._, flare.framework._,
  host.name). A `buildTracesEnvelope()` mirrors this for `resourceSpans -> scopeSpans -> spans`.
- **Batching + flushing** — `packages/core/src/logging/Logger.ts`: buffer with three flush triggers (count
  `maxLogBufferSize=100`, bytes `logFlushMaxBytes=800KB`, timer `logFlushIntervalMs=5000`), plus **keepalive packing**
  for tab unload (`keepaliveMaxBytes=60KB`). A `SpanBuffer` can copy this wholesale.
- **Flush lifecycle seam** — `packages/core/src/logging/FlushScheduler.ts` + `packages/js/src/browser/
BrowserFlushScheduler.ts` (listens `visibilitychange:hidden`, flushes with `keepalive:true`). Reuse for span flush.
- **Resource/record attribute partitioning** — `packages/core/src/logging/partition.ts` (prefixes `service.`,
  `telemetry.`, `host.`, `os.`, `process.`, `flare.framework.`, `flare.language.` go resource-level). Reusable logic.
- **API client** — `packages/core/src/api/Api.ts`: `.logs()` already POSTs an OTel envelope with
  `x-api-token`, `Content-Type: application/json`, and `keepalive`. Add a `.traces()` method to a new
  `tracesIngestUrl` (default `https://ingress.flareapp.io/v1/traces`). `.report()` shows the error path
  (`ingestUrl` default `.../v1/errors`).
- **Config merge** — `Config` (`packages/core/src/types.ts:7-29`) already has `ingestUrl`, `logsIngestUrl`, `key`,
  `enableLogs`, buffer/flush sizes, `serviceName`. Extend with `enableTracing`, `tracesIngestUrl`, span buffer sizes,
  `tracesSampleRate`, `tracePropagationTargets`. `flare.configure(partial)` already merges.
- **Framework integration patterns** — React `FlareErrorBoundary` (`componentDidCatch`), Vue plugin
  (`app.config.errorHandler`, `flareVue.ts`), Svelte factory + `preprocessor.ts`, SvelteKit hooks
  (`captureError.ts`). These are the seams where router/render instrumentation hooks in.

### 5.2 What is missing (net-new)

- A real **Span** type with `traceId`/`spanId`/`parentSpanId`/`name`/start/end/status/attributes/events. The existing
  `SpanEvent` type (`packages/core/src/types.ts:42-47`) is **not** span infrastructure — it is only error-report
  breadcrumb markers, populated solely by `glowsToEvents()` (hardcoded type `php_glow`, `endTimeUnixNano` always null).
  Do not overload it; introduce a proper tracing model.
- A `TracesEnvelope` type (parallel to `LogsEnvelope`).
- **Trace context / propagation** — generating IDs, holding an active trace, building `traceparent`. None today.
- **HTTP interception** — nothing patches `fetch`/`XMLHttpRequest` today (only `FetchFileReader` uses fetch for
  sourcemaps). Net-new monkeypatch needed.
- **`PerformanceObserver` integration** — none today.
- **Router/render instrumentation** in framework packages — they only capture errors today.

### 5.3 Where new code lives

- `packages/core/src/tracing/` — model, envelope, buffer, sampler, ID/traceparent helpers (env-agnostic, reuse
  `logging/otel.ts`).
- `packages/js/src/tracing/` — browser collection: fetch/XHR patch, `PerformanceObserver`, web-vitals, pageload/nav.
- `packages/node/src/tracing/` — Node collection (can reuse `AsyncLocalStorageScopeProvider` for context, optional
  daemon path).
- `packages/{react,vue,svelte,sveltekit}/src/tracing/` — thin framework hooks. Each already `@flareapp/js`-depends.

---

## 6. Sentry's JS SDK (competitive reference)

Sentry v8/v9. Sources: docs.sentry.io, develop.sentry.dev, getsentry/sentry-javascript.

### 6.1 Model and lifecycle

- v8+ removed "transactions"; everything is a **span**, a "transaction" is just a **root span**. Pageload/navigation
  roots are **idle spans**. Pageload root start time is backdated to the browser's first request for the URL (Navigation
  Timing). Source: `packages/browser/src/tracing/browserTracingIntegration.ts`,
  https://develop.sentry.dev/sdk/platform-specifics/javascript-sdks/browser-tracing/.
- Idle-span defaults: `idleTimeout=1000ms` (end after last child + idle), `finalTimeout=30000ms` (hard cap),
  `childSpanTimeout=15000ms`. Auto-flags default on: `enableLongTask`, `enableLongAnimationFrame`, `enableInp`,
  `traceFetch`, `traceXHR`, `instrumentPageLoad`, `instrumentNavigation`.

### 6.2 Request instrumentation

- Monkeypatches `fetch` and `XMLHttpRequest`; each in-flight request gets an `http.client` child span (origin
  `auto.http.browser`). Source: `packages/core/src/fetch.ts`.
- Two independent gates: **create a span** (always, when traceFetch/XHR on) vs **attach headers** (only when URL matches
  `tracePropagationTargets`). Default targets: same-origin + relative URLs only; cross-origin requires opt-in;
  `tracePropagationTargets: []` disables. Source: `packages/core/src/utils/tracePropagationTargets.ts`,
  https://docs.sentry.io/platforms/javascript/tracing/distributed-tracing/.
- Resource-timing spans explicitly exclude `xmlhttprequest`/`fetch` initiator types to avoid double-counting.

### 6.3 Correlation headers (the key mechanism)

Two headers injected on qualifying outgoing requests:

- **`sentry-trace`**: `<trace_id(32hex)>-<span_id(16hex)>-<sampled(optional: 0|1)>`. Example
  `771a43a4192642f0b136d5159a501700-7e0009f1eb3d1adf-1`. Source:
  https://develop.sentry.dev/sdk/telemetry/traces/trace-propagation-cheat-sheet/. This is "minimally compatible" with
  W3C `traceparent` but omits the version prefix. Opt-in `propagateTraceparent: true` additionally sends a real
  `traceparent: 00-<trace_id>-<span_id>-<sampled>`.
- **`baggage`** (W3C): carries the Dynamic Sampling Context — `sentry-trace_id`, `sentry-public_key`,
  `sentry-sample_rate`, `sentry-sample_rand`, `sentry-environment`, `sentry-release`, `sentry-transaction`, etc.
  Source: https://develop.sentry.dev/sdk/telemetry/traces/dynamic-sampling-context/.

**SSR continuation:** a Sentry-instrumented backend emits `<meta name="sentry-trace">` and `<meta name="baggage">` into
the page `<head>`; the browser SDK reads them at pageload and continues the same `trace_id`. Full chain: backend →
meta tags → browser pageload root adopts trace_id → browser fetch re-injects headers → next backend continues.

**Relevance to Flare:** Flare's equivalent of "continue the trace" is W3C `traceparent` (the PHP side already reads it).
For SSR (SvelteKit), Flare would need the same meta-tag (or equivalent) handoff so the client pageload trace shares the
server's `traceId`. This is net-new for Flare on both ends.

### 6.4 Sampling

- `tracesSampleRate` (uniform 0–1) or `tracesSampler(samplingContext)` (per-span, takes precedence). Head-based:
  decision made once at the root and propagated unchanged via `baggage` (with `sample_rand` fixed at trace start) so
  downstream decisions are consistent. `tracesSampleRate: 0` keeps tracing active (propagates context) but sends
  nothing.

### 6.5 Web vitals + native spans

- Sentry **vendors a fork of Google `web-vitals`** (`packages/browser-utils/src/metrics/web-vitals/`) and attaches
  LCP/CLS/INP/FCP/TTFB/FP. LCP and CLS are emitted as **standalone spans** (so final values are captured, not snapshotted
  at pageload end). INP is never on the pageload span — each interaction is a standalone span op
  `ui.interaction.<name>`.
- Native spans on the pageload root (`packages/browser-utils/src/metrics/browserMetrics.ts`): navigation phases
  (`browser.DNS`, `browser.connect`, `browser.TLS/SSL`, `browser.request`, `browser.response`, redirect/cache),
  resource timing (`resource.<initiatorType>`), `ui.long-task`, `ui.long-animation-frame`, `paint`, User Timing
  `mark`/`measure`.

### 6.6 Transport

- Sentry envelope (newline-delimited JSON) POSTed to `/api/<project>/envelope/`, `Content-Type:
application/x-sentry-envelope`. The envelope header `trace` field carries the DSC for ingest-time sampling. Transport
  uses a bounded promise buffer (default 64 in-flight), `X-Sentry-Rate-Limits`/`Retry-After` handling, fetch with
  `keepalive`. Source: `packages/core/src/transports/base.ts`, `packages/browser/src/transports/fetch.ts`.

Flare differs: Flare's transport is OTLP/JSON to `/v1/traces` and the core already batches (§5). We do not need the
Sentry envelope format.

### 6.7 Framework SDK architecture (packaging parity)

- Layering: `@sentry/core` (agnostic primitives + integration machinery) → `@sentry/browser` (owns
  `browserTracingIntegration`, fetch/XHR, web vitals) → framework packages `export * from '@sentry/browser'` and add
  framework integrations. `@sentry/sveltekit` depends on **both** `@sentry/svelte` + `@sentry/node` (client + SSR +
  Vite plugin). This mirrors Flare's `@flareapp/core` → `@flareapp/js` → framework packages, and
  `@flareapp/sveltekit` → `@flareapp/svelte` + `@flareapp/node`.
- Integration interface (`packages/core/src/types-hoist/integration.ts`): `name`, `setupOnce()`, `setup(client)`,
  `preprocessEvent`, `processEvent`, `afterAllSetup`. Factory convention: a plain function returning
  `{ name, setup(client){...} }`.
- **React** (`packages/react/src/profiler.tsx`): Sentry does **not** use React's built-in `<Profiler onRender>`. It
  implements its own class component with three spans: `ui.react.mount` (constructor→`componentDidMount`),
  `ui.react.update` (`shouldComponentUpdate`, records changed prop _keys_ only), `ui.react.render` (mount→unmount).
  Origin `auto.ui.react`. Exposed as `withProfiler` HOC and `useProfiler` hook.
- **Vue** (`packages/vue/src/tracing.ts`): `app.mixin` brackets lifecycle pairs (create/mount/update) into spans
  `ui.vue.<op>`, under a debounce-closed root `Application Render` (`ui.vue.render`, default 2000ms). `trackComponents`
  opt-in (all or named). Error handler wraps `app.config.errorHandler`.
- **Svelte** (`packages/svelte/src/preprocessors.ts`): compile-time `componentTrackingPreprocessor` injects
  `trackComponent({...})` into each component's script. `trackComponent` (`performance.ts`) creates `ui.svelte.init`
  (around `onMount`) and `ui.svelte.update` (`beforeUpdate`→`afterUpdate`) spans, `onlyIfParent: true`. Defaults:
  `trackComponents=true`, `trackInit=true`, `trackUpdates=false`.
- **SvelteKit**: `sentryHandle()` server hook (creates `http.server` root, injects trace meta tags via
  `transformPageChunk`), `wrapServerLoadWithSentry`/`wrapLoadWithSentry` (continue inbound trace via `continueTrace`
  reading `sentry-trace`/`baggage`), `handleErrorWithSentry`, and the `sentrySvelteKit()` Vite plugin (auto-injects the
  preprocessor + uploads sourcemaps; must precede `sveltekit()`).
- SSR meta-tag generator: `getTraceMetaTags()` in `packages/core/src/utils/meta.ts`:
  `<meta name="sentry-trace" content="...">` + `<meta name="baggage" content="...">`.

**Span op cheat sheet (for Flare naming parity):**

| Layer   | Op                                                           | Origin           |
| ------- | ------------------------------------------------------------ | ---------------- |
| React   | `ui.react.mount` / `.update` / `.render`                     | `auto.ui.react`  |
| Vue     | `ui.vue.create` / `.mount` / `.update`; root `ui.vue.render` | `auto.ui.vue`    |
| Svelte  | `ui.svelte.init` / `.update`                                 | `auto.ui.svelte` |
| Browser | `pageload` / `navigation`; `http.client`                     | `auto.*.browser` |

### Open questions (Sentry)

1. `sentry-trace` sampled-flag wording vs the `sentry-sampled` baggage key (cross-checked; the header carries an
   optional sampled char, the DSC must not contain `sentry-sampled`-as-trace-flag — believed reconciled but not 100%).
2. Exact default `tracePropagationTargets` regex literal (source file moved; behavior confirmed, literal not read).
3. Exact React Profiler op constant identifiers; SvelteKit load span op strings (`function.sveltekit.load`) — source
   fetch 404'd.

---

## 7. Rendering / component performance

### 7.1 Recommended layered approach

1. **Native base (reliable, production, cross-framework):** `PerformanceObserver` + Google `web-vitals`.
2. **Framework enrichment (uneven):** React `<Profiler>`, Vue `app.config.performance`, Svelte manual.
3. **Correlation:** tie Resource Timing entries to our own fetch spans; emit our own `performance.mark`/`measure` for
   app-defined spans.

### 7.2 React

- `<Profiler id onRender>` — `onRender(id, phase, actualDuration, baseDuration, startTime, commitTime)`. `phase` is
  `"mount" | "update" | "nested-update"` (three values). https://react.dev/reference/react/Profiler.
- **Production caveat:** React docs say profiling instrumentation is "disabled in the production build by default" and
  recommend a profiling build (alias `react-dom/client` → `react-dom/profiling`). Whether `onRender` still fires (with
  degraded accuracy) in a _plain_ production build is **not clear from the docs — needs an empirical test** before the
  SDK relies on it in the field. (Flagged.)
- Concurrent rendering (18/19): a component may render multiple times per commit; `actualDuration` counts React
  component time only (not internals, not yielded time) — treat as a relative signal, not wall-clock.
- `unstable_trace` / interaction tracing was **removed**; `<Profiler>`/`onRender` is the only stable commit-timing hook.
- Sentry's own approach sidesteps all this by timing lifecycle methods manually (§6.7) — a viable model for Flare.

### 7.3 Vue

- `app.config.performance = true` emits User Timing marks for init/compile/render/patch — but **dev-only** and only
  where `performance.mark` exists. https://vuejs.org/api/application.html. Useless for production RUM. Exact mark-name
  strings not enumerated in docs (historically `vue-` prefixed) — verify against a running app. (Flagged.)
- Production-viable timing: bracket lifecycle hooks (`onBeforeUpdate`/`onUpdated`, `onMounted`) with `performance.now()`
  / User Timing yourself. (Sentry does this via `app.mixin`.)

### 7.4 Svelte

- Svelte 5 exposes **no** dedicated render-timing/profiling API. https://svelte.dev/docs/svelte/lifecycle-hooks.
  `beforeUpdate`/`afterUpdate` are **deprecated** in Svelte 5 (replace with `$effect.pre` / `$effect`); `onMount` /
  `onDestroy` / `tick()` exist. To time renders we must instrument manually (Sentry uses a compile-time preprocessor —
  §6.7). Weakest framework layer; lean hardest on the native base for Svelte.

### 7.5 Native Performance APIs (the foundation)

`PerformanceObserver` with `observe({ type, buffered: true })` (buffered replays pre-observer entries — critical for
early metrics). Feature-detect via `PerformanceObserver.supportedEntryTypes`. Entry types:

| Entry type                 | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `navigation`               | pageload breakdown (Nav Timing L2)      |
| `resource`                 | per-request network timing              |
| `paint`                    | `first-paint`, `first-contentful-paint` |
| `largest-contentful-paint` | LCP                                     |
| `layout-shift`             | CLS source data                         |
| `event` / `first-input`    | INP / input responsiveness              |
| `longtask`                 | tasks >50ms blocking main thread        |
| `long-animation-frame`     | LoAF (richer jank attribution)          |
| `element`                  | Element Timing                          |
| `mark` / `measure`         | custom app spans (User Timing)          |

- **Navigation Timing** computes DNS (`domainLookupEnd-domainLookupStart`), TCP (`connectEnd-connectStart`), TTFB
  (`responseStart-requestStart`), response (`responseEnd-responseStart`), DOM/load phases. MDN
  PerformanceNavigationTiming.
- **Resource Timing** per request: `name`, `initiatorType`, `transferSize` (0 ⇒ cache), `encoded/decodedBodySize`,
  `responseStatus`, `nextHopProtocol`. **Cross-origin needs `Timing-Allow-Origin`** or detailed phases zero out. Buffer
  defaults ~250 entries — call `clearResourceTimings()` on long-lived SPAs or silently drop. Filter to
  `fetch`/`xmlhttprequest` and match by URL + time window to attach to our request spans.
- **web-vitals** (Google): `onCLS`/`onLCP`/`onINP`/`onFCP`/`onTTFB` (v3+ renamed from `getX`). Handles CLS
  session-windowing, INP thresholds (good ≤200ms, poor >500ms), `buffered:true`, **bfcache re-reporting** (new metric
  id on restore), and an `attribution` build (element selectors, timing breakdowns). Recommendation: **use web-vitals**
  for the five vitals (the math is hard to get right), **raw `PerformanceObserver`** for everything else.

### 7.6 Browser support caveats

| API / metric                  | Support                                    | Caveat                                                         |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Navigation/Resource Timing    | broad                                      | cross-origin needs `Timing-Allow-Origin`; 250-entry buffer cap |
| FCP / LCP                     | Chromium, Firefox, Safari                  | measured differently per engine → field variance               |
| CLS (`layout-shift`)          | **Chromium only**                          | no CLS on Safari/Firefox                                       |
| INP / Event Timing            | Chromium, Firefox, Safari (per web-vitals) | Safari/Firefox approximate; bfcache restore nuances            |
| TTFB                          | broad                                      | reliable                                                       |
| `longtask`                    | Chromium; limited elsewhere                | verify Safari/Firefox                                          |
| LoAF (`long-animation-frame`) | **Chromium only**                          | best jank signal; fall back to `longtask`                      |
| Element Timing                | Chromium (verify)                          | flagged                                                        |
| User Timing `mark`/`measure`  | broad                                      | safe; foundation for custom spans                              |
| React `<Profiler>`            | all React envs                             | overhead; prod needs profiling build; relative not wall-clock  |
| Vue `app.config.performance`  | dev only                                   | never fires in production                                      |
| Svelte render timing          | none                                       | manual instrumentation only                                    |

### Open questions (rendering)

1. Does React `<Profiler>` `onRender` fire in a plain production build? Empirical test needed.
2. Exact Vue mark/measure name strings.
3. React 19 profiling-renderer config change (facebook/react#32992) — confirm.
4. Per-browser compat tables for `element`/`longtask`.
5. `web-vitals` version to vendor (function names + attribution build assume v3/v4).

---

## 8. Router interop (pageload + navigation traces)

Universal pattern (Sentry's, worth copying): two primitives — start a **pageload** span on initial load and a
**navigation** span on each route change — and each router integration only (a) detects nav start/end and (b) supplies
a **parameterized** route name (e.g. `/products/:id`, not `/products/123`) plus a source flag `route` vs `url`. The
parameterized name is required so the backend `SpanAggregators` group correctly (§2.4).

### 8.1 React Router (v6/v7)

- No direct nav events. Two strategies: (A) component/hook-based — feed `useLocation`, `useNavigationType`,
  `matchRoutes`, `createRoutesFromChildren`, `useEffect` into the integration and wrap `Routes` with
  `withSentryReactRouterV6Routing`; (B) data-router — wrap `createBrowserRouter` via `wrapCreateBrowserRouterV6`.
- `useNavigationType()` returns `"POP" | "PUSH" | "REPLACE"` (distinguishes initial load from navigation).
- Parameterized name: no single getter — run `matchRoutes(routes, location)` and join matched `route.path` segments
  (`:param` syntax). Data router: `router.state.matches[last].route.path`.
- Docs: reactrouter.com/api/hooks/useLocation, /useNavigationType, /utils/matchRoutes; Sentry v6/v7 guides.

### 8.2 TanStack Router (cleanest)

- First-class events: `router.subscribe(eventName, listener)`. Order: `onBeforeNavigate` (start) → `onBeforeLoad` →
  `onLoad` → `onBeforeRouteMount` → `onResolved` (end) → `onRendered`. Payload: `{ fromLocation?, toLocation,
pathChanged, hrefChanged, hashChanged }`.
- Initial pageload distinction: likely `fromLocation === undefined` on first `onResolved` — **not stated explicitly in
  docs; verify.** (Flagged.)
- Parameterized name: read `router.state.matches[last].fullPath` / `routeId` (TanStack uses `$param`; normalize
  `$postId`→`:postId` if backend expects colon form). Guard against `""` fullPath for pathless routes (issue #4892).
- **No first-party Sentry integration** — community uses `subscribe` + `startBrowserTracing*Span`. (Flagged.)
- Docs: tanstack.com/router/latest/docs/guide/router-events, /api/router/RouterEventsType.

### 8.3 Vue Router

- Global guards: `router.beforeEach((to, from) => {})` (start) / `router.afterEach((to, from, failure) => {})` (end) /
  `router.onError`. Sentry wires via `browserTracingIntegration({ router })` (vue-router v2/3/4).
- Parameterized name: `to.matched[last].path` (e.g. `/users/:id`) or `to.name`; **never** `to.path`/`to.fullPath`
  (those have params filled in). Sentry's `routeLabel` option chooses `"name"` (default) or `"path"`.
- Docs: router.vuejs.org/guide/advanced/navigation-guards.html, /api/.

### 8.4 SvelteKit (client + server)

- Client (Sentry uses stores, not the hooks): subscribe to the `page` store for pageload (rename span once
  `page.route.id` resolves), and the `navigating` store for navigation — **non-null = nav in progress (start),
  back-to-null = nav finished (end)**. Alternatively `$app/navigation` hooks: `beforeNavigate` / `onNavigate` /
  `afterNavigate` (`Navigation.type` ∈ `enter|form|leave|link|goto|popstate`, `to.route.id` parameterized).
- Parameterized name: `route.id` IS the parameterized pattern (`/products/[id]`; normalize `[id]`→`:id` if needed).
  Client: `page.route.id` / `navigation.to.route.id`. Server: `event.route.id`.
- **Server-side correlation (the SvelteKit differentiator):** `sentryHandle()` reads inbound `sentry-trace`/`baggage`
  (via `continueTrace`), creates the `http.server` root, and injects trace `<meta>` tags into the SSR `<head>` via
  `transformPageChunk`; the client reads them on boot to continue the same `trace_id`. `wrapServerLoadWithSentry` /
  `wrapLoadWithSentry` wrap load functions as child spans. **For Flare, server↔client correlation hinges on: (1) parse
  inbound `traceparent` in `handle`, (2) emit trace meta tags into the SSR head, (3) read them client-side on
  pageload.** Net-new on both ends.
- Deprecation note: `$app/stores` (`page`, `navigating`) is being superseded by `$app/state` (Svelte 5 / SvelteKit
  2.12+); Sentry has `TODO(v11)` to migrate. Pin to the SvelteKit version we target.
- Docs: svelte.dev/docs/kit/$app-navigation, /$app-state; Sentry SvelteKit guides; verified source
  `packages/sveltekit/src/{client/browserTracingIntegration,server-common/handle,server-common/load}.ts`.

### 8.5 Cross-router summary

| Router             | Nav start                                    | Nav end                             | Parameterized name                       | Param syntax | Sentry official |
| ------------------ | -------------------------------------------- | ----------------------------------- | ---------------------------------------- | ------------ | --------------- |
| React Router v6/v7 | `useLocation` change / data-router subscribe | `useEffect` after commit            | `matchRoutes()` → join `route.path`      | `:id`        | Yes             |
| TanStack Router    | `subscribe('onBeforeNavigate')`              | `'onResolved'`                      | `state.matches[last].fullPath`/`routeId` | `$id`        | No (community)  |
| Vue Router         | `beforeEach`                                 | `afterEach`                         | `to.matched[last].path` / `to.name`      | `:id`        | Yes             |
| SvelteKit          | `navigating` non-null / `beforeNavigate`     | `navigating`→null / `afterNavigate` | `route.id`                               | `[id]`       | Yes (+ server)  |

### Open questions (routers)

1. React Router v7 framework (Remix-style) mode instrumentation API — was Beta; verify.
2. TanStack initial-pageload detection (no explicit flag confirmed) and absence of a first-party Sentry integration.
3. Vue: exact name-resolution precedence inside Sentry not source-verified.
4. Param-syntax normalization — does the backend want one canonical placeholder form across routers? Backend decision.
5. SvelteKit `$app/stores` → `$app/state` migration timing vs the version we target.

---

## 9. Synthesis: a candidate architecture (not a decision)

Putting the pieces together into one coherent (still-tentative) shape:

1. **Data model in `@flareapp/core/src/tracing/`**: a `Span` type (traceId/spanId/parentSpanId/name/start/end/status/
   attributes/events), a `Trace`/active-context holder, a `Sampler`, ID + `traceparent` helpers (port `Ids` from PHP,
   using `crypto.getRandomValues`), a `SpanBuffer` (copy `Logger`'s triggers/keepalive), a `buildTracesEnvelope()` (copy
   `buildLogsEnvelope`), reusing `logging/otel.ts` for attributes. Emit `flare.span_type` on every span. Honor PHP's
   client limits (1024 spans, 128 attrs).

2. **Browser collection in `@flareapp/js/src/tracing/`**:
    - Patch `fetch` + `XMLHttpRequest`: create an `http.client` child span per request; inject
      `traceparent: 00-<traceId>-<spanId>-<01|00>` on same-origin (and allow-listed cross-origin via a
      `tracePropagationTargets`-style option, documenting the CORS requirement).
    - `PerformanceObserver` for navigation/resource/paint/longtask/LoAF/element/marks; `web-vitals` for
      LCP/CLS/INP/FCP/TTFB. Attach to a pageload root span (LCP/CLS/INP likely as standalone spans per Sentry's lesson).
    - Pageload root on init; navigation root driven by the router integration.

3. **Framework packages** (`export *` from `@flareapp/js`, add a thin integration):
    - React: a Profiler component timing mount/update/render (Sentry-style manual lifecycle, not React's `<Profiler>`),
      plus router integration (v6/v7 + TanStack) for pageload/navigation names.
    - Vue: `app.mixin` lifecycle bracketing (opt-in `trackComponents`) + `vue-router` guards.
    - Svelte: compile-time preprocessor injecting render tracking + SvelteKit store-based nav + server `handle`/load
      wrapping with `traceparent` meta-tag handoff for SSR correlation.

4. **Transport**: a new `Api.traces()` → `tracesIngestUrl` (`/v1/traces`), `x-api-token`, OTLP/JSON, keepalive, reusing
   the core flush scheduler.

5. **Config additions**: `enableTracing`, `tracesIngestUrl`, `tracesSampleRate`, `tracePropagationTargets`, span buffer
   sizes.

### Hard dependencies / things to settle before building

- **Backend: define JS `SpanType`s + `SpanAggregator`s + the attribute contract** (route name, http method, url, render
  component) — without this, JS spans do not surface (§1, §2.4). This is the gating cross-team item.
- **Backend: confirm the production ingress path** (Cloudflare worker vs direct) and the **nanosecond timestamp
  encoding** (integer vs string) (§2, §4.3).
- **Decide build-vs-buy** for the browser tracer (hand-rolled minimal exporter vs `@opentelemetry/*` web SDK) — bundle
  size vs correctness/async-context (§4.4).
- **Decide the SSR correlation handoff** (meta tags carrying `traceparent`) for SvelteKit (§6.3, §8.4).
- **Decide the sampled-flag convention** (`=== '01'` quirk vs bitmask) to interop with current PHP (§3.3).

---

## 10. Consolidated open questions / unverified (master list)

Backend

- B1. Production `/v1/traces` ingress: Cloudflare-worker envelope vs direct raw OTLP; worker source not in repo. (Blocking.)
- B2. Time fields: JSON integer required, or numeric string accepted? Drives JS nanosecond precision strategy. (Blocking-ish.)
- B3. ID format enforcement (hex length) at ingress.
- B4. `telemetry.sdk.version: '1.0.0'` missing-end-time exemption — use or not.
- B5. JS span taxonomy: new `SpanType` + `SpanAggregator` needed; attribute contract TBD. (Blocking for product visibility.)
- B6. `throttle:trace-ingress` exact limits.
- B7. `otel-collector.yml` → Zipkin: confirmed not the customer path, but its deployment/consumer unverified.

PHP client

- P1. Vendored snapshot vs current GitHub tag (version drift).
- P2. `parseTraceparent` `=== '01'` quirk — replicate or fix.
- P3. Internal Flare frontend↔backend linking design doc / `prd.json` (unread).

Standards / OTel

- S1. OTLP/JSON nanosecond-as-string vs Flare validator's integer requirement (ties to B2).
- S2. Build-vs-buy: `@opentelemetry/*` web SDK bundle cost vs hand-roll; async-context strategy without zone.js.
- S3. ID randomness source (recommend `crypto.getRandomValues` + `Math.random` fallback for insecure contexts).

Sentry reference

- X1. `sentry-trace` sampled flag vs `sentry-sampled` baggage wording (believed reconciled).
- X2. Exact default `tracePropagationTargets` literal (behavior confirmed).
- X3. Some React/SvelteKit op-string constants (source 404'd).

Rendering

- R1. React `<Profiler>` `onRender` behavior in plain production build (empirical test needed).
- R2. Exact Vue mark/measure name strings.
- R3. React 19 profiling-renderer config change (facebook/react#32992).
- R4. Per-browser compat for `element`/`longtask`.
- R5. `web-vitals` version to vendor.

Routers

- T1. React Router v7 framework-mode API (was Beta).
- T2. TanStack initial-pageload detection; no first-party Sentry integration.
- T3. Vue Sentry name-resolution precedence (not source-verified).
- T4. Param-syntax normalization — canonical placeholder form (backend decision).
- T5. SvelteKit `$app/stores` → `$app/state` migration vs target version.

---

## 11. Primary sources

Backend (local): `flareapp.io/routes/ingress.php`,
`app/Http/Api/Controllers/Ingress/{TraceIngressController,Local/LocalTraceIngressController}.php`,
`app/Domain/Monitoring/{Enums/SpanType.php,SpanAggregators/*,Data/Rows/SpanRow.php,Actions/PerformanceReport/*}`,
`app/Domain/Project/Support/ApiKey.php`, `database/migrations/2025_11_21_091623_better_spans.php`,
`app/Mcp/Tools/Performance/*`, `otel-collector.yml`, `grafana-agent.yml`.

PHP client/daemon: `vendor/spatie/flare-client-php/src/{Spans/Span.php,Support/Ids.php,Time/SystemTime.php,
Exporters/OpenTelemetryJsonExporter.php,Support/OpenTelemetryAttributeMapper.php,Api.php,Tracer.php,Senders/*}`,
`vendor/spatie/laravel-flare/src/FlareServiceProvider.php:197`, github.com/spatie/flare-daemon.

JS client (local): `packages/core/src/{logging/{otel,envelope,Logger,partition,FlushScheduler}.ts,api/Api.ts,
types.ts}`, `packages/js/src/browser/BrowserFlushScheduler.ts`, framework entry points.

Standards: https://www.w3.org/TR/trace-context/, https://www.w3.org/TR/baggage/,
https://opentelemetry.io/docs/specs/otlp/, https://opentelemetry.io/docs/languages/js/getting-started/browser/,
github.com/open-telemetry/opentelemetry-js, github.com/open-telemetry/opentelemetry-proto.

Sentry: docs.sentry.io/platforms/javascript/tracing/_, develop.sentry.dev/sdk/telemetry/traces/_,
develop.sentry.dev/sdk/platform-specifics/javascript-sdks/browser-tracing/, github.com/getsentry/sentry-javascript
(`packages/{core,browser,react,vue,svelte,sveltekit}/...`).

Rendering/routers: react.dev/reference/react/Profiler, vuejs.org/api/application.html,
svelte.dev/docs/svelte/lifecycle-hooks, svelte.dev/docs/kit/$app-navigation, developer.mozilla.org (Performance\*
interfaces), web.dev/articles/{lcp,inp,bfcache}, github.com/GoogleChrome/web-vitals, reactrouter.com,
tanstack.com/router, router.vuejs.org.
