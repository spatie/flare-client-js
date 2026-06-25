import { readFileSync } from 'node:fs';

export type FlareConfig = {
    apiKey?: string;
    apiEndpoint?: string;
};

/**
 * Read flare.json from an EXPLICIT path. The hooks run from android/ or ios/, so
 * resolving relative to process.cwd() would read the wrong file — callers always
 * pass --config. Missing or malformed file → empty config, so resolution falls
 * through to env, then to the no-key skip-with-banner. Any `version` key is
 * deliberately ignored: in the auto path the version flows only through
 * FLARE_SOURCEMAP_VERSION (see resolveAutoVersion / the design doc).
 */
export function readFlareConfig(configPath?: string): FlareConfig {
    if (!configPath) {
        return {};
    }

    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        const config: FlareConfig = {};
        const apiKey = asString(raw.apiKey);
        const apiEndpoint = asString(raw.apiEndpoint);
        if (apiKey !== undefined) {
            config.apiKey = apiKey;
        }
        if (apiEndpoint !== undefined) {
            config.apiEndpoint = apiEndpoint;
        }
        return config;
    } catch {
        return {};
    }
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
