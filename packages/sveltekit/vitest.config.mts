import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    resolve: {
        alias: {
            '$app/state': path.resolve('./tests/__mocks__/app-state.ts'),
        },
    },
    test: {
        environment: 'node',
    },
});
