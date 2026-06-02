# @flareapp/core

Environment-agnostic core for the Flare JavaScript SDK. Most users want
[`@flareapp/js`](../js) (browser) or [`@flareapp/node`](../node) (Node.js
servers). This package is the shared base that both consume.

Public and stable, versioned in lockstep with `@flareapp/js` (2.x). Intended
for third-party Flare integrators who need to build against the same primitives
the official SDKs use.

## Surface

- `Flare` — the core class. Takes three optional injection points: `ScopeProvider`,
  `ContextCollector`, `FileReader`.
- `Scope`, `GlobalScopeProvider`, `ScopeProvider` — per-call mutable state.
- `FileReader`, `NullFileReader` — source-snippet reading abstraction.
- `Api` — the HTTP client used to send reports.
- Types: `Config`, `Report`, `Attributes`, `Glow`, `StackFrame`, etc.
- Util: `redactUrlQuery`, `resolveDenylist`, `convertToError`, `DEFAULT_URL_DENYLIST`.

See `docs/superpowers/specs/2026-05-28-nodejs-sdk-design.md` in the monorepo
for the architectural contract.
