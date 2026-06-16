# Spec: performance tracing — core foundation (`@flareapp/core/src/tracing/`)

Status: design approved 2026-06-15. Scope: the framework-agnostic tracing foundation only. Branch:
`research/performance-tracing`.

## Context

This is the first slice of a larger performance-tracing effort for the `@flareapp/*` SDK. The full effort spans core
primitives, browser collection (fetch/XHR + Performance APIs), four framework integrations, and backend coordination.
That is too large for one implementation plan, so it is decomposed. **This spec covers only the core foundation** — the
env-agnostic tracing model, ID/traceparent helpers, sampler, span buffer, OTLP envelope builder, transport, and a
minimal public manual-span API. Browser collection and framework integrations get their own specs later.

Full research: `.claude/docs/research/performance-tracing.md`. Backend schema exploration:
`.claude/docs/research/backend-schema-cross-project-tracing.md`. The research locked most cross-cutting decisions
(§9.0); this spec consumes them.

### Why this slice first

It is the smallest shippable unit, it unblocks everything downstream, and it is fully unit-testable against the
existing `FakeApi` without any backend change. It also gives a real public surface (manual spans) so the foundation is
exercised and demoable on its own, not dead code awaiting the browser layer.

### Approved decisions driving this spec

- **Build in-house**, mirror the existing logging module rather than adopt the OTel web SDK (research §4.4).
- **Wire format**: raw OTLP/JSON to `https://ingress.flareapp.io/v1/traces`, `x-api-token` auth, no Flare-specific
  wrapper. Cloudflare worker is transparent (research §2.7).
- **Transport mirrors `Api.logs()` exactly** — header-only auth, URL unchanged, no `?key=` query fallback (see
  Transport). Validated against `flare-client-php`: the PHP `Api`/`CurlSender` use one API token for errors, traces,
  and logs identically (OTLP/JSON body, same base URL, only the path differs; PHP's query-string `key` is a curl
  convenience, not a contract). The JS `Api.logs()` already ships an OTLP entity from the browser with the
  configured (public) key. So `Api.traces()` is a clone of `Api.logs()` with path `/v1/traces`. The protocol-doc
  "private key only" wording for `/v1/traces` is not enforced by any client code and is treated as PHP-perspective
  wording; confirmed by a live test-POST before shipping (see External prerequisites).
- **Timestamps**: integer nanoseconds as JS `number`. Accept precision loss above 2^53 ns — sub-microsecond precision
  is meaningless in a browser (`performance.now()` is ms-resolution). No BigInt serializer.
- **IDs**: OTel hex (32-char trace, 16-char span, lowercase), `crypto.getRandomValues` with a `Math.random` fallback
  for insecure contexts, all-zeroes forbidden.
- **Sampling**: uniform `tracesSampleRate` (0–1) plus an optional `tracesSampler(ctx)` callback that takes precedence;
  head-based, decided once at the root and inherited by all children; inbound traceparent sampled flag wins.
- **Send finished spans only**; never spoof `telemetry.sdk.version` to dodge the backend missing-end-time guard.
- **Public API**: minimal manual-span surface (`startSpan`/`withSpan`/`span.end()` + explicit active-span holder, no
  zone.js).

## Architecture

All new code in `@flareapp/core/src/tracing/`. Environment-agnostic; the browser, Node, and framework layers consume it
in later specs.

```
packages/core/src/tracing/
  Span.ts          # Span class: data + lifecycle (end/setAttribute/setStatus/addEvent)
  Tracer.ts        # owns SpanBuffer, startSpan/withSpan, sampling entry, active-span holder use
  SpanBuffer.ts    # buffer + 3 flush triggers + keepalive packing (mirrors Logger)
  context.ts       # explicit active-span holder (no zone.js)
  sampler.ts       # uniform rate + tracesSampler callback + traceparent inheritance
  ids.ts           # randomHex trace(32)/span(16), crypto + Math.random fallback, no all-zero
  traceparent.ts   # build "00-tid-sid-flag" + parse (strict 01/00, PHP-interop)
  envelope.ts      # buildTracesEnvelope() mirrors buildLogsEnvelope()
  index.ts         # barrel
```

