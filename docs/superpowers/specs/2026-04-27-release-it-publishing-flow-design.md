# Release-it publishing flow

Date: 2026-04-27
Topic: Automate per-package npm publishing via `release-it`

## Goal

Replace the manual release flow documented in `README.md` (bump version, commit, tag, push, `npm publish`) with a single `npm run release` command per package, executed locally by the developer.

## Non-goals

- CI-driven publishing (GitHub Actions stays unchanged).
- Conventional-commit-driven version bumps or `CHANGELOG.md` generation.
- GitHub release creation.
- Coordinated multi-package releases (each package still releases independently).

## Workflow

From a package directory:

```bash
cd packages/js
npm run release
```

`release-it` then:

1. Verifies clean working dir and current branch is `main`.
2. Prompts the developer for the next version (patch/minor/major/custom).
3. Bumps `version` in that package's `package.json`.
4. Runs the `before:release` hook (`npm test --if-present`).
5. Commits with message `chore: release @flareapp/<pkg>@<version>`.
6. Creates annotated tag `@flareapp/<pkg>@<version>`.
7. Pushes commit and tag to `origin`.
8. Runs `npm publish` from the package directory. The existing `prepublishOnly` script builds the package first.

## Authentication

- Local-only flow. Developer must be authenticated to npm via `npm login` or `NPM_TOKEN` in the environment.
- Publishing scoped public packages already configured via `"publishConfig": { "access": "public" }` in each package.
- If npm requires 2FA on publish, `release-it` prompts for the OTP interactively.

## Configuration

### Root `package.json`

Add `release-it` to `devDependencies`. Single install at the root, shared by all workspaces.

### Per-package `.release-it.json`

One file per published package: `packages/js/`, `packages/react/`, `packages/vue/`, `packages/vite/`.

```json
{
    "git": {
        "tagName": "@flareapp/<pkg>@${version}",
        "tagAnnotation": "Release @flareapp/<pkg>@${version}",
        "commitMessage": "chore: release @flareapp/<pkg>@${version}",
        "requireBranch": "main",
        "requireCleanWorkingDir": true,
        "push": true
    },
    "npm": {
        "publish": true
    },
    "github": {
        "release": false
    },
    "hooks": {
        "before:release": "npm test --if-present"
    }
}
```

`<pkg>` is replaced per package: `js`, `react`, `vue`, `vite`.

### Per-package `package.json`

Add `"release": "release-it"` to `scripts` in each of the four packages.

## README update

Replace the current "Bumping a version" and "Publishing to npm" subsections under "Versioning and releasing" with a single "Releasing a package" section that documents:

- `cd packages/<pkg> && npm run release`
- The interactive prompt for the next version.
- The fact that the build runs automatically via `prepublishOnly` and tests run automatically via the `before:release` hook.
- That the tag and commit are pushed automatically.
- A note that npm authentication (`npm login` or `NPM_TOKEN`) is required.

Keep the existing "Publishing multiple packages" subsection (dependency order) verbatim.

## Files affected

New:
- `packages/js/.release-it.json`
- `packages/react/.release-it.json`
- `packages/vue/.release-it.json`
- `packages/vite/.release-it.json`

Modified:
- `package.json` (root) — add `release-it` to `devDependencies`.
- `packages/js/package.json` — add `release` script.
- `packages/react/package.json` — add `release` script.
- `packages/vue/package.json` — add `release` script.
- `packages/vite/package.json` — add `release` script.
- `README.md` — replace bump/publish sections.

## Risk and rollback

- Risk: a failed `npm publish` after a successful tag push leaves the repo tagged but not published. Mitigation: `release-it` runs `npm publish` last; if it fails, the developer can retry `npm publish` manually from the package directory.
- Risk: developer runs from a non-`main` branch by accident. Mitigation: `requireBranch: "main"` blocks this.
- Rollback: delete the local config files, the `release` scripts, and the `release-it` devDep. No runtime code is touched.
