import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Highest precedence first: a value in .env.local wins over the same key in .env.
// An already-set process.env value (an explicit shell export, or an EAS env var)
// wins over both, because we never overwrite a key that already exists.
const ENV_FILES = ['.env.local', '.env'];

/**
 * Load FLARE_* variables from .env.local / .env in `rootDir` into process.env,
 * without overwriting anything already set.
 *
 * The native build hooks run in a fresh process whose environment often does NOT
 * carry the upload key: the app's .env files are loaded by Metro at JS runtime, not
 * at native build time, and a build launched from an IDE — or served by a reused
 * Gradle daemon with a stale environment — won't see a key you exported in your
 * shell. Reading the key from the FILE here makes "drop FLARE_API_KEY in .env.local"
 * work the way developers expect, on both platforms, without re-exporting it per
 * build.
 *
 * Only FLARE_-prefixed keys are read, so this never pulls unrelated secrets from the
 * file into the process. Minimal parser (no dependency): `KEY=value`, an optional
 * `export ` prefix, surrounding single/double quotes stripped, blank and `#` comment
 * lines ignored. Inline comments are NOT stripped (a `#` is treated as part of the
 * value), which is fine for the alphanumeric keys Flare issues.
 */
export function loadEnvFiles(rootDir: string): void {
    for (const file of ENV_FILES) {
        let raw: string;
        try {
            raw = readFileSync(join(rootDir, file), 'utf8');
        } catch {
            continue; // absent or unreadable — nothing to load from this file
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
