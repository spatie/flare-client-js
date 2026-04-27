# Release-it Publishing Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual per-package release flow with `npm run release` driven by `release-it`, run locally from each package directory.

**Architecture:** Add `release-it` as a root devDependency. Add a `.release-it.json` config and a `release` script in each of the four published packages (`packages/js`, `packages/react`, `packages/vue`, `packages/vite`). Update `README.md` to document the new flow. No code changes, no CI changes.

**Tech Stack:** `release-it` v17+, npm workspaces.

---

### Task 1: Install `release-it` at the root

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install release-it as a root devDependency**

Run: `npm install --save-dev --workspaces=false release-it`

The `--workspaces=false` flag ensures it is added to the root `package.json`, not to a workspace package.

- [ ] **Step 2: Verify root `package.json` contains release-it**

Run: `grep release-it package.json`
Expected: a line like `"release-it": "^17.x.x"` under `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add release-it devDependency"
```

---

### Task 2: Add release config and script for `@flareapp/js`

**Files:**
- Create: `packages/js/.release-it.json`
- Modify: `packages/js/package.json`

- [ ] **Step 1: Create `packages/js/.release-it.json`**

```json
{
    "git": {
        "tagName": "@flareapp/js@${version}",
        "tagAnnotation": "Release @flareapp/js@${version}",
        "commitMessage": "chore: release @flareapp/js@${version}",
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

- [ ] **Step 2: Add `release` script to `packages/js/package.json`**

In the `scripts` block, add `"release": "release-it"`. Final `scripts`:

```json
"scripts": {
    "prepublishOnly": "npm run build",
    "build": "tsdown src/index.ts --format cjs,esm --dts --env.FLARE_JS_CLIENT_VERSION=\\\"$(node -p \"require('./package.json').version\")\\\" --clean",
    "test": "vitest run",
    "typescript": "tsc",
    "release": "release-it"
},
```

- [ ] **Step 3: Verify config validity with a dry run**

Run: `cd packages/js && npx release-it --dry-run --ci`
Expected: dry-run output describing the would-be tag `@flareapp/js@<next>` and would-be commit message; no errors. Run from the repo root must work too: `npx release-it --dry-run --ci -c packages/js/.release-it.json` (skip if the per-package run already succeeds).

If `--dry-run --ci` fails because `requireCleanWorkingDir` complains about the new files being uncommitted, that is expected on this task; commit first, then verify.

- [ ] **Step 4: Commit**

```bash
git add packages/js/.release-it.json packages/js/package.json
git commit -m "chore: add release-it config for @flareapp/js"
```

- [ ] **Step 5: Re-run dry run on the now-clean working dir**

Run: `cd packages/js && npx release-it --dry-run --ci`
Expected: output shows `Empty changeset` resolution prompt skipped under `--ci`, target version computed, and proposed tag is `@flareapp/js@<patch-bump>`. No errors.

---

### Task 3: Add release config and script for `@flareapp/vite`

**Files:**
- Create: `packages/vite/.release-it.json`
- Modify: `packages/vite/package.json`

- [ ] **Step 1: Create `packages/vite/.release-it.json`**

```json
{
    "git": {
        "tagName": "@flareapp/vite@${version}",
        "tagAnnotation": "Release @flareapp/vite@${version}",
        "commitMessage": "chore: release @flareapp/vite@${version}",
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

- [ ] **Step 2: Add `release` script to `packages/vite/package.json`**

Final `scripts`:

```json
"scripts": {
    "prepublishOnly": "npm run build",
    "build": "tsdown src/index.ts --format cjs,esm --dts --clean",
    "typescript": "tsc",
    "release": "release-it"
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/vite/.release-it.json packages/vite/package.json
git commit -m "chore: add release-it config for @flareapp/vite"
```

- [ ] **Step 4: Dry run**

Run: `cd packages/vite && npx release-it --dry-run --ci`
Expected: proposed tag `@flareapp/vite@<patch-bump>`, no errors. `npm test --if-present` is a no-op (no `test` script in this package).

---

### Task 4: Add release config and script for `@flareapp/react`

**Files:**
- Create: `packages/react/.release-it.json`
- Modify: `packages/react/package.json`

- [ ] **Step 1: Create `packages/react/.release-it.json`**

```json
{
    "git": {
        "tagName": "@flareapp/react@${version}",
        "tagAnnotation": "Release @flareapp/react@${version}",
        "commitMessage": "chore: release @flareapp/react@${version}",
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

- [ ] **Step 2: Add `release` script to `packages/react/package.json`**

Final `scripts`:

```json
"scripts": {
    "prepublishOnly": "npm run build",
    "build": "tsdown src/index.ts --format cjs,esm --dts --clean",
    "test": "vitest run",
    "typescript": "tsc --noEmit",
    "release": "release-it"
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/react/.release-it.json packages/react/package.json
git commit -m "chore: add release-it config for @flareapp/react"
```

- [ ] **Step 4: Dry run**

Run: `cd packages/react && npx release-it --dry-run --ci`
Expected: proposed tag `@flareapp/react@<patch-bump>`, tests run successfully, no errors.

---

### Task 5: Add release config and script for `@flareapp/vue`

**Files:**
- Create: `packages/vue/.release-it.json`
- Modify: `packages/vue/package.json`

- [ ] **Step 1: Create `packages/vue/.release-it.json`**

```json
{
    "git": {
        "tagName": "@flareapp/vue@${version}",
        "tagAnnotation": "Release @flareapp/vue@${version}",
        "commitMessage": "chore: release @flareapp/vue@${version}",
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

- [ ] **Step 2: Add `release` script to `packages/vue/package.json`**

Final `scripts`:

```json
"scripts": {
    "prepublishOnly": "npm run build",
    "build": "tsdown src/index.ts --format cjs,esm --dts --clean",
    "test": "vitest run",
    "typescript": "tsc --noEmit",
    "release": "release-it"
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/vue/.release-it.json packages/vue/package.json
git commit -m "chore: add release-it config for @flareapp/vue"
```

- [ ] **Step 4: Dry run**

Run: `cd packages/vue && npx release-it --dry-run --ci`
Expected: proposed tag `@flareapp/vue@<patch-bump>`, tests run successfully, no errors.

---

### Task 6: Update README

**Files:**
- Modify: `README.md` (the "Versioning and releasing" section, lines ~90-132)

- [ ] **Step 1: Replace "Bumping a version" and "Publishing to npm" subsections**

Replace the content between the `## Versioning and releasing` heading and the `### Publishing multiple packages` heading with:

```markdown
## Versioning and releasing

Each package is versioned and published independently using [release-it](https://github.com/release-it/release-it).

### Releasing a package

From the package directory you want to release, run:

```bash
cd packages/js
npm run release
```

This will:

1. Verify your working directory is clean and you are on the `main` branch.
2. Prompt you for the next version (patch, minor, major, or custom).
3. Run the package's tests (if it has a `test` script).
4. Bump the `version` in the package's `package.json`.
5. Commit the bump with message `chore: release @flareapp/<pkg>@<version>`.
6. Tag the commit as `@flareapp/<pkg>@<version>`.
7. Push the commit and tag to `origin`.
8. Build the package (via `prepublishOnly`) and publish it to npm.

You must be authenticated to npm before running this. Run `npm login` once, or set the `NPM_TOKEN` environment variable. If 2FA is enabled, release-it will prompt for the OTP.

To preview without making any changes, add `--dry-run`:

```bash
npm run release -- --dry-run
```
```

Keep the existing `### Publishing multiple packages` subsection unchanged below this.

- [ ] **Step 2: Verify the README renders sanely**

Run: `grep -n "release-it\|npm run release\|Bumping a version\|Publishing to npm" README.md`
Expected: matches for `release-it` and `npm run release`, NO matches for `Bumping a version` or `Publishing to npm`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document release-it publishing flow"
```

---

### Task 7: End-to-end dry-run verification across all packages

**Files:** none

- [ ] **Step 1: Dry-run release for every package**

Run, one at a time:

```bash
cd packages/js && npx release-it --dry-run --ci && cd ../..
cd packages/vite && npx release-it --dry-run --ci && cd ../..
cd packages/react && npx release-it --dry-run --ci && cd ../..
cd packages/vue && npx release-it --dry-run --ci && cd ../..
```

Expected per package:
- Proposed tag matches `@flareapp/<pkg>@<next-version>`.
- Proposed commit message matches `chore: release @flareapp/<pkg>@<next-version>`.
- `before:release` hook output shows `npm test` ran (or was skipped via `--if-present` for `vite`).
- No errors.

- [ ] **Step 2: Confirm no real tags or commits were created**

Run: `git status && git tag -l '@flareapp/*'`
Expected: working tree matches HEAD (clean), tag list unchanged from before Task 1 (still `@flareapp/js@1.1.0`, `@flareapp/react@1.0.1`, `@flareapp/vite@1.1.0`, `@flareapp/vue@1.0.1`).

---

## Self-review notes

- Spec coverage: every spec section maps to a task (install → T1, four configs → T2-T5, README → T6, verification → T7).
- No placeholders: every config and script is shown in full per package; no "similar to Task N" references.
- Type/name consistency: tag pattern `@flareapp/<pkg>@${version}` and commit pattern `chore: release @flareapp/<pkg>@${version}` are identical across all four configs.
- Dry-run order: tasks 2-5 each include a per-package dry run; task 7 is the cross-package re-verification.
