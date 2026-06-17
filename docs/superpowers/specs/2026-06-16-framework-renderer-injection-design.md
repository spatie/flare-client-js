# Framework clients in the Electron renderer — injection design

Date: 2026-06-16
Status: draft for planning
Depends on: `@flareapp/electron` 0.1.0 (PR #57), `@flareapp/js/browser` subpath export

## Goal

Let `@flareapp/react`, `@flareapp/vue`, and `@flareapp/svelte` run inside an
Electron renderer and route their reports through the renderer's `RendererFlare`
instance (keyless, IPC-forwarding) instead of the `@flareapp/js` root singleton
(keyed, fetch-direct). Do it WITHOUT breaking existing web consumers, WITHOUT a
dynamic import, and WITHOUT pulling the js root (and its import-time side effects)
into the renderer bundle.

This is a fast follow to the electron 0.1.0 release, which already covers the
global `window.onerror` / `unhandledrejection` path. This spec covers ONLY the
framework error boundaries / handlers.

## Problem

All three framework clients are hardwired to the `@flareapp/js` ROOT singleton:

| Package            | Binding                                     | Call site                                                |
| ------------------ | ------------------------------------------- | -------------------------------------------------------- |
| `@flareapp/react`  | `import { flare } from '@flareapp/js'`      | `FlareErrorBoundary.ts` → `flare.reportSilently`         |
| `@flareapp/vue`    | `import { ..., flare } from '@flareapp/js'` | `flareVue.ts` → `flare.reportSilently` / `reportMessage` |
| `@flareapp/svelte` | `import { ..., flare } from '@flareapp/js'` | `createFlareErrorHandler.ts` → `flare.reportSilently`    |

That singleton (`packages/js/src/index.ts`) is the browser `Flare`: it POSTs
directly via fetch (needs key + `ingestUrl`), and importing the module runs
`new Flare()`, `window.flare = flare`, and `catchWindowErrors()` as side effects.
Each framework ALSO registers SDK identity at module load
(`registerReactSdkIdentity()`, `flare.setSdkInfo(...)` in vue,
`registerSvelteSdkIdentity()`), mutating that singleton on import.

On the WEB this is exactly right: the consumer does `import { flare } from
'@flareapp/js'; flare.light(key)` and then renders `<FlareErrorBoundary>` with no
prop; the boundary implicitly reports through that same configured singleton. The
shared-singleton default is the documented web ergonomic and must stay.

In an Electron renderer the same wiring is wrong on four counts:

1. **Key leak / wrong transport.** The singleton fetches Flare directly, which
   needs the API key in the renderer and bypasses IPC. That defeats electron's
   single-key design (key lives only in main) and skips main's enrichment + gate.
2. **Bypasses `RendererFlare`.** Frameworks call the imported `flare` binding,
   not `window.flare`. The IPC-forwarding `RendererFlare` is never touched even
   though `renderer.ts` assigned it to `window.flare`.
3. **Duplicate side effects.** Importing `@flareapp/js` root installs a second
   `window.flare` and a second `catchWindowErrors()` alongside the electron
   renderer's own. Whoever imports last wins `window.flare`; global errors get
   double-reported or misrouted depending on bundler order.
4. **SDK identity clobber.** Module-level `setSdkInfo({ name: '@flareapp/react' })`
   etc. would overwrite electron's `@flareapp/electron` SDK name on the shared
   instance.

## Decisions

1. **Optional dependency injection is the seam.** Each integration accepts an
   optional Flare instance. Web passes nothing and keeps the existing default
   singleton; Electron passes the `RendererFlare`. The method surface already
   matches — `RendererFlare` inherits `reportSilently` / `reportMessage` /
   `reportUnhandledRejection` from the js browser `Flare`, and its overridden
   `sendReport` does the IPC forward — so only the SOURCE of the instance changes,
   not the call sites. Additive: no change to existing web call signatures.

2. **Separate entry points, NOT a dynamic import.** The js root is electron's
   problem only because its side effects fire on import. Web WANTS those side
   effects; the renderer must never reach them. Split by entry, not by `await`:
    - **Default (web) entry** — `@flareapp/react` / `@flareapp/vue` /
      `@flareapp/svelte`. Statically imports `@flareapp/js`, registers the root
      singleton as the default Flare, and sets SDK identity on it at import.
      Behavior is byte-for-byte identical to today.
    - **Inject (electron-safe) entry** — `@flareapp/react/inject` (and vue/svelte
      equivalents). Re-exports the SAME boundary/handler component, but its module
      graph contains NO reference to `@flareapp/js` root, so importing it never
      runs the root side effects. No default is registered, so `flare` must be
      supplied (prop / option / context); if absent it throws a clear error.

    Both entries share one component implementation and one optional `flare?` type.
    They differ only in whether a default singleton was registered. Resolution is
    fully synchronous — no dynamic import, no async-first-report regression on the
    web default path.

3. **Identity registration: at-import for web, per-instance for injected.**
    - Default entry: on import, set `setSdkInfo` + `setFramework` on the root
      singleton, exactly as today (preserves the web window where a global
      `catchWindowErrors` report fired before any boundary mounts still carries
      `framework = React|Vue|Svelte`).
    - Injected instance: on first resolve, set `setFramework({ name, version })`
      ONLY — never `setSdkInfo` (that would clobber `@flareapp/electron`). Guard
      with a `WeakSet<Flare>` so the same instance is tagged once and DIFFERENT
      instances are each tagged (today's module-level boolean guard cannot, since
      it blocks tagging a second target).
    - Backend then sees `sdk = @flareapp/electron`, `framework = Vue|React|Svelte`
      in the renderer; `sdk = @flareapp/<framework>`, `framework = ...` on web.

4. **Backward compatible, additive → MINOR release.** The `/inject` entry, the
   optional `flare?` option, and the fallback-provider indirection are all
   additive. A web app that imports `@flareapp/react` and renders
   `<FlareErrorBoundary>` with no `flare` prop behaves exactly as today. Bump
   `@flareapp/react`, `@flareapp/vue`, `@flareapp/svelte` `2.4.0 → 2.5.0`. No
   major break, the documented zero-prop web API is untouched.

5. **Resolve the instance once at WIRING time, never at report time.** The
   instance is resolved (and `resolveFlare` may throw) when the boundary is
   constructed / `app.use(flareVue)` runs / `createFlareErrorHandler()` is called
   — NOT inside `componentDidCatch` / the vue `errorHandler` / the svelte
   `handleError`. A missing instance is a wiring bug; surface it at boot, not by
   throwing inside an error handler (which would mask the original error or crash
   the host). The report path is then infallible. Identity is also tagged at this
   resolve point.

6. **SvelteKit ordering is a hard constraint.** `@flareapp/sveltekit` does
   `export * from '@flareapp/svelte'` and re-asserts `sdk = @flareapp/sveltekit`
   on every report to beat svelte's module-load identity registration (see
   `sveltekit/src/identify.ts`). The svelte DEFAULT entry MUST keep registering
   identity at import (byte-for-byte as today) so this override ordering is
   preserved. SvelteKit imports the svelte main entry, never `/inject`, never
   `createFlareErrorHandler` — but a regression test must assert the sveltekit sdk
   name still wins after these changes.

