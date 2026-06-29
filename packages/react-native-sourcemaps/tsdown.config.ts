import { defineConfig } from 'tsdown';

export default defineConfig([
    {
        entry: ['src/index.ts', 'src/babel.ts', 'src/bin.ts', 'src/runtime.ts'],
        format: ['cjs', 'esm'],
        dts: true,
        clean: true,
        // `@flareapp/flare-api` is private and unpublished, so bundle it into the
        // output instead of leaving it as an external runtime import.
        noExternal: ['@flareapp/flare-api'],
        // tsdown warns when it bundles dependencies (here: `@flareapp/flare-api` into
        // the output, and `@babel/types` declarations into `babel.d.ts`) and, with the
        // default `failOnWarn: "ci-only"`, that warning is fatal under CI. Both are
        // intentional, so disable the check.
        inlineOnly: false,
    },
    {
        // The Expo config plugin is loaded by the Expo CLI via require() at prebuild;
        // Metro never bundles it. Emit CJS only — an ESM build would carry bare
        // `require`/`require.resolve` (undefined in ESM) and throw.
        entry: ['src/expo.ts'],
        format: ['cjs'],
        dts: true,
        clean: false,
        noExternal: ['@flareapp/flare-api'],
        inlineOnly: false,
    },
]);
