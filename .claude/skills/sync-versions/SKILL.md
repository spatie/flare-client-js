---
name: sync-versions
description: Audit all package.json files in the monorepo for version consistency — checks peer dependencies, internal references, and shared devDependencies.
disable-model-invocation: true
allowed-tools: Read, Bash
---

# Sync Versions

Audit all `package.json` files in the monorepo for version consistency.

## Checks

1. **Internal peer dependencies**: For each package that has `@flareapp/*` peer dependencies, verify the version range covers the actual current version of that package. For example, if `@flareapp/react` has `"@flareapp/js": "^1.0.0"` as a peer dep, and `@flareapp/js` is at version `1.1.0`, that's fine. But if `@flareapp/js` is at `2.0.0`, flag it.

2. **Internal devDependencies**: All packages should use `file:../` references for local packages (not published versions).

3. **Shared devDependencies**: Check that `typescript` and `tsdown` versions are the same across all packages that use them.

4. **Lockstep set shares one version**: `js`, `react`, `vue`, `svelte`, `webpack`, `vite`, `sveltekit` and `nextjs` must all be on the same version, anchored on `@flareapp/js`. Flag any that drifted, which usually means someone released one of them on its own with per-package `release-it` instead of `npm run release:all`. `core`, `node`, `electron`, `react-native` and `react-native-sourcemaps` version independently and are exempt.

5. **Exact `@flareapp/core` pins**: `js`, `node`, `electron`, `react`, `vue`, `svelte` and `react-native` pin `@flareapp/core` exactly (no caret). Verify each pin matches the current `packages/core` version.

## Output

Show a concise report:

```
@flareapp/js       2.6.0  OK
@flareapp/react    2.6.0  OK
@flareapp/vue      2.6.0  WARNING: tsdown version differs from root (...)
@flareapp/vite     2.5.1  WARNING: lockstep drift, expected 2.6.0

Lockstep set: all on 2.6.0 / X packages drifted
@flareapp/core pins: all match 2.6.0 / X stale
```

If issues are found, suggest the fix but don't apply it — let the user decide.
