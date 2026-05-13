import path from 'node:path';
import { fileURLToPath } from 'node:url';

import flareSourcemapUploader from '@flareapp/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    return {
        plugins: [
            tailwindcss(),
            sveltekit(),
            flareSourcemapUploader({
                apiKey: env.VITE_FLARE_SVELTEKIT_KEY,
            }),
        ],
        resolve: {
            alias: {
                '@flareapp/js': path.resolve(__dirname, '../packages/js/src/index.ts'),
                '@flareapp/svelte': path.resolve(__dirname, '../packages/svelte/src/index.ts'),
            },
        },
    };
});
