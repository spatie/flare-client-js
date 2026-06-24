import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ResolveVersionOptions = {
    /** Explicit version (e.g. CLI `--version`). Highest precedence. */
    version?: string;
    /** Directory whose package.json is read as the last-resort fallback. */
    cwd?: string;
};

const LOG_PREFIX = '@flareapp/react-native-sourcemaps';

/**
 * Resolve the sourcemap version shared by the Babel plugin and the CLI.
 * Precedence: explicit `version` > `FLARE_SOURCEMAP_VERSION` env > package.json
 * `version` (with a warning). Never a random value — a random default would
 * silently desync the inlined runtime value from the uploaded `version_id`.
 */
export function resolveVersion({ version, cwd = process.cwd() }: ResolveVersionOptions = {}): string {
    if (version) {
        return version;
    }

    const envVersion = process.env.FLARE_SOURCEMAP_VERSION;
    if (envVersion) {
        return envVersion;
    }

    const pkgVersion = readPackageVersion(cwd);
    if (pkgVersion) {
        console.warn(
            `${LOG_PREFIX}: No version provided (--version or FLARE_SOURCEMAP_VERSION). ` +
                `Falling back to package.json version "${pkgVersion}". Use the same version when ` +
                `building the bundle and uploading the map, or symbolication will silently fail.`,
        );
        return pkgVersion;
    }

    throw new Error(
        `${LOG_PREFIX}: Could not resolve a sourcemap version. ` +
            'Pass --version, set FLARE_SOURCEMAP_VERSION, or ensure package.json has a "version".',
    );
}

function readPackageVersion(cwd: string): string | null {
    try {
        const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as { version?: string };
        return pkg.version ?? null;
    } catch {
        return null;
    }
}
