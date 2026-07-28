/**
 * Build-time sourcemap version, for `flare.configure({ sourcemapVersionId })`.
 *
 * The `.../babel` plugin replaces every reference to this binding with the resolved version literal, then
 * drops the import. Without that plugin it stays an empty string, which is harmless because sourcemaps
 * are only uploaded for release builds.
 *
 * No Node imports, unlike the package root, so this is safe to pull into Metro-bundled app code.
 */
export const flareSourcemapVersion: string = '';
