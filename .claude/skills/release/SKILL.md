---
name: release
description: Release a single @flareapp/* package to npm using release-it. Runs cross-workspace pre-flight checks, invokes release-it from the package directory, and updates the CLAUDE.md version table.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit
argument-hint: <package-name> [version]
---

# Release Package

Release the `@flareapp/$0` package using `release-it`. Optional `$1` is a version string (`patch`, `minor`,
`major`, or an explicit `x.y.z`). If `$1` is omitted, ask the user which bump is appropriate based on recent
commits before running, then pass it to `release-it`.

Valid `$0` values: `js`, `react`, `vue`, `vite`.

## How publishing works in this repo

- `release-it` is installed once at the repo root, configured per package in `packages/$0/.release-it.json`.
- Each package has `"release": "release-it"` in its `package.json` scripts.
- `release-it` enforces clean working tree + `main` branch, bumps version, commits, tags, pushes, then publishes.
- `prepublishOnly` runs the build, so the published artifact is always fresh.
- `before:release` hook runs `npm test --if-present`. `@flareapp/js` and `@flareapp/react` have test
  scripts today; `@flareapp/vue` will once PR #31 lands; `@flareapp/vite` has no tests.

The `release-it` flow does not type-check, does not build other packages, and does not run cross-workspace tests.
This skill performs those checks before invoking `release-it`.

## Pre-flight (repo root)

1. Confirm the working tree is clean and the branch is `main`:

   ```bash
   git status
   git rev-parse --abbrev-ref HEAD
   ```

   If not on `main` or there are uncommitted changes, abort and tell the user.

2. Confirm the package exists by reading `packages/$0/package.json`. Note the current `version`.

3. Run cross-workspace validation from the repo root. Abort on any failure:

   ```bash
   npm run typescript
   npm run test
   npm run build
   ```

## Decide the version

4. If `$1` is set, use it as-is.
5. If `$1` is empty, summarize the commits since the last `@flareapp/$0@*` tag (`git log @flareapp/$0@<last>..HEAD -- packages/$0`)
   and propose a bump (`patch` / `minor` / `major`). Ask the user to confirm before continuing.

## Cross-package peer dependency check

6. If `$0` is `js` and the bump is a major bump, read `packages/react/package.json`, `packages/vue/package.json`,
   and `packages/vite/package.json`. For each, check the `peerDependencies["@flareapp/js"]` range. If the new
   version falls outside the range, warn the user. Do not edit those files automatically.

## Confirm

7. Show a summary to the user: package, current version, target bump, what `release-it` will do
   (commit message, tag name, push, npm publish). Ask for explicit confirmation before continuing.

## Run release-it

8. Run from the package directory:

   ```bash
   cd packages/$0 && npm run release -- $1
   ```

   If the user wants a dry run first, add `--dry-run`:

   ```bash
   cd packages/$0 && npm run release -- $1 --dry-run
   ```

   `release-it` is interactive. It will prompt for npm OTP if 2FA is on. Pass through any prompts to the user.

   If `release-it` fails:

   - Pre-condition failure (dirty tree, wrong branch): fix and retry.
   - `before:release` hook failure (test failed): fix the test, do not retry the release until tests pass.
   - `npm publish` failure: the git commit and tag may have already been pushed. Investigate before retrying.
     Do not blindly re-run `npm run release` because the version bump commit already exists.

## Post-release

9. Update the version column in the "Monorepo structure" table in `.claude/CLAUDE.md` to reflect the new version
   of `@flareapp/$0`.

10. Print a summary:
    - Package: `@flareapp/$0`
    - Old version -> new version
    - Tag: `@flareapp/$0@<new-version>`
    - npm: `https://www.npmjs.com/package/@flareapp/$0`

11. Remind the user to run the `sync-versions` skill if `@flareapp/js` was bumped to a new major version.
