# Spec: tracing span-context alignment (PHP-shaped, drift-free) — `@flareapp/core` + `@flareapp/js`

Status: design approved 2026-07-03; revised same day after review (scope snapshot at start on local roots, keepalive resource caching, test-plan corrections). Scope: fix browser span attributes to match the PHP client's model (rich context on request-roots, lean children, separate resource) and eliminate the context-drift bug. Branch: `research/performance-tracing`.

## Context

Manual testing of the [pageload/navigation roots slice](2026-07-02-performance-tracing-pageload-navigation-roots-design.md) surfaced a real defect in the span attributes on the wire:

- **Context drift.** Every span currently runs the full browser context collector (`collectBrowser`) in `Tracer.onSpanEnd` — i.e. at span **end** time. A pageload/navigation root is a long-lived idle span; by the time it closes (idle, ~1s later, often _because_ the user navigated away), the live collector reads the _new_ page. So a root representing `/` was observed with `url.full: /broken` and `flare.entry_point.handler.identifier: /broken`. Confirmed by tracing `Tracer.onSpanEnd` → `Flare.buildSpanAttributes` → `this.contextCollector(config)` (a live `window.location`/cookie read).
- **Cookies + full request context on every span**, including lean fetch children — heavy and a privacy smell.
- **Redundant/non-standard keys.** The roots slice manually set `context.url` / `context.route` / `context.user_agent` / `context.viewport`, which duplicate the collector's canonical `url.full` / `flare.entry_point.handler.identifier` / `user_agent.original` and disagree with them under drift.

### Reference: how the PHP client (`spatie/flare-client-php`) models span attributes

Verified in `/Users/driesheyninck/projects/flare-client-php`:

- **Resource is a first-class, separate object** (`src/Resources/Resource.php`), exported once per envelope (`resource->export(...)`). It is not attached to spans.
- **The request ROOT span carries the request context.** `RequestRecorder::recordStart` gives the root only `flare.span_type` + `EntryPoint::toAttributes()` (`flare.entry_point.type`/`.value`/`.handler.identifier`/`.handler.name`/`.handler.type`). `RequestRecorder::recordEnd` enriches it with the full request context (`url.full`, `user_agent.original`, `http.request.*` incl. redacted cookies/headers, route, user, response).
- **Child spans are lean.** `ExternalHttpRecorder` (outgoing HTTP, the analogue of our fetch spans) sets only `url.full` (target), `http.request.method`, sizes, headers — no page/request context, no cookies.
- **Key convention is `flare.entry_point.*` / `url.full` / `user_agent.original` / `http.request.*`** — never `context.*`.
- PHP collects request context at span _end_ with no drift, because a server request's URL is fixed for its lifetime. The browser's SPA navigation mutates the URL mid-root, so **we specifically must capture the root's context at span start.**

### Approved decisions

- **Mirror PHP's structure:** rich context on the pageload/navigation root (the browser "request root"), lean fetch children, resource sourced separately. Captured at span **start** for the browser (drift fix).
- **Scope context attaches to local roots only, snapshotted at start.** The scope-derived record (user `flare.context()` / identity keys, entry-point overrides, framework-in-`context.custom`) is read once when a local root starts, never at span end. Children carry only their own attributes, like PHP's child recorders. This closes the residual drift path where a long-lived root would read the scope at end time and pick up state from the next page; scope changes after a root starts apply to the next root, not the open one.
- **Root context = PHP request-root minus cookies.** The root carries `flare.entry_point.*`, `url.full`, `user_agent.original`, `http.request.referrer`, `document.ready_state`. **No cookies** — browser `document.cookie` (analytics/third-party) is lower value and higher noise than PHP's server-side request cookies. No structured query params (`requestData`) — `url.full` (redacted) already carries the query. (`document.ready_state` is only informative on pageload roots; navigation roots always read `complete`. Kept for uniformity with errors.)
- **Key convention = the collector's existing keys** (`url.full`, `flare.entry_point.*`, `user_agent.original`), matching errors/logs and PHP. Drop the manual `context.url` / `context.route` / `context.user_agent` / `context.viewport` (viewport can return later via the collector if a web-vitals/layout slice needs it, so errors + logs + spans get it uniformly). `context.custom` is **not** dropped: it is scope context and appears on roots via the scope snapshot.
- **Precedence:** a span's own attributes are spread last and win over the scope snapshot, so a root's start-captured `flare.entry_point.*` beats scope entry-point overrides. Framework router integrations that want route names on traces must set attributes on the root span (a follow-up slice), not `scope.entryPoint`. (Errors keep the opposite precedence — scope entry point wins over collector defaults — unchanged.)
- **Consequence — manual roots carry no page context.** A user-created `flare.startSpan()` root gets its own attributes plus the scope snapshot, but no DOM context (nothing auto-collects anymore). Intentional and PHP-shaped: page context belongs to the browser request root, attached by `browserTracing`. A continued trace (`continueFromTraceparent`) still gets the scope snapshot on its first local span: it has a remote parent but it IS this participant's local root, and PHP behaves the same way (`Lifecycle::start` attaches the application/request context regardless of an inbound traceparent). This also covers the future pageload-continuation case, where a server-injected traceparent must not strip the browser root of its context. (Revised 2026-07-03 during implementation; the original design said the opposite and lost to PHP parity.)
- **Errors and logs are unchanged** — they keep the full live collector (cookies included) at report time, which is correct since they are instantaneous.

