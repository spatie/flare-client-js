---
name: release
description: Release a single independently versioned @flareapp/* package to npm using release-it. Runs cross-workspace pre-flight checks and invokes release-it from the package directory. Not for the lockstep set, which goes through npm run release:all.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit
argument-hint: <package-name> [version]
---

# Release Package

Release the `@flareapp/$0` package using `release-it`. Optional `$1` is a version string (`patch`, `minor`,
`major`, or an explicit `x.y.z`). If `$1` is omitted, ask the user which bump is appropriate based on recent
commits before running, then pass it to `release-it`.

Valid `$0` values are the independently versioned packages: `core`, `node`, `electron`, `react-native`,
`react-native-sourcemaps`.

If `$0` is a lockstep package (`js`, `react`, `vue`, `svelte`, `webpack`, `vite`, `sveltekit`, `nextjs`), stop
and tell the user to run `npm run release:all` instead. Per-package `release-it` rewrites no cross-package
reference, so releasing a lockstep package this way ships a stale `@flareapp/js` peer range and breaks the
published entry point.

## How publishing works in this repo

- `release-it` is installed once at the repo root, configured per package in `packages/$0/.release-it.json`.
- Each package has `"release": "release-it"` in its `package.json` scripts.
- `release-it` enforces clean working tree + `main` branch, bumps version, commits, tags, pushes, then publishes.
- `prepublishOnly` runs the build, so the published artifact is always fresh.
- `before:release` hook runs `npm test --if-present`. Every package has a `test` script (`vitest run`), so the
  hook always runs that package's suite.

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

## Cross-package pin check

6. If `$0` is `core`, the exact `@flareapp/core` pin in `packages/js`, `packages/node`, `packages/electron`,
   `packages/react`, `packages/vue`, `packages/svelte` and `packages/react-native` will still point at the old
   version once this release lands, because per-package `release-it` does not rewrite it. Warn the user, and
   point them at `npm run release:all`, which rewrites those pins and publishes in dependency order. Do not
   edit the files automatically.

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

9. Print a summary:
    - Package: `@flareapp/$0`
    - Old version -> new version
    - Tag: `@flareapp/$0@<new-version>`
    - npm: `https://www.npmjs.com/package/@flareapp/$0`

    Nothing else needs updating. `CLAUDE.md` records no per-package versions; each `package.json` is the
    source of truth for its own version.

10. If `$0` is `core`, remind the user to run the `sync-versions` skill to see which `@flareapp/core` pins are
    now stale.
