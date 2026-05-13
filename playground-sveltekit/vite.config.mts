import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    resolve: {
        alias: {
            '@flareapp/js': path.resolve(__dirname, '../packages/js/src/index.ts'),
            '@flareapp/svelte': path.resolve(__dirname, '../packages/svelte/src/index.ts'),
        },
    },
});
