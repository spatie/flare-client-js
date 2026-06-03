# Core logging — standalone structured logs

Date: 2026-06-03
Status: Approved (design)

## Problem

The PHP client (`spatie/flare-client-php`) ships structured logs as a first-class
entity: an in-memory buffer of log records, shipped to Flare's `POST /v1/logs`
ingest endpoint as an OpenTelemetry `resourceLogs` payload. The JS/TS client has
no equivalent. It has two adjacent but distinct features:

- `glow()` — breadcrumbs attached to error reports as span events (PHP "glows").
- `reportMessage(..., isLog: true)` — a single log sent as a report to `/v1/errors`.

Neither provides standalone log shipping. This design adds it: buffer log entries
and POST them to `/v1/logs` as their own entity, viewable independent of errors.

## Goals

- Standalone structured logs buffered in core and shipped to `/v1/logs`.
- Wire format mirrors `https://flareapp.io/docs/protocol/logs/payload` exactly
  (OTel `resourceLogs` envelope).
- Batching policy (count/weight/timer caps) lives in core, no per-platform
  duplication.
- Lifecycle teardown (browser unload, Node shutdown) is a per-environment seam,
  matching how `Api` / `ScopeProvider` / `FileReader` are already injected.
- Ergonomic level-helper API (`flare.logger.info(...)`), idiomatic for JS.

## Non-goals (v1)

- Attaching standalone logs onto error reports — glows already cover
  breadcrumbs-on-report.
- Monolog/console-bridge style auto-capture of existing log calls.
- e2e playground triggers + Playwright coverage (follow-up).

## Architecture

New capability split across packages, reusing the existing DI seams:

```
@flareapp/core
  Logger          buffer + batching policy + flush + OTel envelope build
  SeverityMapper  level -> severityNumber, severityText
  otel encoding   attributesToOpenTelemetry / valueToOpenTelemetry
  Api.logs()      POST envelope to /v1/logs
  FlushScheduler  INTERFACE (injected) — owns only the lifecycle teardown trigger

@flareapp/js    BrowserFlushScheduler  -> visibilitychange:hidden, flush({ keepalive: true })
@flareapp/node  NodeFlushScheduler     -> process.on('beforeExit'), flush()
```

Core owns the count/weight/timer caps. The platform supplies only the
"drain on teardown" hook. This is the Sentry model: shared batching policy in
core, one lifecycle hook per environment.

## Public API

On the Flare instance:

```ts
flare.logger.debug(message, attributes?)
flare.logger.info(message, attributes?)
flare.logger.notice(message, attributes?)
flare.logger.warning(message, attributes?)
flare.logger.error(message, attributes?)
flare.logger.critical(message, attributes?)
flare.logger.alert(message, attributes?)
flare.logger.emergency(message, attributes?)

flare.flush(timeoutMs?)   // now also drains the log buffer
```

- `message: string`
- `attributes?: Attributes` (reuses the existing core `Attributes` type)
- The 8 levels reuse the existing `MessageLevel` type, which already lists
  exactly these 8 names.
- `flare.logger` is the core `Logger` instance, exposing the 8 helpers.

### Config additions (`Config`)

| Key                  | Type            | Default                               | Meaning                                                                       |
| -------------------- | --------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `enableLogs`         | `boolean`       | `false`                               | Opt-in. No surprise log traffic until switched on.                            |
| `logsIngestUrl`      | `string`        | `https://ingress.flareapp.io/v1/logs` | Logs endpoint (sibling of `ingestUrl`).                                       |
| `minimumLogLevel`    | `MessageLevel?` | `undefined`                           | Drop logs below this level at capture time.                                   |
| `serviceName`        | `string?`       | `undefined`                           | Emitted as the `service.name` resource attribute when set; omitted otherwise. |
| `maxLogBufferSize`   | `number`        | `100`                                 | Flush when buffer reaches this count.                                         |
| `logFlushIntervalMs` | `number`        | `5000`                                | One-shot timer flush interval.                                                |
| `logFlushMaxBytes`   | `number`        | `800_000`                             | Flush when estimated buffer bytes reach this.                                 |
| `keepaliveMaxBytes`  | `number`        | `60_000`                              | Max estimated bytes per teardown (keepalive) envelope chunk.                  |

