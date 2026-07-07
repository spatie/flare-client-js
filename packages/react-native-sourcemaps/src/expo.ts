import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import {
    type ConfigPlugin,
    createRunOncePlugin,
    withAppBuildGradle,
    withDangerousMod,
    withXcodeProject,
} from '@expo/config-plugins';

import {
    addFlareGradleApply,
    addSourcemapFileEnv,
    ensureGitignored,
    type FlarePluginProps,
    flareJsonContents,
    flareXcodeShellScript,
    toPosixRelative,
} from './expoTransforms';
import { addUploadBuildPhase } from './expoXcode';

// Resolve real install locations (correct under monorepo hoisting). Called during prebuild, never at
// import time.
function packageDir(): string {
    return dirname(require.resolve('@flareapp/react-native-sourcemaps/package.json'));
}
function flareGradlePath(): string {
    return join(packageDir(), 'flare.gradle');
}
function flareXcodeScriptPath(): string {
    return join(packageDir(), 'scripts', 'flare-xcode.sh');
}
function withEnvironmentScriptPath(): string {
    return join(dirname(require.resolve('react-native/package.json')), 'scripts', 'xcode', 'with-environment.sh');
}

async function writeFlareConfigFiles(projectRoot: string, props: FlarePluginProps): Promise<void> {
    await fs.writeFile(join(projectRoot, 'flare.json'), flareJsonContents(props), 'utf8');

    const gitignorePath = join(projectRoot, '.gitignore');
    let gitignore = '';
    try {
        gitignore = await fs.readFile(gitignorePath, 'utf8');
    } catch {
        gitignore = '';
    }
    await fs.writeFile(gitignorePath, ensureGitignored(gitignore), 'utf8');
}

// flare.json must exist whichever platform builds. EAS prebuilds one platform at a time, so register
// the write for both; it is idempotent (overwrites identical content).
const withFlareConfigFiles: ConfigPlugin<FlarePluginProps> = (config, props) => {
    for (const platform of ['ios', 'android'] as const) {
        config = withDangerousMod(config, [
            platform,
            async (cfg) => {
                await writeFlareConfigFiles(cfg.modRequest.projectRoot, props);
                return cfg;
            },
        ]);
    }
    return config;
};

const withFlareAndroidGradle: ConfigPlugin = (config) =>
    withAppBuildGradle(config, (cfg) => {
        const appDir = join(cfg.modRequest.platformProjectRoot, 'app');
        cfg.modResults.contents = addFlareGradleApply(
            cfg.modResults.contents,
            toPosixRelative(appDir, flareGradlePath()),
        );
        return cfg;
    });

const withFlareXcodeEnv: ConfigPlugin = (config) =>
    withDangerousMod(config, [
        'ios',
        async (cfg) => {
            const xcodeEnvPath = join(cfg.modRequest.platformProjectRoot, '.xcode.env');
            let contents = '';
            try {
                contents = await fs.readFile(xcodeEnvPath, 'utf8');
            } catch {
                contents = '';
            }
            await fs.writeFile(xcodeEnvPath, addSourcemapFileEnv(contents), 'utf8');
            return cfg;
        },
    ]);

const withFlareIosBuildPhase: ConfigPlugin = (config) =>
    withXcodeProject(config, (cfg) => {
        const iosRoot = cfg.modRequest.platformProjectRoot;
        const shellScript = flareXcodeShellScript(
            toPosixRelative(iosRoot, withEnvironmentScriptPath()),
            toPosixRelative(iosRoot, flareXcodeScriptPath()),
        );
        cfg.modResults = addUploadBuildPhase(cfg.modResults, shellScript);
        return cfg;
    });

const withFlareSourcemaps: ConfigPlugin<FlarePluginProps | undefined> = (config, props) => {
    const resolved = props ?? {};
    config = withFlareConfigFiles(config, resolved);
    config = withFlareAndroidGradle(config);
    config = withFlareXcodeEnv(config);
    config = withFlareIosBuildPhase(config);
    return config;
};

// createRunOncePlugin dedupes a transitively-doubled application. Read name/version from our own
// package.json; never throw at import if it is somehow unresolvable.
const pkg = ((): { name: string; version: string } => {
    try {
        return require('@flareapp/react-native-sourcemaps/package.json') as { name: string; version: string };
    } catch {
        return { name: '@flareapp/react-native-sourcemaps', version: '0.0.0' };
    }
})();

export default createRunOncePlugin(withFlareSourcemaps, pkg.name, pkg.version);
