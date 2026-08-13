import flareSourcemaps from '@flareapp/vite';
import { loadEnv, type PluginOption } from 'vite';

const REAL_FLARE_ENDPOINT = 'https://flareapp.io/api/sourcemaps';

/**
 * Wires @flareapp/vite into a playground build so every playground exercises the real
 * sourcemap upload plugin.
 *
 * Uploading is opt-in, because a plain playground build should not talk to flareapp.io on its
 * own. It turns on when VITE_FLARE_URL is set (the e2e run, pointing at the fake Flare server)
 * or when FLARE_UPLOAD_SOURCEMAPS=1 is exported.
 *
 * @param mode The vite mode, from `defineConfig(({ mode }) => ...)`.
 */
export function flareSourcemapsForPlayground(mode: string): PluginOption {
    // Empty prefix so .env values and the variables Playwright injects both land in here.
    const env = loadEnv(mode, process.cwd(), '');

    const ingestUrl = env.VITE_FLARE_URL;
    const optedIn = Boolean(ingestUrl) || env.FLARE_UPLOAD_SOURCEMAPS === '1';

    if (!optedIn || !env.VITE_FLARE_KEY) {
        return false;
    }

    return flareSourcemaps({
        apiKey: env.VITE_FLARE_KEY,
        // VITE_FLARE_URL points at the error ingest path, so keep only its origin.
        apiEndpoint: ingestUrl ? new URL('/api/sourcemaps', ingestUrl).href : REAL_FLARE_ENDPOINT,
        runInDevelopment: false,
        removeSourcemaps: false,
    });
}
