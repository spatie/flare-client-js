# @flareapp/node changelog

## 0.1.0 — 2026-05-28

Initial release. Standalone Node.js SDK.

- `flare.runWithContext({ method, path, url, headers, body }, fn)` opens an
  AsyncLocalStorage-backed scope for a single request. Glows, custom context,
  user identity, and entry point are all isolated.
- `flare.setUser({ id, email, username, ipAddress })` attaches identity to the
  active scope. Mirrors Sentry's split between user identity and request context.
- Process listeners attached on `flare.light(key)` based on
  `uncaughtExceptionMode` and `unhandledRejectionMode` (each `off`, `report`,
  or `report-and-exit`; default `report-and-exit`). Listener state reconciles
  dynamically when `configureNode(...)` is called later.
- Default header denylist redacts `authorization`, `cookie`, `set-cookie`,
  `x-api-key`, CSRF tokens, and forwarding headers. Custom allowlist and
  denylist available via `configureNode`.
- Request body capture is off by default; opt in via
  `configureNode({ captureRequestBody: true })`. JSON and form-urlencoded
  content types accepted; 16 KB cap; circular references and PII keys redacted.
- Requires Node >=22.
