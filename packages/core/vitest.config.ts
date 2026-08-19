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
            // Must come before the bare entry: Vite matches aliases by prefix, so '@flareapp/core'
            // would otherwise swallow this and resolve to '.../src/index.ts/util'.
            '@flareapp/core/util': resolve(__dirname, 'src/util/index.ts'),
            '@flareapp/core': resolve(__dirname, 'src/index.ts'),
            '@flareapp/test-helpers': resolve(__dirname, '../test-helpers/src/index.ts'),
        },
    },
});