## Shared type

The injected instance is typed against the browser `Flare` from
`@flareapp/js/browser` (the minimal surface the integrations call). This is a
type-only import — `browser.ts` has no top-level side effects, so it does not pull
the root into the inject entry.

```ts
import type { Flare } from '@flareapp/js/browser';
// integrations only use: reportSilently, reportMessage, setFramework
```

`RendererFlare extends BrowserFlare extends CoreFlare`, so a `RendererFlare` is
assignable to this `Flare` type.

## Default-resolution pattern (shared, synchronous)

A tiny indirection lets one component impl serve both entries without the inject
entry ever referencing the root. No `import('@flareapp/js')`, no promise.

```ts
// resolveFlare.ts — shared, NO @flareapp/js root import
import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the default (web) entry as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: registering a web default while the electron bridge exists means
    // the renderer pulled the root entry (it must use `/inject`). Surfaces the
    // one realistic way the silent-fallback hazard bites.
    if (typeof window !== 'undefined' && (window as Record<string, unknown>).__flare) {
        console.warn(
            '[flare] @flareapp/js default registered while the electron bridge is ' +
                'present. In a renderer, import the framework from its `/inject` entry ' +
                'and pass the @flareapp/electron/renderer instance instead.',
        );
    }
    defaultProvider = provider;
}

// Call at WIRING time (boundary construct / plugin install / handler creation),
// never inside a report path. Throws here so a missing instance fails fast at boot.
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) return explicit;
    if (defaultProvider) return defaultProvider();
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import the package main entry to use ' +
            'the @flareapp/js default singleton.',
    );
}
```

```ts
// index.ts — DEFAULT (web) entry. Static root import; side effects fire as today.
import { flare } from '@flareapp/js';
import { registerDefaultFlare } from './resolveFlare';
import { registerReactSdkIdentity } from './identify';

registerDefaultFlare(() => flare);
registerReactSdkIdentity(flare); // sdkInfo + framework on the singleton, as today
export { FlareErrorBoundary } from './FlareErrorBoundary';
// ...existing re-exports
```

