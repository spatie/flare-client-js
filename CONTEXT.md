# Flare JavaScript client

The official JavaScript and TypeScript client for Flare error tracking. It captures errors in browsers,
Node, React Native and Electron, collects context about what happened around them, and reports them to
the Flare backend.

## Language

### Reporting

**Report**:
One error, log or message on its way to the Flare backend. Carries a stack trace, attributes and a
timeline of events.
_Avoid_: Error occurrence, exception payload

**Attribute**:
One named fact about a report or a span, such as `url.full` or `user.id`.
_Avoid_: Field, tag, property

**Scope**:
The mutable state a report is built from: glows, breadcrumbs, pending attributes and the entry point.
One per browser tab, one per request in Node.
_Avoid_: Context, session, state

### The timeline

**Timeline**:
The ordered list of things that happened before an error, shown on the Debug tab. Glows and breadcrumbs
both land on it.
_Avoid_: History, trail, log

**Glow**:
A note a developer placed by hand with `flare.glow()`. Carries a name, a level and arbitrary context.
_Avoid_: Manual breadcrumb, note, marker

**Breadcrumb**:
A timeline entry the SDK recorded on its own, without the developer asking. A click, a form change, a
request or a route change. Distinct from a glow: nothing in the application code produced it.
_Avoid_: Automatic glow, event, trail entry

**Recorder**:
The thing that produces one kind of breadcrumb. One per kind: clicks, form changes, fetch, XHR, route
changes.
_Avoid_: Collector, listener, instrumentation

### Interception

**Bus**:
The internal broadcast that carries intercepted browser activity to whoever is interested. Tracing and
breadcrumbs both subscribe, and each decides on its own what to do with a message.
_Avoid_: Event emitter, pubsub, dispatcher

**Subscriber**:
Something registered on the bus. A subscriber **sees** what the bus publishes.
_Avoid_: Observer, consumer, listener. Also avoid "hears" and every other listening metaphor: you
watch a bus, you do not listen to it.

**Subscription**:
One live registration on the bus. Counting them is what keeps a patch installed, so the count is not
another word for subscriber.
_Avoid_: Consumer count, refcount

**Mutation slot**:
The single-owner hook that may rewrite an outgoing request before it is sent. Separate from the bus,
because a bus message cannot change anything. Only tracing holds it, to attach the `traceparent` header.
_Avoid_: Request hook, interceptor, middleware

**Navigation source**:
A framework router that tells the SDK when a route change starts and settles, and what the route is
called. Registering one suppresses the built-in History detection.
_Avoid_: Router integration, navigation provider

### Tracing

**Span**:
One timed operation in a trace, with a start and an end.

**Span event**:
A point in time attached to a span, or an entry on a report's timeline. Its end time may be null.

**Root**:
The span a browser trace hangs off: one per page load, one per navigation.
_Avoid_: Transaction, root span, parent