`service.name` has no current source in core config (reports do not emit it and
are accepted, so the ingest does not require it). It is added here as an
**optional** config key, default `undefined`. The resource builder adds the
`service.name` attribute **only when `config.serviceName` is set** (a `truthy`
guard, the same pattern `buildReport` uses for `service.version` / `service.stage`
at `packages/core/src/Flare.ts:435`). It does not rely on the OTel mapper's
null-drop: `undefined` is not part of `AttributeValue`, and putting `undefined`
into an attribute bag is ill-typed. Build conditionally, never emit the key when
unset. No hard default; the wire contract does not require it, and a generic
default like `"unknown"` would just be noise in the Flare UI.

## Buffer, batching, flush

`Logger` (core), one global buffer per Flare instance.

`record(level, message, attributes)`:

1. If `!config.enableLogs`, return.
2. If `config.minimumLogLevel` is set and `level` is below it (by severity
   number), drop.
3. Resolve the merged attributes for this record (see "Per-record attributes"
   below): active scope `pendingAttributes` + entry-point attributes +
   user-passed `attributes`.
4. Build a `LogRecord` (timestamp now, severityNumber + severityText, body,
   merged attributes), push to the buffer.
5. Evaluate auto-flush triggers (below).

### Per-record attributes

Attributes are resolved and **frozen at capture time** (a later mutation of the
scope must not retroactively change an already-buffered record), mirroring PHP,
which merges the context recorder and entry-point resolver into each record
before buffering. Merge order, last write wins:

1. `contextCollector(config)` output — the **injected env collector**, same one
   `buildReport` calls. This is the load-bearing source for Node request/user
   data: `NodeScope.request` / `NodeScope.user` are separate buckets
   (`packages/node/src/scope/NodeScope.ts:6`) that do **not** live in
   `pendingAttributes`; they only become attributes when `makeNodeContextCollector`
   projects them (`packages/node/src/context/collectNode.ts:52`). Merging just
   `pendingAttributes` would silently miss request/user context. So `record()`
   must run the same collector reports do.
2. Active scope `pendingAttributes` (`scopeProvider.active().pendingAttributes`)
   — the custom context `addContext` / `addContextGroup` feed into reports.
3. Entry-point attributes from `scope.entryPoint`, emitted under the same
   `flare.entry_point.handler.*` keys `buildReport` uses (entry-point overrides
   applied after the collector, matching `buildReport`).
4. User-passed `attributes` (highest precedence).

This is exactly `buildReport`'s attribute assembly minus the report-only base
attributes. Factor the shared assembly into a method both call rather than
duplicating it.

Cost note: running the context collector per log re-reads env context (browser
cookies/URL, Node process/request) on every `record()`. That matches PHP's
per-record context behavior and keeps logs filterable, but it is real per-log
work; if it shows up as a hotspot under high-volume logging, a later optimization
can memoize the collector output per scope. Not optimized in v1.

Auto-flush triggers (core-owned policy):

- Buffer length `>= maxLogBufferSize` (100) -> flush now.
- Estimated buffer bytes `>= logFlushMaxBytes` (~0.8 MB) -> flush now.
- Else, if no timer is active, start a one-shot
  `setTimeout(flush, logFlushIntervalMs)`. The clock runs from the first
  buffered item after a flush and is NOT reset per log, so max latency is
  bounded at the interval. Call `timer.unref?.()` so Node is not held open;
  harmless no-op in the browser.

`flush(opts?: { keepalive?: boolean })`:

