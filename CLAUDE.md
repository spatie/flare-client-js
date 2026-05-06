# CLAUDE.md — flare-client-js

## Claude instructions

- Do not tell me I am right all the time.
- Be critical.
- We're equals.
- Try to be neutral and objective.
- Do not use emojis.
- Do not use -- when writing comments or explaining something.
- For more information regarding:
    - The research: take a look at .claude/docs/research
    - Repo cleanup: take a look at .claude/docs/repo-cleanup

## What is this?

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking by Spatie. Captures frontend
errors, collects
browser context (cookies, request data, query params), and reports them to the Flare backend. Includes framework
integrations for React and Vue, and a Vite plugin for sourcemap uploads.

## Monorepo structure

npm workspaces monorepo with 4 packages + a playground app:

| Package          | npm name          | Version | Purpose                                                           |
|------------------|-------------------|---------|-------------------------------------------------------------------|
| `packages/js`    | `@flareapp/js`    | 1.1.0   | Core client — error capture, stack traces, context, API reporting |
| `packages/react` | `@flareapp/react` | 1.0.1   | React `FlareErrorBoundary` error boundary component               |
| `packages/vue`   | `@flareapp/vue`   | 1.0.1   | Vue error handler plugin (`flareVue()`)                           |
| `packages/vite`  | `@flareapp/vite`  | 1.0.3   | Vite build plugin for sourcemap upload with retry logic           |
| `playground`     | (private)         | —       | Local dev/test app for all integrations (JS, React, Vue)          |

## Tech stack

- **Language:** TypeScript 5.7, target ES2022, strict mode
- **Build:** tsdown (outputs CJS + ESM + .d.ts declarations)
- **Test:** Vitest (tests only in `packages/js/tests/`)
- **Formatting:** Prettier with `@trivago/prettier-plugin-sort-imports`
- **Git hooks:** Husky + lint-staged (pre-commit runs Prettier)
- **Package manager:** npm workspaces

## Commands (run from repo root)

```bash
npm run build        # Build all packages
npm run test         # Run tests (vitest) across all workspaces
npm run typescript   # Type-check all packages
npm run format       # Run Prettier on all files
npm run playground   # Build packages, then start playground dev server
```

## Key source files (packages/js)

- `src/Flare.ts` — Main Flare class. Config, context, glows, error reporting, solution providers
- `src/api/Api.ts` — HTTP communication with Flare backend via fetch
- `src/browser/catchWindowErrors.ts` — Global `window.onerror` / `window.onunhandledrejection` listeners
- `src/stacktrace/createStackTrace.ts` — Stack trace parsing (uses `error-stack-parser`)
- `src/stacktrace/fileReader.ts` — Source code snippet reading from stack frames
- `src/context/collectContext.ts` — Collects browser context
- `src/context/request.ts`, `cookie.ts`, `requestData.ts` — Individual context collectors
- `src/solutions/getSolutions.ts` — Solution providers for error resolution suggestions
- `src/types.ts` — Core TypeScript interfaces (Config, Report, Context, StackFrame, etc.)

## Tests

All tests are in `packages/js/tests/`:

- `configure.test.ts`, `context.test.ts`, `glows.test.ts`, `hooks.test.ts`
- `light.test.ts`, `report.test.ts`, `solutions.test.ts`
- `helpers/FakeApi.ts` — Test helper for mocking the API

Run tests: `npm run test` from root, or `npx vitest run` from `packages/js`.

## Playground

Local Vite dev app (`playground/`) for manually testing all integrations. Multi-page setup with separate entry points
for plain JS, React, and Vue. Each page has buttons that trigger different error types (uncaught exceptions, unhandled
promise rejections, async errors, component errors, etc.).

- Registered as an npm workspace (`"private": true`, not published)
- Imports `@flareapp/js`, `@flareapp/react`, `@flareapp/vue` from local packages
- Flare API key goes in `playground/.env.local` (gitignored) — see `playground/.env.example`
- Run with `npm run playground` from root (builds packages first, then starts Vite dev server)

