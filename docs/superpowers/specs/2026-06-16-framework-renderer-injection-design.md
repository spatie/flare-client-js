# Framework clients in the Electron renderer — injection design

Date: 2026-06-16
Status: draft for planning
Depends on: `@flareapp/electron` 0.1.0 (PR #57), `@flareapp/js/browser` subpath export

## Goal

Let `@flareapp/react`, `@flareapp/vue`, and `@flareapp/svelte` run inside an
Electron renderer and route their reports through the renderer's `RendererFlare`
instance (keyless, IPC-forwarding) instead of the `@flareapp/js` root singleton
(keyed, fetch-direct). Do it without breaking existing web consumers and without
re-triggering the js root's import-time side effects in the renderer.

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

In an Electron renderer this is wrong on four counts:

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

1. **Dependency injection is the seam.** Each integration accepts an optional
   Flare instance; defaults to the existing singleton for plain web. Electron
   passes the `RendererFlare`. The method surface already matches —
   `RendererFlare` inherits `reportSilently` / `reportMessage` /
   `reportUnhandledRejection` from the js browser `Flare`, and its overridden
   `sendReport` does the IPC forward — so only the SOURCE of the instance changes,
   not the call sites.
2. **The default singleton import becomes lazy.** A static
   `import { flare } from '@flareapp/js'` runs the root side effects regardless of
   whether the injected instance is used. The default must be resolved lazily
   (only when no instance is injected) so an Electron app that injects
   `RendererFlare` never imports the js root. Types come from the side-effect-free
   `@flareapp/js/browser` export.
3. **Identity registration moves per-instance and lazy.** Module-level
   `registerReactSdkIdentity()` / `registerSvelteSdkIdentity()` /
   `flare.setSdkInfo(...)` must not run at import and must not mutate an injected
   instance's SDK name. When an instance is injected, the framework sets
   `setFramework({ name, version })` (additive, accurate) but NOT `setSdkInfo`.
   Backend then sees `sdk = @flareapp/electron`, `framework = Vue|React|Svelte`.
   For plain web (no injection) behavior is unchanged: the framework owns both
   `sdkInfo` and `framework` on the singleton.
4. **Backward compatible, additive only.** No change to existing web call sites or
   defaults. A web app that imports `@flareapp/react` and renders
   `<FlareErrorBoundary>` with no `flare` prop behaves exactly as today, including
   the js root side effects and SDK identity.

## Shared type

The injected instance is typed against the browser `Flare` from
`@flareapp/js/browser` (the minimal surface the integrations call):

```ts
import type { Flare } from '@flareapp/js/browser';
// integrations only use: reportSilently, reportMessage, setFramework
```

## Per-framework API

### React

Add an optional `flare` prop to `FlareErrorBoundary` (and the equivalent option to
`flareReactErrorHandler`). Optionally a `FlareProvider` context so a tree can set
it once.

```tsx
import { flare } from '@flareapp/electron/renderer';
import { FlareErrorBoundary } from '@flareapp/react';

<FlareErrorBoundary flare={flare}>
    <App />
</FlareErrorBoundary>;
```

- `FlareErrorBoundaryProps.flare?: Flare`
- Resolution order: prop → context (if `FlareProvider` present) → lazy default singleton.
- `registerReactSdkIdentity()` moves out of module scope: called once against the
  resolved instance, and only sets `setFramework` (not `setSdkInfo`) when injected.

### Vue

Extend `FlareVueOptions` with `flare?: Flare`.

```ts
import { flare } from '@flareapp/electron/renderer';
import { flareVue } from '@flareapp/vue';

app.use(flareVue, { flare });
```

- `flareVue.ts` resolves `options.flare ?? lazyDefaultSingleton()`.
- `setSdkInfo` only on the default singleton; on an injected instance call
  `setFramework({ name: 'Vue', version: app.version })` only.

### Svelte

Extend `FlareErrorHandlerOptions` with `flare?: Flare`.

```ts
import { flare } from '@flareapp/electron/renderer';
import { createFlareErrorHandler } from '@flareapp/svelte';

export const handleError = createFlareErrorHandler({ flare });
```

- `registerSvelteSdkIdentity()` moves out of module scope; same injected-instance
  rule (framework yes, sdkInfo no).

## Lazy-default pattern (shared)

```ts
import type { Flare } from '@flareapp/js/browser';

let cachedDefault: Flare | null = null;

async function defaultFlare(): Promise<Flare> {
    if (!cachedDefault) {
        // Dynamic import so the js root (and its side effects) only load when
        // no instance was injected. Electron renderer never hits this path.
        cachedDefault = (await import('@flareapp/js')).flare;
    }
    return cachedDefault;
}
```

Note: report paths are already async (`reportSilently` returns a promise), so a
dynamic import on first use is acceptable. If a synchronous default is required
anywhere, fall back to a top-level static import in a SEPARATE entry that web
consumers use, keeping the electron-friendly entry import-free of the root. Decide
during implementation; the dynamic-import form is preferred.

## Electron-side ergonomics

- `@flareapp/electron/renderer` already exports the `flare` (RendererFlare)
  singleton. No new export needed for injection.
- Document clearly in the electron README: in the renderer, do NOT import
  `@flareapp/js` anywhere; get the instance from `@flareapp/electron/renderer`,
  let `renderer.ts` own `window.flare` + global catch, and inject that instance
  into the framework boundary.

## Report flow (React example, in renderer)

```
component throws
  → FlareErrorBoundary.componentDidCatch
  → injected RendererFlare.reportSilently(error, reactContextAttrs)
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

- Injected instance receives the report; the js root singleton does NOT (regression
  guard for the bypass).
- No injection → unchanged web behavior: singleton receives the report, SDK identity
  set as today.
- With injection, importing the framework package does NOT import `@flareapp/js`
  root (no `window.flare`, no `catchWindowErrors`, no `setSdkInfo` clobber). Assert
  via a spy on the side effects, mirroring `js/tests/browserExport.test.ts`.
- Injected instance gets `setFramework` but NOT `setSdkInfo`.

Cross-package (electron renderer + one framework, e.g. React):

- `reportSilently` on the injected `RendererFlare` forwards a STRING over the bridge
  and the react `context.custom` survives in the parsed payload on the main side.

## Out of scope

- A shared `FlareProvider`/context abstraction across all three frameworks (each
  uses its own idiom; React context optional, vue/svelte via options).
- Changing the existing web default behavior or call signatures beyond the additive
  `flare?` option.
- Electron Playwright e2e for the framework path (follow-up, same as electron 0.1.0).
