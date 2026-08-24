# Automatic breadcrumb collection

Date: 2026-08-24
Status: approved design, not yet implemented

Supersedes the design of 2026-08-14, which was deleted and redesigned from zero. The two differ on
the central question: that version folded glows into one shared buffer with the automatic entries and
changed `maxGlowsPerReport` from a ceiling into a floor. This one leaves glows completely alone.

## What this is

The browser client records nothing about what a person did before an error. A developer can leave notes
with `flare.glow()`, but nothing is captured on its own. This design adds automatic capture of clicks,
form changes, requests and route changes, and puts them on the error report so the Debug tab shows a
timeline of what happened before the error.

## Scope

Recorded: clicks, form `change`, fetch, XHR, route changes including the first page load.

Not recorded, deferred: console calls, page visibility, online and offline, window resize, component
names.

Browser only. `@flareapp/node` and `@flareapp/react-native` get nothing. Electron renderers are
included, because a renderer is a browser and the report path already carries the data.

## Glows are not touched

A glow is a note a developer placed by hand. A breadcrumb is an entry the SDK recorded on its own. They
are two concepts, and the code keeps them apart: `Scope.glows`, `addGlow`, `clearGlows`,
`maxGlowsPerReport` and `glowsToEvents` are unchanged, and no glow behaviour differs after this change.

They meet on the wire, and only there. Both land in `Report.events`, because a person debugging an error
wants one list in time order. Splitting them into two arrays would mean paying to join them again in
the UI.

## What each entry is on the wire

`Report.events` is typed `SpanEvent[]` (`packages/core/src/types.ts:109`) and `buildReport`
(`packages/core/src/Flare.ts:593`) is its only producer. It gains a second source beside
`glowsToEvents`. No new payload field.

`SpanEvent.endTimeUnixNano` is `number | null`, so a durated entry would be legal. No breadcrumb uses
it: every entry is point in time.

| Source       | Type                   |
| ------------ | ---------------------- |
| Click        | `browser_click`        |
| Form change  | `browser_input`        |
| Fetch        | `browser_fetch`        |
| XHR          | `browser_xhr`          |
| Route change | `browser_route_change` |

The three new strings live in a new `BrowserSpanEventType` map in core, beside `BrowserSpanType`.
They are kept apart because clicks and form changes are not spans, and one map holding both would
mean two things.

`browser_route_change` is deliberately not `browser_navigation`. A navigation on an error report has no
reliable end time: in a trace the root closes on idle, and with tracing off there is no idle controller.
One string must not mean a durated span in one place and a point in time in another.

### Attributes

Clicks and form changes:

| Attribute                  | Type   | Description                                                |
| -------------------------- | ------ | ---------------------------------------------------------- |
| `browser.element.selector` | string | Tag, id and class list, e.g. `button#checkout.btn-primary` |
| `browser.element.test_id`  | string | The element's `data-testid`, when present                  |

Fetch and XHR reuse tracing's names exactly, so the backend needs no new attribute keys for them:
`http.request.method`, `url.full`, `http.response.status_code`, `server.address`.

Route changes:

| Attribute                              | Type   | Description                               |
| -------------------------------------- | ------ | ----------------------------------------- |
| `browser.route.from`                   | string | Previous URL, omitted when there is none  |
| `browser.route.to`                     | string | URL after the route settled               |
| `flare.entry_point.handler.identifier` | string | Route pattern, when a router supplied one |
| `flare.route.source`                   | string | `route` or `url`                          |

Route changes carry no `url.full`. The pair is named `from` and `to` because that is what the timeline
UI shows, and reusing `url.full` for the destination would force a translation in the UI for one entry
type. The cost, accepted: a generic filter keyed on `url.full` skips route changes.

## Privacy

Clicks and form changes record a selector only: tag, id, class list and `data-testid`. Never text
content, never input values. There is no option to widen it.

This includes `select` and checkbox elements, where the value is most of the information. That loss is
deliberate: a rule for which elements are "safe" is false the moment somebody builds a customer picker.

Sentry records `aria-label`, `title` and `alt` in the same position. We do not, because those carry
text.

