import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

import { flarePreprocessor } from './src/preprocessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Runs the real preprocessor so preprocessedRuntime.test.ts can check what the injected code does,
// not just what the preprocessor prints. The allowlist is what keeps it scoped: nothing outside
// tests/fixtures/preprocessed/ matches, so the rest of the suite compiles unchanged. importSource
// points straight at the module so the test doesn't need a build.
const preprocessedFixtures = flarePreprocessor({
    componentTracking: false,
    profileComponents: [/\+(page|layout)(@[^/]*)?$/, 'AddToCartButton'],
    routesDir: 'tests/fixtures/preprocessed',
    importSource: 'flare-preprocessed-entry',
});

export default defineConfig({
    plugins: [svelte({ hot: false, preprocess: [preprocessedFixtures] }), svelteTesting()],
    test: {
        environment: 'jsdom',
    },
    resolve: {
        alias: {
            'flare-preprocessed-entry': resolve(__dirname, 'src/profileComponent.ts'),
            '@flareapp/test-helpers': resolve(__dirname, '../test-helpers/src/index.ts'),
        },
    },
});
