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
    - Svelte packaging quirks (ESM extensions, version generation): take a look at .claude/docs/svelte-packaging

## What is this?

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking by Spatie. Captures frontend
errors, collects
browser context (cookies, request data, query params), and reports them to the Flare backend. Includes framework
integrations for React, Vue, and Svelte, and a Vite plugin for sourcemap uploads.

## Monorepo structure

npm workspaces monorepo with 9 published packages, 1 internal package, 4 framework playground apps, a shared fixture
package, and a Playwright-based e2e suite:

| Package                            | npm name                            | Purpose                                                                                        |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core`                    | `@flareapp/core`                    | Environment-agnostic Flare core (shared between js + node)                                     |
| `packages/js`                      | `@flareapp/js`                      | Core client — error capture, stack traces, context, API reporting                              |
| `packages/react`                   | `@flareapp/react`                   | React `FlareErrorBoundary` error boundary component; `/inject` entry for Electron renderers    |
| `packages/vue`                     | `@flareapp/vue`                     | Vue error handler plugin (`flareVue()`); `/inject` entry for Electron renderers                |
| `packages/svelte`                  | `@flareapp/svelte`                  | Svelte 5 `FlareErrorBoundary` with props serialization; `/inject` entry for Electron renderers |
| `packages/sveltekit`               | `@flareapp/sveltekit`               | SvelteKit error hooks (`handleErrorWithFlare`) + route context                                 |
| `packages/vite`                    | `@flareapp/vite`                    | Vite build plugin for sourcemap upload with retry logic                                        |
| `packages/webpack`                 | `@flareapp/webpack`                 | Webpack 5 plugin for sourcemap upload                                                          |
| `packages/nextjs`                  | `@flareapp/nextjs`                  | Next.js wrapper (`withFlareSourcemaps`) for sourcemap upload                                   |
| `packages/node`                    | `@flareapp/node`                    | Node.js SDK (process handlers, AsyncLocalStorage scope)                                        |
| `packages/react-native`            | `@flareapp/react-native`            | React Native SDK (pure-JS, Expo + bare; ErrorUtils + boundary capture)                         |
| `packages/react-native-sourcemaps` | `@flareapp/react-native-sourcemaps` | RN/Metro sourcemap upload: Babel version inlining + `flare-rn-sourcemaps` upload CLI           |
| `packages/electron`                | `@flareapp/electron`                | Electron SDK (main + preload + renderer, IPC-unified)                                          |
| `packages/flare-api`               | `@flareapp/flare-api`               | Shared API client for sourcemap uploads (private, not published)                               |
| `playgrounds/shared`               | `@flareapp/playgrounds-shared`      | Shared TS fixtures: products, scenarios, testIds, Tailwind tokens                              |
| `playgrounds/js`                   | `@flareapp/playgrounds-js`          | Vanilla TS + Vite webshop (port 5180)                                                          |
| `playgrounds/react`                | `@flareapp/playgrounds-react`       | React 19 + TanStack Router webshop (port 5181)                                                 |
| `playgrounds/vue`                  | `@flareapp/playgrounds-vue`         | Vue 3 + vue-router webshop (port 5182)                                                         |
| `playgrounds/svelte`               | `@flareapp/playgrounds-svelte`      | SvelteKit (adapter-node) webshop (port 5183)                                                   |
| `e2e/`                             | (not a workspace)                   | Playwright specs + fake-flare-server fixture                                                   |

## Tech stack

- **Language:** TypeScript 5.7, target ES2022, strict mode
- **Build:** tsdown (outputs CJS + ESM + .d.ts declarations)
- **Test:** Vitest, per-package suites in `packages/<pkg>/tests/` (each package has its own `vitest.config.ts`)
- **Linting:** oxlint (per-package configs extending root `.oxlintrc.json`)
- **Formatting:** oxfmt (config in `.oxfmtrc.json`, replaces Prettier)
- **Git hooks:** Husky + lint-staged (pre-commit runs oxlint --fix + oxfmt)
- **Package manager:** npm workspaces

## Commands (run from repo root)

```bash
npm run build              # Build all packages
npm run test               # Run vitest across workspaces (after build)
npm run typescript         # Type-check all packages
npm run format             # Run oxfmt on all files
npm run lint               # Run oxlint across all packages
npm run test:e2e           # Run Playwright suite across all 4 framework playgrounds
npm run playgrounds:js     # Boot the vanilla JS playground on http://localhost:5180
npm run playgrounds:react  # Boot the React playground on http://localhost:5181
npm run playgrounds:vue    # Boot the Vue playground on http://localhost:5182
npm run playgrounds:svelte # Boot the SvelteKit playground on http://localhost:5183
```

## Key source files

The `Flare` engine lives in `@flareapp/core`; `@flareapp/js` is the browser wiring layer that subclasses
it and injects the browser-specific seams. Paths below are relative to each package's `src/`.

### `packages/core` — the engine

- `Flare.ts` — Main Flare class. Config, context, glows, the whole `report()` pipeline
- `api/Api.ts` — HTTP communication with Flare backend via fetch
- `stacktrace/createStackTrace.ts` — Stack trace parsing (uses `error-stack-parser`)
- `stacktrace/fileReader.ts` — Source code snippet reading from stack frames (`FileReader` interface + cache)
- `Scope.ts` — Active scope: glows, pending attributes, user, entry point
- `util/rejection.ts` — Routes `unhandledrejection` reasons to the right report method
- `types.ts` — Core TypeScript interfaces (Config, Report, StackFrame, Attributes, etc.)

### `packages/js` — browser wiring

- `browser.ts` — Browser `Flare` subclass; passes the browser seams to core's constructor
- `index.ts` — Creates the `flare` singleton, sets `window.flare`, wires `catchWindowErrors`
- `browser/catchWindowErrors.ts` — Global `window.onerror` / `window.onunhandledrejection` listeners
- `browser/FetchFileReader.ts` — Fetches source files for snippets (http(s) only, HTTP 200 only, cached)
- `browser/context/collectBrowser.ts` — Collects browser context (entry point, host, request, query, cookies)
- `browser/context/request.ts`, `cookie.ts`, `requestData.ts` — Individual context collectors

## Tests

Tests live next to the code they cover, in each package's own `tests/` dir. Put a test where its behavior
lives, not all in one package.

- `packages/core/tests/` — the bulk (~22 files): buffer/report/context/encoding/flush logic, plus
  `helpers/FakeApi.ts` (the shared API mock).
- `packages/js/tests/` — browser-specific (window listeners, fetch reader, browser context). Has its own
  `helpers/FakeApi.ts`.
- `packages/node/tests/` — Node-specific (~16 files): async-scope provider, fatal handlers, lifecycle,
  disk file reader, Node context.
- `packages/{react,vue,svelte}/tests/` — framework integration tests.

Run tests: `npm run test` from root (runs every workspace's suite), or `npx vitest run` from a single
`packages/<pkg>`.

## Playgrounds

Four parallel webshop apps under `playgrounds/{js,react,vue,svelte}/`, one per framework. Each implements the same
spec (product grid, detail, cart, checkout, confirmation, broken page) so the Playwright suite can exercise the
SDK uniformly across frameworks.

- Shared data lives in `@flareapp/playgrounds-shared`: product list, error scenarios, test IDs, route paths,
  Tailwind v4 `@theme` tokens. Every playground imports from this workspace.
- The `/broken` route in each playground renders one button per scenario in `coverageFor('<framework>')`. Test IDs
  follow `testIds.brokenTrigger(scenario.id)` so specs select by ID, not label.
- Each playground reads `VITE_FLARE_URL` (and `VITE_FLARE_KEY`) at boot and overrides Flare's `ingestUrl`. In tests
  this points at the fake-flare-server (see e2e section below).
- For manual exploration, run a playground with `npm run playgrounds:<framework>` and visit `localhost:518X`. No
  fake server needed; reports just fail to send.
- Tailwind v4: each playground imports `@flareapp/playgrounds-shared/styles.css` once in its entry. The shared
  stylesheet declares `@theme` tokens. Don't duplicate `tailwindcss` config.

## E2E suite

Playwright config at `playwright.config.ts`, specs at `e2e/specs/*.spec.ts`. One project per framework, single
worker (the fake server has shared in-memory state), `webServer` boots each playground's `vite dev` automatically.

- `e2e/fake-flare-server/`: standalone node http server (no deps). `POST /api/reports` and `POST /api/sourcemaps`
  record the body. `GET /__inspect/reports` and `POST /__inspect/reset` are the inspection API used by the test
  fixture. CORS open. Boots on `FAKE_FLARE_PORT` (default 7765 — avoid 4318, OrbStack squats on it).
- `e2e/global-setup.ts` / `global-teardown.ts`: boots/stops the fake server around the test run.
- `e2e/fixtures/fake-flare.ts`: Playwright fixture exposing `reset()`, `reports()`, `waitForReport({ predicate })`,
  `assertNoReports()`. Each test auto-resets the server before running.
- `e2e/specs/shared.ts`: data-driven `runScenario(page, fakeFlare, scenario)` helper used by all four spec files.
  Branches on `scenario.kind` (sync / async / unhandled / render / boundaryReset / manualReport / sveltekitServer).
- After `page.goto(...)`, specs call `page.waitForLoadState('networkidle')` to let SvelteKit (and others) finish
  hydrating before the click — otherwise the onclick handler isn't wired up yet and clicks no-op silently.

Run the whole thing: `npm run test:e2e`. One project: `npx playwright test --project=svelte`. One scenario:
`npx playwright test -g "sync-throw"`.

## Error reporting flow

1. Error caught by global listeners (`catchWindowErrors`) or framework integration (React boundary / Vue handler)
2. `Flare.report(error)` builds a Report: stack trace + browser context + glows (breadcrumbs)
3. `beforeEvaluate` / `beforeSubmit` hooks can filter or modify the report
4. `Api.report()` sends POST to Flare backend with API key in headers

## Code style

- Formatting: oxfmt, config in `.oxfmtrc.json`
- Linting: oxlint, root config in `.oxlintrc.json`, per-package configs in `packages/<pkg>/.oxlintrc.json`
- Doc comments on functions must be terse and follow JSDoc (`/** ... */` with `@param` / `@returns` where they add
  information). Write them only when they clarify non-obvious behavior; do not restate the signature.

## Publishing

Each published package (`@flareapp/js`, `@flareapp/react`, `@flareapp/vue`, `@flareapp/vite`, `@flareapp/webpack`, `@flareapp/nextjs`) is released
independently with [`release-it`](https://github.com/release-it/release-it). `release-it` is installed once at the
repo root as a devDependency and shared across workspaces. Per-package configuration lives in
`packages/<pkg>/.release-it.json` and a `release` script in each `packages/<pkg>/package.json`.

## Commits and PRs

- No co-authored by <model_name> in commit messages.
- When creating PRs and PR descriptions, do not add Generated by Claude Code at the bottom.
- Keep the commit descriptions short or omit them completely if the commit title contains enough info.
- Keep commits small and contained

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

### Independently versioned packages: `@flareapp/core` and `@flareapp/node`

`@flareapp/core` and `@flareapp/node` version INDEPENDENTLY of the lockstep set
(e.g. core at `2.2.0`, node at `0.1.0`), but `scripts/release-all.mjs` can
release them in the same run. After the lockstep version prompt the script asks,
per package, for a core and a node version, where you can:

- enter an exact semver to (re)release it,
- press `k` to keep the current version (first publish of an unreleased package),
- press `s` to skip it (a plain lockstep release that leaves core/node alone).

When core is part of the run it publishes FIRST (js and node hard-pin it), and the
script rewrites the `@flareapp/core` pin in `packages/js/package.json` and
`packages/node/package.json` to the EXACT core version it just released, staged
into the release commit. No manual pin edit needed. If you skip core, the pins are
left untouched and the pre-flight dependency check verifies the currently pinned
core version is already on npm (`--skip-dep-check` bypasses it). Deps that are
being published in the same run are excluded from that pre-check.

Publishing waits for npm visibility between tiers: after a tier publishes, the
script polls `npm view` (every `NPM_POLL_INTERVAL_MS`, default 30s, up to
`NPM_POLL_TIMEOUT_MS`, default 10m, with a spinner) until each package resolves
before releasing anything that depends on it. This absorbs registry propagation
lag, so a downstream package never publishes against a core/svelte/webpack version
the registry has not surfaced yet.

You can still release either package on its own with the per-package `release-it`
flow when you don't want a full run:

```bash
cd packages/core   # or packages/node
npm run release
```

### Skill

For an automated walkthrough use the `release` skill: `/release <package> <version>` (e.g.
`/release js 1.2.0`). It runs the pre-flight checks, invokes `release-it`, and updates the CLAUDE.md version
table.
