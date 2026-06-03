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
- Broad e2e playground triggers + Playwright coverage across all four frameworks
  (follow-up). The one exception is a single cross-origin unload test that backs
  the keepalive/preflight guarantee (see Testing) — that one is in scope because
  it verifies correctness, not just coverage.

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
| `keepaliveMaxBytes`  | `number`        | `60_000`                              | Combined keepalive budget; the single teardown envelope stays under this.     |

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
3. Resolve this record's attributes (see "Resource vs record attributes" below):
   run the context collector, partition out resource-level keys, merge the
   record-level keys with scope custom context, entry-point overrides, and
   user-passed `attributes`.
4. **Oversized-record guard:** if this single record's estimated bytes exceed
   `logFlushMaxBytes`, drop it now (logged when `debug`) and return. It cannot be
   shipped — it does not fit a normal envelope's weight budget, and the trim
   below could never satisfy the byte cap while keeping it (dropping older records
   leaves the one oversized record behind). Dropping at capture is deterministic;
   truncating attributes/body would silently corrupt the log. See "Oversized
   records" below.
5. Build a `LogRecord` (timestamp now, severityNumber + severityText, body,
   record-level attributes), push to the buffer; stash the partitioned
   resource-level attributes for the envelope.
6. Evaluate auto-flush triggers (below). With a key, an over-cap push
   **flushes-and-clears here**, so data is shipped, not trimmed away.
