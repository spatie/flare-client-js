# Unified Release Command

## Problem

Releasing all 8 public packages requires running `release-it` manually in each package directory, in the correct dependency order. This is slow, error-prone, and produces 8 separate commits instead of one clean release commit.

## Solution

A single Node.js script (`scripts/release-all.mjs`) that orchestrates a lockstep release of all public packages. Invoked via `npm run release:all`.

## Design Decisions

- **Lockstep versioning**: all 8 public packages always get the same version number
- **Delegates to release-it**: the script calls release-it per package for the version bump phase, so `.release-it.json` configs remain the single source of truth for bump behavior (hooks, version generation, etc.)
- **Dry-run default**: the script stops after bump+commit+tag and shows a summary; user must confirm to publish and push
- **AI-generated changelogs**: after publishing, shells out to `claude` CLI to generate GitHub release notes from commit history

## Packages

8 public packages, published in dependency order:

| Tier | Packages                                    | Reason                                          |
| ---- | ------------------------------------------- | ----------------------------------------------- |
| 0    | `js`                                        | No internal deps, everything else depends on it |
| 1    | `react`, `vue`, `svelte`, `webpack`, `vite` | Depend on js or flare-api (internal)            |
| 2    | `sveltekit`, `nextjs`                       | Depend on tier-1 packages (svelte, webpack)     |

`flare-api` is private/internal and not released.

## Flow

### Phase 1: Pre-flight

1. Verify working tree is clean
2. Verify current branch is `main`
3. Verify npm auth (`npm whoami`)
4. Verify GitHub CLI auth (`gh auth status`)
5. Run `npm run build` (all packages)
6. Run `npm run test` (vitest across workspaces)
7. Run `npm run typescript` (type-check all packages)

If any check fails, abort with a clear error message.

### Phase 2: Version prompt

Interactive prompt using Node.js `readline`:

- Show current version (read from `packages/js/package.json`)
- Offer choices: patch, minor, major, or exact semver
- Show what the new version will be
- Confirm before proceeding

### Phase 3: Bump versions via release-it

For each of the 8 public packages, run from its directory:

```
npx release-it {version} --ci \
  --git.commit=false \
  --git.tag=false \
  --git.push=false \
  --npm.publish=false \
  --hooks.before:release=
```

This:

- Bumps `version` in the package's `package.json`
- Runs `after:bump` hooks (generates `version.ts` for svelte and sveltekit)
- Skips git operations (we handle those ourselves)
- Skips npm publish (we handle that ourselves)
- Skips `before:release` test hook (already ran in pre-flight)

### Phase 4: Update cross-package references

After all bumps, update dependency ranges that reference sibling packages:

| Package     | Field              | Reference           | Update to    |
| ----------- | ------------------ | ------------------- | ------------ |
| `react`     | `peerDependencies` | `@flareapp/js`      | `^{version}` |
| `vue`       | `peerDependencies` | `@flareapp/js`      | `^{version}` |
| `svelte`    | `peerDependencies` | `@flareapp/js`      | `^{version}` |
| `sveltekit` | `peerDependencies` | `@flareapp/js`      | `^{version}` |
| `sveltekit` | `dependencies`     | `@flareapp/svelte`  | `^{version}` |
| `nextjs`    | `dependencies`     | `@flareapp/webpack` | `^{version}` |

### Phase 5: Single commit + tags

1. `git add -A`
2. Commit: `chore: release v{version}`
3. Create 8 annotated tags:
    - `@flareapp/js@{version}`
    - `@flareapp/react@{version}`
    - `@flareapp/vue@{version}`
    - `@flareapp/svelte@{version}`
    - `@flareapp/sveltekit@{version}`
    - `@flareapp/webpack@{version}`
    - `@flareapp/vite@{version}`
    - `@flareapp/nextjs@{version}`

### Phase 6: Dry-run gate

Print summary:

- Version: `{old} -> {new}`
- Files changed (list)
- Tags to be created (list)
- Packages to be published (list in order)

Ask: "Publish to npm and push to origin? (y/N)"

If declined, all changes are local (commit + tags exist but not pushed). User can `git reset HEAD~1` and `git tag -d` to undo.

### Phase 7: Publish

Publish packages sequentially in tier order:

```
Tier 0: npm publish --workspace=@flareapp/js
Tier 1: npm publish --workspace=@flareapp/react
        npm publish --workspace=@flareapp/vue
        npm publish --workspace=@flareapp/svelte
        npm publish --workspace=@flareapp/webpack
        npm publish --workspace=@flareapp/vite
Tier 2: npm publish --workspace=@flareapp/sveltekit
        npm publish --workspace=@flareapp/nextjs
```

Each package's `prepublishOnly` script runs `npm run build` before publish.

If a publish fails mid-way: stop, report which packages succeeded and which failed. The commit and tags are already local. User can fix the issue and re-run publish for remaining packages manually.

### Phase 8: Push

```
git push origin main --follow-tags
```

### Phase 9: GitHub releases via Claude CLI

For each of the 8 packages:

1. Get commits since previous tag:
    ```
    git log --pretty=format:"%s (%h)" {prev_tag}...{new_tag}
    ```
2. Shell out to Claude CLI:
    ```
    claude -p "Generate a concise GitHub release changelog for @flareapp/{pkg} v{version}. Here are the commits since the last release: {commits}. Write 3-5 bullet points summarizing what changed. Be specific, not generic. No intro text, just the bullet points."
    ```
3. Create GitHub release:
    ```
    gh release create @flareapp/{pkg}@{version} --title "@flareapp/{pkg}@{version}" --notes "{changelog}" --target main
    ```

If a GitHub release fails, log a warning and continue (non-fatal).

## Files

| What           | Path                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Release script | `scripts/release-all.mjs`                                              |
| New npm script | `"release:all": "node scripts/release-all.mjs"` in root `package.json` |

No changes to existing `.release-it.json` files or per-package `release` scripts.

## Error handling

| Failure point            | Behavior                                                   |
| ------------------------ | ---------------------------------------------------------- |
| Pre-flight check         | Abort immediately with clear message                       |
| release-it bump          | Abort, tell user to `git checkout .` to undo partial bumps |
| Cross-package ref update | Abort, tell user to `git checkout .`                       |
| git commit/tag           | Abort with error                                           |
| npm publish (partial)    | Stop, list succeeded/failed, user can retry manually       |
| git push                 | Report error, packages already on npm                      |
| GitHub release           | Warn and continue                                          |

## Not in scope

- Replacing per-package `release-it` (still works for individual releases)
- CHANGELOG.md generation
- CI/CD automation
- Independent per-package version bumps
