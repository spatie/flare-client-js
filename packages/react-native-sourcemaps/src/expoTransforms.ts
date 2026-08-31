import { relative, sep } from 'node:path';

export type FlarePluginProps = {
    apiKey?: string;
    apiEndpoint?: string;
};

export const FLARE_GRADLE_MARKER = '@flareapp/react-native-sourcemaps Expo config plugin';
// Must not live in $CONFIGURATION_BUILD_DIR: with Hermes, react-native-xcode.sh writes its intermediate
// map there, then removes it after composing the final map into SOURCEMAP_FILE — if SOURCEMAP_FILE also
// sits there, that cleanup deletes the map we need. $TARGET_TEMP_DIR is per-target and lives elsewhere, so
// the map survives.
export const SOURCEMAP_FILE_LINE = 'export SOURCEMAP_FILE="$TARGET_TEMP_DIR/main.jsbundle.map"';
export const GITIGNORE_ENTRY = 'flare.json';

// Absent props are omitted so the CLI applies its own defaults and its FLARE_API_KEY fallback. No
// `version` key: that flows only through FLARE_SOURCEMAP_VERSION.
export function flareJsonContents(props: FlarePluginProps): string {
    const config: Record<string, string> = {};
    if (props.apiKey) {
        config.apiKey = props.apiKey;
    }
    if (props.apiEndpoint) {
        config.apiEndpoint = props.apiEndpoint;
    }
    return `${JSON.stringify(config, null, 4)}\n`;
}

// Append `apply from: "<path>"` to android/app/build.gradle. Idempotent via a marker comment, so a
// re-prebuild without --clean doesn't duplicate it.
export function addFlareGradleApply(buildGradle: string, applyFromPath: string): string {
    if (buildGradle.includes(FLARE_GRADLE_MARKER)) {
        return buildGradle;
    }
    const base = buildGradle.endsWith('\n') ? buildGradle : `${buildGradle}\n`;
    return `${base}\n// ${FLARE_GRADLE_MARKER}\napply from: ${JSON.stringify(applyFromPath)}\n`;
}

// Exports SOURCEMAP_FILE so the stock bundle phase emits the composed map. Idempotent, and treats a
// missing file as valid input. The guard is line-based and ignores comments, so a commented-out
// `# SOURCEMAP_FILE=` doesn't suppress injection, while a real one is left untouched.
export function addSourcemapFileEnv(xcodeEnv: string): string {
    const alreadySet = xcodeEnv.split('\n').some((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('#') && /^(export\s+)?SOURCEMAP_FILE=/.test(trimmed);
    });
    if (alreadySet) {
        return xcodeEnv;
    }
    const base = xcodeEnv.length === 0 || xcodeEnv.endsWith('\n') ? xcodeEnv : `${xcodeEnv}\n`;
    return `${base}# Flare: emit the composed Hermes sourcemap so the upload phase can find it\n${SOURCEMAP_FILE_LINE}\n`;
}

// Append `flare.json` to .gitignore once (it is generated from app.json props).
export function ensureGitignored(gitignore: string, entry: string = GITIGNORE_ENTRY): string {
    const present = gitignore.split('\n').some((line) => line.trim() === entry);
    if (present) {
        return gitignore;
    }
    const base = gitignore.length === 0 || gitignore.endsWith('\n') ? gitignore : `${gitignore}\n`;
    return `${base}${entry}\n`;
}

// Sources RN's with-environment.sh first, so SOURCEMAP_FILE and FLARE_* are present.
export function flareXcodeShellScript(withEnvironmentPath: string, flareXcodePath: string): string {
    return [
        'set -e',
        `WITH_ENVIRONMENT="${withEnvironmentPath}"`,
        `FLARE_XCODE="${flareXcodePath}"`,
        // Invoke with-environment.sh with the Flare script as a single quoted argument, its documented
        // usage — not a `sh -c "$A $B"` string, which would word-split on any space in either path.
        '/bin/sh "$WITH_ENVIRONMENT" "$FLARE_XCODE"',
        '',
    ].join('\n');
}

// path.relative normalised to forward slashes (Gradle/Xcode paths are posix even on Windows).
export function toPosixRelative(fromDir: string, target: string): string {
    return relative(fromDir, target).split(sep).join('/');
}
