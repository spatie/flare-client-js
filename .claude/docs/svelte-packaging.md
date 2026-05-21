# Svelte packaging quirks

## The rule

All relative imports in `packages/svelte/src/` and `packages/sveltekit/src/` must use `.js` extensions,
even though the source files are `.ts`.

```typescript
// Correct
import { registerSvelteSdkIdentity } from './identify.js';
import type { FlareSvelteContext } from './types.js';

// Wrong - will break Node ESM resolution at runtime
import { registerSvelteSdkIdentity } from './identify';
import type { FlareSvelteContext } from './types';
```

`.svelte` imports keep their `.svelte` extension as normal.

## Why

Both `@flareapp/svelte` and `@flareapp/sveltekit` are built with `svelte-package` (from `@sveltejs/package`).
Unlike `tsdown` (used by the other packages), `svelte-package` does **not** rewrite import specifiers. Whatever
you write in source is preserved verbatim in the `dist/` output.

Node's ESM loader requires fully specified file extensions on relative imports. Bundlers (Vite, webpack) resolve
extensions automatically, so extensionless imports work in dev and in bundled apps. But when someone imports the
package in a Node context (SSR, tests, SvelteKit server hooks), Node reads the dist files directly and fails on
bare specifiers with `ERR_MODULE_NOT_FOUND`.

TypeScript handles this fine: `from './identify.js'` in a `.ts` file resolves to `identify.ts` during
type-checking, then emits `./identify.js` in the compiled output.

## Affected packages

- `packages/svelte/` - all `src/**/*.ts` and `src/**/*.svelte` files
- `packages/sveltekit/` - all `src/**/*.ts` files

The other packages (`packages/js`, `packages/react`, `packages/vue`, `packages/vite`) use `tsdown` which
rewrites imports, so they don't need this.

## No JSON imports

`svelte-package` passes `import { version } from '../package.json'` through unchanged. This breaks
Node ESM in two ways: no `with { type: 'json' }` import attribute, and JSON modules only expose a
default export (named imports like `{ version }` fail).

Instead, both packages use a generated `src/version.ts` file with the version string hardcoded:

```typescript
// src/version.ts - generated during release, do not modify
export const PACKAGE_VERSION = '2.0.0';
```

This is the same approach Svelte and SvelteKit themselves use (`packages/svelte/src/version.js`).

### How it stays in sync

- `scripts/generate-version.mjs` reads `package.json` and writes `src/version.ts`
- Each package's `build` script runs it: `npm run generate:version && svelte-package -i src -o dist`
- Each package's `.release-it.json` has an `after:bump` hook that regenerates and stages the file
- The generated file is committed to the repo (not gitignored)

### What NOT to do

- Do not `import` from `package.json` in svelte/sveltekit source files
- Do not `import` from `svelte/package.json` either (same problem)
- Do not use build-time defines (`svelte-package` has no support for them)

## Reference

- Svelte packaging caveats: https://svelte.dev/docs/kit/packaging#Caveats
- Node.js ESM mandatory extensions: https://nodejs.org/api/esm.html
- TypeScript module resolution: https://www.typescriptlang.org/docs/handbook/modules/reference.html
