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
   effects (see "Required changes to existing packages").
7. **Main base class:** `ElectronFlare extends CoreFlare` directly — NOT
   `NodeFlare`. NodeFlare's surface is web-server-shaped (`runWithContext`,
   header/body redaction, AsyncLocalStorage scope) and hardcodes `process.exit`,
   which is wrong for Electron (the fatal path should exit via `app.exit` after
   flushing; see Process handlers for why not `app.quit`).
   Electron implements its own thin process handling, disk file reader, and flush
   scheduler. Consequence: the package depends ONLY on `@flareapp/core` and
   `@flareapp/js` — NO `@flareapp/node` dependency. Tradeoff: a small amount of
   code is duplicated from node (process handlers, fs snippet reader, timer-based
   flush scheduler); these are modeled on node's implementations and kept minimal
   to limit divergence.

## Required changes to existing packages

v1 is not purely additive; it needs one small, contained change to `js`, called
out so the plan treats it as first-class work, not an incidental edit.

### `@flareapp/core` — no change

Because `ElectronFlare extends CoreFlare` directly (Decision 7) and passes its own
Electron context collector to `CoreFlare`'s constructor, no collector-composition
hook is needed. Core is untouched.

### `@flareapp/js` — side-effect-free browser assembly export

`@flareapp/js`'s package root (`src/index.ts`) instantiates the `flare` singleton,
assigns `window.flare`, and calls `catchWindowErrors()` at import time. The
renderer must NOT trigger any of that. Add a new subpath export (e.g.
`@flareapp/js/browser`) that re-exports the `Flare` class, `collectBrowser`,
`FetchFileReader`, `BrowserFlushScheduler`, and `catchWindowErrors` with NO
top-level instantiation or `window` mutation. The package root keeps its current
behavior for existing consumers. This is a `js` minor bump, and `@flareapp/js`
gains its first subpath export.

This requires real build + packaging work, not just a source file: `@flareapp/js`
currently builds ONLY `src/index.ts` (`tsdown src/index.ts ... --dts`) and
declares a single `"."` export. The new export needs (a) a second build entry
(e.g. `src/browser.ts` that re-exports the side-effect-free symbols) added to the
tsdown invocation, and (b) an `exports["./browser"]` map entry mirroring the dual
CJS+ESM+`.d.ts` shape of `"."`. The export/build verification below covers BOTH
`@flareapp/electron`'s subpaths AND this new `@flareapp/js/browser` subpath — a
source-level test would pass even if the published subpath were missing.

### `@flareapp/node` — no change

Decision 7 (extend `CoreFlare`, zero node dependency) means electron does NOT
import or depend on `@flareapp/node`. Electron reimplements the three small
node-flavored pieces it needs:

- **Disk file reader** — reads source snippets for main-process stack frames via
  `node:fs/promises`. Modeled on node's `DiskFileReader`.
- **Flush scheduler** — timer-based, modeled on node's `NodeFlushScheduler`.
- **Process handlers** — `uncaughtException` / `unhandledRejection` attach/detach
  with fatal modes, flushing then exiting via Electron's `app.exit(code)` (not
  `process.exit`, not `app.quit`; see the Main process section for the rationale).
  Modeled on node's `ProcessHandlerManager` + `buildFatalCallbacks` (whose `exit`
  parameter is already injectable).

Keep these minimal and reference node's versions as the source pattern to limit
divergence. If duplication becomes painful later, the shared primitives can be
extracted into `core` in a follow-up; out of scope for v1.

## Architecture

### Layering recap (existing)

`@flareapp/core` exposes a `Flare` base whose constructor takes the platform
seams: `(api, contextCollector, fileReader, scopeProvider, scheduler)`.
`@flareapp/js` subclasses it for the browser (window listeners, `FetchFileReader`,
`BrowserFlushScheduler`). `@flareapp/node` subclasses it for Node
(`AsyncLocalStorageScopeProvider`, `DiskFileReader`, `ProcessHandlerManager`,
`NodeFlushScheduler`). `@flareapp/electron` adds a third platform that spans two
runtimes. It subclasses `CoreFlare` directly (NOT `NodeFlare`) and supplies its
own Electron-flavored seams, so it does not inherit node's web-server surface.

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

