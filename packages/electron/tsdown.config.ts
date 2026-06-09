import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
};

const env = { FLARE_ELECTRON_CLIENT_VERSION: pkg.version };

// Three separate configs — one per entry — so each is built as a self-contained bundle.
// Combining all three entries in a single tsdown run triggers rolldown's cross-entry
// code-splitting, which emits a dead `require('./main.cjs')` inside renderer.cjs even
// though renderer has no runtime dependency on main. Building each entry alone prevents
// that artifact: each output is a standalone bundle with no shared chunks.
export default defineConfig([
    {
        entry: ['src/main.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        clean: true,
        env,
        outputOptions: { codeSplitting: false },
    },
    {
        entry: ['src/preload.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        clean: false,
        env,
        outputOptions: { codeSplitting: false },
    },
    {
        entry: ['src/renderer.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        clean: false,
        env,
        outputOptions: { codeSplitting: false },
    },
]);
