# React Native client (`@flareapp/react-native`) — design

Date: 2026-06-18
Status: Approved, ready for implementation plan

## Goal

Add a pure-JS Flare client for React Native that works on both Expo (managed)
and bare React Native, with no required native module. It captures uncaught JS
errors and React render errors, enriches reports with device/app context, and
reports to the Flare backend through the existing core pipeline.

## Constraints

- **Pure JS.** No native module is a hard dependency. Expo packages are
  optional and lazy-required; absence degrades gracefully to RN-core context.
- **Reuse core.** Subclass `CoreFlare` and inject platform seams, exactly like
  `@flareapp/node` and `@flareapp/electron` already do. No fork of the report
  pipeline.
- **No premature divergence.** Anything that is genuinely cross-platform
  (breadcrumb auto-instrumentation) is deferred to a unified spec rather than
  shipped RN-first.

## Package layout

New workspace `packages/react-native/` published as `@flareapp/react-native`.

- Subclasses `CoreFlare` (`class ReactNativeFlare extends CoreFlare`), mirroring
  `NodeFlare`.
- tsdown build (CJS + ESM + `.d.ts`), own `vitest.config.ts` and
  `.oxlintrc.json`.
- Exports a singleton `flare`.

Dependencies:

- `@flareapp/core` — hard-pinned to an exact version, like js/node.
- `@flareapp/react` — for the error boundary, consumed via its side-effect-free
  `/inject` entry (the same entry built for Electron renderers).
- `react`, `react-native` — `peerDependencies`.
- Expo packages (`expo-device`, `expo-application`) — NOT dependencies.
  Lazy-`require`d at runtime inside try/catch.

Entry points:

- root `@flareapp/react-native` — the `flare` singleton, `light()`-driven
  handler install, and a re-exported `FlareErrorBoundary` wired to the RN flare.

## The five core seams

`ReactNativeFlare`'s constructor injects the same five seams `CoreFlare` takes.
Three are reused from core unchanged; two are new RN implementations.

| Seam               | Choice                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `Api`              | reuse core `Api` (fetch is native in RN)                               |
| `ContextCollector` | NEW `makeReactNativeContextCollector()` (see below)                    |
| `FileReader`       | reuse core `NullFileReader` (no runtime snippets; sourcemaps deferred) |
| `ScopeProvider`    | reuse core `GlobalScopeProvider` (RN is a single app scope)            |
| `FlushScheduler`   | NEW `ReactNativeFlushScheduler` (see below)                            |

Rationale for the reuses:

- **No runtime source snippets.** RN has no JS filesystem and the bundle is
  minified, so `NullFileReader` is correct. De-minification is handled later by
  a Metro sourcemap-upload package (out of scope).
- **Single global scope.** Unlike node, RN has no per-request concurrency to
  isolate, so `GlobalScopeProvider` is sufficient; no AsyncLocalStorage.

### `ReactNativeFlushScheduler`

Implements `FlushScheduler`. Registers an `AppState` listener; on transition to
`background` it calls `flush()`. Only relevant when `enableLogs` is on, but
always wired (cheap).

It is INSPIRED BY `BrowserFlushScheduler` (flush on lifecycle exit) but the RN
semantics differ on two points the implementer must not paper over:

- **Flush on `background` only, NOT `inactive`.** On iOS, `inactive` fires on
  every transient interruption (app-switcher peek, Control Center pull, incoming
  call, notification banner), so flushing on `inactive` floods the network with
  redundant requests. The browser analog gates on `hidden` only, not every blur;
  `background` is the correct RN equivalent. `inactive` is ignored.
- **Delivery on backgrounding is best-effort, NOT guaranteed.** The browser's
  `flush({ keepalive: true })` leans on fetch/Beacon keepalive to survive page
  unload. RN's `fetch` rides on `XMLHttpRequest` and does NOT reliably honor
  `keepalive`; when iOS/Android suspends the app an in-flight request can be
  killed mid-flight. So this scheduler calls plain `flush()` and accepts that a
  background flush may drop. A guaranteed-delivery path (native module or a
  persistent on-disk queue replayed on next launch) is explicitly out of scope
  for v1; the spec must not imply background delivery is reliable.