Dependencies: `@flareapp/core` (hard-pinned), `@flareapp/js` (hard-pinned, used by
the renderer entry). NO `@flareapp/node` dependency (Decision 7). `electron` is a
**peer dependency AND a devDependency** — the repo does not currently have
`electron` installed, and the package needs Electron's bundled types for its own
typecheck and tests (matching how the framework peer packages keep their peer in
`devDependencies` too, e.g. `@flareapp/react`).

### Main process — `ElectronFlare extends CoreFlare`

Supplies its own Electron-flavored seams to `CoreFlare`'s constructor: an Electron
context collector, the reimplemented disk file reader, a `GlobalScopeProvider`
(Electron main has no per-request scoping), and the reimplemented flush scheduler.
Adds:

- **Process handlers.** Attach/detach `uncaughtException` / `unhandledRejection`
  with fatal modes (`report` / `report-and-exit` / `off`) and a shutdown timeout.
  In `report-and-exit` mode the handler reports, flushes in-flight reports
  itself (up to the shutdown timeout), THEN calls `app.exit(code)`. `app.exit()`
  is deliberate: it exits immediately and skips `before-quit` / `will-quit`,
  which is correct after an uncaught exception (the process is in an undefined
  state) and mirrors node's `process.exit` semantics. We do NOT use `app.quit()`
  for the fatal path: it is graceful but can be blocked or stalled by app
  `before-quit` handlers, which is wrong when crashing. The flush happens before
  the exit, so reports are not lost. `app.exit` is injectable for tests.
  Reimplemented in electron (see "Required changes"); not inherited from node.
- **SDK identity.** `ElectronFlare` calls `setSdkInfo({ name: '@flareapp/electron',
version })` in its constructor. `CoreFlare` otherwise defaults to `@flareapp/core`,
  which would misattribute reports. (The renderer does the same — see Renderer.)
- **User context.** `CoreFlare` has no user state (only `NodeScope` does).
  `ElectronFlare` owns a `setUser(user | null)` that stores the user and is
  projected to `enduser.id` / `enduser.email` / `enduser.username` (and
  `client.address` if present) by the Electron collector, mirroring node's
  projection. Per-app, not per-request (Electron main has no request scope).
- **Electron context collector.** The collector passed to `CoreFlare`. Adds: app
  name and version (`app.getName()`, `app.getVersion()`), Electron / Chrome / Node
  versions (`process.versions`), OS platform + arch, locale (`app.getLocale()`),
  `app.isPackaged`, `process.type` (`'browser'` for main), and the current user's
  `enduser.*` attributes when set.

    **Ready-safety (required).** `app.getLocale()` returns a reliable value only
    after the `ready` event, but the SDK is typically initialized before
    `app.whenReady()` and early main-process errors must still report. The collector
    guards locale (and any other ready-only field) with `app.isReady()` (or
    try/catch), omitting the field pre-ready rather than throwing. A unit test
    exercises the pre-ready path.

- **Renderer-crash listeners.** Attach `app.on('render-process-gone', ...)` and
  `app.on('child-process-gone', ...)`. `CoreFlare`'s report assembly (`buildReport`,
  base attributes, glows) is private and core is unchanged, so electron does NOT
  hand-build a `Report`. Instead each listener synthesizes an `Error`
  (e.g. `new Error('Renderer process gone: ' + details.reason)`) and calls the
  public `this.report(error, { ... })` with crash attributes (`reason`,
  `exitCode`, affected window/frame id, `process.type`). This routes through the
  normal pipeline so the report gets base attributes, glows, the Electron context
  collector, and `beforeSubmit` for free. The synthetic stack points at the
  listener (no real JS frame exists for a native crash); that is acceptable and
  noted. No Crashpad, no minidumps.
