import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOG_PREFIX } from './constants';

export type ResolveVersionOptions = {
    /** Explicit version (e.g. CLI `--version`). Highest precedence. */
    version?: string;
    /** Directory whose package.json is read as the last-resort fallback. */
    cwd?: string;
};

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

/**
 * Version resolution for the AUTOMATIC native upload path. Unlike resolveVersion it
 * NEVER falls back to package.json: the hook runs in android/ or ios/, a different
 * cwd than Metro, so a package.json fallback would read a different (or missing)
 * file and silently desync from the version the Babel plugin inlined. The only
 * input guaranteed identical to both halves is FLARE_SOURCEMAP_VERSION. Returns
 * null when unresolved so the caller can skip-with-banner rather than upload a
 * guaranteed-mismatched map.
 */
export function resolveAutoVersion(version?: string): string | null {
    if (version) {
        return version;
    }

    const envVersion = process.env.FLARE_SOURCEMAP_VERSION;
    return envVersion ? envVersion : null;
}

function readPackageVersion(cwd: string): string | null {
    try {
        const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as { version?: string };
        return pkg.version ?? null;
    } catch {
        return null;
    }
}
