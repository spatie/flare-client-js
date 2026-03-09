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

3. **Shared devDependencies**: Check that `typescript` and `tsup` versions are the same across all packages that use them.

4. **Monorepo table in CLAUDE.md**: Check if the version numbers listed in the CLAUDE.md monorepo structure table match the actual versions in each `package.json`.

## Output

Show a concise report:

```
@flareapp/js       1.1.0  OK
@flareapp/react    1.0.1  OK
@flareapp/vue      1.0.1  WARNING: tsup version differs from root (...)
@flareapp/vite     1.0.3  OK

CLAUDE.md versions: all match / X mismatches found
```

If issues are found, suggest the fix but don't apply it — let the user decide.