- Empty buffer -> no-op.
- Clear the timer / active flag.
- Build the envelope(s) and snapshot-and-clear the buffer:
    - Normal flush (`keepalive` falsy): a single envelope with all buffered
      records. The buffer is already bounded by `logFlushMaxBytes` (~0.8 MB), fine
      for a normal `fetch`.
    - Teardown flush (`keepalive: true`): the `keepaliveMaxBytes` (~60 KB) budget
      is the **combined** limit across all in-flight keepalive requests, not
      per-request — so this is NOT chunked into several keepalive POSTs (two 60 KB
      keepalive POSTs sum to 120 KB and the browser rejects them). Send **one**
      keepalive envelope holding the trailing records that fit under
      `keepaliveMaxBytes`. If the buffer exceeds the budget, the older overflow is
      dropped (logged when `debug`): unload is best-effort and the steady-state
      timer/count flushes keep the buffer small, so overflow is the rare tail
      case, not the norm. See "Why `keepalive`".
- For each envelope, call `api.logs(envelope, …, opts?.keepalive)` and pass the
  returned promise to the injected `track` callback (below), which registers it
  in `Flare`'s `inflight` set. `flush()` itself does **not** await the HTTP
  round-trip; it starts the send(s) and returns. This is what lets
  `flare.flush(timeoutMs)` bound the wait (below).

`track` seam: `track` is private on `Flare` (`packages/core/src/Flare.ts:116`).
`Flare` owns the `Logger` and injects `this.track.bind(this)` into it at
construction, so the `Logger`'s own auto-flushes (timer/count, which fire inside
`record()` without going through `Flare.flush`) still enroll their sends in
`inflight`. `track` stays private on `Flare`; the `Logger` only holds the bound
callback. No new public surface on `Flare`.

`FlushScheduler` interface:

```ts
interface FlushScheduler {
    register(flush: (opts?: { keepalive?: boolean }) => void): void;
}
```

- Default implementation is a no-op (core has no lifecycle to hook).
- The browser and Node packages inject real schedulers.
- The count/weight/timer caps stay in core regardless of which scheduler is
  injected.

`flare.flush(timeoutMs?)` is extended to drain the log buffer. It calls
`logger.flush()` first, which **starts** the buffered log send(s) and registers
them in `inflight` (it does not await them). The existing timeout-bounded
`Promise.allSettled(inflight)` race then covers in-flight log sends and reports
together under the same `timeoutMs`. This preserves the Node fatal handler's
guarantee at `packages/node/src/process/fatal.ts:33,49`
(`await flare.flush(opts.shutdownTimeoutMs)`): a hung log POST cannot extend
shutdown past `shutdownTimeoutMs`.

## Wire format (OTel envelope)

Mirrors `https://flareapp.io/docs/protocol/logs/payload`:

```jsonc
{
    "resourceLogs": [
        {
            "resource": {
                "attributes": [
                    /* KeyValue */
                ],
                "droppedAttributesCount": 0,
            },
            "scopeLogs": [
                {
                    "scope": {
                        "name": "@flareapp/js",
                        "version": "<sdk ver>",
                        "attributes": [],
                        "droppedAttributesCount": 0,
                    },
                    "logRecords": [
                        {
                            "timeUnixNano": "<string ns>",
                            "observedTimeUnixNano": "<string ns>",
                            "severityNumber": 9,
                            "severityText": "INFO",
                            "body": { "stringValue": "the message" },
                            "attributes": [
                                /* KeyValue */
                            ],
                            "flags": 0,
                        },
                    ],
                },
            ],
        },
    ],
}
```

Protocol divergences from the PHP client, locked to the protocol doc:

- Timestamps are **strings** (nanoseconds-as-string). This sidesteps the
  `Number.MAX_SAFE_INTEGER` nanosecond-precision loss the client already
  documents for `seenAtUnixNano`. Compute as `String(Date.now()) + '000000'`
  (ms -> ns, no float math, no precision loss).
- `flags` is integer `0` (PHP used string `'01'`/`'00'`).
- `severityText` is uppercase (`"INFO"`, `"ERROR"`).

### OTel value encoding (`valueToOpenTelemetry`)

Ported from PHP `OpenTelemetryAttributeMapper`, with the JS-specific decisions
made explicit:

