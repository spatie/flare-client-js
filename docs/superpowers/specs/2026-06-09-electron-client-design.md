# `@flareapp/electron` — design

Date: 2026-06-09
Status: approved for planning
Initial release: `0.1.0` (experimental)

## Goal

An Electron SDK for Flare error tracking, built in the same layered style as the
existing `@flareapp/node` client. It captures JavaScript errors in BOTH Electron
runtimes — the main process (Node) and renderer processes (Chromium) — and routes
every report through a single place so the API key lives in exactly one process.

This is an experimental first release. It ships as `0.1.0` and the README carries
an explicit experimental notice. Because there is no flareapp.io/docs page for it
yet, the README is intentionally long and instructive (full setup walkthrough for
main, preload, and renderer).

## Decisions (locked during brainstorming)

1. **Coverage:** Both processes, unified report flow. Renderer errors forward to
   main over IPC; main owns all sends.
2. **Native crashes:** Skip Crashpad/minidumps. DO capture `render-process-gone`
   and `child-process-gone` as structured JS reports.
3. **Renderer IPC:** Preload helper (`contextBridge`) + a renderer SDK. Respects
   `contextIsolation`; never requires `nodeIntegration`.
4. **Report build location:** The renderer builds the full Report (stack parse +
   source snippets + browser context) in its own context, then forwards the
   serialized Report. Main only enriches with Electron metadata and sends.
5. **E2E:** Defer the Electron Playwright playground to a follow-up. v1 ships on
   vitest unit coverage only.
6. **Renderer reuse:** `RendererFlare` subclasses `@flareapp/js`'s `Flare`. The
   electron package depends on both `@flareapp/core` and `@flareapp/js`.

## Architecture

### Layering recap (existing)

`@flareapp/core` exposes a `Flare` base whose constructor takes the platform
seams: `(api, contextCollector, fileReader, scopeProvider, scheduler)`.
`@flareapp/js` subclasses it for the browser (window listeners, `FetchFileReader`,
`BrowserFlushScheduler`). `@flareapp/node` subclasses it for Node
(`AsyncLocalStorageScopeProvider`, `DiskFileReader`, `ProcessHandlerManager`,
`NodeFlushScheduler`). `@flareapp/electron` adds a third platform that spans two
runtimes.

### Package shape

One published package, `@flareapp/electron`, with three subpath exports — one per
Electron context. (No package in the repo uses subpath exports today; this is the
first. The `exports` map mirrors the existing CJS+ESM+.d.ts dual-format pattern,
one entry per subpath.)

| Export                        | Runs in     | Surface                                                         |
| ----------------------------- | ----------- | --------------------------------------------------------------- |
| `@flareapp/electron/main`     | main (Node) | `ElectronFlare` singleton + `flare` instance; owns the API key  |
| `@flareapp/electron/preload`  | preload     | `exposeFlare()` — sets up the `contextBridge` bridge            |
| `@flareapp/electron/renderer` | renderer    | `RendererFlare` + `flare` instance; catches and forwards errors |

Dependencies: `@flareapp/core` (hard-pinned, same as node/js), `@flareapp/js`
(hard-pinned, used by the renderer entry). `electron` is a peer dependency.

### Main process — `ElectronFlare extends NodeFlare`

Reuses node's fatal-handler machinery unchanged: `uncaughtException` /
`unhandledRejection` capture, fatal modes (`report` / `report-and-exit` / `off`),
shutdown timeout, `DiskFileReader` for main-process stack snippets. On top of
that:

- **Electron context collector.** Layered on top of node's collector. Adds:
  app name and version (`app.getName()`, `app.getVersion()`), Electron / Chrome /
  Node versions (`process.versions`), OS platform + arch, locale
  (`app.getLocale()`), `app.isPackaged`, and `process.type` (`'browser'` for
  main). Projected to attributes alongside the node context.
- **Renderer-crash listeners.** Attach `app.on('render-process-gone', ...)` and
  `app.on('child-process-gone', ...)`. Each turns into a synthetic structured
  Report carrying `reason`, `exitCode`, and an identifier for the affected window
  / child. No Crashpad, no minidumps.
- **IPC receiver.** Registers `ipcMain.handle('flare:report', handler)`. The
  handler receives a serialized Report from a renderer, merges Electron/app
  metadata into it, and sends via the shared `Api`. This is the single egress
  point; the API key is configured only in main via `flare.light(key)`.