New tracing types live in `packages/core/src/types.ts` alongside the existing logging types (or in
`tracing/types.ts` if the file grows; default to core `types.ts` for consistency with `LogsEnvelope`/`BufferedLog`).

**Reused verbatim** (no changes): `logging/otel.ts` (attribute → OTLP AnyValue encoder), `logging/partition.ts`
(resource/record attribute split), `logging/FlushScheduler.ts` + `packages/js/src/browser/BrowserFlushScheduler.ts`
(lifecycle flush seam).

**Touched**: `packages/core/src/api/Api.ts` (add `traces()`), `packages/core/src/Flare.ts` (construct + expose a
`Tracer`), `packages/core/src/types.ts` (Config additions + new tracing types), `packages/core/src/logging/index.ts`
or a new `tracing/index.ts` barrel + `packages/core/src/index.ts` re-exports.

### Wiring

Mirrors how `Logger` is wired today (`Flare.ts:74`). The `Flare` constructor builds a `Tracer` from a deps object and
the same `scheduler` instance already passed for logging:

```ts
this._tracer = new Tracer({
    api: this.api,
    getConfig: () => this._config,
    getSdkInfo: () => this.sdkInfo,
    getFramework: () => this.framework,
    buildSpanAttributes: (userAttributes) => this.buildSpanAttributes(userAttributes),
    track: (p) => this.track(p),
    scheduler, // SAME instance as Logger — one lifecycle seam drains both buffers
});
```

`buildSpanAttributes` parallels the existing `buildLogAttributes`: it runs the context collector and the partition
split, returning `{ record, resource }`. Resource attributes match `Logger.resourceForFlush()`
(`telemetry.sdk.*`, `service.*`, `flare.framework.*`).

`Flare` exposes `get tracer(): Tracer` (parallel to `get logger()`) plus thin passthroughs `flare.startSpan(...)` and
`flare.withSpan(...)`.

`Tracer` exposes a `flush()` (parallel to `Logger.flush()`). **`Flare.flush()` (`Flare.ts:225`) currently flushes
only `_logger`; it must also call `this._tracer.flush()` before taking the in-flight snapshot**, so buffered spans
drain on an explicit flush exactly like logs. Likewise `Flare.light()` (`Flare.ts:255`), which flushes the logger
after a key is set (to drain records buffered while keyless), must also flush the tracer for spans buffered before
the key. Both are covered by integration tests mirroring the existing logger ones.

## Data model

The existing `SpanEvent` type (`core/src/types.ts:42`) is the **error-report breadcrumb** type, populated only by
`glowsToEvents()`. It is NOT span infrastructure and MUST NOT be overloaded (research §5.2). The tracing model is
separate.

