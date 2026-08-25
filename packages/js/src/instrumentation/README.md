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
 |  instrumentFetch.ts    instrumentXHR.ts     navigationBus.ts  |
 +---------------------------------------------------------------+
           |                    |                      |
           +---------+----------+                      |
                     v                                 v
               request bus                      navigation bus
              (requests/)                       (navigation/)
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

The newest claim wins. That keeps Vite HMR clean: HMR re-runs the start-up code, and the new
claim replaces the stale one from the last load. A claim that arrives while the previous owner
is still active usually means the page has two copies of `@flareapp/js`, so that one logs a
warning.

## Why the traceparent header

The header carries the trace id and the span id of the browser request span. The server reads
the header and continues the same trace. Flare then shows the browser span and the server spans
in one waterfall.

By default the header only goes to same-origin requests. The `tracePropagationTargets` config
option widens or narrows this. A `traceparent` header that the app set itself always wins.

## Counted subscriptions

The patches install when the first subscriber arrives and uninstall when the last one leaves.
The count is what keeps turning tracing off from removing the patch that breadcrumbs still
need, when both are on. `withRequestPatches` in `requests/requestPatches.ts` owns
the count for the request patches. `subscribeToNavigation` in `navigation/navigationBus.ts` does
the same for the History patch.

## Safety rules

Instrumentation must never break the app.

- A subscriber that throws is skipped. The request still goes out.
- When nothing is subscribed, the wrappers call the real function untouched.
- Uninstall is all or nothing. When another library wrapped our wrapper, we restore nothing
  and our wrapper stays in place, idle.

## Navigation

`navigation/navigationBus.ts` handles route changes. The History patch sees `pushState`,
`replaceState` and `popstate`, and broadcasts a url change when the path changed.

A framework router can register as the navigation source. While one is registered, the built-in
detection stays quiet, and the router reports every navigation itself: start, route name,
settle. This is how the React, Vue, Svelte and Inertia packages plug in.

## Layout

Each folder exports its public surface through its `index.ts`. Import the folder, not a file
inside it.

```
requests/
    types.ts            the shared types for the request bus
    requestBus.ts       the bus and the mutation slot
    instrumentFetch.ts  the fetch wrapper
    instrumentXHR.ts    the XMLHttpRequest wrapper for open, setRequestHeader and send
    requestPatches.ts   the subscription count: first subscriber installs, last one removes
    index.ts            the public surface of this folder

navigation/
    types.ts            RouteName, NavigationSource, NavigationSubscriber
    utils.ts            currentPath, currentHref, routeName, resolveHref
    navigationBus.ts    the History patch, the bus and the navigation source seam
    index.ts            the public surface of this folder
```
