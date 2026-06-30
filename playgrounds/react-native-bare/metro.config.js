const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// This bare app lives inside the flare-client-js monorepo and is NOT an npm
// workspace member. The @flareapp SDK packages (@flareapp/react-native and its
// @flareapp/core / @flareapp/react deps) are injected as TARBALLS into this app's
// OWN node_modules by scripts/rn-relink.mjs, so the smoke test validates the real
// published artifact rather than source. @flareapp/react-native-sourcemaps is a
// file: dep resolved from packages/. We still watch the monorepo root and add its
// node_modules to the resolver so Metro can read those file: deps and the shared
// toolchain, otherwise it fails with "Unable to resolve module ...".
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const appNodeModules = path.resolve(projectRoot, 'node_modules');

// The monorepo root has its OWN react-native (0.79, a dev/peer dep of
// packages/react-native) and react. Without pinning, Metro resolves the
// react-native/react imports INSIDE the symlinked @flareapp/* packages to those
// root copies, so the bundle ends up with two react-native versions and the
// native binary crashes with "TurboModuleRegistry... 'DeviceInfo' could not be
// found". Force these singleton, native-coupled packages to the app's one copy.
const forceAppCopy = ['react', 'react-native'];

const config = {
    watchFolders: [monorepoRoot],
    resolver: {
        // Required: @flareapp/react-native imports @flareapp/react/inject, a
        // subpath that resolves ONLY through @flareapp/react's exports map, and the
        // package itself resolves via a "react-native" export condition. The bare RN
        // template defaults this off, so without it Metro cannot resolve the subpath.
        // Expo enables it by default; this is the bare-only opt-in.
        unstable_enablePackageExports: true,
        nodeModulesPaths: [appNodeModules, path.resolve(monorepoRoot, 'node_modules')],
        resolveRequest: (context, moduleName, platform) => {
            const pinned = forceAppCopy.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
            if (pinned) {
                // Re-root resolution at the app so node_modules walking finds the
                // app's single copy, regardless of which package did the import.
                return context.resolveRequest(
                    { ...context, originModulePath: path.join(projectRoot, 'index.js') },
                    moduleName,
                    platform,
                );
            }
            return context.resolveRequest(context, moduleName, platform);
        },
    },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
