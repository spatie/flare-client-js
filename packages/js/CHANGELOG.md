## 2.0.0

### Breaking changes

- **Endpoint changed.** SDK now POSTs to `https://ingress.flareapp.io/v1/errors`. Success response is `201 Created`. Auth header is `x-api-token`.
- **Wire format reshaped to match the server's canonical schema** (no more `MapOldReportFormatAction` round-trip).
  - `Report` uses camelCase top-level fields (`exceptionClass`, `seenAtUnixNano`, `sourcemapVersionId`, `isLog`, `level`, `attributes`, `events`).
  - `StackFrame` uses camelCase (`lineNumber`, `columnNumber`, `codeSnippet`, `isApplicationFrame`).
  - `Context` is gone. User context is set via `addContext(name, value)` and `addContextGroup(group, value)`; both write into the flat `attributes` map under `context.custom` and `context.<group>`.
  - Glows ride along as `php_glow`-typed entries in `events[]`.
- **Config keys renamed:** `reportingUrl` → `ingestUrl`, `sourcemapVersion` → `sourcemapVersionId`. No aliases.
- **Deprecated trailing setters removed:** `flare.beforeEvaluate = …`, `flare.beforeSubmit = …`, `flare.stage = …`. Use `flare.configure({ … })`.
- **`reportMessage` signature changed:** `reportMessage(message, level?, attributes?)`. The old `'Log INFO'` regex is gone — pass `level` directly.
- **Solutions API removed:** `registerSolutionProvider`, `Solution`, `SolutionProvider`, `SolutionProviderExtraParameters`, and the third arg to `report()` are all deleted. The server has been silently dropping `solutions` from payloads; the client now matches.

### New

- `setEntryPoint({ identifier?, name?, type? })` — mutable global setter for the entry-point handler. SPA framework adapters call this on every navigation.
- `setSdkInfo({ name, version })` — overridable SDK identity (default `@flareapp/js` + client version). Integrations override it.
- `setFramework({ name, version? })` — host framework attribution (e.g. React, Vue).
- `code` field auto-populated from `error.code` when present (string, ≤64 chars).

### Notes

- `seenAtUnixNano` is now real nanoseconds (`Date.now() * 1_000_000`).
