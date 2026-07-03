# Spec: tracing span-context alignment (PHP-shaped, drift-free) — `@flareapp/core` + `@flareapp/js`

Status: design approved 2026-07-03. Scope: fix browser span attributes to match the PHP client's model (rich context on request-roots, lean children, separate resource) and eliminate the context-drift bug. Branch: `research/performance-tracing`.

## Context

Manual testing of the [pageload/navigation roots slice](2026-07-02-performance-tracing-pageload-navigation-roots-design.md) surfaced a real defect in the span attributes on the wire:

- **Context drift.** Every span currently runs the full browser context collector (`collectBrowser`) in `Tracer.onSpanEnd` — i.e. at span **end** time. A pageload/navigation root is a long-lived idle span; by the time it closes (idle, ~1s later, often _because_ the user navigated away), the live collector reads the _new_ page. So a root representing `/` was observed with `url.full: /broken` and `flare.entry_point.handler.identifier: /broken`. Confirmed by tracing `Tracer.onSpanEnd` → `Flare.buildSpanAttributes` → `this.contextCollector(config)` (a live `window.location`/cookie read).
- **Cookies + full request context on every span**, including lean fetch children — heavy and a privacy smell.
- **Redundant/non-standard keys.** The roots slice manually set `context.url` / `context.route` / `context.user_agent` / `context.viewport`, which duplicate the collector's canonical `url.full` / `flare.entry_point.handler.identifier` / `user_agent.original` and disagree with them under drift.

### Reference: how the PHP client (`spatie/flare-client-php`) models span attributes

Verified in `/Users/driesheyninck/projects/flare-client-php`:

- **Resource is a first-class, separate object** (`src/Resource.php`), exported once per envelope (`resource->export(...)`). It is not attached to spans.
- **The request ROOT span carries the request context.** `RequestRecorder::recordStart` gives the root only `flare.span_type` + `EntryPoint::toAttributes()` (`flare.entry_point.type`/`.value`/`.handler.identifier`/`.handler.name`/`.handler.type`). `RequestRecorder::recordEnd` enriches it with the full request context (`url.full`, `user_agent.original`, `http.request.*` incl. redacted cookies/headers, route, user, response).
- **Child spans are lean.** `ExternalHttpRecorder` (outgoing HTTP, the analogue of our fetch spans) sets only `url.full` (target), `http.request.method`, sizes, headers — no page/request context, no cookies.
- **Key convention is `flare.entry_point.*` / `url.full` / `user_agent.original` / `http.request.*`** — never `context.*`.
- PHP collects request context at span _end_ with no drift, because a server request's URL is fixed for its lifetime. The browser's SPA navigation mutates the URL mid-root, so **we specifically must capture the root's context at span start.**

### Approved decisions

- **Mirror PHP's structure:** rich context on the pageload/navigation root (the browser "request root"), lean fetch children, resource sourced separately. Captured at span **start** for the browser (drift fix).
- **Root context = PHP request-root minus cookies.** The root carries `flare.entry_point.*`, `url.full`, `user_agent.original`, `http.request.referrer`, `document.ready_state`. **No cookies** — browser `document.cookie` (analytics/third-party) is lower value and higher noise than PHP's server-side request cookies. No structured query params (`requestData`) — `url.full` (redacted) already carries the query.
- **Key convention = the collector's existing keys** (`url.full`, `flare.entry_point.*`, `user_agent.original`), matching errors/logs and PHP. Drop `context.*`. Drop `context.viewport` (add later via the collector if a web-vitals/layout slice needs it, so errors + logs + spans get it uniformly).
- **Errors and logs are unchanged** — they keep the full live collector (cookies included) at report time, which is correct since they are instantaneous.

### Out of scope (noted, not fixed here)

`telemetry.sdk.version: "?"` (a client-version-generation issue, separate). The fetch-not-nesting-after-idle timing (working as designed; a later idle-default / interaction-instrumentation question). Applying the same resource separation to the Logger (logs are instantaneous; no drift; left as-is).

## Architecture

Three moves. Core stops auto-collecting DOM context onto spans and sources resource stably; the browser attaches the rich root context at start and keeps children lean.

### 1. Core — stop auto-collecting DOM context on spans

