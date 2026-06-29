import { relative, sep } from 'node:path';

export type FlarePluginProps = {
    apiKey?: string;
    apiEndpoint?: string;
};

export const FLARE_GRADLE_MARKER = '@flareapp/react-native-sourcemaps Expo config plugin';
// Must NOT live in $CONFIGURATION_BUILD_DIR. With Hermes, react-native-xcode.sh writes
// its intermediate "packager" sourcemap to `$CONFIGURATION_BUILD_DIR/<basename of
// SOURCEMAP_FILE>`, composes the final map into SOURCEMAP_FILE, then `rm`s that
// intermediate — so if SOURCEMAP_FILE is `$CONFIGURATION_BUILD_DIR/main.jsbundle.map`
// the cleanup deletes the composed map we need. $TARGET_TEMP_DIR is per-target (shared
// by the bundle phase and the upload phase) and lives elsewhere, so the map survives.
export const SOURCEMAP_FILE_LINE = 'export SOURCEMAP_FILE="$TARGET_TEMP_DIR/main.jsbundle.map"';
export const GITIGNORE_ENTRY = 'flare.json';

/** Serialise the plugin props into the flare.json the native hooks read. Absent
 * props are omitted so the CLI applies its own defaults (endpoint) and env fallback
 * (FLARE_API_KEY). No `version` key — version flows only through FLARE_SOURCEMAP_VERSION. */
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

/** Append `apply from: "<path>"` to android/app/build.gradle. Idempotent via a marker
 * comment, so a re-prebuild without --clean does not duplicate it. */
export function addFlareGradleApply(buildGradle: string, applyFromPath: string): string {
    if (buildGradle.includes(FLARE_GRADLE_MARKER)) {
        return buildGradle;
    }
    const base = buildGradle.endsWith('\n') ? buildGradle : `${buildGradle}\n`;
    return `${base}\n// ${FLARE_GRADLE_MARKER}\napply from: ${JSON.stringify(applyFromPath)}\n`;
}

/** Ensure ios/.xcode.env exports SOURCEMAP_FILE so the stock bundle phase emits the
 * composed map. Idempotent, and treats a missing file (empty string) as valid input.
 * The guard is line-based and ignores comments, so a commented-out `# SOURCEMAP_FILE=`
 * does not suppress injection while a real `export SOURCEMAP_FILE=`/`SOURCEMAP_FILE=`
 * (a user's custom map path) is left untouched. */
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

/** Append `flare.json` to .gitignore once (the file is generated from app.json props). */
export function ensureGitignored(gitignore: string, entry: string = GITIGNORE_ENTRY): string {
    const present = gitignore.split('\n').some((line) => line.trim() === entry);
    if (present) {
        return gitignore;
    }
    const base = gitignore.length === 0 || gitignore.endsWith('\n') ? gitignore : `${gitignore}\n`;
    return `${base}${entry}\n`;
}

/** The shell body of the iOS "Upload Flare sourcemaps" phase: source RN's
 * with-environment.sh (so SOURCEMAP_FILE/FLARE_* are present), then run flare-xcode.sh. */
export function flareXcodeShellScript(withEnvironmentPath: string, flareXcodePath: string): string {
    return [
        'set -e',
        `WITH_ENVIRONMENT="${withEnvironmentPath}"`,
        `FLARE_XCODE="${flareXcodePath}"`,
        '/bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"',
        '',
    ].join('\n');
}

/** path.relative, normalised to forward slashes (Gradle/Xcode script paths are posix
 * even when prebuild runs on Windows). */
export function toPosixRelative(fromDir: string, target: string): string {
    return relative(fromDir, target).split(sep).join('/');
}
