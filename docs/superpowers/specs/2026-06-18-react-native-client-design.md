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
`background`/`inactive` it calls `flush({ keepalive: true })`. This is the RN
analog of `BrowserFlushScheduler`, which flushes on `visibilitychange` → hidden.
Only relevant when `enableLogs` is on, but always wired (cheap).

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

**Unhandled promise rejections.** RN does NOT route these through
`window.onunhandledrejection`; it uses its own rejection-tracking
(`promise/setimmediate/rejection-tracking`). v1 hooks RN's rejection tracking
where reachable. This is the one capture path that MUST be verified against the
installed React Native version during implementation — the integration point has
shifted across RN versions.

### 2. React boundary

Re-export `FlareErrorBoundary` from `@flareapp/react`'s `/inject` entry and
register the RN `flare` as the default via `registerDefaultFlare(() => flare)`.

The boundary component is already DOM-free (`React.Component`,
`errorInfo.componentStack`); it only coupled to the web through the
`@flareapp/react` index side effects (`window.flare`, global catch). The
`/inject` entry exists precisely to consume the boundary without those side
effects. No new boundary code.

### Install / teardown

- `light()` installs the global handler (and reconciles, folding the install in
  the way `NodeFlare.light()` folds `handlerManager.reconcile`).
- `removeHandlers()` detaches the `ErrorUtils` handler, the rejection tracking
  hook, and the `AppState` listener. Intended for tests and manual teardown,
  mirroring node's `removeProcessListeners()`.

## Context collector

`makeReactNativeContextCollector()` returns a synchronous collector
(`(config) => Attributes`, matching the seam signature). Because the seam is
synchronous, async Expo getters cannot be awaited per report; the collector uses
only synchronous sources.

**Layer 1 — RN core (always present, sync):**

- `Platform.OS`, `Platform.Version`
- `Dimensions.get('window')` → screen width / height / scale

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

**User.** `setUser(user)` stores the user on the `ReactNativeFlare` instance
(RN is single-scope, so no per-scope user like node's `NodeScope`). The
collector closes over `() => this.user` and projects to `enduser.id`,
`enduser.email`, `enduser.username`. This mirrors how the node collector closes
over `() => this.nodeOptions`.

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
