# CLAUDE.md

## What is this?

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking by Spatie. Captures frontend
errors, collects browser context (cookies, request data, query params), and reports them to the Flare backend. Includes framework
integrations for React, Vue, and Svelte, and a Vite plugin for sourcemap uploads.

## Monorepo structure

npm workspaces monorepo with 14 published packages, 2 internal packages, 5 framework playground apps, a shared fixture
package, and a Playwright-based e2e suite:

| Package                            | npm name                             | Purpose                                                                                        |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/core`                    | `@flareapp/core`                     | Environment-agnostic Flare core (shared between js + node)                                     |
| `packages/js`                      | `@flareapp/js`                       | Core client — error capture, stack traces, context, API reporting                              |
| `packages/react`                   | `@flareapp/react`                    | React `FlareErrorBoundary` error boundary component; `/inject` entry for Electron renderers    |
| `packages/vue`                     | `@flareapp/vue`                      | Vue error handler plugin (`flareVue()`); `/inject` entry for Electron renderers                |
| `packages/svelte`                  | `@flareapp/svelte`                   | Svelte 5 `FlareErrorBoundary` with props serialization; `/inject` entry for Electron renderers |
| `packages/sveltekit`               | `@flareapp/sveltekit`                | SvelteKit error hooks (`handleErrorWithFlare`) + route context                                 |
| `packages/inertia`                 | `@flareapp/inertia`                  | Inertia.js navigation tracing (`traceInertiaRouter`), adapter-agnostic                         |
| `packages/vite`                    | `@flareapp/vite`                     | Vite build plugin for sourcemap upload with retry logic                                        |
| `packages/webpack`                 | `@flareapp/webpack`                  | Webpack 5 plugin for sourcemap upload                                                          |
| `packages/nextjs`                  | `@flareapp/nextjs`                   | Next.js wrapper (`withFlareSourcemaps`) for sourcemap upload                                   |
| `packages/node`                    | `@flareapp/node`                     | Node.js SDK (process handlers, AsyncLocalStorage scope)                                        |
| `packages/react-native`            | `@flareapp/react-native`             | React Native SDK (pure-JS, Expo + bare; ErrorUtils + boundary capture)                         |
| `packages/react-native-sourcemaps` | `@flareapp/react-native-sourcemaps`  | RN/Metro sourcemap upload: Babel version inlining + `flare-rn-sourcemaps` upload CLI           |
| `packages/electron`                | `@flareapp/electron`                 | Electron SDK (main + preload + renderer, IPC-unified)                                          |
| `packages/flare-api`               | `@flareapp/flare-api`                | Shared API client for sourcemap uploads (private, not published)                               |
| `playgrounds/shared`               | `@flareapp/playgrounds-shared`       | Shared TS fixtures: products, scenarios, testIds, Tailwind tokens                              |
| `playgrounds/js`                   | `@flareapp/playgrounds-js`           | Vanilla TS + Vite webshop (port 5180)                                                          |
| `playgrounds/react`                | `@flareapp/playgrounds-react`        | React 19 + TanStack Router webshop (port 5181)                                                 |
| `playgrounds/vue`                  | `@flareapp/playgrounds-vue`          | Vue 3 + vue-router webshop (port 5182)                                                         |
| `playgrounds/svelte`               | `@flareapp/playgrounds-svelte`       | SvelteKit (adapter-node) webshop (port 5183)                                                   |
| `playgrounds/react-router`         | `@flareapp/playgrounds-react-router` | React Router v7 (data mode) + `traceReactRouter` webshop (port 5185)                           |
| `e2e/`                             | (not a workspace)                    | Playwright specs + fake-flare-server fixture                                                   |

## Tech stack

- **Language:** TypeScript 5.7, target ES2022, strict mode
- **Build:** tsdown (outputs CJS + ESM + .d.ts declarations)
- **Test:** Vitest, per-package suites in `packages/<pkg>/tests/` (each package has its own `vitest.config.ts`)
- **Linting:** oxlint (per-package configs extending root `.oxlintrc.json`)
- **Formatting:** oxfmt (config in `.oxfmtrc.json`, replaces Prettier)
- **Git hooks:** Husky + lint-staged (pre-commit runs oxlint --fix + oxfmt)
- **Package manager:** npm workspaces

## Code style

### Code comments

- Code comments should be avoided at all cost, unless they genuinely add something useful that the code is not already explaining
- Code comments explain WHY, not what. The code already says what it does
- Code comments should be as short as possible. If you need a paragraph, the code probably needs the work instead

### Code formatting

- Formatting: oxfmt, config in `.oxfmtrc.json`
- Linting: oxlint, root config in `.oxlintrc.json`, per-package configs in `packages/<pkg>/.oxlintrc.json`
- If statements should always use brackets

### Code reusability

- Functions should be small and reusable
- If something has been duplicated more than 3 times, extract it into a utility function
- Code duplication must be kept at A MINIMUM and should only be done when it makes sense in the context of the feature.
- When there is an opportunity to create a shared utility for the code or the tests, YOU MUST DO SO.

## Commands (run from repo root)

```bash
npm run build              # Build all packages under packages/ (never the playgrounds)
npm run build:playgrounds  # Build the playground apps
npm run test               # Run vitest across workspaces (after build)
npm run typescript         # Type-check all packages
npm run format             # Run oxfmt on all files
npm run lint               # Run oxlint across all packages
npm run test:e2e           # Run Playwright suite across all 5 framework playgrounds
npm run playgrounds:js     # Boot the vanilla JS playground on http://localhost:5180
npm run playgrounds:react  # Boot the React playground on http://localhost:5181
npm run playgrounds:vue    # Boot the Vue playground on http://localhost:5182
npm run playgrounds:svelte # Boot the SvelteKit playground on http://localhost:5183
npm run playgrounds:react-router # Boot the React Router v7 playground on http://localhost:5185
```

Two of these bite if you run them without knowing what they do:

- `npm run format` runs `oxfmt .` over the whole repo, not your changes.
- `npm run test:e2e:engines` takes about twelve minutes, longer than a coding agent's shell allows for one
  command. You can run individual engines: `E2E_ENGINES=chromium npx playwright test`.

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
- `tracing/vitals/webVitals.ts` — Web Vitals collection and the `browser_page_vitals` span plan
- `tracing/vitals/webvitals/` — verbatim vendored `web-vitals` fork, excluded from lint and format

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

## E2E suite

Playwright config at `playwright.config.ts`, specs at `e2e/specs/*.spec.ts`. One project per framework, single
worker (the fake server has shared in-memory state), `webServer` boots each playground's `vite dev` automatically.

- `e2e/fake-flare-server/`: standalone node http server (no deps). Ingest paths mirror the real Flare ingress:
  `POST /v1/errors`, `POST /v1/traces`, `POST /v1/logs` (plus `POST /api/sourcemaps`) record the body. `GET
/__inspect/reports` and `POST /__inspect/reset` are the inspection API used by the test fixture. CORS open. Boots
  on `FAKE_FLARE_PORT` (default 7765 — avoid 4318, OrbStack squats on it).
- `e2e/global-setup.ts` / `global-teardown.ts`: boots/stops the fake server around the test run.
- `e2e/fixtures/fake-flare.ts`: Playwright fixture exposing `reset()`, `reports()`, `waitForReport({ predicate })`,
  `assertNoReports()`. Each test auto-resets the server before running.
- `e2e/specs/shared.ts`: data-driven `runScenario(page, fakeFlare, scenario)` helper used by all four spec files.
  Branches on `scenario.kind` (sync / async / unhandled / render / boundaryReset / manualReport / sveltekitServer).
- After `page.goto(...)`, specs call `page.waitForLoadState('networkidle')` to let SvelteKit (and others) finish
  hydrating before the click — otherwise the onclick handler isn't wired up yet and clicks no-op silently.

Run the whole thing: `npm run test:e2e`. One project: `npx playwright test --project=svelte`. One scenario:
`npx playwright test -g "sync-throw"`.
