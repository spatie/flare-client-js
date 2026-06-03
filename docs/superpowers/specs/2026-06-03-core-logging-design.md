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
- Auto-merging active-scope context / entry point into log attributes (later
  enhancement; avoids coupling now).

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

| Key                  | Type            | Default                               | Meaning                                            |
| -------------------- | --------------- | ------------------------------------- | -------------------------------------------------- |
| `enableLogs`         | `boolean`       | `false`                               | Opt-in. No surprise log traffic until switched on. |
| `logsIngestUrl`      | `string`        | `https://ingress.flareapp.io/v1/logs` | Logs endpoint (sibling of `ingestUrl`).            |
| `minimumLogLevel`    | `MessageLevel?` | `undefined`                           | Drop logs below this level at capture time.        |
| `maxLogBufferSize`   | `number`        | `100`                                 | Flush when buffer reaches this count.              |
| `logFlushIntervalMs` | `number`        | `5000`                                | One-shot timer flush interval.                     |
| `logFlushMaxBytes`   | `number`        | `800_000`                             | Flush when estimated buffer bytes reach this.      |

## Buffer, batching, flush

`Logger` (core), one global buffer per Flare instance.

`record(level, message, attributes)`:

1. If `!config.enableLogs`, return.
2. If `config.minimumLogLevel` is set and `level` is below it (by severity
   number), drop.
3. Build a `LogRecord` (timestamp now, severityNumber + severityText, body,
   attributes), push to the buffer.
4. Evaluate auto-flush triggers (below).

Auto-flush triggers (core-owned policy):

- Buffer length `>= maxLogBufferSize` (100) -> flush now.
- Estimated buffer bytes `>= logFlushMaxBytes` (~0.8 MB) -> flush now.
- Else, if no timer is active, start a one-shot
  `setTimeout(flush, logFlushIntervalMs)`. The clock runs from the first
  buffered item after a flush and is NOT reset per log, so max latency is
  bounded at the interval. Call `timer.unref?.()` so Node is not held open;
  harmless no-op in the browser.

`flush(opts?: { keepalive?: boolean })`:

- Snapshot and clear the buffer; clear the timer / active flag.
- Empty buffer -> no-op.
- Build the envelope, call `api.logs(envelope, …, opts?.keepalive)`.
- Register the send in the existing `inflight` set (via the same `track`
  mechanism reports use) so `flare.flush()` awaits in-flight log sends too.

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

`flare.flush(timeoutMs?)` is extended to drain the log buffer (await
`logger.flush()`) in addition to waiting on in-flight reports.

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

| Input                        | Output                                             |
| ---------------------------- | -------------------------------------------------- |
| `string`                     | `{ stringValue }`                                  |
| `boolean`                    | `{ boolValue }`                                    |
| `number`, `Number.isInteger` | `{ intValue }`                                     |
| `number`, otherwise          | `{ doubleValue }`                                  |
| array                        | `{ arrayValue: { values: [...recurse] } }`         |
| plain object                 | `{ kvlistValue: { values: [{ key, value }...] } }` |
| `null`                       | dropped (filtered out of the attributes array)     |

`attributesToOpenTelemetry(attrs)` maps each entry to `{ key, value }`, dropping
null-valued entries.

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

- Resource attributes: `service.name`, `service.version` and `service.stage`
  (when set), `telemetry.sdk.language: "javascript"`, `telemetry.sdk.name` and
  `telemetry.sdk.version` from `sdkInfo`, framework attributes when set. Reuses
  the same base-attribute logic `buildReport` already assembles.
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

- The browser caps the combined body of all in-flight keepalive requests at
  ~64 KB; past that it rejects the request. Sentry stops setting `keepalive`
  above ~60 KB in-flight for this reason. Our per-flush envelopes are small
  (capped well under the weight limit), so this is not a practical concern for
  v1, but it is why `keepalive` is set only on the teardown flush, not on every
  flush.
- Only the **browser teardown flush** sets `keepalive: true`. Normal timer- and
  count-triggered flushes run while the page is alive, where a plain `fetch` is
  fine and not subject to the 64 KB cap.
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
share one buffer; each record carries its own user-passed attributes. v1 does not
auto-merge active-scope context or entry point into log attributes.

## Testing

Vitest, in `packages/js/tests/`. New `logs.test.ts`:

- Opt-in gating: nothing recorded/sent when `enableLogs` is false.
- `minimumLogLevel` drops below-threshold records at capture.
- Count-cap flush at `maxLogBufferSize`.
- Timer flush via fake timers at `logFlushIntervalMs`.
- Envelope shape + OTel value encoding (string/number int vs double/bool/
  array/object/null-drop).
- Level helpers map to the right severity number/text.
- `flush()` drains the buffer and awaits the send.

`FakeApi` (test helper) extended to capture `logs()` sends alongside `report()`.

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