Today `Tracer.onSpanEnd` calls `this.deps.buildSpanAttributes(span.attributes)`, and `Flare.buildSpanAttributes` runs `this.contextCollector(config)` live (`Flare.ts:611-617`). That live collect is the drift and the cookies-on-every-span source. Change so a span carries only its **own** attributes (set at `startSpan` via `opts.attributes` and `setAttribute` during its life) plus user scope context — never an auto DOM collect. This mirrors PHP, where each recorder sets its span's attributes and nothing auto-collects.

- `Flare.buildSpanAttributes(userAttributes)` becomes record-only and **does not call `this.contextCollector`**. It is `this.assembleAttributes({}, userAttributes, false)` — i.e. the existing assembly (scope `pendingAttributes`, entry-point overrides, framework-in-`context.custom`, user attributes win) but with an empty collector map. Returns `Attributes` (record), not `{ record, resource }`.
- The `TracerDeps.buildSpanAttributes` signature changes from `(userAttributes) => { record, resource }` to `(userAttributes) => Attributes` (record only).
- `Tracer.onSpanEnd` sets `buffered.recordAttributes = attributesToOpenTelemetry(record)` and no longer produces `resourceAttributes`.

Because the span's attributes are fixed at start (plus any `setAttribute` the span makes about itself, e.g. the fetch wrapper's `http.response.status_code`), there is no re-collection at end and therefore no drift.

### 2. Core — source resource from a stable provider

`SpanBuffer` currently takes resource from the last added span (`this.resourceAttributes = span.resourceAttributes` in `add`, merged in `resourceForFlush`). With lean children that carry no `host.name`, a batch ending on a child would lose it. Fix by sourcing resource stably, like PHP's `Resource`.

- Add `getResourceAttributes: () => Attributes` to `SpanBufferDeps` and `TracerDeps`.
- `SpanBuffer.resourceForFlush()` becomes `{ ...this.deps.getResourceAttributes(), ...identity }`. Remove the `private resourceAttributes` field and its assignment in `add`.
- `identity` already contains `telemetry.sdk.*`, `flare.language.name`, `service.*`, `flare.framework.*` (`SpanBuffer.ts:129-144`) — so `getResourceAttributes` only needs to supply `host.name` (the sole resource-level key `collectBrowser` emits).
- `Flare` wires `getResourceAttributes: () => partitionAttributes(this.contextCollector(this._config)).resource`. This reuses the existing collector and keeps only its resource partition (`host.name`), discarding the record-level cookies/url — so no cookies reach spans, no new browser export is needed, and it runs once per flush (not per span). `host.name` is origin-stable, so end-time evaluation is fine.
- Remove `resourceAttributes` from the `BufferedSpan` type (`types.ts`) and from the object built in `Tracer.onSpanEnd`. (Leave the `BufferedLog` `resourceAttributes` and the Logger untouched — out of scope.)

### 3. Browser — rich context on roots (at start), lean fetches

