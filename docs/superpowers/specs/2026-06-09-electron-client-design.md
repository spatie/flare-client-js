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
6. **Renderer reuse:** `RendererFlare` reuses `@flareapp/js`'s browser assembly
   (the `Flare` class + browser collectors + `FetchFileReader` + window
   listeners) via a NEW side-effect-free subpath export on `@flareapp/js`. It
   does NOT import `@flareapp/js`'s package root, which has import-time side
   effects (see "Required changes to existing packages"). The electron package
   depends on both `@flareapp/core` and `@flareapp/js`.

## Required changes to existing packages

These three findings from spec review mean v1 is not purely additive; it needs
small, contained changes to `core` and `js`. Each is called out so the
implementation plan treats them as first-class work, not incidental edits.

### `@flareapp/core` — composable context collector

`CoreFlare` stores a single `contextCollector` privately and offers no way to
extend it. `NodeFlare` hardcodes its collector in its constructor, so a subclass
(`ElectronFlare`) cannot layer Electron metadata onto inherited main-process
reports. Add a `protected appendContextCollector(collector: ContextCollector)`
to `CoreFlare` that composes additional collectors (their attributes merge on top
of the base collector's, last-write-wins). `ElectronFlare` calls it in its
constructor after `super()`. Covered by a core unit test (two collectors compose;
later keys win). This is a `core` minor bump.

### `@flareapp/js` — side-effect-free browser assembly export

`@flareapp/js`'s package root (`src/index.ts`) instantiates the `flare` singleton,
assigns `window.flare`, and calls `catchWindowErrors()` at import time. The
renderer must NOT trigger any of that. Add a new subpath export (e.g.
`@flareapp/js/browser`) that re-exports the `Flare` class, `collectBrowser`,
`FetchFileReader`, `BrowserFlushScheduler`, and `catchWindowErrors` with NO
top-level instantiation or `window` mutation. The package root keeps its current
behavior for existing consumers. This is a `js` minor bump, and `@flareapp/js`
gains its first subpath export.

### `@flareapp/node` — re-export internals the main process reuses

`ElectronFlare extends NodeFlare`, but the main process also needs node internals
that the node package does not currently export (`DiskFileReader`,
`ProcessHandlerManager`, `NodeFlushScheduler`) if any are referenced directly.
Where reuse is via inheritance alone, no export is needed; where electron
references a node internal directly, add it to `@flareapp/node`'s public exports.
Audit during planning; only export what electron actually imports. Possible `node`
patch/minor bump.

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

- **Electron context collector.** Layered on top of node's collector via the new
  `appendContextCollector` core hook (see "Required changes"). Without that hook
  inherited main-process reports would carry node metadata only. Adds: app name
  and version (`app.getName()`, `app.getVersion()`), Electron / Chrome / Node
  versions (`process.versions`), OS platform + arch, locale (`app.getLocale()`),
  `app.isPackaged`, and `process.type` (`'browser'` for main). Merged on top of
  the node context.
- **Renderer-crash listeners.** Attach `app.on('render-process-gone', ...)` and
  `app.on('child-process-gone', ...)`. Each turns into a synthetic structured
  Report carrying `reason`, `exitCode`, and an identifier for the affected window
  / child. No Crashpad, no minidumps.
- **IPC receiver.** Registers `ipcMain.handle('flare:report', handler)`. The
  handler receives a serialized Report from a renderer, merges Electron/app
  metadata into it, runs main's `beforeSubmit`, and sends via the shared `Api`.
  This is the single egress point; the API key is configured only in main via
  `flare.light(key)`. The handler does NOT call the keyless renderer path; it
  injects the received report into main's send pipeline (which has the key).

    **Sender trust + payload validation (required, per Electron security guidance).**
    The handler must not blindly trust renderer input. It:
    - Validates the sender: rejects messages whose `event.senderFrame` is not a
      frame this app owns (origin check against the app's own URLs; reject
      `file://` vs remote mismatch as configured). Default-deny on unknown senders.
    - Validates the payload shape: the deserialized object must match the `Report`
      contract (required fields present, correct types). Malformed payloads are
      dropped, optionally logged in debug.
    - Enforces a max payload size (configurable, sane default) to prevent a
      compromised/buggy renderer from sending oversized bodies.
      Reference: Electron "Validate the sender of all IPC messages".

API surface inherits everything from `NodeFlare` (`light`, `configureNode`,
`runWithContext`, `setUser`, `glow`, `addContext`, etc.) plus an
electron-specific options object (toggling crash listeners, sender-trust policy,
max IPC payload size).

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

### Renderer — `RendererFlare extends Flare` (from `@flareapp/js/browser`)

A real Flare instance so stack parsing and source-snippet reading run in the
renderer's own context, where the bundle files are actually reachable (over
`file://` or the dev server). It reuses js's browser collectors, `FetchFileReader`,
and `window.onerror` / `window.onunhandledrejection` listeners — imported from the
new side-effect-free `@flareapp/js/browser` export, NOT the package root (which
would install a second, fetch-based reporter on import).

**Transport: override `sendReport`, not `Api`.** The core `sendReport()` short-
circuits when no API key is set (`assertKey`), so a keyless renderer with only a
swapped `Api` would never emit. `RendererFlare` instead overrides `sendReport(report)`
to: (1) run the renderer's own `beforeSubmit` (lets users scrub in the renderer),
(2) serialize the finished Report, (3) call `window.__flare.report(serialized)`.
It never checks for a key and never fetches Flare directly. No API key, no
`ingestUrl` in the renderer. If `window.__flare` is missing (preload not wired),
it logs a clear one-time warning rather than throwing.

**`beforeSubmit` semantics (resolved).** Both hooks apply, in order: the renderer's
`beforeSubmit` runs in the renderer before forwarding (scrub close to the source);
main's `beforeSubmit` runs in main before `api.report` (final egress gate).
Returning `null` from either drops the report. This is documented in the README so
the two-stage behavior is not surprising.

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
- **Renderer transport** — overridden `sendReport` runs renderer `beforeSubmit`,
  serializes, and forwards to `window.__flare.report`; keyless renderer still
  emits (regression guard for the `assertKey` short-circuit); missing-bridge path
  warns once instead of throwing; `window.__flare` mocked.
- **IPC sender trust** — handler rejects unknown `senderFrame`, drops malformed
  payloads, and rejects oversized payloads; accepts a valid report and sends via
  `FakeApi`.
- **Core collector composition** (in `core`) — `appendContextCollector` merges
  attributes over the base collector, later keys win.
- **js browser export** (in `js`) — importing `@flareapp/js/browser` does NOT set
  `window.flare` or install window listeners (no import-time side effects), and
  exposes the expected symbols.

**Export/build verification.** Because this is the repo's first subpath-export
package, add a build-output check that runs after `npm run build`: assert each
subpath (`/main`, `/preload`, `/renderer`) resolves in CJS and ESM and its `.d.ts`
exists, and a smoke import of each entry in both formats. (Mocks alone cannot catch
a broken `exports` map.) Use the repo's existing tooling; if a publish-linter like
`publint`/`arethetypeswrong` is not already present, a small script that imports
each built entry is sufficient for v1.

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
