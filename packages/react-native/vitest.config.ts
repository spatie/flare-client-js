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
            '@flareapp/core': resolve(__dirname, '../core/src/index.ts'),
            '@flareapp/react-native': resolve(__dirname, 'src/index.ts'),
            '@flareapp/test-helpers': resolve(__dirname, '../test-helpers/src/index.ts'),
            'react-native': resolve(__dirname, 'tests/stubs/react-native.ts'),
        },
    },
});