- **Factor `collectBrowser`** (`packages/js/src/browser/context/collectBrowser.ts`) so its entry-point block becomes a reusable `browserEntryPoint(config): Attributes` (returning `flare.entry_point.type`/`.value`/`.handler.identifier`/`.handler.type`, redacted via `redactUrlQuery`). `collectBrowser` keeps its current behavior (entry-point + `host.name` + `request()` + `requestData()` + `cookie()`) by composing the extracted helper — no change to error/log output.
- **New `collectBrowserSpanContext(config): Attributes`** = `{ ...browserEntryPoint(config), ...request(config.urlDenylist) }` — i.e. `flare.entry_point.*` + `url.full` + `user_agent.original` + `http.request.referrer` + `document.ready_state`, all redacted. Explicitly **excludes** `cookie()`, `requestData()`, and `host.name`. No-op-safe outside a browser (returns `{ 'flare.entry_point.type': 'server' }`-style fallback like `collectBrowser`, or `{}` — match `collectBrowser`'s guard).
- **`browserTracing.startRoot`** attaches `collectBrowserSpanContext(flare.config)` into the root's `attributes` at creation, and **drops** the manual `context.url` / `context.route` / `context.user_agent` / `context.viewport` / `flare.entry_point.type`. Because these are set at span start and the Tracer no longer re-collects, they reflect the page the root represents. (Keep `flare.span_type`, set by the Tracer from `opts.spanType`.)
- **The fetch wrapper is unchanged.** With the auto-collector removed, a fetch span now carries only its own `flare.span_type`, `http.request.method`, `url.full` (target), `server.address`/`server.port`, `http.response.status_code` — the lean child, matching PHP's `ExternalHttpRecorder`.

## Data flow (fixed)

- `startBrowserTracing`/navigation → `startRoot` → `flare.startSpan(path, { spanType, startTimeUnixNano, attributes: collectBrowserSpanContext(config) })`. The rich context is captured **now**, at the page the root represents.
- Root idles and ends ~1s later (possibly on a different page) → `onSpanEnd` buffers the span's **own** attributes (the start-time snapshot) — no re-collect, no drift.
- Fetch under an active root → `startSpan` (no collector) → carries only its `http.*` — lean child, nested via the active-root holder (unchanged).
- Flush → envelope resource = `getResourceAttributes()` (`host.name`) + stable identity (sdk/language/service/framework).

## Net attributes on the wire

- **pageload/navigation root:** `flare.span_type`, `flare.entry_point.type`, `flare.entry_point.value`, `flare.entry_point.handler.identifier`, `flare.entry_point.handler.type`, `url.full`, `user_agent.original`, `http.request.referrer`, `document.ready_state` — start-captured, correct page, no cookies.
- **fetch child:** `flare.span_type`, `http.request.method`, `url.full` (target), `server.address`, `server.port`, `http.response.status_code`.
- **resource (once/envelope):** `host.name`, `telemetry.sdk.language`, `telemetry.sdk.name`, `telemetry.sdk.version`, `flare.language.name`, `service.*`, `flare.framework.*`.
- **errors/logs:** unchanged (full context incl. cookies, at report time).

## Files touched

- `packages/core/src/Flare.ts` — `buildSpanAttributes` record-only (no collector); wire `getResourceAttributes` into the Tracer.
- `packages/core/src/tracing/Tracer.ts` — `TracerDeps.buildSpanAttributes` returns `Attributes`; add `getResourceAttributes` dep, pass to `SpanBuffer`; `onSpanEnd` drops `resourceAttributes`.
- `packages/core/src/tracing/SpanBuffer.ts` — add `getResourceAttributes` dep; `resourceForFlush` uses it; remove `resourceAttributes` field/assignment.
- `packages/core/src/types.ts` — remove `resourceAttributes` from `BufferedSpan`.
- `packages/js/src/browser/context/collectBrowser.ts` — extract `browserEntryPoint`.
- `packages/js/src/browser/context/collectBrowserSpanContext.ts` (new) — the lean root-context collector.
- `packages/js/src/tracing/browserTracing.ts` — attach `collectBrowserSpanContext` at start; drop `context.*`.
- `packages/js/src/browser.ts` — if needed, wire the js `Flare`'s resource collector (default path already works via `contextCollector`).

## Testing

**Core.**

- Drift: with a stubbed `contextCollector`/`buildSpanAttributes` whose return changes between `startSpan` and `.end()`, the buffered span carries the **start** value (the regression that motivated this).
- `buildSpanAttributes` no longer invokes the DOM collector for spans (spy the collector; assert not called during span build); the span record = its own attributes + scope context only.
- Resource: a batch containing only lean child spans (no `host.name` on any span) still flushes an envelope whose resource has `host.name` (from `getResourceAttributes`).
- `BufferedSpan` no longer carries `resourceAttributes`; envelope resource comes solely from `resourceForFlush`.

**Browser (js).**

- `collectBrowserSpanContext` returns `flare.entry_point.*` + `url.full` + `user_agent.original` + `http.request.referrer` + `document.ready_state`; excludes `http.request.cookies`, `requestData` keys, `host.name`; applies `redactUrlQuery`.
- `collectBrowser` (errors/logs) still returns the full set incl. cookies + host.name (no regression from the `browserEntryPoint` extraction).
- `browserTracing` roots carry the lean-rich context and no `context.*`.

**E2e (js).**

- Navigate `/` → `/broken`; assert the `/` root's `url.full` / `flare.entry_point.handler.identifier` are `/` (not the post-navigation page) — the drift, fixed.
- A `browser_fetch` span carries no `http.request.cookies` and no page-context keys beyond its own `http.*`/`url.full`.
- The envelope resource has `host.name`.
- No span carries a `context.*` key.

## Acceptance

- `npm run typescript` clean; `npm run test` green incl. new core + js tests; `npm run build` clean.
- `npx playwright test --project=js` green, incl. the updated span-attribute assertions.
- Manual: `npm run playgrounds:js` against an ingest, navigate around, and confirm each root's `url.full`/`entry_point` matches the page it represents, fetch children are lean (no cookies), and resource carries `host.name`.