| Input                        | Output                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `string`                     | `{ stringValue }`                                                |
| `boolean`                    | `{ boolValue }`                                                  |
| `number`, `Number.isInteger` | `{ intValue }`                                                   |
| `number`, otherwise          | `{ doubleValue }`                                                |
| array                        | `{ arrayValue: { values: [...recurse, null-dropped] } }`         |
| plain object                 | `{ kvlistValue: { values: [{ key, value }...], null-dropped } }` |
| `null`                       | dropped (no OTel `anyValue` null type exists)                    |

`AttributeValue` permits nested nulls (`packages/core/src/types.ts:3`:
`{ foo: [null] }`, `{ foo: { bar: null } }`). OTel `anyValue` has no null
variant, so a nested `null` cannot be encoded as a value. The drop rule is
therefore **recursive and applied at every level**, not just the top:

- `attributesToOpenTelemetry(attrs)`: map each entry to `{ key, value }`, drop
  entries whose value encodes to `null`.
- `arrayValue.values`: encode each item, drop items that encode to `null`
  (so `[1, null, 2]` -> two values, not a value-with-null hole).
- `kvlistValue.values`: encode each entry, drop keys whose value encodes to
  `null`.

This diverges intentionally from PHP, which only `array_filter`s the top level
and would emit nested-null holes; the recursive drop keeps every emitted
`anyValue` well-formed. A test asserts `[1, null, 2]` and `{ a: 1, b: null }`
drop the nulls at depth.

### SeverityMapper

| Level     | severityNumber |
| --------- | -------------- |
| debug     | 5              |
| info      | 9              |
| notice    | 10             |
| warning   | 13             |
| error     | 17             |
| critical  | 18             |
| alert     | 19             |
| emergency | 21             |

`severityText` = the level name uppercased. Minimum-level comparison uses the
severity number.

### Resource / scope attributes

- Resource attributes: `service.name` (only when `config.serviceName` set,
  see config table), `service.version` and `service.stage` (when set),
  `telemetry.sdk.language: "javascript"`, `telemetry.sdk.name` and
  `telemetry.sdk.version` from `sdkInfo`, framework attributes when set. Reuses
  the same base-attribute logic `buildReport` already assembles. Null-valued
  entries are dropped by the OTel mapper, so unset optionals never reach the wire.
- Scope `name` / `version` come from `sdkInfo`.

### Api.logs

```ts
Api.logs(envelope, url, key, debug, keepalive?)
```

Mirrors `Api.report`. Header `x-api-token`. `keepalive` is passed straight to
`fetch` so a browser unload flush survives; Node's fetch accepts and ignores it
harmlessly. Treats `201` as success (other codes logged when `debug`).

## Platform schedulers

`@flareapp/js` — `BrowserFlushScheduler`:

- `register(flush)` adds a `document` `visibilitychange` listener; on
  `visibilityState === 'hidden'`, calls `flush({ keepalive: true })`.
- Relies on `fetch` `keepalive` for unload-time delivery (no `sendBeacon`).

### Why `keepalive`

Logs live in an in-memory buffer until a flush. When the user closes the tab or
navigates away, the buffer's last flush must still go out. The browser normally
**aborts all in-flight `fetch` requests when a page unloads**, so a flush fired
from the `visibilitychange:hidden` handler would be cancelled mid-send and those
logs would be lost.

`fetch(url, { keepalive: true })` tells the browser to let the request run to
completion in the background even after the page is gone. It is the modern
replacement for `navigator.sendBeacon()` and lets us reuse the same `fetch`
transport instead of a second code path.

Constraints, all browser-enforced and browser-only:

- The browser caps the **combined body of all in-flight keepalive requests** at
  ~64 KB; past that it rejects the request. This is a shared budget, not a
  per-request one, so splitting a large teardown into several keepalive POSTs
  does **not** help: two 60 KB keepalive POSTs sum to 120 KB and get rejected.
  The teardown therefore sends a **single** keepalive envelope holding the
  trailing records that fit under `keepaliveMaxBytes` (~60 KB), and drops the
  older overflow (logged when `debug`). Best-effort: the steady-state timer/count
  flushes keep the live buffer small, so on a normal unload the whole buffer fits
  in one keepalive POST and nothing is dropped.