7. **Trim the buffer** (below) — a safety net that only bites when step 6 did not
   clear (no API key yet, so the flush no-op'd).

### Buffer trim (hard bound, safety net)

`maxLogBufferSize` and `logFlushMaxBytes` are _flush triggers_ first: step 6
flushes-and-clears when the buffer crosses either cap and a key is set, which is
the path that actually preserves the data (it gets sent). The trim exists only
because a triggered flush can **no-op** (the key gate fails, no API key yet),
which would otherwise let the buffer grow without bound. The trim therefore runs
**after** the triggers, not before — running it first would pull the buffer back
under `logFlushMaxBytes` and rob the weight trigger of its chance to fire, turning
a flush into silent data loss. Same shape as the glow cap (`Scope.addGlow` →
`slice(length - max)`):

- Drop oldest records until the buffer holds `<= maxLogBufferSize` records, AND
- Drop oldest records until the estimated buffer bytes are `<= logFlushMaxBytes`.

Because the oversized-record guard (step 4) already removed any single record
bigger than the byte cap, "drop oldest until under the byte cap" is always
satisfiable. Trailing records (the most recent) are kept, matching glows and the
teardown behavior. With a key the trim almost never bites (step 6 flushed first);
with no key (or repeated send failure) the trim is what bounds the buffer.
Dropped-on-trim records are lost (logged when `debug`) — intended back-pressure
for "logging enabled but never authenticated."

### Oversized records

A single record larger than `logFlushMaxBytes` (~0.8 MB of estimated attributes +
body) is pathological — far past any reasonable log line. It is **dropped at
capture** (step 4), never buffered, and `debug`-logged. The client does not
truncate it: a half-attributes log is more misleading than an absent one, and the
drop keeps every buffered record guaranteed-shippable (fits a normal envelope, and
fits a keepalive teardown envelope when under `keepaliveMaxBytes`). A test asserts
an over-cap single record is dropped and does not wedge the buffer.

### Disable semantics

`enableLogs` is a master switch, not just a capture gate. `record()` returns early
when it is false (nothing buffered), and `flush()` returns early when it is false
(nothing sent) — so a user who buffers logs while enabled and then
`configure({ enableLogs: false })` before the timer fires (or before `light(key)`)
gets **no log traffic**, which is the intuitive meaning of "disable logging."

The disable transition also **clears the buffer AND the timer**: when
`configure(...)` flips `enableLogs` from true to false, the `Logger` drops its
buffered records (the same `clearGlows`-style reset) AND clears any pending
`setTimeout` plus resets the timer-active flag. Clearing the timer flag is not
optional bookkeeping: if a timer is active when logs are disabled and logs are
later re-enabled, a stale `isTimerActive === true` would make the next `record()`
believe a flush is already scheduled and never arm a new one, so the buffer would
sit until a count/weight trigger or manual flush. Resetting the flag on disable
means the first `record()` after re-enable arms a fresh timer normally.

Rationale for clearing the buffer: a disabled logger that silently retained a
backlog would either leak it on a later re-enable (surprising) or pin memory
indefinitely. Clear-on-disable makes "off" mean off. Re-enabling starts a fresh
buffer; it does not resurrect pre-disable records. Tests cover: (1) buffer while
enabled, `configure({ enableLogs: false })`, assert no `api.logs` call on any
subsequent flush path and the buffer is empty; (2) timer active, disable,
re-enable, `record()`, assert a timer flush still fires (the flag was not left
stuck).

### Resource vs record attributes

The OTel logs envelope has two attribute homes: the **resource** (once per
envelope) and each **logRecord** (per log line). PHP keeps these separate — the
`Resource` exports static service / SDK / host / process data, while each log
record carries the per-call context + entry point. The JS report path does NOT
make this distinction (a report is a single entity with one flat `attributes`
bag), so the existing `contextCollector` returns everything mixed: identity +
process (`collectNode.ts:45`) alongside per-request `http.*` / `url.*` /
`enduser.*` (`collectNode.ts:52+`). Putting that whole bag on every record would both
duplicate process/host across all N records and diverge from PHP's placement.

The split is done in core by **partitioning the collector output by key**, so no
new platform seam is needed. The rule is an **resource-prefix allowlist; every
other key — known or unknown — is record-level**. This default direction matters:
the collectors emit more keys than any prefix list will enumerate, and a new key
added to a collector later must land somewhere safe without a spec change.
Record-level is that safe default (request-varying data belongs on the record;
mis-placing a static key on the record only costs a little duplication, whereas
mis-placing a request key on the resource corrupts batched envelopes).

- Resource-level prefixes (the allowlist): `service.`, `telemetry.`, `host.`,
  `os.`, `process.`, `flare.framework.`, `flare.language.`.
- Record-level exceptions that override the allowlist: `process.uptime`. The Node
  collector emits `process.uptime` (`process.ts:19`) as a **changing** per-capture
  value, deliberately re-read each time. Promoting it to the shared resource would
  tag every batched record with the flush-time uptime, not each record's
  capture-time uptime — breaking the resource-static assumption. So `process.uptime`
  is kept record-level despite the `process.` prefix (PHP's resource process data
  is stable identity — pid / executable / command / owner — and excludes uptime;
  this keeps the JS resource equally stable). The partition is therefore
  "resource-prefix allowlist MINUS an explicit record-level exception set, then
  everything else record-level."
- Everything else → record-level. The keys the collectors actually emit that fall
  here, verified against source: `http.*`, `url.*`, `enduser.*`, `client.address`
  (`collectNode.ts:104-111` — note it is `enduser.*` / `client.address`, NOT
  `user.*`), `user_agent.original`, `document.ready_state` (browser collector),
  `context.*`, and `flare.entry_point.*`. (Earlier drafts listed `user.` /
  `request.` prefixes that no collector emits — do not rely on them; the
  allowlist-plus-default rule is what's load-bearing.)

`flare.entry_point.*` is intentionally record-level even though the resources
protocol lists it as a resource attribute: in a batched envelope the records can
come from different requests, so entry point must travel per-record to stay
accurate. Two sub-families coexist on the record without clobbering — the
collector emits `flare.entry_point.type` / `.value`, and `buildReport`'s
entry-point overrides emit `flare.entry_point.handler.*`; different sub-keys,
both kept.

Process/host identity (pid, runtime, hostname, arch, os) are instance-static, so
merging them into the one resource (last write wins across records) dedupes them
correctly. The one non-static `process.*` key, `process.uptime`, is excluded from
the resource (kept record-level, above), so the dedupe is only applied to genuinely
**instance-static** attributes; see the resource-static assumption under "Resource
assembly".

#### Per-record assembly (in `record()`, frozen at capture time)

Resolved once and stored on the buffered record; a later scope mutation must not
change an already-buffered record. Merge order, last write wins:

1. Run `contextCollector(config)` (the injected env collector — the only source
   of Node `NodeScope.request` / `user`, which are separate buckets at
   `NodeScope.ts:6`, not in `pendingAttributes`). Partition its output: the
   record-level keys stay on this record; the resource-level keys are handed to
   the envelope builder (below).
2. Active scope `pendingAttributes` (custom context from `addContext` /
   `addContextGroup`).
3. Entry-point overrides from `scope.entryPoint` (`flare.entry_point.handler.*`),
   applied after the collector — matching `buildReport`'s ordering.
4. User-passed `attributes` (highest precedence).

`context.custom` gets the **same special handling `buildReport` has**
(`Flare.ts:470`), which the earlier "exactly buildReport's assembly" wording
glossed over: when both the scope's `pendingAttributes['context.custom']` and the
user-passed `attributes['context.custom']` are objects, deep-merge them (user
keys win per-key) instead of letting the user bag clobber `addContext()` data;
and inject `context.custom.framework` from the framework name when set. Factor
this shared merge out of `buildReport` into a helper both call.

#### Resource assembly (in `flush()`, read lazily)

The envelope resource is built at flush time from the **current** Flare state, not
captured at `Logger` construction. This matters because `setSdkInfo(...)` /
`setFramework(...)` run AFTER `super(...)` in both platforms (`js/src/index.ts:23`,
`node/src/Flare.ts:81`); a Logger that snapshotted `sdkInfo` at construction would
emit `@flareapp/core` forever. The `Logger` therefore reads SDK/framework through
getters into `Flare` (e.g. `() => this.sdkInfo`, `() => this.framework`) — or
`Flare` builds the resource and hands it to `Logger.flush()`. Resource =
identity (`service.name` when set, `service.version` / `service.stage` when set,
`telemetry.sdk.*` from current `sdkInfo`, `flare.framework.*` from current
framework) merged with the resource-level attributes partitioned out of the
collector (process/host).

Resource-static assumption: one envelope carries one resource shared by all its
batched records, so resource attributes are assumed **instance-static for the
buffer's lifetime**. Identity (`sdkInfo`, `framework`, `serviceName`) and
process/host are stable in normal use, so this holds. The known sharp edge:
reconfiguring `serviceName` or calling `setFramework(...)` **between** buffering
records and the flush will tag every already-buffered record in that envelope
with the new resource value (last-write-wins at flush), not the value in effect
when each was recorded. This is acceptable — reconfiguring identity mid-batch is
not a real workflow — but it is a real divergence from the per-record freezing
that record-level attributes get. If it ever becomes a problem, snapshot the
resource at the first record after each flush instead of at flush time. Not done
in v1.

Cost note: running the context collector per log re-reads env context (browser
cookies/URL, Node process/request) on every `record()`. Matches PHP's per-record
context behavior and keeps logs filterable, but it is real per-log work; if it
becomes a hotspot under high-volume logging, a later optimization can memoize per
scope. Not optimized in v1.

Auto-flush triggers (core-owned policy):

- Buffer length `>= maxLogBufferSize` (100) -> flush now.
- Estimated buffer bytes `>= logFlushMaxBytes` (~0.8 MB) -> flush now.
- Else, if no timer is active, start a one-shot
  `setTimeout(flush, logFlushIntervalMs)`. The clock runs from the first
  buffered item after a flush and is NOT reset per log, so max latency is
  bounded at the interval. Call `timer.unref?.()` so Node is not held open;
  harmless no-op in the browser.

Byte accounting: these triggers and the buffer trim use a **cheap estimate**
(e.g. summed per-record sizes) — they are soft heuristics, so an approximation is
fine and avoids re-serializing the whole buffer on every `record()`. The
**keepalive teardown cap is the exception**: it is a hard, browser-enforced limit,
so it is checked against the **actual serialized body bytes**
(`TextEncoder().encode(flatJsonStringify(envelope)).length`, see "Teardown
flush"), not the estimate.

`flush(opts?: { keepalive?: boolean })`:

- Empty buffer -> no-op.
- **Enabled gate (master switch):** if `!config.enableLogs`, no-op — never call
  `api.logs`. `enableLogs` gates BOTH capture (`record()`) and send (`flush()`),
  so logs buffered while enabled are not shipped after the user turns logging off.
  See "Disable semantics" below for what happens to the already-buffered records.
- **Key gate:** if `assertKey(config.key, config.debug)` is false (no API key
  set yet), reset the timer-active flag (the one-shot has fired) but **leave the
  buffer intact**, then return. This mirrors `sendReport`'s `assertKey` guard
  (`Flare.ts:527`), but for reports a dropped report is gone; logs are buffered,
  so the records must **survive** until `light()` sets a key — clearing here
  would silently destroy them. Resetting only the timer flag lets the next
  `record()` re-arm a fresh timer. The buffer cannot grow unbounded while keyless
  because the per-`record()` trim (above) still applies. Applies to every flush
  path — manual `flush()`, timer, count/weight auto-flush, and the
  unload/`beforeExit` teardown — so none can emit an unauthenticated `api.logs`
  POST. (`assertKey` only warns when `debug`, so the periodic timer re-check is
  quiet in production.)

The backlog ships when the key is set, not only on the next `record()`:
`Flare.light(...)` (and `configure(...)` when it sets a key) calls
`logger.flush()` after applying the key, **if** the buffer is non-empty. Without
this, a keyless timer flush followed by `light(key)` with no further logging
would leave the buffered records sitting until the next manual flush or
unload/`beforeExit`. The post-`light` flush is itself key-gated, so calling it
when no key was actually provided is a cheap no-op.

- Otherwise (key present): clear the timer / active flag.
- Build the envelope(s) and snapshot-and-clear the buffer:
    - Normal flush (`keepalive` falsy): a single envelope with all buffered
      records. The buffer is already bounded by `logFlushMaxBytes` (~0.8 MB), fine
      for a normal `fetch`.
    - Teardown flush (`keepalive: true`): the `keepaliveMaxBytes` (~60 KB) budget
      is the **combined** limit across all in-flight keepalive requests, not
      per-request — so this is NOT chunked into several keepalive POSTs (two 60 KB
      keepalive POSTs sum to 120 KB and the browser rejects them). Send **one**
      keepalive envelope, packing records **newest-first**. The budget is measured
      on the **actual serialized body**, not summed per-record estimates:
      `TextEncoder().encode(flatJsonStringify(envelope)).length <= keepaliveMaxBytes`.
      This matters because the envelope wrapper (`resourceLogs` / `resource` /
      `scopeLogs` overhead) and JSON escaping add bytes that per-record estimates
      miss; the browser cap is on the real body, so the gate must be too. Build up
      the envelope newest-first and back off when adding the next record would push
      the serialized body over the cap. A record that does not fit is **skipped**
      (left behind, dropped on unload, logged when `debug`) and packing continues
      with the next-older record — so one large record does not block smaller ones.
      This also covers the single-record case the `logFlushMaxBytes` capture guard
      does not: a record between `keepaliveMaxBytes` and `logFlushMaxBytes` (e.g.
      100 KB) is valid for a normal flush but cannot fit a 60 KB unload envelope,
      so on teardown it is skipped/dropped. Forcing a normal (non-keepalive) flush
      at unload is not an option — the browser aborts it. Unload is best-effort,
      and the steady-state timer/count flushes keep the buffer small (and ship the
      100 KB record long before unload in practice), so this drop is the rare tail
      case. See "Why `keepalive`".
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
  documents for `seenAtUnixNano`. Compute once as `String(Date.now()) + '000000'`
  (ms -> ns, no float math, no precision loss), and write that **same value** to
  both `timeUnixNano` and `observedTimeUnixNano` (the protocol requires at least
  one; we emit both with the capture time).
- `flags` is integer `0` (PHP used string `'01'`/`'00'`).
- `severityText` is uppercase (`"INFO"`, `"ERROR"`).
- `droppedAttributesCount` is emitted as a literal `0` on resource / scope /
  record. The client DOES drop attributes (recursive null-drop) and records (trim,
  oversized, keepalive overflow), but it does not count them into this field — the
  field is optional per protocol and a hard `0` is simpler than threading a count
  through. Documented so the `0` is understood as "not tracked," not "nothing was
  ever dropped."

### OTel value encoding (`valueToOpenTelemetry`)

Ported from PHP `OpenTelemetryAttributeMapper`, with the JS-specific decisions
made explicit:

| Input                                   | Output                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| `string`                                | `{ stringValue }`                                                |
| `boolean`                               | `{ boolValue }`                                                  |
| non-finite `number` (`NaN`/`±Infinity`) | dropped (see below)                                              |
| finite `number`, `Number.isInteger`     | `{ intValue }`                                                   |
| finite `number`, otherwise              | `{ doubleValue }`                                                |
| array                                   | `{ arrayValue: { values: [...recurse, null-dropped] } }`         |
| plain object                            | `{ kvlistValue: { values: [{ key, value }...], null-dropped } }` |
| `null` / `undefined`                    | dropped (no OTel `anyValue` null type exists)                    |

Number edge cases (JS has one `number` type; PHP had distinct int/float, so these
are JS-specific decisions, not inherited from the PHP mapper):

- **Non-finite (`NaN`, `Infinity`, `-Infinity`):** encode to `null` (i.e.
  dropped, same as `null`). Critical: the send path is `flatJsonStringify` →
  `JSON.stringify`, which turns `NaN`/`Infinity` into the JSON literal `null`. So
  emitting `{ doubleValue: NaN }` would serialize to `{ "doubleValue": null }` — a
  malformed OTel `anyValue` the ingest can reject. The encoder must detect
  `!Number.isFinite(n)` BEFORE choosing `intValue`/`doubleValue` and drop it.
- **`intValue` representation:** a bare JSON number, matching PHP (`json_encode`
  of a PHP int is a bare number) and what the Flare ingest already accepts from
  the PHP client. Not stringified. (Contrast timestamps, which are forced to
  strings because they are ALWAYS ~19 digits; ordinary integer attributes are
  not.)
- **Beyond `Number.MAX_SAFE_INTEGER`:** a JS `number` that large has already lost
  integer precision before it reaches the encoder, so no special handling — it is
  emitted as the (already-imprecise) `intValue`. Callers needing exact large
  integers must pass them as strings. Documented, not guarded.
- **`-0`:** serializes to `0`; harmless, no special case.

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

**Cycle safety.** `valueToOpenTelemetry` recurses into arrays and plain objects,
so a cyclic attribute value (a realistic case — user context can hold Vue/React
instances or self-referential objects) would infinite-loop and stack-overflow
**inside the encoder**, before the value ever reaches `flatJsonStringify`. The
existing `flatJsonStringify` decycles (`flatJsonStringify.ts:1`), but only at
serialize time — and the encoder runs first, transforming attributes into the
OTel `keyValue` shape, so that decycle is too late. The encoder must do its own
cycle detection, mirroring `decycle`'s approach: track ancestors on the current
branch with a `WeakSet` (add on enter, remove on exit — a branch-local path set,
not a global "seen" set, so the same object referenced twice in sibling branches
is not falsely flagged), and replace a back-edge with the same `'[Circular]'`
sentinel `flatJsonStringify` uses, encoded as `{ stringValue: '[Circular]' }`. A
test asserts a self-referential object attribute encodes with `'[Circular]'` and
does not throw.

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

- Resource attributes: see "Resource assembly" above — identity (`service.name`
  when set, `service.version` / `service.stage` when set, `telemetry.sdk.*` from
  current `sdkInfo`, `flare.framework.*` from current framework) plus the
  resource-level keys partitioned out of the collector (process/host). Built at
  flush time from current Flare state (lazy), never snapshotted at construction.
- Scope `name` / `version` come from the current `sdkInfo` (same lazy read).

### Api.logs

```ts
Api.logs(envelope, url, key, debug, keepalive?)
```

Mirrors `Api.report`. Header `x-api-token`. `keepalive` is passed straight to
`fetch` so a browser unload flush survives; Node's fetch accepts and ignores it
harmlessly. Treats `201` as success (other codes logged when `debug`).

CORS preflight: a cross-origin POST with `Content-Type: application/json` plus
the custom `x-api-token` header is not a CORS-simple request, so the browser
sends an `OPTIONS` preflight first. The report path already incurs this for every
report, and the ingest answers it (the e2e fake server keeps CORS open). The new
risk is specifically the **first log send firing on `visibilitychange:hidden`**
when no preflight is cached: the unload-time fetch must complete both the
preflight and the POST. `keepalive` keeps the whole fetch (preflight included)
alive past document teardown, so this is expected to work — but it is the kind of
thing that silently fails in one browser. The guarantee is therefore **backed by
an explicit test** (below), not assumed. If that test shows preflight-on-unload
is unreliable, the fallback is to lower the steady-state flush thresholds so a
preflight is essentially always already cached by unload (a normal flush has run),
rather than changing transport — sendBeacon is not an option (it cannot send the
`x-api-token` header; see "Why `keepalive`").

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

Why not `navigator.sendBeacon()`: it **cannot set custom request headers**, and
the logs ingest authenticates via the `x-api-token` header. No header means no
auth (401), so sendBeacon cannot deliver an authenticated log POST at all. It
also shares the same ~64 KB queued-data limit and gives no access to the
response. MDN steers callers who "need to change any request properties" to
`fetch` with `keepalive` for exactly this reason; this is also why Sentry's SDK
uses `fetch` keepalive rather than sendBeacon. Decision: keepalive, not beacon.

Constraints, all browser-enforced and browser-only:

- The browser caps the **combined body of all in-flight keepalive requests** at
  ~64 KB; past that it rejects the request. This is a shared budget, not a
  per-request one, so splitting a large teardown into several keepalive POSTs
  does **not** help: two 60 KB keepalive POSTs sum to 120 KB and get rejected.
  The teardown therefore sends a **single** keepalive envelope, packing records
  newest-first under `keepaliveMaxBytes` (~60 KB) and skipping any record that
  does not fit the remaining budget — including a single record that is itself
  larger than `keepaliveMaxBytes` (valid for a normal flush, too big for unload).
  Skipped records are dropped (logged when `debug`). Best-effort: the steady-state
  timer/count flushes keep the live buffer small, so on a normal unload the whole
  buffer fits in one keepalive POST and nothing is dropped.
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

Known `beforeExit` gap: `beforeExit` fires only when the event loop drains
naturally. It does **not** fire on `process.exit()`, nor on `SIGTERM` / `SIGINT`
unless the app installs handlers that let the loop empty. So a graceful container
shutdown that calls `process.exit(0)` from a signal handler bypasses both
`beforeExit` and the fatal handler, and buffered logs are lost. v1 does **not**
auto-install `SIGTERM`/`SIGINT` handlers — doing so would silently take over
signals the host app likely manages itself, a worse surprise than a few dropped
logs. The documented guidance is: call `await flare.flush()` in your own shutdown
hook (the same call that already drains reports). This is called out so the
limitation is a known, documented contract rather than a silent gap. Revisit if
users report lost logs on graceful shutdown.

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
- Disable semantics: buffer logs while `enableLogs: true`, then
  `configure({ enableLogs: false })`; assert no `api.logs` call on any subsequent
  flush path AND the buffer was cleared on the disable transition.
- Key gate: `enableLogs: true` + `key: null` records into the buffer but no flush
  path (manual, timer, count, unload) calls `api.logs`; buffer is retained.
- Keyless backlog ships on `light(key)`: record several logs with no key (no
  send), call `light(key)` with **no further `record()`**, assert the buffered
  logs are flushed.
- Keyless trim bound: with `enableLogs: true` + `key: null`, recording far more
  than `maxLogBufferSize` keeps the buffer at the cap (oldest dropped), does not
  grow unbounded.
- `minimumLogLevel` drops below-threshold records at capture; strict `<` by
  severity number (a record exactly at the threshold is kept, matching PHP).
- Count-cap flush at `maxLogBufferSize`.
- Weight-cap flush at `logFlushMaxBytes`.
- Weight-cap with a key **flushes-and-clears, does not trim**: crossing
  `logFlushMaxBytes` ships the records via `api.logs` (no records silently dropped
  by the trim when keyed).
- Oversized single record (> `logFlushMaxBytes`) is dropped at capture, never
  buffered, and does not wedge the buffer (a subsequent normal record still
  records and flushes).
- Timer flush via fake timers at `logFlushIntervalMs` (one-shot, not reset per
  log).
- Envelope shape + OTel value encoding (string / number int vs double / bool /
  array / object / null-drop).
- Level helpers map to the right severity number/text.
- Per-record attributes: record-level collector keys + scope context +
  entry-point merged at capture, frozen (later scope mutation does not change a
  buffered record), user attributes win.
- Resource/record partition: a collector emitting both `process.*` and `http.*`
  puts `process.*` on the envelope resource (once, deduped) and `http.*` on the
  record. Two records sharing one resource still carry their own request keys.
- `context.custom` deep-merges scope + user values (user keys win per-key, no
  clobber of `addContext` data); `context.custom.framework` injected from
  framework name.
- Lazy SDK identity: `setSdkInfo` after construction is reflected in the next
  flush's resource/scope (not stuck at `@flareapp/core`).
- OTel nested-null drop: `[1, null, 2]` and `{ a: 1, b: null }` drop nulls at
  depth, no null-holes in `arrayValue` / `kvlistValue`.
- Non-finite numbers: `NaN` / `Infinity` / `-Infinity` attribute values are
  dropped (never emitted as `{ doubleValue: null }`); a real-number sibling in the
  same object/array survives.
- Cyclic attribute: a self-referential object value encodes with a `'[Circular]'`
  sentinel and does not throw / stack-overflow.
- Keepalive boundary: a teardown envelope whose **serialized** body (envelope
  overhead + escaping included) would exceed `keepaliveMaxBytes` packs fewer
  records so the actual `TextEncoder` byte length stays `<= keepaliveMaxBytes`.
- Disable clears the timer: timer active, `configure({ enableLogs: false })`, then
  re-enable and `record()`; a timer flush still fires (flag not left stuck).
- Resource/record partition default: an unknown key (no resource prefix) lands at
  record level; `enduser.*` / `client.address` / `user_agent.original` are
  record-level (verified against real collector keys, not the dead `user.*`).
- Teardown flush sends ONE keepalive envelope `<= keepaliveMaxBytes`; older
  overflow is dropped, not split into a second keepalive POST.
- Teardown packs newest-first and skips an over-`keepaliveMaxBytes` record: a
  buffer of [small, 100 KB, small] ships the two smalls in one keepalive envelope
  and drops the 100 KB record (with `keepaliveMaxBytes` < 100 KB < `logFlushMaxBytes`).
- `flush()` starts sends into `inflight`; `flare.flush(timeoutMs)` stays bounded.

`packages/js/tests/` — `BrowserFlushScheduler`: `visibilitychange:hidden`
triggers a `keepalive` flush. Plus an e2e (Playwright) test for the
first-send-on-unload path against the **cross-origin** fake-flare-server: record
a log, navigate away without any prior flush, and assert the server received the
log (exercises the uncached preflight + keepalive POST on unload). If unsupported
in a target browser, this test is what catches it.

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
- `src/logging/otel.ts` (attribute/value encoding + resource/record key
  partition classifier)
- `src/logging/FlushScheduler.ts` (interface + no-op default)
- types added to `src/types.ts` (`LogRecord`, OTel envelope types, `Config`
  additions)
- `Api.logs()` in `src/api/Api.ts`
- the `context.custom` deep-merge + framework injection factored out of
  `buildReport` into a shared helper `record()` and `buildReport` both call
- exports in `src/index.ts`
- `Logger` wired into `Flare`: new constructor seam `flushScheduler`; `Logger`
  reads SDK/framework lazily (getters into `Flare`), so `setSdkInfo` /
  `setFramework` after `super(...)` are reflected at flush time
- `Flare.light(...)` (and `configure(...)` when it sets a key, gated on
  `config.key !== undefined`, not on any `configure` call) calls `logger.flush()`
  after applying the key, when the buffer is non-empty, so a backlog buffered
  before authentication ships as soon as a key arrives
- `configure(...)` detects an `enableLogs` true->false transition and clears the
  log buffer **and the timer** (disable semantics)
- the OTel encoder mirrors `flatJsonStringify`'s `JSON.stringify` reality: drop
  non-finite numbers BEFORE choosing `intValue`/`doubleValue` (so no
  `{ doubleValue: null }` reaches the wire), and carry its own branch-local
  `WeakSet` cycle detection (the `flatJsonStringify` decycle runs too late — the
  encoder recurses first)
- keepalive teardown packing measures the **actual** serialized body
  (`TextEncoder().encode(flatJsonStringify(envelope)).length`) against
  `keepaliveMaxBytes`, not summed estimates

New in `@flareapp/js`:

- `src/browser/BrowserFlushScheduler.ts`, wired into the browser Flare assembly.

New in `@flareapp/node`:

- `src/logging/NodeFlushScheduler.ts`, wired into the Node Flare assembly.
