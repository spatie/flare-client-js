## next-version — 2026-05-28

- Internal refactor: most env-agnostic logic moved to the new `@flareapp/core`
  package. Public API is unchanged: `import { flare, Flare, ... } from '@flareapp/js'`
  continues to work.
- `redactFullPath` is now a deprecated alias for `redactUrlQuery` (re-exported
  from `@flareapp/core`). Replace call sites at your convenience; both keep
  working.
- Per-call mutable state (glows, context attributes, entry point) now lives on
  a `Scope` object internally. Behavior is identical in the browser. The change
  enables `@flareapp/node` to isolate per-request state via AsyncLocalStorage.

## 2.0.0

### Breaking changes

- **Endpoint changed.** SDK now POSTs to `https://ingress.flareapp.io/v1/errors`. Success response is `201 Created`. Auth header is `x-api-token`.
- **Wire format reshaped to match the server's canonical schema.**
    - `Report` uses camelCase top-level fields (`exceptionClass`, `seenAtUnixNano`, `sourcemapVersionId`, `isLog`, `level`, `attributes`, `events`).
    - `StackFrame` uses camelCase (`lineNumber`, `columnNumber`, `codeSnippet`, `isApplicationFrame`).
    - `Context` is gone. User context is set via `addContext(name, value)` and `addContextGroup(group, value)`; both write into the flat `attributes` map under `context.custom` and `context.<group>`.
    - Glows ride along as `php_glow`-typed entries in `events[]`.
- **`report()` second argument** is now an `Attributes` map (was a freeform context object). The third argument (solution provider parameters) is removed.
- **Config keys renamed:** `reportingUrl` → `ingestUrl`, `sourcemapVersion` → `sourcemapVersionId`.
- **Deprecated trailing setters removed:** `flare.beforeEvaluate = …`, `flare.beforeSubmit = …`, `flare.stage = …`. Use `flare.configure({ … })`.
- **`reportMessage` signature changed:** `reportMessage(message, level?, attributes?)`. The old `'Log INFO'` regex is gone, pass `level` directly.
- **Solutions API removed:** `registerSolutionProvider`, `Solution`, `SolutionProvider`, `SolutionProviderExtraParameters` are all deleted.
- **`flare.config` is now `Readonly<Config>`** and `flare.glows` is `readonly Glow[]`. Direct property mutation no longer works; use `configure()`.

### New

- **URL redaction.** Sensitive query-string parameters (`password`, `token`, `secret`, `authorization`, etc.) are automatically replaced with `[redacted]` in `url.full`, `url.query`, and `flare.entry_point.value` attributes. Configurable via `urlDenylist` (custom regex) and `replaceDefaultUrlDenylist` (boolean) config options.
- `DEFAULT_URL_DENYLIST`, `redactFullPath`, and `resolveDenylist` are exported for direct use by framework adapters.
- `setEntryPoint({ identifier?, name?, type? })` — mutable global setter for the entry-point handler. SPA framework adapters call this on every navigation.
- `setSdkInfo({ name, version })` — overridable SDK identity (default `@flareapp/js` + client version). Integrations override it.
- `setFramework({ name, version? })` — host framework attribution (e.g. React, Vue).
- `code` field auto-populated from `error.code` when present (string, ≤64 chars).
- Non-`Error` values passed to `report()` are coerced to `Error` instead of silently failing.
- Browser context attributes (`url.full`, `url.query`, `browser.user_agent`, `browser.viewport.*`, cookies, request data) are auto-collected on each report.
- New exported types: `SpanEvent`, `EntryPointHandler`, `Framework`, `SdkInfo`, `OverriddenGrouping`, `Attributes`, `AttributeValue`.
- **`sampleRate` config option.** Number between `0` and `1` (default `1`). Controls what fraction of errors are reported. Applies to `report()`, `reportMessage()`, and `reportUnhandledRejection()`.

### Notes

- `seenAtUnixNano` is now real nanoseconds (`Date.now() * 1_000_000`).
