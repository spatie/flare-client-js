---
name: release
description: Guide through releasing a specific package to npm. Bumps version, builds, tests, commits, tags, and publishes.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit
argument-hint: <package-name> <version>
---

# Release Package

Release the `@flareapp/$0` package with version `$1`.

If no version is provided, ask which version bump is appropriate (patch, minor, or major) based on recent changes.

## Pre-flight checks

1. Verify you're on the `main` branch with a clean working tree (`git status`)
2. Read `packages/$0/package.json` to confirm the current version
3. Verify the package exists in the monorepo

## Validation

4. Run `npm run typescript` from the repo root — abort if type-checking fails
5. Run `npm run test` from the repo root — abort if any test fails
6. Run `npm run build` from the repo root — abort if the build fails

## Version bump

7. Update `version` in `packages/$0/package.json` to `$1`
8. If other packages in the monorepo have a peer dependency on `@flareapp/$0`, check if their peer dependency range already covers the new version. If not, warn the user but do NOT update them automatically.

## Commit and tag

9. Stage only the changed `package.json` file(s)
10. Commit with message: `Bump @flareapp/$0 from <old-version> to $1`
11. Create a git tag: `@flareapp/$0@$1`

## Publish

12. Ask the user for confirmation before publishing
13. Run `npm publish` from `packages/$0/`
14. Push the commit and tag to origin

## Post-release

15. Show a summary: package name, old version, new version, npm URL, git tag