URLs go through the existing redaction, which is `DEFAULT_URL_DENYLIST` in
`packages/core/src/util/redactUrl.ts`. **This is credential redaction, not PII redaction.** It matches
`password`, `token`, `secret`, `api_key`, `session`, `card_number` and similar, in query values only.
It has no `email`, no `name`, no `phone`, and it does not touch path segments. Breadcrumb URLs get
exactly what fetch spans and request context already get. Making one of the three stricter would make
the payload inconsistent without protecting anybody; closing the PII gap is its own piece of work
across the whole SDK.

## Client design

### The buffer

`Scope.breadcrumbs: SpanEvent[]` in core, beside `glows`. The recorders are browser code, but a ring
buffer with a size cap has nothing browser-specific in it, and putting it on `Scope` means Node gets
per-request breadcrumbs for free if it ever wants them.

- `maxBreadcrumbs`, default 100. Drop oldest.
- Never cleared during normal operation, so it spans the whole tab session. This matches glows, which
  are only cleared by an explicit `clearGlows()`.
- Cleared when `enableBreadcrumbs` goes from true to false, matching what `configure()` already does
  with `_logger.clear()` and `_tracer.clear()`.

No byte budget. The automatic entries carry no arbitrary host data, so the only unbounded field is the
URL, and that is capped directly.

### The 256-character URL cap

`browser.route.from`, `browser.route.to` and `url.full` are truncated at 256 characters, with no marker
appended: an ellipsis inside a URL reads as part of the URL to whoever is debugging.

A route change carries two URLs, so it is the largest entry type. At 256 a full buffer of them is
roughly 60 KB, about 11% of the 550,000 byte ingest limit. That limit is enforced by
`MaximumContentCharacters`, which despite its name reads `CONTENT_LENGTH`, so it is bytes.

The cap is an internal constant, not an option. Raising it pushes reports toward the ingest limit, and
that failure is not graceful: `Api.report()` sends one POST and only logs the response when `debug` is
on, so an oversized report loses the whole error rather than just its breadcrumbs.

### Recorders

A `BreadcrumbRecorder` interface with `type` and `install(): teardown`, and class implementations. No
abstract base class. This matches `FileReader` and `FlushScheduler`, which are the codebase's own
answer to "one seam, several fillings". The PHP client's `SpanEventsRecorder` hierarchy exists to serve
a DI container that does not exist here; with five recorders and no per-recorder configuration, a base
class would hold one method.

The single write decision lives in a module function, `recordBreadcrumb(scope, config, type,
attributes)`, which every recorder calls. A function can be tested without constructing a recorder and
cannot be silently overridden.

Recorders bind their handlers in the constructor. `document.addEventListener('click', this.handle)`
loses `this`, and the failure is a silently dead listener rather than an error.

Per-recorder configuration is deferred. Nothing here blocks adding it.

### Clicks

One capture-phase listener on `document`. Capture phase so it sees clicks an application stops
propagating.

From `event.target`, walk up at most five levels for the nearest interactive ancestor: `button`, `a`,
`input`, `select`, `textarea`, `label`, `[role]`, `[tabindex]`, `[onclick]`. If none matches, record
`event.target` anyway.

**Never drop a click.** React and Vue attach handlers at the root, so a `<div onClick>` has no
`onclick` attribute, no role and no tabindex. The DOM cannot tell you it is interactive. Dropping
unmatched clicks would silently lose exactly the ones a modern application cares about, and a wrong
drop is invisible while a noisy entry is merely unhelpful.

Sentry solves the same problem differently: `htmlTreeAsString` walks five levels unconditionally and
records the whole ancestor chain, `body > div.cart > button#checkout > span`. That never guesses wrong
and costs about four times the bytes. We record one element instead, because a person scanning twenty
rows wants a name, not a path.

### Form changes

Listen to `change`, not `input`. `input` fires per keystroke: one email address is about 25 entries, and
four fields would evict every click and request before them. `change` gives one entry per field the
person finished, with no timers and no collapse rule.

The cost: someone who types and never blurs before the error produces nothing. Collapsing repeated
`input` events on the same element is the upgrade if that turns out to matter.

### Interception is a bus

One internal bus carries intercepted activity. Every source publishes to it, and each subscriber
decides on its own whether to act. Tracing and breadcrumbs are the two subscribers today; clicks go on
the bus as well, so that browser traces can later show interaction on the root span without a new
mechanism.

