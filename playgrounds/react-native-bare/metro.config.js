const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// This bare app lives inside the flare-client-js monorepo and is NOT an npm
// workspace member. It consumes the workspace packages (@flareapp/react-native
// and its @flareapp/core / @flareapp/react deps) through the ROOT node_modules
// symlinks, which point OUTSIDE this project directory. Node and Babel resolve
// those already, but Metro only bundles files inside a watched folder and only
// searches the resolver paths it is given. So we watch the monorepo root and add
// the root node_modules to the resolver, otherwise Metro fails with
// "Unable to resolve module @flareapp/react-native".
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
