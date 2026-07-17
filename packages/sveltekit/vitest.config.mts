import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    resolve: {
        // Without the browser condition, `svelte` resolves to its server build where `$effect` is a
        // no-op: runes modules still compile, effects just silently never run.
        conditions: ['browser'],
        alias: {
            '$app/state': path.resolve('./tests/__mocks__/app-state.ts'),
        },
    },
    test: {
        environment: 'node',
    },
});