- Only the **browser teardown flush** sets `keepalive: true`. Normal timer- and
  count-triggered flushes run while the page is alive, where a plain `fetch` is
  fine and not subject to the keepalive cap.
- In Node there is no page-unload concept, so `keepalive` is a no-op (undici
  accepts and ignores it). Node durability comes from the `beforeExit` flush
  plus the existing shutdown-timeout drain, not from `keepalive`.

`@flareapp/node` — `NodeFlushScheduler`:

- `register(flush)` adds `process.on('beforeExit', () => flush())`.
- The existing fatal handler already calls `flare.flush()`, which now drains
  logs too, so a crash path also ships buffered logs (best-effort within the
  shutdown timeout).

## Scope semantics

The log buffer is global per Flare instance, not per-request scope (matches PHP's
singleton `Logger` and Sentry's per-client buffer). In Node, concurrent requests
share one buffer. Each record still captures the **active scope's** context +
entry-point attributes at `record()` time (see "Per-record attributes"), so a
record buffered during a request carries that request's context even though the
buffer itself is shared. The buffer holds fully-resolved records, not references
to live scopes.

## Testing

Each package has its own Vitest suite (`packages/<pkg>/tests/`,
`packages/<pkg>/vitest.config.ts`). Tests go where the behavior lives, not all
in `packages/js`.

`packages/core/tests/logs.test.ts` (the bulk — core owns buffer, encoding, API,
flush policy):

- Opt-in gating: nothing recorded/sent when `enableLogs` is false.
- `minimumLogLevel` drops below-threshold records at capture.
- Count-cap flush at `maxLogBufferSize`.
- Weight-cap flush at `logFlushMaxBytes`.
- Timer flush via fake timers at `logFlushIntervalMs` (one-shot, not reset per
  log).
- Envelope shape + OTel value encoding (string / number int vs double / bool /
  array / object / null-drop).
- Level helpers map to the right severity number/text.
- Per-record attributes: context-collector output + scope context + entry-point
  merged at capture, frozen (later scope mutation does not change a buffered
  record), user attributes win.
- OTel nested-null drop: `[1, null, 2]` and `{ a: 1, b: null }` drop nulls at
  depth, no null-holes in `arrayValue` / `kvlistValue`.
- Teardown flush sends ONE keepalive envelope `<= keepaliveMaxBytes`; older
  overflow is dropped, not split into a second keepalive POST.
- `flush()` starts sends into `inflight`; `flare.flush(timeoutMs)` stays bounded.

`packages/js/tests/` — `BrowserFlushScheduler`: `visibilitychange:hidden`
triggers a `keepalive` flush.

`packages/node/tests/` — `NodeFlushScheduler`: `beforeExit` triggers a flush;
the fatal-handler path drains logs within `shutdownTimeoutMs`. Plus: a log
recorded inside a `runWithContext` request scope carries that request's
`http.*` / user attributes (proves the context-collector merge, not just
`pendingAttributes`).

The core `FakeApi` test helper is extended to capture `logs()` sends alongside
`report()`.

## Files (anticipated)

New in `@flareapp/core`:

- `src/logging/Logger.ts`
- `src/logging/SeverityMapper.ts`
- `src/logging/otel.ts` (attribute/value encoding)
- `src/logging/FlushScheduler.ts` (interface + no-op default)
- types added to `src/types.ts` (`LogRecord`, OTel envelope types, `Config`
  additions)
- `Api.logs()` in `src/api/Api.ts`
- exports in `src/index.ts`
- `Logger` wired into `Flare` (new constructor seam: `flushScheduler`)

New in `@flareapp/js`:

- `src/browser/BrowserFlushScheduler.ts`, wired into the browser Flare assembly.

New in `@flareapp/node`:

- `src/logging/NodeFlushScheduler.ts`, wired into the Node Flare assembly.
