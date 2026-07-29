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
            // More specific first: Vite alias matching is prefix-based, so the subpath entry must be
            // checked before the bare-package entry or it resolves to '.../src/index.ts/util'.
            '@flareapp/core/util': resolve(__dirname, '../core/src/util/index.ts'),
            '@flareapp/core': resolve(__dirname, '../core/src/index.ts'),
            '@flareapp/node': resolve(__dirname, 'src/index.ts'),
            '@flareapp/test-helpers': resolve(__dirname, '../test-helpers/src/index.ts'),
        },
    },
});
