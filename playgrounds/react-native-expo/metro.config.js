const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// Managed Expo app inside the flare-client-js monorepo. The @flareapp/* packages are
// file: deps symlinked into this app's node_modules and point at ../../packages/*,
// so watch the monorepo root (Metro must be allowed to read those files) and pin
// react/react-native to the app's single copy (root has RN 0.79 vs this app's 0.85;
// without pinning the bundle carries two versions and crashes with
// "TurboModuleRegistry... 'DeviceInfo' could not be found").
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const forceAppCopy = ['react', 'react-native'];

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.unstable_enablePackageExports = true;
config.resolver.nodeModulesPaths = [path.join(projectRoot, 'node_modules'), path.join(monorepoRoot, 'node_modules')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (forceAppCopy.some((name) => moduleName === name || moduleName.startsWith(`${name}/`))) {
        return context.resolveRequest(
            { ...context, originModulePath: path.join(projectRoot, 'index.ts') },
            moduleName,
            platform,
        );
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