```ts
// inject.ts — INJECT (electron-safe) entry. No @flareapp/js root in this graph.
export { FlareErrorBoundary } from './FlareErrorBoundary';
// ...same re-exports, minus the root-importing default registration + identity
```

The component calls `resolveFlare(this.props.flare)` (or `options.flare`). On web
the registered provider returns the singleton; on the inject path the caller must
pass an instance.

The component resolves `flare` at construction (see Decision 5), not per report.

> Tree-shaking note: `registerDefaultFlare(...)` and the `@flareapp/js` import are
> retained because they are calls/imports with side effects; verify the default
> entry still runs them after bundling (covered in Testing). `sideEffects` is
> currently unset on all three packages, so this holds today; react/vue pin it
> explicitly (see Versioning) to keep it true if a future `sideEffects: false` is
> added.

## Per-framework API

### React

Add an optional `flare` prop to `FlareErrorBoundary` (and the equivalent option to
`flareReactErrorHandler`). Optionally a `FlareProvider` context so a tree can set
it once.

```tsx
// web (unchanged):
import { FlareErrorBoundary } from '@flareapp/react';
<FlareErrorBoundary>
    <App />
</FlareErrorBoundary>;

// electron renderer:
import { flare } from '@flareapp/electron/renderer';
import { FlareErrorBoundary } from '@flareapp/react/inject';
<FlareErrorBoundary flare={flare}>
    <App />
</FlareErrorBoundary>;
```

- `FlareErrorBoundaryProps.flare?: Flare`
- Resolution order: prop → [context reserved, not built in v1] → registered default → throw.
- `registerReactSdkIdentity(instance)` takes the resolved instance. On the
  injected path it sets `setFramework` only; on the default singleton (called from
  the web entry at import) it sets both, as today. `WeakSet<Flare>` guard.
- `flareReactErrorHandler` (the React 19 `createRoot` path) is a SECOND root
  binding — today it imports root `flare` directly. Add `flare?: Flare` to
  `FlareReactErrorHandlerOptions`, resolve it once when the handler is created
  (not per call), and export the handler from `/inject` too. Without this, React
  19 electron users get a working boundary but a broken `onCaughtError` handler.

    ```ts
    // electron renderer, React 19:
    import { flare } from '@flareapp/electron/renderer';
    import { flareReactErrorHandler } from '@flareapp/react/inject';
    createRoot(el, { onCaughtError: flareReactErrorHandler({ flare }) });
    ```

### Vue

Extend `FlareVueOptions` with `flare?: Flare`.

```ts
// web (unchanged): app.use(flareVue)
// electron renderer:
import { flare } from '@flareapp/electron/renderer';
import { flareVue } from '@flareapp/vue/inject';
app.use(flareVue, { flare });
```

- `flareVue.ts` resolves `resolveFlare(options?.flare)`.
- Identity is set inside install (as today). On the default singleton:
  `setSdkInfo` + `setFramework`. On an injected instance:
  `setFramework({ name: 'Vue', version: app.version })` only, `WeakSet`-guarded.

### Svelte

Extend `FlareErrorHandlerOptions` with `flare?: Flare`.

```ts
// web (unchanged):
import { createFlareErrorHandler } from '@flareapp/svelte';
// electron renderer:
import { flare } from '@flareapp/electron/renderer';
import { createFlareErrorHandler } from '@flareapp/svelte/inject';
export const handleError = createFlareErrorHandler({ flare });
```

- `createFlareErrorHandler.ts` resolves `resolveFlare(options?.flare)`.
- `registerSvelteSdkIdentity(instance)` moves out of module scope (today it runs
  at the top of BOTH `index.ts` and `createFlareErrorHandler.ts`; both must move).
  Same injected-instance rule: `setFramework` yes, `setSdkInfo` no.

## Build / packaging changes

- **react, vue (tsdown):** add `src/inject.ts`, extend the build to emit it
  (`tsdown src/index.ts src/inject.ts ...`), and add a `./inject` key to
  `exports` (import + require, `.d.mts`/`.d.cts`), mirroring the `.` entry.
- **svelte (`svelte-package`):** `svelte-package` already compiles every `src/`
  module to `dist/` (that is how `./config` exists). Add `src/inject.(ts|js)` and
  a `./inject` `exports` key pointing at the compiled output. No build-command
  change.
- All three: the default entry keeps the static `@flareapp/js` import; the inject
  entry must not import it directly or transitively (enforced by test).

## Electron-side ergonomics

- `@flareapp/electron/renderer` already exports the `flare` (RendererFlare)
  singleton. No new export needed for injection.
