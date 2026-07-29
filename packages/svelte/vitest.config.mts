import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

import { flarePreprocessor } from './src/preprocessor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The REAL preprocessor, installed over the test compile so preprocessedRuntime.test.ts can assert on
// what injected code actually does at runtime, not just on the string the preprocessor emits.
//
// Scoped by allowlist rather than by path: `componentTracking: false` plus a `profileComponents` list
// that only tests/fixtures/preprocessed/* can satisfy means every other .svelte file in this package
// is returned untouched, so the rest of the suite compiles exactly as before.
//
// `importSource` points at the module itself instead of '@flareapp/svelte' so the test does not
// depend on dist being built. That the published entries re-export the symbol is covered separately
// by webEntry, injectEntry and sveltekitContract.
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
