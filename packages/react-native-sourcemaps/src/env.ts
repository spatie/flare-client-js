import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Ordered by precedence: .env.local wins over .env. An already-set process.env value (shell export
// or EAS env var) wins over both, since we never overwrite an existing key.
const ENV_FILES = ['.env.local', '.env'];

/**
 * Load FLARE_* variables from .env.local / .env in `rootDir` into process.env, without overwriting
 * anything already set.
 *
 * Native build hooks run in a fresh process that often lacks the upload key: .env files are loaded by
 * Metro at JS runtime not native build time, and an IDE build (or a stale reused Gradle daemon) won't
 * see a key exported in your shell. Reading it from the file makes "drop FLARE_API_KEY in .env.local"
 * work on both platforms without re-exporting per build.
 *
 * Only FLARE_-prefixed keys are read, never unrelated secrets. Minimal parser (no dependency):
 * `KEY=value`, optional `export ` prefix, surrounding quotes stripped, blank and `#` comment lines
 * ignored. Inline comments are not stripped (fine for the alphanumeric keys Flare issues).
 */
export function loadEnvFiles(rootDir: string): void {
    for (const file of ENV_FILES) {
        let raw: string;
        try {
            raw = readFileSync(join(rootDir, file), 'utf8');
        } catch {
            continue; // absent or unreadable, nothing to load
        }

        for (const [key, value] of parseFlareEnv(raw)) {
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    }
}

function parseFlareEnv(raw: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }

        const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
        const eq = body.indexOf('=');
        if (eq === -1) {
            continue;
        }

        const key = body.slice(0, eq).trim();
        if (!key.startsWith('FLARE_')) {
            continue;
        }

        let value = body.slice(eq + 1).trim();
        const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        if (quoted && value.length >= 2) {
            value = value.slice(1, -1);
        }

        out.push([key, value]);
    }

    return out;
}
