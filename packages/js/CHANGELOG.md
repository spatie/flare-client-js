# @flareapp/js

## 1.2.0

This is the **final v1 release**. Subsequent work ships under v2.

### Added
- Reports are now mapped to the Flare v2 wire format on egress. The mapper sits at the `Api.report()` boundary; the public API and the `beforeSubmit` hook still see the v1 `Report` shape.

### Changed
- Default `reportingUrl` now points to the new ingestion endpoint: `https://ingress.flareapp.io/v1/errors`. Consumers with allowlist firewall rules on outbound HTTP must add this host to their allowlist. Consumers passing a custom `reportingUrl` to `flare.configure({...})` are unaffected.
- HTTP success status changed from `204` to `201`.
- Headers updated: `Accept: application/json` and `X-Flare-Client-Version: 2` added; `X-Requested-With` and `X-Report-Browser-Extension-Errors` removed.
- `Config.reportBrowserExtensionErrors` is now a no-op. The v2 ingestion endpoint does not consume the corresponding header. The field is preserved on `Config` for backward compatibility.
- Stack frames omit the `class` field when empty (previously emitted as `""`). The field is still emitted when populated.

### Fixed
- `cookie` context collector preserves `=` characters inside cookie values (previously truncated base64-padded values at the first `=`).
- Global error and unhandled-rejection handlers attach via `addEventListener`, so user code reassigning `window.onerror` no longer detaches Flare's handlers.
- Non-Error rejection reasons (strings, plain objects, Symbols) now produce reports instead of being silently dropped.
- `flatJsonStringify` decycles via a `WeakSet` of ancestor objects: real cycles become the literal `'[Circular]'`; non-cyclic shared sub-objects are preserved without recursion blowup.
- `createStackTrace` wraps `ErrorStackParser.parse` in `try/catch`. Parser failures resolve to a single fallback frame instead of dropping the report.

### Internal
- New `mapToV2Wire(report, config)` pure function in `src/api/mapToV2Wire.ts`.
- New `glowsToEvents(glows)` helper in `src/util/glowsToEvents.ts`.
- `Api.report()` signature changed from `(report, url, key, reportBrowserExtensionErrors)` to `(report, config)`. This is internal — it is not part of the package's public exports.

## 1.1.0

Prior history is in git.