```ts
type SpanStatusCode = 0 | 1 | 2; // Unset | Ok | Error (OTel SpanStatusCode)

type SpanStatus = { code: SpanStatusCode; message?: string }; // message only meaningful when Error

// public-facing span handle
interface Span {
    readonly traceId: string; // 32 lowercase hex
    readonly spanId: string; // 16 lowercase hex
    readonly parentSpanId: string | null;
    name: string;
    setAttribute(key: string, value: AttributeValue): this;
    setStatus(status: SpanStatus): this;
    addEvent(name: string, attributes?: Attributes): this;
    end(endTimeUnixNano?: number): void; // idempotent; on first end -> buffer (if recording)
    readonly isRecording: boolean; // false when sampled out (end becomes a no-op for buffering)
}

// internal buffered shape (pre-encoding), parallel to BufferedLog
type BufferedSpan = {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    startTimeUnixNano: number; // integer nanos
    endTimeUnixNano: number; // integer nanos (always set; only finished spans buffer)
    status: SpanStatus;
    recordAttributes: KeyValue[]; // already OTLP-encoded via otel.ts
    resourceAttributes: Attributes; // raw; encoded at envelope build (matches BufferedLog)
    droppedAttributesCount: number; // span attrs dropped over maxAttributesPerSpan
    droppedEventsCount: number; // events dropped over maxEventsPerSpan
    events: {
        name: string;
        timeUnixNano: number;
        attributes: KeyValue[];
        droppedAttributesCount: number; // event attrs dropped over maxAttributesPerSpanEvent
    }[];
};

type TracesEnvelope = {
    resourceSpans: Array<{
        resource: OtelResource;
        scopeSpans: Array<{ scope: OtelScope; spans: OtelSpan[] }>;
    }>;
};

type OtelSpan = {
    traceId: string;
    spanId: string;
    parentSpanId: string | null; // ALWAYS emitted; null for roots
    name: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    status: { code: number; message?: string };
    attributes: KeyValue[];
    events: { name: string; timeUnixNano: number; attributes: KeyValue[]; droppedAttributesCount: number }[];
    droppedAttributesCount: number;
    droppedEventsCount: number;
    links: [];
    droppedLinksCount: 0;
};
```

- `flare.span_type` and `flare.entry_point.*` are carried as **attributes**, not fields (Flare has no `SpanKind`;
  research §2.3). In this core slice, `flare.span_type` is set only when the caller passes `opts.spanType`
  (`startSpan`). The browser/framework layers set the real taxonomy values later.
- Timestamps are integer nanoseconds: `Math.round((performance.timeOrigin + performance.now()) * 1e6)` where the
  Performance API is available; the time source is injected so Node/tests can substitute it.
- Client-side caps (PHP parity, research §3.4): `maxSpansPerTrace` 1024, `maxAttributesPerSpan` 128, `maxEventsPerSpan`
  128, `maxAttributesPerSpanEvent` 128. Over-cap span attributes/events drop into the span's
  `droppedAttributesCount`/`droppedEventsCount`; over-cap event attributes drop into that event's own
  `droppedAttributesCount`. Every count is preserved from the buffered shape through to the OTLP output (no silent
  loss of the dropped totals).

## Public span API

```ts
type SpanOptions = {
  parent?: Span | { traceId: string; spanId: string };  // explicit parent
  attributes?: Attributes;
  startTimeUnixNano?: number;     // backdating (pageload root needs this in a later slice)
  spanType?: string;              // sets the flare.span_type attribute
};

// on Tracer; thin passthroughs on Flare
startSpan(name: string, opts?: SpanOptions): Span;
withSpan<T>(name: string, fn: (span: Span) => T, opts?: SpanOptions): T;   // sync + Promise-aware
getActiveSpan(): Span | undefined;
```

### Trace state (internal)

The "decided once at the root, inherited by children" and `maxSpansPerTrace` requirements need a per-trace store. The
`Tracer` holds a small internal map keyed by `traceId`:

```ts
type TraceState = {
    traceId: string;
    recording: boolean; // the head sampling decision; children read this, never re-sample
    startedSpanCount: number; // monotonic; enforces maxSpansPerTrace
    openSpanCount: number; // started-not-yet-ended; drives pruning
};
```

Rules:

- A new root creates its `TraceState`, runs the sampler once, stores `recording`, seeds both counts to 0.
- **Cap (exact).** At every `startSpan` resolving to an existing trace, check **before** incrementing:
  `if (state.startedSpanCount >= maxSpansPerTrace)` → the span is created non-recording (will not buffer), drop
  debug-logged; **else** `state.startedSpanCount++`. With the default 1024 this records exactly 1024 spans (counts
  0…1023 pass, the 1025th is rejected at count 1024), not 1023.
- `openSpanCount` increments when a recording span starts and decrements on its `end()`.
- A child reads `recording` from its trace's state — it does not call the sampler. A sampled-out trace yields
  non-recording children whose `end()` is a buffering no-op.
