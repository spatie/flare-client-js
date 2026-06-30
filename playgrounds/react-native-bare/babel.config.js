module.exports = {
    presets: ['module:@react-native/babel-preset'],
    // Inlines `process.env.FLARE_SOURCEMAP_VERSION` at bundle time so the running
    // app reports a `sourcemapVersionId` that matches the uploaded sourcemap's
    // version. The version comes from the FLARE_SOURCEMAP_VERSION env var set on
    // the build (falls back to package.json version with a warning).
    plugins: ['@flareapp/react-native-sourcemaps/babel'],
};
