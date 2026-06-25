import { printFailureBanner } from './banner';
import { readFlareConfig } from './config';
import { LOG_PREFIX } from './constants';
import { uploadSourcemaps } from './uploadSourcemaps';
import { resolveAutoVersion } from './version';

const USAGE =
    'Usage: flare-rn-sourcemaps upload --sourcemap <path> [--api-key <key>] ' +
    '[--bundle-filename <name>] [--version <v>] [--api-endpoint <url>] ' +
    '[--config <flare.json>] [--auto]';

export type ParsedArgs = {
    command: string | undefined;
    flags: Record<string, string>;
};

/** Minimal `--flag value` / `--flag` parser. No external dependency. */
export function parseArgs(argv: string[]): ParsedArgs {
    const [command, ...rest] = argv;
    const flags: Record<string, string> = {};

    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (!arg.startsWith('--')) {
            continue;
        }
        const body = arg.slice(2);
        const eq = body.indexOf('=');
        if (eq !== -1) {
            flags[body.slice(0, eq)] = body.slice(eq + 1);
            continue;
        }
        const key = body;
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[key] = next;
            i++;
        } else {
            flags[key] = 'true';
        }
    }

    return { command, flags };
}

export async function runCli(argv: string[]): Promise<void> {
    const { command, flags } = parseArgs(argv);

    if (command !== 'upload') {
        console.error(`${LOG_PREFIX}: Unknown command "${command ?? ''}".\n${USAGE}`);
        process.exitCode = 1;
        return;
    }

    const sourcemap = flags.sourcemap;
    if (!sourcemap) {
        console.error(`${LOG_PREFIX}: --sourcemap is required.\n${USAGE}`);
        process.exitCode = 1;
        return;
    }

    // Precedence per field: explicit flag > env > flare.json > default. The
    // relative_filename has no flare.json/env override in v1; `--bundle-filename`
    // (manual) or the map-basename default (in uploadSourcemaps) cover it.
    const config = readFlareConfig(flags.config);
    const apiKey = flags['api-key'] ?? process.env.FLARE_API_KEY ?? config.apiKey ?? '';
    const apiEndpoint = flags['api-endpoint'] ?? process.env.FLARE_API_ENDPOINT ?? config.apiEndpoint;
    const bundleFilename = flags['bundle-filename'];

    if (flags.auto === 'true') {
        await runAutoUpload({ apiKey, sourcemap, bundleFilename, apiEndpoint, version: flags.version });
        return;
    }

    await uploadSourcemaps({ apiKey, sourcemap, bundleFilename, version: flags.version, apiEndpoint });
}

type AutoUploadOptions = {
    apiKey: string;
    sourcemap: string;
    bundleFilename: string | undefined;
    apiEndpoint: string | undefined;
    version: string | undefined;
};

/**
 * The build-hook upload path. It NEVER throws and NEVER sets a non-zero exit code
 * (a Gradle doLast / Xcode run-script phase would abort the build on a non-zero
 * child). Every failure mode — no key, unresolved version, upload error — prints the
 * loud banner and returns, leaving the build green. Only arg misuse (handled in
 * runCli before we get here) exits non-zero.
 */
async function runAutoUpload(options: AutoUploadOptions): Promise<void> {
    const { apiKey, sourcemap, bundleFilename, apiEndpoint } = options;

    if (!apiKey) {
        printFailureBanner({
            reason: 'No Flare API key. Set FLARE_API_KEY or add "apiKey" to flare.json.',
            sourcemap,
            bundleFilename,
            apiKey,
            apiEndpoint,
        });
        return;
    }

    const version = resolveAutoVersion(options.version);
    if (!version) {
        printFailureBanner({
            reason: 'FLARE_SOURCEMAP_VERSION is not set (required for the automatic upload).',
            sourcemap,
            bundleFilename,
            apiKey,
            apiEndpoint,
        });
        return;
    }

    try {
        await uploadSourcemaps({ apiKey, sourcemap, bundleFilename, version, apiEndpoint });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        printFailureBanner({ reason: message, sourcemap, bundleFilename, version, apiKey, apiEndpoint });
    }
}
