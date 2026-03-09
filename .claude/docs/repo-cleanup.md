## Repo cleanup

Before building new features, clean up the repo to make it a solid foundation. Keep it simple — no over-engineering.

### Dependencies to update

- [x] `typescript` ^5.3.3 → ^5.7 (all packages)
- [x] `vitest` ^1.0.4 → ^3.x (packages/js)
- [x] `husky` ^8.0.3 → ^9.x (root) — v9 has a much simpler setup, no more `.husky/_/husky.sh` sourcing
- [x] `@types/react` ^18.2.47 → add ^19 support (packages/react has `react: ^19.0.0` as devDep but types are still v18)
- [x] `@types/node` — consolidate: root has ^24.3.0, vite package still has ^18.11.17. Remove from vite, use root's.
- [x] `tsup` — Migrate tsup to tsdown as it's maintained and considered the successor.
- [ ] `@trivago/prettier-plugin-sort-imports` — update
  once [minimatch fix PR](https://github.com/trivago/prettier-plugin-sort-imports/pull/401) is released

### Clean up tsconfig.json

- [x] Remove all the commented-out boilerplate — keep only what's actually used
- [x] Add `moduleResolution: "bundler"` (modern resolution, matches tsdown/rolldown)
- [x] Add `isolatedModules: true` (tsdown uses rolldown which transpiles per-file, this catches issues early)
- [x] Bump target to `es2022` (adds `error.cause` support which we'll need) — also changed `module` to `esnext` to match
  bundler workflow

### Package.json fixes

- [x] Root: move `@trivago/prettier-plugin-sort-imports` from `dependencies` to `devDependencies` (it's a dev tool, not
  a runtime dep) — was already in devDependencies
- [x] All packages: add `types` condition to exports map for better TS resolution (done as part of tsdown migration —
  exports now use conditional `types` with `.d.cts`/`.d.mts`)
- [x] Add `engines` field to root package.json (`"node": ">=18"`) — documents minimum Node version
- [x] Add `.node-version` file for consistent dev environments (using fnm)

### Vue package: convert to TypeScript

- [x] `packages/vue/src/index.js` was plain JavaScript — converted to TypeScript
- [x] Convert to `index.ts` with proper types for Vue's `App`, `ComponentPublicInstance`, etc.
- [x] Add a `typescript` script to vue's package.json (`tsc --noEmit`)
- [x] Update build script from `tsdown src/index.js` to `tsdown src/index.ts`

### Housekeeping

- [x] Add `.idea/` to `.gitignore` (currently showing as untracked in git status)

### Local dev/test app

- [x] Add a simple test app inside the repo (e.g. `playground/` directory) that imports `@flareapp/js`,
  `@flareapp/react`, `@flareapp/vue` etc. from the local packages
- [x] Should be a basic Vite app with a few buttons that trigger different error types (uncaught exception, unhandled
  promise rejection, console.error, manual report, etc.)
- [x] Makes it easy to iterate without setting up an external project — just `npm run dev` in the playground and click
  around
- [x] Wire it up as an npm workspace so it picks up local package changes automatically
- [x] Add a `playground` script to root package.json for quick access
- [x] Gitignore the playground's Flare API key (use `.env.local` or similar)
- [x] Not published to npm — `"private": true`
