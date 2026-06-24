import { uploadSourcemaps } from './uploadSourcemaps';

const LOG_PREFIX = '@flareapp/react-native-sourcemaps';
const USAGE =
    'Usage: flare-rn-sourcemaps upload --sourcemap <path> [--api-key <key>] ' +
    '[--bundle-filename <name>] [--version <v>] [--api-endpoint <url>]';

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

    await uploadSourcemaps({
        apiKey: flags['api-key'] ?? process.env.FLARE_API_KEY ?? '',
        sourcemap,
        bundleFilename: flags['bundle-filename'],
        version: flags.version,
        apiEndpoint: flags['api-endpoint'],
    });
}