The bus is internal. It is not exported from `@flareapp/js`, and there is no public `addBreadcrumb`
either: `flare.glow()` is already the manual API, and a second one would need explaining forever.

**One thing is not a bus message.** The fetch patch does not only observe a request, it rewrites it:
`instrumentFetch.ts:70-80` builds a `traceparent` and calls through with `finalInit` instead of `init`.
A broadcast cannot carry that. So beside the bus there is a **mutation slot**: one holder, synchronous,
may return a replacement init. Only tracing claims it. A breadcrumb recorder must never be able to
change an outgoing request, and that is enforced by the slot being a separate thing rather than by
convention.

The slot is last-wins with a loud console warning on a second claim, matching `registerNavigationSource`
which already replaces a previous source. Vite HMR re-runs boot code against a `window.fetch` that
survived the reload, which is the case that produces a second claim; first-wins would leave the stale
holder in charge.

### Splitting the patch from the behaviour

Today `createFetchWrapper(tracer, original, urls)` opens the span, builds the `traceparent` and ends the
span. Installing the patch and installing tracing are one act, which is why "first subscriber installs"
would otherwise mean "the first subscriber's behaviour is what runs".

The refactor splits it in two:

- The wrapper becomes neutral. It publishes request start and request settle, and asks the mutation slot
  whether to replace the init. It knows nothing about spans.
- Tracing becomes a subscriber that also holds the mutation slot.

`createPatcher<T>()` needs no change: it is already feature-neutral, holds one `installed` flag for the
whole patch set, and refuses to restore if a third party wrapped over it.

Install is reference-counted. First subscriber patches, last unsubscriber unpatches. `browser.ts` stops
calling `instrumentFetch` and `unpatchFetch` directly and subscribes instead, so tracing toggling off at
runtime no longer rips the patch out from under breadcrumbs.

Order of subscription does not affect behaviour, because behaviour comes from subscribing rather than
from installing. One benign effect survives: a request firing between two subscriptions gets no
`traceparent`. Both subscribe inside the same synchronous `configure()` call, so that gap is empty.

### The navigation module

The built-in History detection currently lives inside `startBrowserTracing`
(`browserTracing.ts:316-318`), which runs only when `enableTracing` is true. With breadcrumbs on and
tracing off, nothing would detect navigation at all unless a framework router was wired. A vanilla SPA
would record zero route changes, silently.

So three things move together into a neutral navigation module: the History patch, the
`registerNavigationSource` registration with its last-wins token and stale-handle guard, and the
broadcast to subscribers. It installs when the first subscriber arrives and removes when the last
leaves. A registered router source still suppresses the History detection.

**The four framework packages change nothing.** TanStack Router, React Router v7, vue-router and
SvelteKit keep importing `registerNavigationSource` from `@flareapp/js` with the same signature.

A breadcrumb is emitted on `settleNavigation`, not `startNavigation`. React Router v7 opens a navigation
before the URL commits, and the `url` field on `RouteName` exists so a redirect can re-stamp it.
Emitting early would record where the router was headed rather than where the person landed.

The first page load emits a `browser_route_change` with no `browser.route.from`, so the timeline opens
with where the person landed instead of starting mid-session. A hard reload loses the previous URL
permanently, because the buffer is in memory.

### Electron renderers

`RendererFlare` extends core `Flare` and overrides only `sendReport`, so `buildReport` runs in the
renderer and fills `events`. `isReportShape` (`ipcReceiver.ts:55`) checks `Array.isArray(r.events)` and
forwards the array whole, and the 1,000,000 byte IPC cap is far above a full buffer. The renderer
installs the recorders like `packages/js` does.

A renderer loading from `file://` produces route change entries with `file://` URLs. Odd to read,
harmless.

## Configuration

Two new options:

- `enableBreadcrumbs: boolean`, default `false`
- `maxBreadcrumbs: number`, default `100`

Default off, deliberately. Tracing defaults off, and a silent payload increase for everyone who upgrades
is not something to do without asking.

No existing option changes meaning. `maxGlowsPerReport` keeps its name, its default and its behaviour as
a hard ceiling on glows.

## Breadcrumbs never write into a trace

Recorders write to the report only. They never call `Span.addEvent`, and there is no option that would
let them. See `docs/adr/0001-breadcrumbs-never-write-into-traces.md`.