- **IPC receiver.** Registers `ipcMain.handle('flare:report', handler)`. The
  handler receives a serialized Report from a renderer, merges Electron/app
  metadata into it, runs main's `beforeSubmit`, and sends via the shared `Api`.
  This is the single egress point; the API key is configured only in main via
  `flare.light(key)`. The handler does NOT call the keyless renderer path; it
  injects the received report into main's send pipeline (which has the key).

    **Sender trust + payload validation (required, per Electron security guidance).**
    The handler must not blindly trust renderer input. It:
    - Validates the sender via a trust policy with a **working default** (so a
      copy-paste setup is not silently dropped). The default accepts EXACTLY two
      cases and nothing else: (1) `senderFrame` URL scheme is `file:` (packaged
      build), and (2) host is `localhost` or `127.0.0.1` over `http(s)` (vite/dev
      server). Everything else — including custom protocols and any remote origin
      — is rejected by default. Custom protocols are NOT auto-trusted: an app that
      serves its renderer over a custom protocol (e.g. `app://`) in production must
      opt in. Two override knobs on `configureElectron`: `trustedProtocols:
string[]` (add exact scheme names like `'app'`) and/or `trustSender: (frame)
=> boolean` (full predicate, replaces the default check). The README main
      setup documents both for production custom-protocol and remote-content apps.
    - Validates the payload shape: the deserialized object must match the `Report`
      contract (required fields present, correct types). Malformed payloads are
      dropped, optionally logged in debug.
    - Enforces a max payload size (configurable, sane default) to prevent a
      compromised/buggy renderer from sending oversized bodies.
      Reference: Electron "Validate the sender of all IPC messages".

    **Registration lifecycle + ownership (required).** `ipcMain.handle(channel, ...)`
    throws if a handler is already registered, and with multiple instances a naive
    `removeHandler`-before-`handle` lets an older instance's `dispose()` tear down
    a newer instance's handler. Guard with a module-level ownership token: a single
    `currentOwner` reference for the `flare:report` channel.
    - On register: if `currentOwner` is set and is not `this`, the new instance
      takes over (`removeHandler` then `handle`) and becomes `currentOwner`;
      re-register by the same instance is a no-op.
    - `dispose()` removes the handler ONLY if `currentOwner === this`, then clears
      `currentOwner` (in addition to detaching process handlers and crash
      listeners). An older instance's `dispose()` after a newer one took ownership
      does nothing to the live handler.
      The package's normal usage is the exported singleton, so multi-instance is
      mainly a test / hot-reload concern; the token makes those paths safe.

API surface: inherited from `CoreFlare` — `light`, `configure`, `glow`,
`addContext`, `report`, `flush`, etc. Electron-owned additions:
`setUser(user | null)` (projects `enduser.*`), `configureElectron(options)` (fatal
modes, shutdown timeout, toggling crash listeners, `trustSender` predicate, max IPC
payload size), and `dispose()`. It does NOT expose node's `runWithContext` /
`configureNode` / header-body redaction.

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

**SDK identity.** `RendererFlare` calls `setSdkInfo({ name: '@flareapp/electron',
version })` in its constructor, after `super()`. The js `Flare` base sets
`@flareapp/js`; without the override, renderer reports would be misattributed.

**Transport: override `sendReport`, not `Api`.** The core `sendReport()` short-
circuits when no API key is set (`assertKey`), so a keyless renderer with only a
swapped `Api` would never emit. `RendererFlare` instead overrides `sendReport(report)`
to: (1) run the renderer's own `beforeSubmit` (lets users scrub in the renderer),
(2) serialize the finished Report, (3) call `window.__flare.report(serialized)`.
It never checks for a key and never fetches Flare directly. No API key, no
`ingestUrl` in the renderer. If `window.__flare` is missing (preload not wired),
it logs a clear one-time warning rather than throwing.

**Global error-listener wiring (required).** `catchWindowErrors()` reports through
the `window.flare` global, not a passed-in instance — it reads `window.flare` and
calls `reportSilently` / `reportUnhandledRejection` on it. So `RendererFlare`'s
setup MUST assign `window.flare = <the RendererFlare instance>` before calling
`catchWindowErrors()`; otherwise global renderer errors are silently dropped.
`RendererFlare` exposes the `reportSilently` / `reportUnhandledRejection` surface
`catchWindowErrors` expects (inherited from the js `Flare`). A unit test asserts
that a `window` `error` event reaches the renderer transport.

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
  → ElectronFlare's own process handlers (uncaught / unhandledRejection)
  → Api.report() → Flare backend   (exit via app.exit in report-and-exit mode)

