# Instrumentation

This folder watches the browser for the rest of the SDK. It patches `fetch`, `XMLHttpRequest`
and the History API, and broadcasts what it sees on two buses. The folder knows nothing about
tracing or breadcrumbs. Those two subscribe to the buses and each decides on its own what to do
with an event.

The words in this file follow the glossary in `CONTEXT.md` at the repo root.

## The flow

```
 app code
    |  fetch(...)        xhr.send(...)         history.pushState(...)
    v
 +---------------------------------------------------------------+
 |  patches, installed once, removed when the last subscriber    |
 |  leaves                                                       |
 |                                                               |
 |  instrumentFetch.ts    instrumentXHR.ts     navigation.ts     |
 +---------------------------------------------------------------+
           |                    |                      |
           +---------+----------+                      |
                     v                                 v
               request bus                      navigation bus
              (requestBus.ts)                   (navigation.ts)
                     |                                 |
         +-----------+-----------+          +----------+-----------+
         v                       v          v                      v
      tracing              breadcrumbs    tracing            breadcrumbs
  traceRequests.ts      RequestRecorder   browserTracing.ts  NavigationRecorder
  holds the mutation    sees every        opens and names    records route
  slot, adds            request           the root spans     changes
  traceparent
```

The subscribers on the bottom row live outside this folder, in `../tracing` and
`../breadcrumbs`.

## One request, step by step

1. The app calls `fetch()` or `xhr.send()`.
2. The wrapper asks the bus if anything is subscribed. If not, it calls the real function and
   stops there.
3. The bus tells every subscriber that a request starts. A subscriber can return an `onSettle`
   handler for the result.
4. If the mutation slot is claimed, its owner can rewrite the request. Tracing uses this to add
   the `traceparent` header.
5. The wrapper sends the request, rewritten or not.
6. When the request settles, the wrapper publishes the result. Every `onSettle` handler sees
   the status or the error.

## The mutation slot

A bus subscriber only sees a request. It cannot change one, and the types make that impossible.

The mutation slot is the one hook that can rewrite a request before it goes out. There is
exactly one slot, so two features can never race on the same headers. Only tracing claims it,
and the only rewrite in the SDK is the `traceparent` header.

The newest claim wins. Vite HMR runs the start-up code again, and the owner from before is
dead. A second claim while the first owner is alive logs a loud warning, because the page then
probably has two copies of `@flareapp/js`.

## Why the traceparent header

The header carries the trace id and the span id of the browser request span. The server reads
the header and continues the same trace. Flare then shows the browser span and the server spans
in one waterfall.

By default the header only goes to same-origin requests. The `tracePropagationTargets` config
option widens or narrows this. A `traceparent` header that the app set itself always wins.

## Counted subscriptions

The patches install when the first subscriber arrives and uninstall when the last one leaves.
The count matters. With tracing and breadcrumbs both on, turning tracing off must not remove
the patch that breadcrumbs still need. `withRequestPatches` in `requestInstrumentation.ts` owns
the count for the request patches. `subscribeToNavigation` in `navigation.ts` does the same for
the History patch.

## Safety rules

Instrumentation must never break the app.

- A subscriber that throws is skipped. The request still goes out.
- When nothing is subscribed, the wrappers call the real function untouched.
- Uninstall is all or nothing. When another library wrapped our wrapper, we restore nothing
  and our wrapper stays in place, idle.

## Navigation

`navigation.ts` does the same job for route changes. The History patch sees `pushState`,
`replaceState` and `popstate`, and broadcasts a url change when the path changed.

A framework router can register as the navigation source. While one is registered, the built-in
detection stays quiet, and the router reports every navigation itself: start, route name,
settle. This is how the React, Vue, Svelte and Inertia packages plug in.

## Files

| File                        | Owns                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `requestBus.ts`             | The bus for outgoing requests, and the mutation slot.                   |
| `instrumentFetch.ts`        | The `fetch` wrapper. Publishes each call on the request bus.            |
| `instrumentXHR.ts`          | The `XMLHttpRequest` wrapper for `open`, `setRequestHeader` and `send`. |
| `requestInstrumentation.ts` | The subscription count. First subscriber installs, last one removes.    |
| `navigation.ts`             | The History patch, the navigation bus and the navigation source seam.   |
