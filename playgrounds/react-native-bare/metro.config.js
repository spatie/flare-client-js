const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
    resolver: {
        // Required: @flareapp/react-native imports @flareapp/react/inject, a
        // subpath that resolves ONLY through @flareapp/react's exports map. The
        // bare RN template defaults this off, so without it Metro cannot resolve
        // the subpath. Expo enables it by default; this is the bare-only opt-in.
        unstable_enablePackageExports: true,
    },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