### Out of scope (noted, not fixed here)

`telemetry.sdk.version: "?"` (a client-version-generation issue, separate). The fetch-not-nesting-after-idle timing (working as designed; a later idle-default / interaction-instrumentation question). Applying the same resource separation to the Logger (logs are instantaneous; no drift; left as-is).

## Architecture

Three moves. Core stops auto-collecting DOM context onto spans, snapshots scope at start on local roots, and sources resource stably; the browser attaches the rich root context at start and keeps children lean.

### 1. Core — no DOM collect on spans; scope snapshotted at start, local roots only

Today `Tracer.onSpanEnd` calls `this.deps.buildSpanAttributes(span.attributes)`, and `Flare.buildSpanAttributes` runs `this.contextCollector(config)` live (`Flare.ts:611-617`). That live collect is the drift and the cookies-on-every-span source. It also reads the active scope at end time — the same drift shape for scope-sourced values (user context, entry-point overrides). Change so a span carries only its **own** attributes (set at `startSpan` via `opts.attributes` and `setAttribute` during its life), plus — for local roots only — a scope snapshot taken at start. This mirrors PHP, where each recorder sets its span's attributes, the request root carries the request/user context, and nothing auto-collects.

- Replace `TracerDeps.buildSpanAttributes: (userAttributes) => { record, resource }` with `getScopeAttributes: () => Attributes`. `Flare` implements it as `this.assembleAttributes({}, {}, false)` — the existing assembly (scope `pendingAttributes`, entry-point overrides, framework-in-`context.custom`) with an empty collector map and no user attributes. **It does not call `this.contextCollector`.**
- `Tracer.startSpan` snapshots `getScopeAttributes()` at creation for spans that are **recording local roots** — the span the trace state registers as `localRootSpanId`: a new root (`parentSpanId === null`) or the first local span of a continued trace. The snapshot is stored on the span (`SpanImpl`). Child spans get no snapshot — they stay lean.
- `Tracer.onSpanEnd` sets `buffered.recordAttributes = attributesToOpenTelemetry({ ...scopeSnapshot, ...span.attributes })` (snapshot `{}` for children) and no longer produces `resourceAttributes`. The span's own attributes are spread last, so start-captured root context wins over scope overrides (see the precedence decision above).

Because the root's page context and its scope snapshot are both fixed at start (plus any `setAttribute` the span makes about itself, e.g. the fetch wrapper's `http.response.status_code`), there is no re-collection or scope re-read at end and therefore no drift, DOM- or scope-sourced.

### 2. Core — source resource from a stable provider

`SpanBuffer` currently takes resource from the last added span (`this.resourceAttributes = span.resourceAttributes` in `add`, merged in `resourceForFlush`). With lean children that carry no `host.name`, a batch ending on a child would lose it. Fix by sourcing resource stably, like PHP's `Resource`.

