import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { FlareApi } from '@flareapp/flare-api';

import { resolveVersion } from './version';

const DEFAULT_ENDPOINT = 'https://flareapp.io/api/sourcemaps';
const LOG_PREFIX = '@flareapp/react-native-sourcemaps';

export type UploadSourcemapsOptions = {
    /** Flare project API key. */
    apiKey: string;
    /** Path to the composed `.map` file to upload. */
    sourcemap: string;
    /**
     * The `relative_filename` the backend matches against runtime stack frames.
     * Defaults to the map's basename minus `.map` (e.g. `index.android.bundle`).
     */
    bundleFilename?: string;
    /** Explicit version; otherwise resolved from env/package.json. */
    version?: string;
    /** Override the Flare sourcemaps endpoint. */
    apiEndpoint?: string;
};

export async function uploadSourcemaps(options: UploadSourcemapsOptions): Promise<void> {
    const { apiKey, sourcemap, apiEndpoint = DEFAULT_ENDPOINT } = options;

    if (!apiKey) {
        console.warn(`${LOG_PREFIX}: No Flare API key provided, not uploading sourcemaps.`);
        return;
    }

    const version = resolveVersion({ version: options.version });
    const bundleFilename = options.bundleFilename ?? defaultBundleFilename(sourcemap);
    const content = readFileSync(sourcemap, 'utf8');

    const flare = new FlareApi(apiEndpoint, apiKey, version);

    log(`Uploading sourcemap "${bundleFilename}" (version ${version}) to Flare.`);
    await flare.uploadSourcemap({ originalFile: bundleFilename, content });
    log('Successfully uploaded sourcemap to Flare.');
}

function defaultBundleFilename(sourcemapPath: string): string {
    return basename(sourcemapPath).replace(/\.map$/, '');
}

function log(message: string): void {
    console.log(`${LOG_PREFIX}: ${message}`);
}
