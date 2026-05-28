# @flareapp/core changelog

## 0.1.0 — 2026-05-28

Initial release. Extracted from `@flareapp/js`. Public API is unstable until `1.0.0`.

- `Flare` class accepts three constructor injection points: `ScopeProvider`,
  `ContextCollector`, `FileReader`.
- `Scope` class owns per-call mutable state: `glows`, `pendingAttributes`,
  `entryPoint`. In the browser, a single `GlobalScopeProvider` is used. In Node,
  `@flareapp/node` provides an `AsyncLocalStorageScopeProvider` for per-request
  isolation.
- `flare.flush(timeoutMs)` drains in-flight reports across the full pipeline
  (not just the final `api.report()` step).
- `redactUrlQuery` renamed from `redactFullPath`. The old name is re-exported
  as a `@deprecated` alias from `@flareapp/js`.
