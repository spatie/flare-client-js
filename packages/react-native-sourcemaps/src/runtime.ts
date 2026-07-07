/**
 * Build-time sourcemap version, for `flare.configure({ sourcemapVersionId })`.
 *
 * The `.../babel` plugin replaces every reference to this binding with the resolved version literal at
 * bundle time, then drops the import. Without that plugin it stays an empty string ("no version"),
 * which is harmless since sourcemaps are only uploaded for release builds.
 *
 * Runtime-safe: no Node imports, so safe to import into Metro-bundled app code (unlike the package
 * root, which pulls in the uploader).
 */
export const flareSourcemapVersion: string = '';