- **Plain parent object** (`opts.parent: { traceId, spanId }` with no live `Span`): **first look up an existing
  `TraceState` by `traceId`.** If one exists, inherit its `recording` (so a known, sampled-out trace cannot be
  resurrected into recording by passing a stripped parent). Only when no local state exists for that `traceId` create
  a fresh one defaulting `recording: true` (the safe default for a genuinely-external parent — we cannot prove it was
  sampled out). The continuation hook (below) is the path that carries a real upstream sampling decision; a bare parent
  object does not.
- **Pruning.** A `TraceState` is removed once its root span has ended AND `openSpanCount === 0` (no live descendants).
  A bounded LRU backstop caps the number of concurrent live traces so a pathological app that never ends spans cannot
  grow the map without bound. `startedSpanCount` (monotonic) is for the cap only; `openSpanCount` is what tells pruning
  whether spans are still open — a cumulative count alone cannot.

### Parenting

Resolved at `startSpan`:

1. `opts.parent` given → child of it (adopt its `traceId`, `parentSpanId` = its `spanId`; see plain-parent-object rule
   in Trace state).
2. else an active span is set → child of the active span.
3. else a continued traceparent exists (set via the continuation hook — see traceparent section, one-shot) → adopt its
   `traceId`, `parentSpanId` = its `spanId`.
4. else → new root: fresh `traceId` + `spanId`, `parentSpanId = null`.

### Active context (`context.ts`)

Explicit holder, no zone.js. `withSpan` sets the span active for the **synchronous** duration of `fn` (try/finally
restore of the previous active span). If `fn` returns a Promise, the span ends on settle, but the active context is
NOT held across the `await` — this is the documented Sentry-style limitation (research §4.4). `startSpan` does NOT
auto-activate; the caller ends it manually. The holder is a small interface so Node can later substitute an
AsyncLocalStorage-backed implementation without changing callers.

### Status behavior in `withSpan`

- `fn` throws → set `status = { code: 2, message }`, `end()`, rethrow.
- `fn` returns / resolves cleanly → leave `Unset` (caller may set `Ok` explicitly).
- `fn` returns a rejecting Promise → set `Error` on rejection, end, re-reject.

## Sampler (`sampler.ts`)

```ts
type SamplingContext = {
    name: string;
    parentSampled?: boolean; // from an inbound traceparent flag
    attributes: Attributes;
    spanType?: string;
};
type TracesSampler = (ctx: SamplingContext) => number | boolean; // probability 0-1, or boolean
```

Head-based: the decision is made **once at the root** and inherited unchanged by every child in that trace (children
read a flag on the trace, they do not re-roll). Resolution order at the root:

1. inbound traceparent sampled flag present → inherit it (upstream wins; PHP parity, research §3.3).
2. else `config.tracesSampler(ctx)` if set → number (probability) or boolean.
3. else `config.tracesSampleRate` (uniform 0–1).
4. default rate `1.0` (record everything until volume is understood).

`tracesSampleRate: 0` (or a sampled-out decision) keeps the tracer active — IDs are still generated so the browser
layer can still inject `traceparent` for backend continuation later — but the root and its children are marked
not-recording: `isRecording` is `false` and `end()` is a no-op for buffering. The RNG is injected so tests can seed it.

## SpanBuffer (`SpanBuffer.ts`)

Copies `Logger`'s batching mechanics (`packages/core/src/logging/Logger.ts`):

- Three flush triggers: count (`maxSpanBufferSize`, default 100), bytes (`spanFlushMaxBytes`, default 800_000), timer
  (`spanFlushIntervalMs`, default 5000ms) with the same `unref()` handling for Node.
- Oversized-span drop guard at capture: a single span larger than `spanFlushMaxBytes` is dropped (debug-logged), since
  it can never ship and would make the trim unsatisfiable.
