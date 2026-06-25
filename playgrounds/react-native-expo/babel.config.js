module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        // Inlines `flareSourcemapVersion` (imported from
        // @flareapp/react-native-sourcemaps/runtime) at bundle time so production
        // reports carry a sourcemapVersionId matching the uploaded sourcemap.
        plugins: ['@flareapp/react-native-sourcemaps/babel'],
    };
};
