import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: 'node',
    },
    resolve: {
        alias: {
            '@flareapp/core': resolve(__dirname, 'src/index.ts'),
        },
    },
});
