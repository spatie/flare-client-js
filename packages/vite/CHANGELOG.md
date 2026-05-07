## 2.0.0

### Breaking changes

- Renamed plugin function: `flareSourcemapUploader` -> `flareSourcemaps` (default export unchanged).
- Renamed option: `key` -> `apiKey`.
- Renamed type: `PluginConfig` -> `FlareVitePluginOptions`.
- Renamed `Sourcemap` fields: `original_file` -> `originalFile`, `sourcemap_url` -> `sourcemapPath`.
- Removed `fast-glob` dependency. Sourcemap discovery now uses Rollup's `bundle` parameter.
- Replaced hand-rolled UUID with `crypto.randomUUID()`. Requires Node >= 18.
- HTTP 429/5xx responses are now retried with exponential backoff. Non-retriable HTTP errors (4xx) throw immediately.
- Failed uploads no longer abort remaining uploads (`Promise.allSettled` replaces `Promise.all`).
- Sourcemaps are only deleted when `removeSourcemaps` is true AND the upload succeeded.

### New

- `enforce: 'post'` ensures the plugin runs after all other plugins.
- Uses Vite's logger instead of bare `console.log`/`console.error`.
- `define` values use `JSON.stringify` (fixes injection vulnerability with special characters in keys/versions).
- Upload enable/disable now uses Vite's `mode` parameter instead of `process.env.NODE_ENV`.
- `SKIP_SOURCEMAPS=true` env var disables uploads (useful for CI matrix jobs).
- Added `engines: { node: ">=18" }` to package.json.