- Document clearly in the electron README: in the renderer, do NOT import
  `@flareapp/js` anywhere; import the framework from its `/inject` entry, get the
  instance from `@flareapp/electron/renderer`, let `renderer.ts` own `window.flare`
    - global catch, and pass that instance into the framework boundary.

## Report flow (React example, in renderer)

```
component throws
  → FlareErrorBoundary.componentDidCatch
  → resolveFlare(props.flare) → injected RendererFlare
  → RendererFlare.reportSilently(error, reactContextAttrs)
  → RendererFlare.sendReport: renderer beforeSubmit → flatJsonStringify → size-check
  → window.__flare.report(string)  [contextBridge → IPC]
  → main ipcReceiver: trust + size + shape
  → overlay main config + electron/app metadata (react context.custom preserved)
  → main beforeSubmit → Api.report → Flare backend
```

The framework-collected context (`context.custom.react|vue|svelte`) lives in
`report.attributes` and is preserved by main's overlay, so it survives the IPC
trip intact.

## Testing

Per framework:

- **Default entry, no injection** → unchanged web behavior: the root singleton
  receives the report; SDK identity (`sdkInfo` + `framework`) is set at import, as
  today. Regression guard for the documented zero-prop API.
- **Inject entry, instance passed** → that instance receives the report; the js
  root singleton does NOT (bypass regression guard).
- **Inject entry does NOT import `@flareapp/js` root.** Two guards:
    - Runtime: importing the `/inject` entry installs no `window.flare`, runs no
      `catchWindowErrors`, performs no `setSdkInfo` clobber. Spy on the side effects,
      mirroring `js/tests/browserExport.test.ts`; `vi.resetModules()` per case.
    - Static (load-bearing): a post-build assertion that the built `dist/inject.*`
      bundle contains no bare `@flareapp/js` root specifier. Runtime spies can't
      prove a module was never loaded; the dist grep proves absence.
- **Inject entry, no instance** → `resolveFlare` throws at WIRING time (boundary
  construct / install / handler creation), with the clear error — not at report.
- **Identity on injected instance** → `setFramework` set, `setSdkInfo` NOT.
  `WeakSet` guard tags the same instance once and distinct instances separately.
- **`flareReactErrorHandler` inject path** → handler created with `{ flare }`
  routes to that instance; the root singleton does NOT receive it.
- **Double-import dev-warn (Q4 tripwire)** → `registerDefaultFlare` warns when
  `window.__flare` already exists.
- **`sideEffects` regression** → importing the default entry registers the default
  and a zero-prop report routes to the singleton (guards against a future
  `sideEffects: false` shaking the registration out).

Cross-package:

- Electron renderer + React: `reportSilently` on the injected `RendererFlare`
  forwards a STRING over the bridge and the react `context.custom` survives in the
  parsed payload on the main side.
- SvelteKit regression (Decision 6): in a sveltekit app running against svelte
  `2.5.0`, reports still carry `sdk = @flareapp/sveltekit` (svelte's import-time
  identity registration is overridden as today).

## Versioning

Additive minor. Bump only the three framework packages:

- `@flareapp/react` `2.4.0 → 2.5.0`
- `@flareapp/vue` `2.4.0 → 2.5.0`
- `@flareapp/svelte` `2.4.0 → 2.5.0`

No release for:

- `@flareapp/sveltekit` — its `@flareapp/svelte ^2.4.0` dep already satisfies
  `2.5.0`; no code change, but its test suite must run against svelte `2.5.0` to
  honor the Decision 6 guard.
- `@flareapp/electron` — it is the consumer; README/docs update only (point users
  at the `/inject` entries). Its hard `@flareapp/js 2.4.0` pin means the framework
  peerDep `^2.4.0` is satisfied in any electron app — no install friction.

No `@flareapp/js` change required. `peerDependencies` on `@flareapp/js ^2.4.0`
stay valid (the inject entry only uses the `@flareapp/js/browser` type + the
injected instance).

`sideEffects`: set `sideEffects: ["./dist/index.*"]` on `@flareapp/react` and
`@flareapp/vue` so the registering default entry survives future tree-shaking
while `/inject` still shakes clean. Svelte (svelte-package dist layout) relies on
the regression test instead.

## Out of scope

- React `FlareProvider` context — DEFERRED to a follow-up. v1 is prop-only; the
  resolution order reserves a context slot but does not build it. Add only if real
  trees need set-once. (vue/svelte never get context — options is their idiom.)
- Changing the existing web default behavior or call signatures beyond the additive
  `flare?` option and the new `/inject` entry.
- Electron Playwright e2e for the framework path (follow-up, same as electron 0.1.0).