This is the only legitimately RN-specific use of `AppState`: a flush trigger,
not breadcrumb instrumentation. So it does not constitute the cross-platform
divergence we are deferring.

## Error capture

Two sources (global JS errors + React boundary). Native crashes are out of
scope (would require a native module).

### 1. Global JS handler

`ReactNativeErrorHandler` wraps RN's `ErrorUtils`, chaining the previous handler
so RN's own behavior (red box in dev, crash in prod) is preserved:

```ts
const prev = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
    flare.report(error);
    prev?.(error, isFatal); // chain, do not swallow
});
```

This is the RN analog of `catchWindowErrors`.

**Unhandled promise rejections (best-effort, engine-aware).** RN does NOT route
these through `window.onunhandledrejection`, and the hook differs by JS ENGINE,
not RN version — this is the critical subtlety:

- **Hermes (RN's default engine since 0.70):** rejections are tracked on
  Hermes's native `Promise` via `global.HermesInternal.enablePromiseRejectionTracker`.
  The `promise` npm polyfill is NOT the runtime `Promise` on Hermes, so calling
  the polyfill's `rejection-tracking.enable()` resolves and runs without
  throwing but hooks objects the app never creates — a SILENT no-op. A
  polyfill-only implementation captures nothing on essentially every modern app.
- **JSC / non-Hermes:** RN polyfills `global.Promise` with the `promise`
  package, so `promise/setimmediate/rejection-tracking.enable()` is the real hook.

v1 resolves the enabler by engine (Hermes hook first, polyfill second), and if
neither is reachable logs a single dev debug line and continues with NO rejection
capture (uncaught throws via `ErrorUtils` still work). It must never crash.
Verify against the installed ENGINE (not just RN version) during implementation;
Sentry's RN SDK branches on Hermes vs polyfill the same way.

When the hook does land, report via core's
`reportUnhandledRejection(message, attributes)` (`core/Flare.ts:372`), NOT plain
`report()` — same path the browser uses, so unhandled rejections get the
`UnhandledRejection` shaping (empty-stack class) consistently across SDKs.

**Chaining limitation (asymmetry with the ErrorUtils path).** RN's rejection
tracker is enabled by default with its own `onUnhandled` (the dev warning).
`enable()` REPLACES the callbacks and RN exposes no getter for the previous
ones, so — unlike the ErrorUtils handler, which truly chains the prior handler —
the rejection hook cannot chain RN's default. To avoid silently swallowing that
developer signal, our `onUnhandled` re-emits a `console.warn` in dev (`__DEV__`)
alongside the report. The "log a single debug line" fallback above is a
`console.debug` gated on `__DEV__`, not unconditional library logging.

### 2. React boundary

Reuse `FlareErrorBoundary` from `@flareapp/react`'s `/inject` entry by **passing
the RN `flare` as the `flare` prop**, NOT via the default registry.

The `/inject` entry deliberately does NOT export `registerDefaultFlare` ("NO
default registration" by design — `react/src/inject.ts`); only the web root
(`index.ts`) registers a default, and it carries web side effects. So the
default-registry path is not available here. Instead the RN package ships a thin
wrapper that injects the singleton:

```tsx
import { FlareErrorBoundary as InjectBoundary, type FlareErrorBoundaryProps } from '@flareapp/react/inject';
import type { Flare } from '@flareapp/js/browser';
import { flare } from './flare';

export function FlareErrorBoundary(props: Omit<FlareErrorBoundaryProps, 'flare'>) {
    // `flare` comes AFTER `{...props}` so the RN singleton always wins and a
    // consumer cannot override it. Cast lives here (see type tradeoff below).
    return <InjectBoundary {...props} flare={flare as unknown as Flare} />;
}
```

`resolveFlare(props.flare)` already supports an explicit instance
(`FlareErrorBoundary.ts:43`), so no change to `@flareapp/react` is needed.

**Type tradeoff (name it, don't hunt it).** The boundary's `flare` prop is typed
against `@flareapp/js/browser`'s `Flare`, which itself `extends CoreFlare` and is
therefore a SUPERSET of `ReactNativeFlare` (also a `CoreFlare` subclass, but a
different one). Structural assignment will NOT succeed — the implementer needs an
explicit `flare as unknown as Flare` double-cast at the wrapper, not a clean
structural match. This is safe at runtime because the boundary only calls a
core-level method: `reportSilently(error, attributes)`
(`FlareErrorBoundary.ts:74`), which `ReactNativeFlare` inherits from `CoreFlare`
(`core/src/Flare.ts:368`). The cleaner alternative — widening the boundary prop
to accept `CoreFlare` in `@flareapp/react` — is rejected to avoid touching the
web package; the accepted cost is the double-cast. Do not burn time looking for a
structural assignment that cannot exist.

The boundary component is already DOM-free (`React.Component`,
`errorInfo.componentStack`); it only coupled to the web through the
`@flareapp/react` index side effects (`window.flare`, global catch). The
`/inject` entry exists precisely to consume the boundary without those side
effects. No new boundary code beyond the thin wrapper.

### Install / teardown

- `ReactNativeFlare` overrides `light()`: it calls `super.light(...)` then its
  own `install()`, returning `this` (same chaining contract as `NodeFlare.light`).
- `light()` installs the global handler on first call. **The install MUST be
  idempotent via an explicit `installed` guard flag.** Unlike node's
  `handlerManager.reconcile` (idempotent because it diffs desired vs current
  listeners), `ErrorUtils.setGlobalHandler` chaining is NOT idempotent: calling
  it twice wraps the handler twice and produces a duplicate `flare.report` per
  error. The same applies to the rejection hook and the `AppState` listener. So
  the install routine checks `if (this.installed) return;` before wiring
  anything, sets the flag, and only `removeHandlers()` clears it. Do NOT model
  this on node's reconcile; node's mechanism does not transfer.
- `removeHandlers()` detaches the `ErrorUtils` handler (restoring the captured
  previous handler), the rejection tracking hook, and the `AppState` listener,
  and clears the `installed` flag so a later `light()` can re-install. Intended
  for tests and manual teardown, mirroring node's `removeProcessListeners()`.
  Note: `AppState.addEventListener` returns a subscription object — remove via
  the stored `subscription.remove()` handle. Do NOT use
  `AppState.removeEventListener`, which is deprecated/removed in modern RN.

## Context collector

`makeReactNativeContextCollector()` returns a synchronous collector
(`(config) => Attributes`, matching the seam signature). Because the seam is
synchronous, async Expo getters cannot be awaited per report; the collector uses
only synchronous sources.

**Layer 1 — RN core (always present, sync):**

- `Platform.OS` → `os.name` (NOT `os.type`). OTel's `os.type` conventionally
  means the kernel family, and node's collector already uses `os.type` for
  `process.platform`; mapping `'ios'`/`'android'` to `os.name` keeps RN
  consistent with node and the sanctioned key list. When Expo is present its
  `osName` overwrites this with a more precise value (e.g. `'iOS'`) under the
  same key.
- `Platform.Version` → `os.version`. Note: it is a string on iOS but a number on
  Android, so stringify before projecting.
- `Dimensions.get('window')` → `device.screen.width`, `device.screen.height`,
  `device.screen.scale`. These are not standard OTel keys (OTel has no screen
  semconv); they are our chosen namespacing under `device.screen.*`. Fixed here
  so the backend sees a stable shape, not left to implementer choice.

**Layer 2 — Expo (optional, lazy, sync constants only):**

- Once at module load: `try { deviceMod = require('expo-device'); appMod =
require('expo-application') } catch { /* bare RN, skip */ }`. `require` is
  synchronous under Metro, so it fits the sync collector. Module refs are cached.
- Read only Expo's synchronous constant fields: `Device.modelName`,
  `Device.osName`, `Device.osVersion`, `Device.deviceType`,
  `Application.nativeApplicationVersion`, `Application.applicationId`.
- The async `...Async()` getters are NOT used in v1.
- When Expo is absent (bare RN), these keys are simply omitted.

**Attribute keys.** Project to OTel-style keys for cross-SDK consistency with
the node collector: `device.model.name`, `device.type`, `os.name`,
`os.version`, `app.version`.

**User.** `setUser(user)` stores the user on a `private user: User | null`
field declared on the `ReactNativeFlare` subclass (RN is single-scope, so no
per-scope user like node's `NodeScope`). The
collector closes over `() => this.user` and projects to `enduser.id`,
`enduser.email`, `enduser.username`. This mirrors how the node collector closes
over `() => this.nodeOptions`.

Implementation note: the collector is built in the constructor and passed to
`super(...)` before the `ReactNativeFlare` subclass field initializers run, so
`this.user` is `undefined` at construction. This is fine BECAUSE the closure
defers the read to report time, not construction time — same deferral the node
collector relies on. Do not "fix" this by reading `this.user` eagerly; that
would reintroduce the bug.

## Public API surface

```ts
import { flare, FlareErrorBoundary } from '@flareapp/react-native';

flare.light(apiKey);              // inherited; also installs the global handler
flare.configure({ stage, ... });  // inherited from CoreFlare
flare.setUser({ id, email });     // RN-specific, instance-stored
flare.glow('checkout', 'info');   // inherited; manual breadcrumbs
flare.report(error);              // inherited
flare.removeHandlers();           // RN-specific; detach handler + rejection + AppState
```

RN-specific surface added on top of inherited core methods: `setUser`,
`removeHandlers`, and the handler install folded into `light()`. v1 adds no new
config keys (auto-glows were cut — see below).

## Testing

- Per-package `packages/react-native/tests/`, vitest.
- Reuse core's `FakeApi` helper.
- Mock `react-native` (`Platform`, `Dimensions`, `AppState`, `ErrorUtils`) via
  vitest module mock — no native runtime needed.
- Coverage: context collector (with and without Expo, via mocked `require`),
  global handler chaining, flush-on-background, `setUser` projection, boundary
  wiring.
- No playground / Playwright e2e in v1 (RN needs a device/simulator harness,
  which is a separate effort).

## Out of scope / follow-ups

- **Metro sourcemap upload** package (`@flareapp/metro`) — its own spec.
- **Cross-platform auto-instrumentation** (console / network / lifecycle
  breadcrumbs). This was explicitly cut from v1: instrumenting console/XHR/
  AppState as breadcrumbs is a concern shared by browser and node too, and
  shipping it RN-first would force a later unified design to inherit RN's
  accidental API or break it. To be designed once, for all clients, in its own
  spec. Until then, RN breadcrumbs are manual via `flare.glow()`.
- **Navigation breadcrumb adapters** (React Navigation, react-native-navigation).
- **Native crash capture** (requires native modules; violates the pure-JS
  constraint).
- **Expo async device fields** and an **RN e2e harness**.

## Design decisions log

- Pure-JS, both Expo and bare RN — single package, lazy Expo (not a separate
  `@flareapp/react-native-expo`).
- Capture: global JS handler + React boundary; native crashes excluded.
- Context: RN-core always, Expo optional via lazy sync `require`.
- Source code: `NullFileReader` now; Metro sourcemaps later.
- Breadcrumbs: manual `glow()` only in v1; auto-instrumentation deferred to a
  cross-platform spec.
- Verified against Sentry's RN SDK (via context7) that network instrumentation
  should target `XMLHttpRequest`, not `fetch` (RN fetch rides on XHR) — relevant
  to the deferred auto-instrumentation spec, not v1.