API surface inherits everything from `NodeFlare` (`light`, `configureNode`,
`runWithContext`, `setUser`, `glow`, `addContext`, etc.) plus an
electron-specific options object if needed (e.g. toggling the crash listeners).

### Preload — `exposeFlare()`

A single function the user calls once in their preload script:

```ts
import { exposeFlare } from '@flareapp/electron/preload';
exposeFlare();
```

Internally:
`contextBridge.exposeInMainWorld('__flare', { report: (r) => ipcRenderer.invoke('flare:report', r) })`.
That is the entire preload surface. It respects `contextIsolation` and never needs
`nodeIntegration`. The bridge channel name (`flare:report`) and the global key
(`__flare`) are shared constants between the preload and renderer entries so they
cannot drift.

### Renderer — `RendererFlare extends Flare` (from `@flareapp/js`)

A real Flare instance so stack parsing and source-snippet reading run in the
renderer's own context, where the bundle files are actually reachable (over
`file://` or the dev server). It reuses js's browser collectors, `FetchFileReader`,
and `window.onerror` / `window.onunhandledrejection` listeners.

The only thing swapped is transport. Instead of `Api.report()` POSTing to the
Flare backend, the renderer's transport serializes the finished Report and calls
`window.__flare.report(serializedReport)`. No API key, no `ingestUrl`, no fetch to
Flare in the renderer. If `window.__flare` is missing (preload not wired), the
renderer logs a clear warning rather than throwing.

### Report flow

```
renderer error
  → RendererFlare builds Report (stack + snippets + browser context)
  → window.__flare.report(report)        [contextBridge]
  → ipcRenderer.invoke('flare:report')   [IPC]
  → ipcMain handler in ElectronFlare
  → merge Electron / app metadata
  → Api.report() → Flare backend

main-process error
  → ElectronFlare (inherited node fatal handlers)
  → Api.report() → Flare backend

renderer / GPU crash
  → app 'render-process-gone' / 'child-process-gone' listener
  → ElectronFlare builds synthetic Report (reason, exitCode, window id)
  → Api.report() → Flare backend
```

## Packaging

Follows the repo convention exactly: `"files": ["dist"]` in `package.json`, no
`.npmignore` (every existing package does this). Build with tsdown to CJS + ESM +
`.d.ts`, one build per subpath entry (`main`, `preload`, `renderer`). Version
starts at `0.1.0`. `publishConfig.access: "public"`, scoped name. `@flareapp/core`
and `@flareapp/js` are hard-pinned (exact versions) like the other packages pin
core.

## Testing

Vitest, per-package, following the repo pattern (tests next to the code, package
has its own `vitest.config.ts`). Coverage:

- **Main collector** — Electron context projection, with `app` / `process.versions`
  mocked.
- **IPC receiver** — `ipcMain.handle` registration, metadata merge, send via a
  `FakeApi`, with `ipcMain` mocked.
- **Crash listeners** — `render-process-gone` / `child-process-gone` produce the
  expected synthetic Reports.
- **Preload bridge** — `exposeFlare()` calls `contextBridge.exposeInMainWorld` with
  a `report` function that invokes the right channel; `contextBridge` /
  `ipcRenderer` mocked.
- **Renderer transport** — finished Report is forwarded to `window.__flare.report`;
  missing-bridge path warns instead of throwing; `window.__flare` mocked.

The Electron Playwright playground (a 5th e2e project: minimal main + preload +
renderer broken page driven by Playwright's Electron support) is explicitly
deferred to a follow-up. v1 ships on the unit coverage above.

## README

Long and instructive because there is no docs page yet. Must include:

- An experimental notice at the top (matching the `0.1.0` version).
- Install instructions and the `electron` peer-dep note.
- Three setup sections — main, preload, renderer — each with a copy-paste example.
- The contextIsolation / preload requirement called out explicitly (why the
  preload step is not optional).
- What is and is not captured (JS errors in both processes + renderer/child
  process-gone; NOT native minidumps).
- A short report-flow diagram so users understand why the API key lives only in
  main.

## Out of scope (v1)

- Crashpad / native minidump upload.
- Electron Playwright e2e playground (follow-up).
- Per-renderer request-style scoping beyond what the forwarded Report already
  carries.
- A flareapp.io/docs page (README stands in for now).
