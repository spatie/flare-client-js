import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        // @inertiajs/core imports axios itself; without inlining it, Vitest loads it through Node's
        // native ESM resolver rather than Vite's graph, so vi.mock('axios', ...) never intercepts it.
        server: { deps: { inline: ['@inertiajs/core'] } },
    },
    resolve: {
        alias: {
            '@flareapp/test-helpers': resolve(__dirname, '../test-helpers/src/index.ts'),
        },
    },
});
