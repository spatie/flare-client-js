/**
 * The build-time sourcemap version, for `flare.configure({ sourcemapVersionId })`.
 *
 * `@flareapp/react-native-sourcemaps/babel` replaces every reference to this
 * binding with the resolved version string literal at bundle time, then drops the
 * import. Without that Babel plugin it stays an empty string (meaning "no version"),
 * which is harmless because sourcemaps are only uploaded for release builds.
 *
 * This module is runtime-safe: it has no Node imports, so it is safe to import into
 * app code that Metro bundles (unlike the package root, which pulls in the uploader).
 */
export const flareSourcemapVersion: string = '';
