# Automatic breadcrumb collection

Date: 2026-08-14
Status: approved design, not yet implemented

## What this is

The browser client collects nothing about what the user did before an error. A developer can leave
notes with `flare.glow()`, but nothing is recorded automatically. This design adds automatic
collection of clicks, form interaction, requests and route changes, and puts them on the error
report so the Debug tab shows a timeline of what happened before the error.

## What already exists

Three things make this smaller than it looks.

**The PHP client already does this.** `vendor/spatie/flare-client-php/src/Recorders/` has a recorder
per category: cache, query, external HTTP, redis, filesystem, dump, job, command, glow. They all
extend `SpanEventsRecorder` or `SpansRecorder`, and both write through one helper that decides
separately whether to add the entry to the error report and whether to add it to the current span.
This design mirrors that.

**Glows are not special in PHP.** `GlowRecorder extends SpanEventsRecorder` and `RecorderType::Glow`
sits in the enum next to `Cache` and `Query`. The manual API is just the recorder a human calls
directly. The browser client should match that rather than keeping glows in their own buffer.

**The error report already carries a timeline.** The protocol doc for the errors payload states that
spans and span events are combined into a single `events` array on the root payload: spans have both
timestamps, span events always have `endTimeUnixNano: null`. The backend Debug tab merges them,
sorts them (`Debug.tsx:112`), renders one component per type and filters by type. It shows whenever
`errorOccurrence.events.length > 0` (`Ignition.tsx:82`), with no language condition, so JavaScript
errors carrying glows already display it today.

## Scope

Collected:

- Clicks and form interaction
- Fetch requests
- XHR requests
- Route changes, including the initial page load

Not collected, deferred:

- Console calls. Worth revisiting, because `console.error` is where many applications put their
  handled failures.

## What each entry is on the wire

| Category         | Kind       | Type                   | End time |
| ---------------- | ---------- | ---------------------- | -------- |
| Click            | span event | `browser_click`        | null     |
| Form interaction | span event | `browser_input`        | null     |
| Fetch            | span       | `browser_fetch`        | set      |
| XHR              | span       | `browser_xhr`          | set      |
| Route change     | span event | `browser_route_change` | null     |

Requests are spans because they have a real duration and the span types and their attributes are
already defined in the JavaScript protocol docs. Reusing them costs no new backend types.

Route changes are a new type rather than a reuse of the `browser_navigation` span type. A navigation
on the error report has no reliable end time: in a trace the navigation root closes on idle, and with
tracing off there is no idle controller. Reusing the string would make one type mean a span with a
duration in one place and a point-in-time entry in another. The timeline UI labels
`browser_route_change` as "Navigation", because that is what it is to the person reading it.

### Attributes

Clicks and form interaction:

| Attribute                  | Type   | Description                                                       |
| -------------------------- | ------ | ----------------------------------------------------------------- |
| `browser.element.selector` | string | Tag, id and class list, for example `button#checkout.btn-primary` |
| `browser.element.test_id`  | string | The element's `data-testid`, when present                         |

No text content and no input values, ever. See Privacy below.

Fetch and XHR reuse the attributes already documented for those span types: `url.full` (redacted),
`http.request.method`, `server.address`, `http.response.status_code`.

Route changes:

| Attribute                              | Type   | Description                                                                     |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `url.full`                             | string | Full URL after the route settled, redacted                                      |
| `flare.entry_point.handler.identifier` | string | Route pattern, for example `/products/{id}`                                     |
| `flare.route.source`                   | string | `route` when a router supplied the pattern, `url` when it fell back to the path |

## Client design

### Recorders in core

Mirror the PHP client's two base classes: one for recorders that produce span events, one for
recorders that produce spans. Both share a single helper that computes two decisions independently,
the way `SpanEventsRecorder::spanEvent()` does:

- **Report** — append to the shared breadcrumb buffer, which lands in `Report.events`. PHP gives each
  recorder its own buffer; this version uses one shared buffer, for the reason given under
  Configuration.
- **Trace** — append to the current span through `Span.addEvent()` (`Span.ts:80`), only when the
  tracer is sampling and a span is open.

The trace branch exists in the structure so the mirror is complete, but no browser recorder enables
it in this version. Breadcrumbs go on the error report only. Fetch and XHR still produce their normal
trace spans through the tracing listener, which is unchanged.

`Report.events` becomes a mixed array of spans and span events, matching the protocol.

### Glows become a recorder

`Scope.glows`, its cap, `clearGlows()` and `glowsToEvents()` are replaced by a glow recorder on the
same path as the automatic ones. `flare.glow()` keeps its current signature and behaviour; only the
internals change. This removes the special case rather than adding a second one beside it.

### Configuration

Four options:

- `enableBreadcrumbs: boolean`, default `true`
- `maxBreadcrumbs: number`, default `100`
- `maxBreadcrumbBytes: number`, default `64_000`
- `maxBreadcrumbEntryBytes: number`, default `8_000`

One shared buffer across all recorders, dropping oldest. The buffer is not cleared on route change,
so it spans the whole page session.

PHP's per-recorder `withErrors`, `withTraces` and max-items exist in the recorder structure but are
not exposed yet. Exposing them later needs no rewrite.

PHP defaults to 100 items _per recorder_. That number is not copied, because a PHP recorder lives for
one request and a browser recorder lives for a whole session. A shared 100 is the deliberate choice,
and it is Sentry's number and Sentry's behaviour.

#### The buffer is bounded twice: by entries and by bytes

A count alone does not bound the payload. The automatic entries are small and predictable, but
`glow.metaData` is arbitrary host data with no size limit of its own (`glowsToEvents.ts:13` passes it
straight through), so 100 entries can mean 20 KB or 20 MB.

Serialized size of one entry, measured against the shapes in this document:

| Entry                      | Bytes |
| -------------------------- | ----- |
| Click                      | 228   |
| Form input                 | 213   |
| Fetch, short URL           | 269   |
| Fetch, long query string   | 417   |
| Route change               | 264   |
| Glow, small context object | 190   |

A completely full buffer of automatic entries is 24 KB (click-heavy page) to 41 KB (100 long-URL
fetches, the worst automatic case).

`maxBreadcrumbBytes: 64_000` sits above that worst case on purpose. It must never fire during normal
use, or it silently shortens the timeline for busy applications; the only realistic way to reach it
is fat glow context, which is exactly the input that needs a ceiling. It also keeps breadcrumbs a
minority share of the report, where stack-trace snippets already dominate at up to 41 lines per frame
and 1000 characters per line (`fileReader.ts:68`).

Enforcement mirrors `TelemetryBuffer.trim()` (`TelemetryBuffer.ts:229`): drop oldest until the buffer
is under the ceiling.

`maxBreadcrumbEntryBytes: 8_000` covers what trimming cannot. One oversized entry is not fixable by
dropping the entries around it, so a single glow carrying a serialized API response would evict the
whole click history and still leave the buffer over budget. An entry over this cap is dropped whole
rather than truncated: a half-serialized context object reads as real data to whoever is debugging.
At 8 KB a normal entry has twenty times the headroom it uses, so nothing legitimate is refused.

Size is measured when the entry is added, not when the report is sent. `glow.metaData` is held by
reference, so a host can mutate it afterwards and the recorded size drifts. That is accepted here.
The equivalent drift is re-measured on the keepalive path (`envelope.ts:60`) because a browser limit
is hard and an estimate is not; the report has no such limit, so an estimate on add is enough.

#### Glows keep a reserved floor

Today `maxGlowsPerReport: 30` is space nothing else can take. Moving glows into one shared buffer
removes that guarantee, and the loss is worse than it first looks: a page firing 100 requests would
evict every breadcrumb a developer deliberately placed, and keep the automatic noise that pushed them
out.

So eviction skips glows while the buffer holds 30 or fewer of them, and falls back to plain
drop-oldest when glows are all that is left. Existing behaviour is preserved exactly: an application
that only calls `flare.glow()` still gets its 30, and an application that calls it rarely never loses
those calls to click noise.

The remaining known weakness is unchanged from PHP: a chatty application can still fill the
non-reserved part of the buffer with requests and push out the clicks. Per-recorder caps are the fix,
and they arrive with per-recorder config.

### Interception is subscriber-driven

Three interception points are shared between tracing and breadcrumbs: fetch, XHR and the navigation
seam. All three follow the same rule: **the first subscriber installs, the last unsubscriber
removes.** Nothing is patched when both features are off. This also handles someone toggling both off
at runtime without a second code path. `instrumentOnce` in `instrumentationGuard.ts` is close to this
already.

Requests need two hook points, because the fetch patch does not only observe a request, it mutates
it: `instrumentFetch.ts:74-76` builds a `traceparent` from the span it opened and merges it into the
request init.

- `onRequestStart(context)` — synchronous, may return a replacement init. **Only one listener may own
  this, and it is tracing.** A breadcrumb recorder must never be able to change an outgoing request.
- `onRequestSettle(context, status | error)` — notification. Both listen, neither can change
  anything.

The breadcrumb listener never sees the span, so an unsampled trace cannot make a breadcrumb
disappear.

### The navigation seam

`registerNavigationSource()` (`browserTracing.ts:446`) already exists and all four router
integrations drive it: TanStack Router, React Router v7, vue-router and SvelteKit. The navigation
recorder subscribes to it rather than growing a second detection path.