- Add `getResourceAttributes: () => Attributes` to `SpanBufferDeps` and `TracerDeps`.
- `SpanBuffer.resourceForFlush()` becomes `{ ...this.deps.getResourceAttributes(), ...identity }`. Remove the `private resourceAttributes` field and its assignment in `add`.
- Evaluate the resource **once per `flush()` call** and thread it into `buildEnvelope`. `packForKeepalive` builds one trial envelope per buffered span on the pagehide path; the collector (cookie parsing included) must not re-run per trial.
- `identity` already contains `telemetry.sdk.*`, `flare.language.name`, `service.*`, `flare.framework.*` (`SpanBuffer.ts:129-144`) — so `getResourceAttributes` only needs to supply `host.name` (the sole resource-level key `collectBrowser` emits).
- `Flare` wires `getResourceAttributes: () => partitionAttributes(this.contextCollector(this._config)).resource`. This reuses the existing collector and keeps only its resource partition (`host.name`), discarding the record-level cookies/url — so no cookies reach spans, no new browser export is needed, and it runs once per flush (not per span). `host.name` is origin-stable, so end-time evaluation is fine.
- Remove `resourceAttributes` from the `BufferedSpan` type (`types.ts`) and from the object built in `Tracer.onSpanEnd`. (Leave the `BufferedLog` `resourceAttributes` and the Logger untouched — out of scope.)

### 3. Browser — rich context on roots (at start), lean fetches

- **Factor `collectBrowser`** (`packages/js/src/browser/context/collectBrowser.ts`) so its entry-point block becomes a reusable `browserEntryPoint(config): Attributes` (returning `flare.entry_point.type`/`.value`/`.handler.identifier`/`.handler.type`, redacted via `redactUrlQuery`). `collectBrowser` keeps its current behavior (entry-point + `host.name` + `request()` + `requestData()` + `cookie()`) by composing the extracted helper — no change to error/log output.
- **New `collectBrowserSpanContext(config): Attributes`** = `{ ...browserEntryPoint(config), ...request(config.urlDenylist) }` — i.e. `flare.entry_point.*` + `url.full` + `user_agent.original` + `http.request.referrer` + `document.ready_state`, all redacted. Explicitly **excludes** `cookie()`, `requestData()`, and `host.name`. No-op-safe outside a browser: returns `{}`. (Its only caller, `browserTracing`, already guards on `typeof window`; a `'server'` entry-point fallback like `collectBrowser`'s would be wrong on a browser root span.)
- **`browserTracing.startRoot`** attaches `collectBrowserSpanContext(flare.config)` into the root's `attributes` at creation, and **drops** the manual `context.url` / `context.route` / `context.user_agent` / `context.viewport` / `flare.entry_point.type`. Because these are set at span start and the Tracer no longer re-collects, they reflect the page the root represents. (Keep `flare.span_type`, set by the Tracer from `opts.spanType`.)
- **The fetch wrapper is unchanged.** With the auto-collector removed, a fetch span now carries only its own `flare.span_type`, `http.request.method`, `url.full` (target), `server.address`/`server.port`, `http.response.status_code` — the lean child, matching PHP's `ExternalHttpRecorder`.

## Data flow (fixed)

- `startBrowserTracing`/navigation → `startRoot` → `flare.startSpan(path, { spanType, startTimeUnixNano, attributes: collectBrowserSpanContext(config) })`. The rich context is captured **now**, at the page the root represents.
- Root idles and ends ~1s later (possibly on a different page) → `onSpanEnd` buffers `{ ...scopeSnapshot, ...span.attributes }`, both captured at start — no re-collect, no scope re-read, no drift.
- Fetch under an active root → `startSpan` (no collector; no scope snapshot, it has a parent) → carries only its `http.*` — lean child, nested via the active-root holder (unchanged).
- Flush → envelope resource = `getResourceAttributes()` (`host.name`) + stable identity (sdk/language/service/framework).

## Net attributes on the wire

- **pageload/navigation root:** `flare.span_type`, `flare.entry_point.type`, `flare.entry_point.value`, `flare.entry_point.handler.identifier`, `flare.entry_point.handler.type`, `url.full`, `user_agent.original`, `http.request.referrer`, `document.ready_state` — start-captured, correct page, no cookies. Plus `context.custom` when scope context is set (framework name from the integrations, user `flare.context()` values) and any scope identity/entry-point keys — snapshotted at start.
- **fetch child:** `flare.span_type`, `http.request.method`, `url.full` (target), `server.address`, `server.port`, `http.response.status_code`. No scope keys, no `context.*`.
- **resource (once/envelope):** `host.name`, `telemetry.sdk.language`, `telemetry.sdk.name`, `telemetry.sdk.version`, `flare.language.name`, `service.*`, `flare.framework.*`.
- **errors/logs:** unchanged (full context incl. cookies, at report time).

## Files touched

- `packages/core/src/Flare.ts` — replace `buildSpanAttributes` with `getScopeAttributes` (assembly only, no collector); wire `getResourceAttributes` into the Tracer.
- `packages/core/src/tracing/Tracer.ts` — `TracerDeps` swaps `buildSpanAttributes` for `getScopeAttributes`; snapshot it in `startSpan` for recording local roots; `onSpanEnd` merges snapshot + own attributes and drops `resourceAttributes`; add `getResourceAttributes` dep, pass to `SpanBuffer`.
- `packages/core/src/tracing/Span.ts` — `SpanImpl` carries the start-time scope snapshot.
- `packages/core/src/tracing/SpanBuffer.ts` — add `getResourceAttributes` dep; `resourceForFlush` uses it, evaluated once per `flush()` (keepalive packing reuses the value); remove `resourceAttributes` field/assignment.
- `packages/core/src/types.ts` — remove `resourceAttributes` from `BufferedSpan`.
- `packages/js/src/browser/context/collectBrowser.ts` — extract `browserEntryPoint`.
- `packages/js/src/browser/context/collectBrowserSpanContext.ts` (new) — the lean root-context collector.
- `packages/js/src/tracing/browserTracing.ts` — attach `collectBrowserSpanContext` at start; drop `context.*`.
- `packages/js/src/browser.ts` — if needed, wire the js `Flare`'s resource collector (default path already works via `contextCollector`).

## Testing

**Core.**

- Scope drift: start a local root, mutate the scope (`flare.context(...)` / entry point) before `.end()` — the buffered record carries the **start-time** snapshot (the drift class that motivated this). Note the Tracer never snapshots the DOM collector; start-time capture of page context is the browser's job (`startRoot`), tested in js/e2e below.
- The DOM collector is never invoked for spans (spy `contextCollector`; assert zero calls across `startSpan` and `.end()`).
- Children are lean: a child span's buffered record contains only its own attributes — no scope keys, no `context.custom`.
- A continued trace's first local span (remote parent, but registered as the trace's `localRootSpanId`) still gets the scope snapshot — it is this participant's local root.
- Resource: a batch containing only lean child spans (no `host.name` on any span) still flushes an envelope whose resource has `host.name` (from `getResourceAttributes`).
- Keepalive: `getResourceAttributes` is evaluated once per flush even when `packForKeepalive` builds multiple trial envelopes (spy call count).
- `BufferedSpan` no longer carries `resourceAttributes`; envelope resource comes solely from `resourceForFlush`.