renderer / GPU crash
  → app 'render-process-gone' / 'child-process-gone' listener
  → ElectronFlare calls public report(syntheticError, {reason, exitCode, window id})
  → normal assembly + beforeSubmit → Api.report() → Flare backend
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
  mocked, INCLUDING the pre-ready path (`app.isReady()` false → locale omitted, no
  throw).
- **Process handlers** — `uncaughtException` / `unhandledRejection` report; in
  `report-and-exit` mode they flush THEN call the injected `app.exit(1)` (not
  `process.exit`, not `app.quit`); `report` / `off` modes do not exit. `app.exit`
  mocked.
- **SDK identity** — both `ElectronFlare` and `RendererFlare` report
  `sdkInfo.name === '@flareapp/electron'` (not core/js defaults).
- **setUser projection** — `setUser({...})` surfaces `enduser.*` on the next
  report; `setUser(null)` clears it.
- **Sender trust default** — default accepts `file:` and `localhost`/`127.0.0.1`
  only; rejects a custom protocol AND a remote `https` origin; adding the scheme
  via `trustedProtocols` accepts it; a custom `trustSender` predicate replaces the
  default check.
- **IPC receiver + ownership** — idempotent registration (re-register by the same
  instance is a no-op; a second instance takes over via `removeHandler`+`handle`);
  metadata merge; send via a `FakeApi`; an OLD instance's `dispose()` after a newer
  instance took ownership does NOT remove the live handler; the owning instance's
  `dispose()` does. `ipcMain` mocked.
- **Crash listeners** — `render-process-gone` / `child-process-gone` route through
  public `report(...)` and produce reports carrying `reason` / `exitCode` / window
  id and Electron context; `dispose()` detaches them.
- **Preload bridge** — `exposeFlare()` calls `contextBridge.exposeInMainWorld` with
  a `report` function that invokes the right channel; `contextBridge` /
  `ipcRenderer` mocked.
- **Renderer transport** — overridden `sendReport` runs renderer `beforeSubmit`,
  serializes, and forwards to `window.__flare.report`; keyless renderer still
  emits (regression guard for the `assertKey` short-circuit); missing-bridge path
  warns once instead of throwing; `window.__flare` mocked.
- **Renderer global wiring** — `RendererFlare` setup assigns `window.flare` so a
  dispatched `window` `error` event reaches the transport (regression guard for the
  `catchWindowErrors` global dependency).
- **IPC sender trust** — handler rejects unknown `senderFrame`, drops malformed
  payloads, and rejects oversized payloads; accepts a valid report and sends via
  `FakeApi`.
- **js browser export** (in `js`) — importing `@flareapp/js/browser` does NOT set
  `window.flare` or install window listeners (no import-time side effects), and
  exposes the expected symbols.

**Export/build verification.** Because subpath exports are new to the repo, add a
build-output check that runs after `npm run build` and covers BOTH new subpath
surfaces: `@flareapp/electron`'s `/main`, `/preload`, `/renderer` AND the new
`@flareapp/js/browser`. For each, assert the entry resolves in CJS and ESM, its
`.d.ts` exists, and a smoke import in both formats succeeds. This specifically
guards the `@flareapp/js` build-script change (it must emit the browser entry, not
just `src/index.ts`) and its `exports["./browser"]` map — a source-level test would
pass even if the published subpath were missing. (Mocks cannot catch a broken
`exports` map.) Use the repo's existing tooling; if a publish-linter like
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
- The two-stage `beforeSubmit` (renderer scrubs first, main is final gate).
- The sender-trust default (accepts `file:` and `localhost` only; rejects custom
  protocols and remote origins) and how to opt in via `trustedProtocols` /
  `trustSender` for production custom-protocol or remote-content apps.
- `setUser` usage for attaching the logged-in user.

## Out of scope (v1)

- Crashpad / native minidump upload.
- Electron Playwright e2e playground (follow-up).
- Per-renderer request-style scoping beyond what the forwarded Report already
  carries.
- A flareapp.io/docs page (README stands in for now).