## Error reporting flow

1. Error caught by global listeners (`catchWindowErrors`) or framework integration (React boundary / Vue handler)
2. `Flare.report(error)` builds a Report: stack trace + browser context + glows (breadcrumbs) + solutions
3. `beforeEvaluate` / `beforeSubmit` hooks can filter or modify the report
4. `Api.report()` sends POST to Flare backend with API key in headers

## Code style

- Prettier: read from `.prettierrc`

## Publishing

Each published package (`@flareapp/js`, `@flareapp/react`, `@flareapp/vue`, `@flareapp/vite`) is released
independently with [`release-it`](https://github.com/release-it/release-it). `release-it` is installed once at the
repo root as a devDependency and shared across workspaces. Per-package configuration lives in
`packages/<pkg>/.release-it.json` and a `release` script in each `packages/<pkg>/package.json`.

### Release a single package

From the package directory you want to release:

```bash
cd packages/<pkg>            # js, react, vue, or vite
npm run release              # interactive: prompts for the next version
```

To pre-select a bump non-interactively:

```bash
npm run release -- patch     # or minor / major / 1.2.3
npm run release -- --dry-run # preview without changing anything
```

`release-it` will, in order:

1. Check the working tree is clean and the current branch is `main` (`requireBranch: "main"`,
   `requireCleanWorkingDir: true`).
2. Prompt for the next version (or accept the increment passed on the CLI).
3. Bump `version` in that package's `package.json`.
4. Run the `before:release` hook: `npm test --if-present`. `@flareapp/js` and `@flareapp/react` have a
   `test` script today and run their vitest suites. `@flareapp/vue` will once PR #31 lands (adds the
   `test` script + a vitest suite). `@flareapp/vite` has no tests, so the hook is a no-op for it.
5. Commit the version bump as `chore: release @flareapp/<pkg>@<version>`.
6. Create an annotated tag `@flareapp/<pkg>@<version>`.
7. Push the commit and tag to `origin`.
8. Run `npm publish` from the package directory. The package's `prepublishOnly` script builds the package first
   (`npm run build`).

### Pre-flight before running `release-it`

`release-it` only verifies a clean tree and the branch. It does not run type-checks, builds, or cross-package tests.
Before running `npm run release`, do these from the repo root:

```bash
npm run typescript           # type-check all packages
npm run test                 # vitest across workspaces
npm run build                # confirm tsdown builds clean
```

If any of those fail, fix first; do not release.

### Versioning rules

- Each package versions independently, no lockstep across the monorepo.
- Use semver: bug fix only -> `patch`, additive non-breaking -> `minor`, breaking change -> `major`.
- If you bump `@flareapp/js` to a major version, audit the `peerDependencies` ranges in `@flareapp/react`,
  `@flareapp/vue`, and `@flareapp/vite`. The peer-dep ranges are not auto-updated by `release-it`. The
  `sync-versions` skill checks this.
- After releasing, update the version column in the "Monorepo structure" table at the top of this file.

### Authentication

- Local-only flow. You must be logged in to npm (`npm whoami`) or have `NPM_TOKEN` exported.
- Packages are scoped + public via `"publishConfig": { "access": "public" }` in each `package.json`.
- If npm requires a 2FA OTP, `release-it` prompts for it interactively.

### Out of scope

- No CI/GitHub Actions publishing. GitHub releases are disabled (`github.release: false`).
- No `CHANGELOG.md` generation, no conventional-commit-driven version inference.
- No coordinated multi-package release. Release each package separately.

### Skill

For an automated walkthrough use the `release` skill: `/release <package> <version>` (e.g.
`/release js 1.2.0`). It runs the pre-flight checks, invokes `release-it`, and updates the CLAUDE.md version
table.