**Browser (js).**

- `collectBrowserSpanContext` returns `flare.entry_point.*` + `url.full` + `user_agent.original` + `http.request.referrer` + `document.ready_state`; excludes `http.request.cookies`, `requestData` keys, `host.name`; applies `redactUrlQuery`.
- `collectBrowser` (errors/logs) still returns the full set incl. cookies + host.name (no regression from the `browserEntryPoint` extraction).
- `browserTracing` roots carry the lean-rich context and none of `context.url` / `context.route` / `context.user_agent` / `context.viewport`.

**E2e (js).**

- Navigate `/` → `/broken`; assert the `/` root's `url.full` / `flare.entry_point.handler.identifier` are `/` (not the post-navigation page) — the drift, fixed.
- A `browser_fetch` span carries no `http.request.cookies` and no page-context keys beyond its own `http.*`/`url.full`.
- The envelope resource has `host.name`.
- No span carries `context.url`, `context.route`, `context.user_agent`, or `context.viewport`. Fetch children carry no `context.*` at all; `context.custom` may legitimately appear on roots when scope context is set.

## Acceptance

- `npm run typescript` clean; `npm run test` green incl. new core + js tests; `npm run build` clean.
- `npx playwright test --project=js` green, incl. the updated span-attribute assertions.
- Manual: `npm run playgrounds:js` against an ingest, navigate around, and confirm each root's `url.full`/`entry_point` matches the page it represents, fetch children are lean (no cookies), and resource carries `host.name`.