The short version: the fetch and XHR recorders describe requests that tracing already records as
`browser_fetch` and `browser_xhr` spans. If they also wrote into the current span, one trace would carry
each request twice. A `withTraces` flag defaulting to false does not prevent that, because it reads as a
switch and the fetch recorder is the one where flipping it is wrong.

Clicks carry no such hazard, since tracing produces no click spans. Interaction on a trace root is a
separate future feature, and fetch and XHR must stay out of it.

## Backend

### The null path is broken today, independent of this feature

`ErrorOccurrenceEventData::fromDatabase` resolves the type through four `tryFrom` calls: PHP client
`SpanType`, `LaravelSpanType`, `SpanEventType`, `LaravelSpanEventType`. When all four miss it passes
`null` to a constructor property typed as a non-nullable union, which throws a `TypeError`. The
`array_filter` around the `array_map` in `ErrorOccurrenceData` shows somebody expected null to be
returned and filtered; it throws first.

So **any** client sending **any** unknown type 500s the error detail page. Fix this on its own, before
and regardless of breadcrumbs.

Note this is specific to the error path. Traces are safe: `ProcessSpanAction:78` uses
`tryFrom(...) ?? SpanEventType::Unknown`.

### What breadcrumbs then need

- **All five type strings need backend enum cases**, including `browser_fetch` and `browser_xhr`. The
  error path resolves against the PHP client enums and never reads this repo's `BrowserSpanType`, so
  the strings tracing already sends are still unknown here.
- `AttributesData` gains `browser.element.selector`, `browser.element.test_id`, `browser.route.from`
  and `browser.route.to`, which also regenerates the TypeScript types.
- `Debug.tsx` is a hardcoded if/else over type strings, and an unmatched type produces no row at all.
  It needs a branch per new type, an entry in its `EventType` union, and a filter chip.
- New item components beside `GlowEventItem`. Whether `HttpRequestEventItem` renders the browser request
  attributes unchanged is unconfirmed: check it, do not assume it.
- The timeline labels `browser_route_change` as "Navigation", because that is what it is to the person
  reading it.

No ingest changes. `ValidateRawReportAction` has one rule for events, `'events' => ['present',
'array']`, with nothing per entry.

## Implementation order

1. **Backend: fix the `fromDatabase` null path.** Alone. It is a bug fix, not part of this feature.
2. **Client: the interception refactor.** Neutral wrapper, bus, mutation slot, reference-counted
   install, and the navigation module. Tracing is the only subscriber. No new payload, so the existing
   tracing suite is the whole proof.
3. **Backend: enum cases, attribute keys, Debug tab components.**
4. **Client: the buffer, the recorders, the config.** The only step that puts anything new on the wire.

Steps 2 and 3 touch nothing in common and run in parallel. Step 4 waits for both. Breadcrumbs
defaulting to off is not the safety net; step 3 landing before step 4 is.

Step 4 splits further if wanted: buffer plus config plus one recorder, then the rest.

## Testing

**Core:** the 100-entry cap, drop-oldest, clear on disable, and the merge with glows in `buildReport`.

**`packages/js`, per recorder:** the ancestor walk and its five-level bound, the fallback to
`event.target`, the guarantee that no text and no input value is ever read, `change` and not `input`,
reference-counted install and uninstall, the last-wins mutation slot, and a route change recorded with
tracing off.

**The refactor needs no new tests.** The existing tracing suite is the proof, which is the reason for
landing it separately.

**Electron:** its own test, because the renderer report path does not go through the browser one.

**End to end**, split by what is actually framework-specific:

- One click and form scenario in a single playground. Those recorders are plain DOM listeners.
- One route change scenario across all five playgrounds. That is the only part where each framework
  takes a different path through the navigation seam.

## Open items

- Console recorder, deferred. `console.error` is where many applications put their handled failures, so
  this is the first thing to revisit.
- Component names on clicks, deferred. Sentry's come from `data-sentry-component`, stamped by their
  bundler plugin at build time, not from reading React internals. Doing the same means owning a bundler
  plugin.
- Per-recorder configuration, deferred but structurally allowed for.
- Page visibility, online and offline, resize.
- Whether `HttpRequestEventItem` renders the browser request attributes unchanged.
- The PII gap in URL redaction, which is SDK-wide and not this feature's to close.