- `trim()` safety net (count cap + byte cap) identical in spirit to `Logger.trim()`.
- Keepalive packing on `visibilitychange:hidden` via the shared `FlushScheduler`: ship only what fits the ~60KB
  keepalive budget (`keepaliveMaxBytes`, reused from the logging config), retain the over-budget tail and re-arm the
  timer (same logic as `Logger.packForKeepalive` / keepalive branch of `flush`).
- Key gate: `assertKey(config.key, config.debug)` before sending; retain the buffer if no key is set.
- Only **finished** spans enter the buffer (`Span.end()` is what pushes). Open spans are never buffered, satisfying the
  backend missing-end-time guard (research §2.2 / B4).

The buffer logic is intentionally duplicated from `Logger` rather than extracted to a shared base. The trigger policy is
small, and logs vs spans may diverge (e.g. spans gain trace-level grouping). Revisit extraction only if they stay
identical.

## OTLP envelope (`envelope.ts`)

`buildTracesEnvelope(spans, resourceAttributes, scopeName, scopeVersion)` mirrors `buildLogsEnvelope()`
(`packages/core/src/logging/envelope.ts`):

```
resourceSpans[0].resource.attributes       # attributesToOpenTelemetry(resourceAttributes)
resourceSpans[0].resource.droppedAttributesCount = 0
resourceSpans[0].scopeSpans[0].scope        # { name: sdk.name, version: sdk.version, attributes: [], dropped: 0 }
resourceSpans[0].scopeSpans[0].spans[]      # each BufferedSpan -> OtelSpan (above)
```

- `parentSpanId` is **always present** in the emitted span object, set to `null` for roots. The Flare backend
  validator requires the key (`ValidateTraceIngressPayloadAction.php:149` fails on a missing key, accepts string or
  null), and the PHP exporter always emits it (`OpenTelemetryJsonExporter.php:105`). Do NOT omit it — omission fails
  ingress validation and drops the report.
- Resource attributes are built the same way as `Logger.resourceForFlush()`: `telemetry.sdk.language=javascript`,
  `telemetry.sdk.name`, `telemetry.sdk.version`, `flare.language.name=javascript`, plus `service.name/version/stage`
  and `flare.framework.name/version` when configured.
- The output must be byte-compatible with the PHP `OpenTelemetryJsonExporter` for the same logical span. This is
  enforced by a golden-fixture test (see Testing).

## Transport

Add `Api.traces()` to `packages/core/src/api/Api.ts`, a clone of `Api.logs()`:

```ts
traces(
  envelope: TracesEnvelope,
  url: string,
  key: string | null,
  debug: boolean = false,
  keepalive: boolean = false,
): Promise<void>
```

- POST OTLP/JSON. Headers: `Accept: application/json`, `Content-Type: application/json`, `x-api-token: key ?? ''`.
  `keepalive` passed through to `fetch`. URL sent unchanged.
- **No `?key=` query fallback.** `Api.logs()` already ships OTLP from the browser with the header alone and works, so
  the fallback adds nothing for traces while putting the key in a URL (access logs / referrers). The PHP `CurlSender`
  uses the query form only because curl has no shared header default; it is not a contract. Decision: clone `logs()`
  exactly — header only. (Resolves the review contradiction between "clone `logs()` exactly" and the earlier
  `?key=` note.)
- Body serialized with `flatJsonStringify` (same as `logs()` — span attributes are raw user data that can contain
  cycles).
- v1 error handling matches `logs()`: in debug mode, log a non-201 response. Full status-code retry/backoff
  (201 ok / 422 drop-no-retry / 429 backoff / 5xx retry / 401-403 stop, research §2.7) is noted as a follow-on, not
  built here — keeps this slice in parity with the existing logs transport rather than introducing a retry queue the
  logs path does not yet have.
- Default `tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces'`.

## Config additions

Added to `Config` (`packages/core/src/types.ts`), merged by the existing `flare.configure(partial)`:

```ts
enableTracing: boolean;            // default false (parity with enableLogs)
tracesIngestUrl: string;           // default 'https://ingress.flareapp.io/v1/traces'
tracesSampleRate: number;          // default 1.0
tracesSampler?: TracesSampler;     // optional; takes precedence over tracesSampleRate
maxSpanBufferSize: number;         // default 100
spanFlushIntervalMs: number;       // default 5000
spanFlushMaxBytes: number;         // default 800_000
maxSpansPerTrace: number;          // default 1024  (PHP parity)
maxAttributesPerSpan: number;      // default 128   (PHP parity)
maxEventsPerSpan: number;          // default 128   (PHP parity)
maxAttributesPerSpanEvent: number; // default 128   (PHP parity)
// keepaliveMaxBytes is reused from the logging config (shared 60KB budget)
```

Everything is gated on `enableTracing`: when false, `startSpan`/`withSpan` return inert (non-recording) spans and
nothing is buffered or sent — exactly how `enableLogs` gates the logger.

**Enabled→disabled transition.** `configure()` (`Flare.ts:262`) already captures `wasLogsEnabled` and calls
`this._logger.clear()` on a real enabled→disabled flip (line 273), and flushes on a key set (line 277). Mirror both:
capture `wasTracingEnabled` before the merge and, on `wasTracingEnabled && this._config.enableTracing === false`, call
`this._tracer.clear()`. `Tracer.clear()` drops the buffered spans, cancels the flush timer, discards any pending
one-shot continuation, and empties the trace-state map (parallel to `Logger.clear()`, which clears buffer + timer).
The key-set branch that flushes the logger also flushes the tracer (spans buffered while keyless drain once a key
arrives).

## IDs and traceparent

`ids.ts` (port of the PHP `Ids`, research §4.4):

```ts
randomHex(bytes: number): string;   // crypto.getRandomValues; Math.random fallback in insecure contexts;
                                     // forbid all-zeroes (W3C) by forcing the last byte to 1 if needed
traceId(): string;                   // randomHex(16) -> 32 hex chars
spanId(): string;                    // randomHex(8)  -> 16 hex chars
```

`traceparent.ts`:

```ts
buildTraceparent(traceId: string, spanId: string, sampled: boolean): string;   // "00-{tid}-{sid}-{01|00}"
parseTraceparent(header: string): { traceId: string; parentSpanId: string; sampled: boolean } | null;
```

- Build emits the sampled flag as exactly `01` / `00` (interop with the PHP client's strict `=== '01'` parse,
  research §3.3 / P2).
- Parse accepts only version `00`; reads sampled via strict `=== '01'`. Mirrors current PHP behavior. Moving both
  sides to a bitmask is explicitly out of scope for v1.

Core ships build + parse as pure helpers only. **Inbound continuation** (reading a header or SSR meta tag and seeding
the tracer) and **outbound injection** (the fetch/XHR patch) belong to the browser layer and are out of scope. To let
the sampler honor an upstream decision now, the `Tracer` exposes a single continuation hook
(e.g. `continueFromTraceparent(header)`) that stores the parsed `{ traceId, parentSpanId, sampled }` so the next root
adopts it (parenting rule 3, sampler rule 1). The hook is part of the public surface; the code that calls it lives in
later slices.

**One-shot semantics (load-bearing).** The stored continuation is consumed by the **next** root span and cleared on
read. It does NOT persist: a later, unrelated root must not inherit a stale external parent or its sampling decision.
Concretely — `continueFromTraceparent(h)` overwrites any unconsumed pending continuation; the first `startSpan` that
falls to parenting rule 3 reads it, adopts `traceId`/`parentSpanId`, seeds the trace state's `recording` from the
upstream `sampled` flag, then nulls the pending slot. A subsequent root with no fresh continuation falls through to
rule 4 (brand-new trace). Tested explicitly (see Testing).

## Testing