The seam is currently welded to tracing: every method short-circuits on `!activeFlare`, and
`activeFlare` is only set by `startBrowserTracing`, which `configure()` calls only when
`enableTracing` is true. With breadcrumbs on by default and tracing off by default, that is the
common case, so it must be unwelded.

- `registerNavigationSource` moves out of `browserTracing.ts` into a neutral module that owns the
  registration, the last-wins token and the stale-handle guard, and broadcasts the four lifecycle
  calls to subscribers.
- Two subscribers: tracing (today's `startRoot`, `applyRouteName`, hold and idle logic, subscribed
  when `enableTracing`) and breadcrumbs (subscribed when `enableBreadcrumbs`).
- **The four framework packages change nothing.** They keep importing `registerNavigationSource`
  from `@flareapp/js` with the same signature. The refactor is entirely behind that export.

The breadcrumb is emitted on `settleNavigation`, not `startNavigation`. React Router v7 opens a
navigation before the URL commits, and the `url` field on `RouteName` exists so a redirect can
re-stamp it. Emitting early would record where the router was headed rather than where the user
landed.

The initial page load emits the same `browser_route_change`, so the timeline opens with where the
user landed instead of starting mid-session.

### Browser recorders

In a new `packages/js/src/breadcrumbs/`:

- `recordClicks` — one capture-phase listener on `document` for `click`, one for `input` and
  `change`. Capture phase so it sees events an application stops propagating.
- `recordFetch`, `recordXhr` — `onRequestSettle` subscribers.
- `recordNavigation` — navigation seam subscriber.

## Privacy

Click and input capture records a selector only: tag, id, class list and `data-testid`. It never
reads text content and never reads input values.

This is the default and there is no option to widen it in this version. Element text is user data
often enough (a name in a list row, an email in a dropdown) that recording it by default would be a
leak for teams who never read the configuration docs. Sentry's own default masks text unless you opt
in.

The known cost: an application whose buttons carry no ids or `data-testid` produces breadcrumbs that
are hard to tell apart. The fix is on the application side, and it is a fix that costs a team
nothing to make.

`url.full` on request and navigation entries goes through the existing redaction path used by the
equivalent spans.

## Backend design

Three new cases on `App\Domain\Monitoring\Enums\SpanEventType`: `browser_click`, `browser_input`,
`browser_route_change`. Fetch, XHR and navigation need none, because they are span types the backend
already knows from the tracing work.

- `AttributesData` gains the click and route-change attribute keys, which also regenerates the
  TypeScript types.
- `Debug.tsx` gains a branch per new type.
- New item components beside `GlowEventItem` and the rest. `HttpRequestEventItem` may render
  `browser_fetch` and `browser_xhr` unchanged if the attribute names line up; confirm during
  implementation rather than assuming.
- The timeline labels `browser_route_change` as "Navigation".

No ingest changes expected, but confirm the limit before implementing rather than after. The figure
carried into this design was 550,000 characters for `v1/errors`, and it is unverified: nothing in the
client repo records it. A full breadcrumb buffer measures 24 KB to 41 KB (see Configuration), so the
margin looks comfortable, but the failure mode is not graceful. `Api.report()` sends one POST and
only logs the response when `debug` is on (`Api.ts:132`), so a report over the limit loses the whole
error, not just its breadcrumbs. If the real limit is materially lower than 550,000, revisit
`maxBreadcrumbBytes`.

## Testing

- Per-recorder unit tests in `packages/js/tests/`: selector building, the no-text and no-value
  guarantee, subscriber-driven install and uninstall, and that a breadcrumb is still recorded when
  the trace is unsampled.
- Core tests for the recorder base classes and for glows continuing to behave identically through
  the new path.
- Core tests for the two byte limits: the buffer trims oldest once it passes `maxBreadcrumbBytes`, an
  entry over `maxBreadcrumbEntryBytes` is dropped instead of truncated and does not evict anything,
  and eviction leaves 30 glows alone until nothing else is left to drop.
- A Playwright scenario in the playgrounds that clicks through a page, navigates, triggers a request
  and then throws, asserting the merged `events` array on the fake server.

## Open items

- Console recorder, deferred.
- Per-recorder configuration, deferred but structurally allowed for.
- Writing breadcrumbs into the current span, deferred but structurally allowed for.
- Whether `HttpRequestEventItem` renders the browser request attributes unchanged.
- Confirming the real `v1/errors` size limit (see Backend design).
- Whether report entries should get an attribute-count cap of their own. `maxAttributesPerSpanEvent`
  looks like it covers this but does not: it is wired into the tracer only (`Tracer.ts:428` into
  `Span.ts:91`), and `Report.events` never passes through `Span.addEvent()`. The byte limits above
  bound the payload either way, so this is about readability, not size.
- PHP's backtracing recorders record where an event came from in the code. Not mirrored.
