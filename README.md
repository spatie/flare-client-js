# Flare JavaScript Client

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking
by [Spatie](https://spatie.be). Captures frontend errors, collects browser context (cookies, request data, query
params), and reports them to the Flare backend. Includes framework integrations for React, Vue, Svelte, SvelteKit, and build plugins for Vite, webpack, and Next.js
for sourcemap uploads.

Read the JavaScript error tracking section
in [the Flare documentation](https://flareapp.io/docs/javascript-error-tracking/installation) for more information.

## Looking for v1?

The v1 source lives on the [`1.x`](https://github.com/spatie/flare-client-js/tree/1.x) branch.

## Packages

This is an npm workspaces monorepo containing the following packages:

| Package                                    | npm                                                                        | Description                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`packages/js`](packages/js)               | [`@flareapp/js`](https://www.npmjs.com/package/@flareapp/js)               | Core client for error capture, stack traces, context collection, and API reporting |
| [`packages/react`](packages/react)         | [`@flareapp/react`](https://www.npmjs.com/package/@flareapp/react)         | React error boundary component and React 19 error handler                          |
| [`packages/vue`](packages/vue)             | [`@flareapp/vue`](https://www.npmjs.com/package/@flareapp/vue)             | Vue error handler plugin                                                           |
| [`packages/svelte`](packages/svelte)       | [`@flareapp/svelte`](https://www.npmjs.com/package/@flareapp/svelte)       | Svelte 5 error boundary component and boundary handler factory                     |
| [`packages/sveltekit`](packages/sveltekit) | [`@flareapp/sveltekit`](https://www.npmjs.com/package/@flareapp/sveltekit) | SvelteKit client/server error hooks and route context                              |
| [`packages/vite`](packages/vite)           | [`@flareapp/vite`](https://www.npmjs.com/package/@flareapp/vite)           | Vite build plugin for sourcemap uploads                                            |
| [`packages/webpack`](packages/webpack)     | [`@flareapp/webpack`](https://www.npmjs.com/package/@flareapp/webpack)     | Webpack 5 plugin for sourcemap uploads                                             |
| [`packages/nextjs`](packages/nextjs)       | [`@flareapp/nextjs`](https://www.npmjs.com/package/@flareapp/nextjs)       | Next.js wrapper for sourcemap uploads via webpack                                  |
| [`packages/flare-api`](packages/flare-api) | (private)                                                                  | Shared API client for sourcemap uploads (internal)                                 |
| [`playgrounds/shared`](playgrounds/shared) | (private)                                                                  | Shared fixtures: product data, error scenarios, test IDs, Tailwind tokens          |
| [`playgrounds/js`](playgrounds/js)         | (private)                                                                  | Vanilla TS + Vite playground (port 5180)                                           |
| [`playgrounds/react`](playgrounds/react)   | (private)                                                                  | React 19 + TanStack Router playground (port 5181)                                  |
| [`playgrounds/vue`](playgrounds/vue)       | (private)                                                                  | Vue 3 + vue-router playground (port 5182)                                          |
| [`playgrounds/svelte`](playgrounds/svelte) | (private)                                                                  | SvelteKit (adapter-node) playground (port 5183)                                    |
| [`playgrounds/nextjs`](playgrounds/nextjs) | (private)                                                                  | Next.js 15 App Router playground (port 5184)                                       |

## Local development

### Prerequisites

- Node.js >= 18 (see `.node-version` for the exact version used in development)
- npm (comes with Node.js)

### Setup

```bash
# Clone the repo
git clone https://github.com/spatie/flare-client-js.git
cd flare-client-js

# Install all dependencies (root + all workspaces)
npm install

# Build all packages
npm run build
```

### Commands

All commands are run from the repository root:

| Command                      | Description                                                      |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run build`              | Build all packages to their respective `dist` folders            |
| `npm run test`               | Run tests for all packages that have them                        |
| `npm run typescript`         | Type-check all packages                                          |
| `npm run format`             | Run oxfmt across all files                                       |
| `npm run lint`               | Run oxlint across all packages                                   |
| `npm run test:e2e`           | Run the Playwright suite across all four framework playgrounds   |
| `npm run playgrounds:js`     | Build packages, then start the vanilla JS playground (port 5180) |
| `npm run playgrounds:react`  | Build packages, then start the React playground (port 5181)      |
| `npm run playgrounds:vue`    | Build packages, then start the Vue playground (port 5182)        |
| `npm run playgrounds:svelte` | Build packages, then start the SvelteKit playground (port 5183)  |
| `npm run playgrounds:nextjs` | Build packages, then start the Next.js playground (port 5184)    |
| `npm run release:all`        | Lockstep-release all 8 public packages at one shared version     |

### Playgrounds

There are five parallel playgrounds under `playgrounds/`, one per framework. Each implements the same webshop sample
app (product grid, product detail, cart, checkout, confirmation) plus a `/broken` page that triggers a deterministic
list of error scenarios. They share fixtures from `@flareapp/playgrounds-shared` so the surface stays identical across
frameworks.

```bash
# Pick the framework you want to explore
npm run playgrounds:js       # http://localhost:5180
npm run playgrounds:react    # http://localhost:5181
npm run playgrounds:vue      # http://localhost:5182
npm run playgrounds:svelte   # http://localhost:5183
npm run playgrounds:nextjs   # http://localhost:5184
```

To send reports to a real Flare project (instead of letting them fail), set `VITE_FLARE_URL` and `VITE_FLARE_KEY` for
the relevant playground - e.g. `playgrounds/js/.env.local`. Without them the playground still boots; reports just have
nowhere to land.

### E2E suite

End-to-end tests live in `e2e/` and run all four playgrounds against a local fake Flare server (`e2e/fake-flare-server/`)
that records report POSTs and exposes inspection endpoints for the tests. Playwright spawns each playground's Vite dev
server automatically.

```bash
# One-time browser install
npx playwright install chromium --with-deps

# Run the suite (~25s, 44 tests across js/react/vue/svelte)
npm run test:e2e

# One project, one scenario
npx playwright test --project=svelte -g "render-error"
```

The fake server listens on `FAKE_FLARE_PORT` (default `7765`; avoid `4318`, OrbStack squats on the OTLP port).

### Code style

Formatting is handled by [oxfmt](https://oxc.rs/blog/2025-03-15-oxfmt.html) and linting by [oxlint](https://oxc.rs/docs/guide/usage/linter/). A pre-commit hook (Husky + lint-staged) automatically formats and lints staged files on commit.

To manually format and lint all files:

```bash
npm run format
npm run lint
```

See `.oxfmtrc.json` and `.oxlintrc.json` for configuration.

### CI

GitHub Actions runs on every push:

- **Test**: installs dependencies, builds all packages, runs all tests (Vitest)
- **TypeScript**: installs dependencies, builds all packages, type-checks all packages
- **E2E**: installs dependencies, caches Playwright browsers by `@playwright/test` version, builds all packages, and runs the Playwright suite across all four framework playgrounds (Chromium). HTML reports are uploaded as artifacts on every run; traces and screenshots are uploaded only on failure.

## Versioning and releasing

Each package can be versioned and published independently using [release-it](https://github.com/release-it/release-it), or all 8 public packages can be released in lockstep with a single command via `scripts/release-all.mjs`.

### Releasing all packages in lockstep (recommended)

For coordinated releases that span multiple packages, use `npm run release:all` from the repo root. This orchestrates a single-version release across all 8 published packages and produces one release commit instead of eight.

```bash
npm run release:all
```

The script will:

1. **Pre-flight**: verify clean working tree, on `main`, npm authenticated, then run `build`, `test`, and `typescript` for the 8 published packages and the internal `flare-api` workspace.
2. **Prompt for the next version** (patch, minor, major, or custom). The same version is applied to every public package.
3. **Bump** each package via `release-it` (no commit/tag/publish at this stage). The svelte and sveltekit `after:bump` hooks regenerate their `src/version.ts`.
4. **Update cross-package references**: peer-dep and dependency ranges that point at `@flareapp/js`, `@flareapp/svelte`, or `@flareapp/webpack` are bumped to `^<new version>`.
5. **Commit + tag**: one commit (`chore: release v<version>`) plus 8 annotated tags (`@flareapp/<pkg>@<version>`).
6. **Dry-run gate**: prints a summary of tags, file changes, and publish order, then asks for confirmation before any push or publish. Declining leaves the commit and tags local; the script prints the exact undo command.
7. **Publish** to npm in dependency order: `js` first, then `react/vue/svelte/webpack/vite`, then `sveltekit/nextjs`.
8. **Push** the commit and all tags to `origin`.
9. **GitHub releases**: one per tag. If the `claude` CLI is available, release notes are auto-generated from the commit log since the previous tag; otherwise minimal notes are used. Failures here are non-fatal.

Requirements: `npm whoami` must succeed. `gh auth status` is checked but optional (GitHub releases are skipped if unauthenticated). `claude` CLI is optional (falls back to minimal notes).

If publishing fails partway, the script stops, lists which packages made it onto npm, and tells you to publish the remaining ones manually. Commit and tags are already local at that point.

> **Note:** `@flareapp/flare-api` is private and not published. Its source is bundled into `@flareapp/vite` and `@flareapp/webpack` via tsdown's `--noExternal` flag, so changes to `flare-api` only ship when those packages are re-released.

### Releasing a single package

From the package directory you want to release, run:

```bash
cd packages/js
npm run release
```

This will:

1. Verify your working directory is clean and you are on the `main` branch.
2. Prompt you for the next version (patch, minor, major, or custom).
3. Bump the `version` in the package's `package.json`.
4. Run the package's tests (if it has a `test` script).
5. Commit the bump with message `chore: release @flareapp/<pkg>@<version>`.
6. Tag the commit as `@flareapp/<pkg>@<version>`.
7. Push the commit and tag to `origin`.
8. Build the package (via `prepublishOnly`) and publish it to npm.

You must be authenticated to npm before running this. Run `npm login` once, or set the `NPM_TOKEN` environment variable. If 2FA is enabled, release-it will prompt for the OTP.

To preview without making any changes, add `--dry-run`:

```bash
npm run release -- --dry-run
```

> **Note:** `release-it` v20 requires Node.js 20+. If you are on Node 18 (the repo's minimum), upgrade your local Node before running a release.

### Publishing multiple packages

Prefer `npm run release:all` for any release that spans more than one package - it enforces the correct order, bumps the cross-package version ranges, and ships everything under one commit.

If you do release packages individually for some reason, the dependency order is:

1. `@flareapp/js` (core, no internal dependencies)
2. `@flareapp/vite` (no internal dependencies)
3. `@flareapp/webpack` (no internal dependencies)
4. `@flareapp/nextjs` (depends on `@flareapp/webpack`)
5. `@flareapp/react` (depends on `@flareapp/js`)
6. `@flareapp/vue` (depends on `@flareapp/js`)
7. `@flareapp/svelte` (depends on `@flareapp/js`)
8. `@flareapp/sveltekit` (depends on `@flareapp/js` and `@flareapp/svelte`)

## Project structure

```
flare-client-js/
├── packages/
│   ├── js/          # Core client
│   ├── react/       # React integration
│   ├── vue/         # Vue integration
│   ├── svelte/      # Svelte integration
│   ├── sveltekit/   # SvelteKit integration
│   ├── vite/        # Vite sourcemap plugin
│   ├── webpack/     # Webpack sourcemap plugin
│   ├── nextjs/      # Next.js sourcemap plugin
│   └── flare-api/   # Shared API client (private)
├── playgrounds/
│   ├── shared/      # Shared fixtures (products, scenarios, test IDs, Tailwind tokens)
│   ├── js/          # Vanilla TS + Vite playground
│   ├── react/       # React + TanStack Router playground
│   ├── vue/         # Vue + vue-router playground
│   ├── svelte/      # SvelteKit playground
│   └── nextjs/      # Next.js playground
├── e2e/             # Playwright specs + fake-flare-server fixture
├── .github/         # GitHub Actions workflows
├── .husky/          # Git hooks (pre-commit formatting)
└── package.json     # Root workspace config
```

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