TDD with Vitest in `packages/core/tests/`. Extend the shared `helpers/FakeApi.ts` with a `traces()` capture parallel to
its `logs()` capture.

- **ids**: hex length (32 / 16), lowercase, never all-zeroes, `Math.random` fallback path when `crypto` is stubbed
  absent.
- **traceparent**: build format, parse of valid / malformed / wrong-version headers, `01`/`00` sampled round-trip.
- **sampler**: rate 0 / 1 / fractional with a seeded RNG, `tracesSampler` precedence over rate, inbound-traceparent
  inheritance, children inheriting the root decision (no re-roll).
- **trace state**: child inherits root `recording` across an explicit `Span` parent; a plain `{traceId, spanId}`
  parent inherits existing local state when present (a sampled-out trace stays non-recording) and defaults recording
  only when no state exists; `maxSpansPerTrace: N` records **exactly N** spans (the N+1th is non-recording); sampled-out
  trace yields non-recording children; trace state pruned after root end with `openSpanCount === 0`.
- **traceparent continuation (one-shot)**: a stored continuation is consumed by the next root only and cleared — a
  second root with no fresh continuation starts a brand-new trace and does NOT inherit the prior external parent or
  its sampling flag.
- **Span lifecycle**: `end()` idempotent, status rules in `withSpan` (throw / clean / reject), span attribute and
  event caps enforced with correct `droppedAttributesCount`/`droppedEventsCount`, **per-event** attribute cap enforced
  with the event's own `droppedAttributesCount`, an open span never buffered, a sampled-out span non-recording.
- **SpanBuffer**: each of the three triggers, oversized-span drop, trim, keepalive packing + tail retention + timer
  re-arm, key gate retains buffer. Lift the existing `Logger` test patterns.
- **envelope**: byte-compatible OTLP output versus a recorded `OpenTelemetryJsonExporter` (PHP) payload for the same
  logical span (incl. per-event dropped counts) — golden fixture committed under `tests/fixtures/`. Assert a root span
  emits `parentSpanId: null` (key present, not omitted).
- **Api.traces**: header + key (no `?key=` query — URL unchanged), `keepalive` flag forwarded, non-201 debug logging.
- **Flare integration**: `Flare.flush()` drains buffered spans (not just logs) before resolving; `Flare.light()`
  flushes spans buffered while keyless; `configure({ enableTracing: false })` after it was enabled calls
  `Tracer.clear()` (buffer + timer + pending continuation + trace state all dropped); public exports
  (`startSpan`/`withSpan`/`Tracer`/types) are reachable from the package entry. Mirror the existing logger integration
  tests.

Run: `npx vitest run` from `packages/core`, or `npm run test` from the repo root.

## Out of scope (later specs)

fetch/XHR monkeypatch + `traceparent` injection; `PerformanceObserver` (navigation/resource/paint/longtask/LoAF);
`web-vitals`; pageload/navigation root spans; all framework router + render integration (React/Vue/Svelte/SvelteKit);
SSR meta-tag handoff; a Node AsyncLocalStorage active-context holder; transport retry/backoff queue.

## External prerequisites

These do not block building or unit-testing the core, but they block real end-to-end value:

- **B9** — confirm `POST /v1/traces` accepts the project's **public** key and serves CORS for browser origins. One
  live test-POST (or a one-line backend confirm) before shipping. Low risk: mirrors the proven `/v1/logs` path; no
  client code enforces a private-only rule.
- **B5** — the Flare backend must add browser `SpanType` enum cases + matching `SpanAggregator`s + agree the attribute
  contract (route name, http method, url, render component). Until then JS spans store as `Unknown` and never surface
  in the performance product. Cross-team gating item for product visibility, not for this client slice.
- **P4** — confirm the `spatie/laravel-flare` version customers run reads inbound `traceparent`
  (`FlareServiceProvider.php:197`). Determines whether `traceparent`-only correlation is safe in the later
  browser/SSR slices.

```

```
