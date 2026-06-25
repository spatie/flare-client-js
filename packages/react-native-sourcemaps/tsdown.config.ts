import { defineConfig } from 'tsdown';

export default defineConfig({
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
});
