# CLAUDE.md — flare-client-js

## What is this?

The official JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking by Spatie. Captures frontend errors, collects
browser context (cookies, request data, query params), and reports them to the Flare backend. Includes framework
integrations for React and Vue, and a Vite plugin for sourcemap uploads.

## Monorepo structure

npm workspaces monorepo with 4 packages:

| Package | npm name | Version | Purpose |
|---|---|---|---|
| `packages/js` | `@flareapp/js` | 1.1.0 | Core client — error capture, stack traces, context, API reporting |
| `packages/react` | `@flareapp/react` | 1.0.1 | React `FlareErrorBoundary` error boundary component |
| `packages/vue` | `@flareapp/vue` | 1.0.1 | Vue error handler plugin (`flareVue()`) |
| `packages/vite` | `@flareapp/vite` | 1.0.3 | Vite build plugin for sourcemap upload with retry logic |

## Tech stack

- **Language:** TypeScript 5.3, target ES2021, strict mode
- **Build:** tsup (outputs CJS + ESM + .d.ts declarations)
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

## Error reporting flow

1. Error caught by global listeners (`catchWindowErrors`) or framework integration (React boundary / Vue handler)
2. `Flare.report(error)` builds a Report: stack trace + browser context + glows (breadcrumbs) + solutions
3. `beforeEvaluate` / `beforeSubmit` hooks can filter or modify the report
4. `Api.report()` sends POST to Flare backend with API key in headers

## Code style

- Prettier: read from `.prettierrc`

## Publishing

- Update `version` in the package's `package.json`
- Run `npm publish` from the individual package directory

---

## Project 0: Repo modernization

Before building new features, clean up the repo to make it a solid foundation. Keep it simple — no over-engineering.

### Dependencies to update

- [ ] `typescript` ^5.3.3 → ^5.7 (all packages)
- [ ] `vitest` ^1.0.4 → ^3.x (packages/js)
- [ ] `husky` ^8.0.3 → ^9.x (root) — v9 has a much simpler setup, no more `.husky/_/husky.sh` sourcing
- [ ] `@types/react` ^18.2.47 → add ^19 support (packages/react has `react: ^19.0.0` as devDep but types are still v18)
- [ ] `@types/node` — consolidate: root has ^24.3.0, vite package still has ^18.11.17. Remove from vite, use root's.
- [ ] `@trivago/prettier-plugin-sort-imports` → `@ianvs/prettier-plugin-sort-imports` (the trivago version is less actively maintained, @ianvs is the maintained fork)

### Replace axios with native fetch in vite package

- [ ] `@flareapp/vite` uses `axios` + `https` module just for POSTing sourcemaps. Node 18+ has native `fetch`. The core `@flareapp/js` already uses `fetch`. Replace axios with fetch to drop 2 dependencies and keep the codebase consistent.

### Clean up tsconfig.json

- [ ] Remove all the commented-out boilerplate — keep only what's actually used
- [ ] Add `moduleResolution: "bundler"` (modern resolution, matches tsup/esbuild)
- [ ] Add `isolatedModules: true` (tsup uses esbuild which transpiles per-file, this catches issues early)
- [ ] Consider bumping target to `es2022` (adds `error.cause` support which we'll need)

### Package.json fixes

- [ ] Root: move `@trivago/prettier-plugin-sort-imports` from `dependencies` to `devDependencies` (it's a dev tool, not a runtime dep)
- [ ] All packages: add `types` condition to exports map for better TS resolution:
  ```json
  "exports": { ".": { "types": "./dist/index.d.ts", "require": "./dist/index.js", "import": "./dist/index.mjs" } }
  ```
- [ ] Add `engines` field to root package.json (`"node": ">=18"`) — documents minimum Node version
- [ ] Add `.nvmrc` or `.node-version` file for consistent dev environments
- [ ] Consider committing `package-lock.json` (currently gitignored) for reproducible installs

### Vue package: convert to TypeScript

- [ ] `packages/vue/src/index.js` is plain JavaScript — the only non-TS source in the monorepo
- [ ] Convert to `index.ts` with proper types for Vue's `App`, component instance, etc.
- [ ] Add a `typescript` script to vue's package.json (currently missing because it's JS)
- [ ] Update build script from `tsup src/index.js` to `tsup src/index.ts`

### CI improvements

- [ ] Pin Node.js version in GitHub Actions (`node-version: '22'` or use `.nvmrc`)
- [ ] Add npm dependency caching (`actions/setup-node` has `cache: 'npm'` option)
- [ ] Consolidate the two workflows (test.yml + typescript.yml) into one — they both run `npm install` + `npm run build` separately, wasteful
- [ ] Consider running on `push` to `main` + PRs only (currently runs on every push to every branch)

### Local dev/test app

- [ ] Add a simple test app inside the repo (e.g. `playground/` directory) that imports `@flareapp/js`, `@flareapp/react`, `@flareapp/vue` etc. from the local packages
- [ ] Should be a basic Vite app with a few buttons that trigger different error types (uncaught exception, unhandled promise rejection, console.error, manual report, etc.)
- [ ] Makes it easy to iterate without setting up an external project — just `npm run dev` in the playground and click around
- [ ] Wire it up as an npm workspace so it picks up local package changes automatically
- [ ] Add a `playground` script to root package.json for quick access
- [ ] Gitignore the playground's Flare API key (use `.env.local` or similar)
- [ ] Not published to npm — `"private": true`

### Housekeeping

- [ ] Add `.idea/` to `.gitignore` (currently showing as untracked in git status)

---

## Current mission

**Goal:** Make Flare's JavaScript error tracking good enough to stand on its own — not just an add-on for Laravel/PHP
users, but a worthy error tracker for JavaScript-only projects.

The frontend error monitoring is currently barebones. We need to identify gaps and ship improvements as a series of projects. Each project gets a release and an announcement post.

## Flare's existing strengths

- **Solution providers** — programmatic "here's how to fix this" suggestions
- **Tiny bundle** — ~3-5KB gzipped
- **Laravel/PHP ecosystem** — deep integration with the most popular PHP framework
- **Vite-first** — modern build tool support
- **Clean two-hook system** — `beforeEvaluate` (filter errors) + `beforeSubmit` (modify reports)

## Current gaps in Flare (detailed)

**Context collection** — only captures URL, user agent (raw string), referrer, readyState, cookies, query params. Missing: browser name/version, OS, device type, screen size, viewport, locale, timezone, online/offline status, memory, connection info.

**Breadcrumbs** — "glows" are manual only. No automatic capture of: console output, DOM clicks/inputs, navigation/history changes, XHR/fetch requests, network errors.

**Error handling** — uses `window.onerror =` / `window.onunhandledrejection =` assignment (can be overwritten by other scripts). Missing: `addEventListener` approach, console.error interception, timer/rAF wrapping, non-Error rejection handling (strings, numbers silently dropped).

**Networking** — single `fetch()` POST per error. No retry, no offline queue, no rate limiting, no batching, no `sendBeacon()` for unload, no request timeout.

**React** (`@flareapp/react`) — captures component stack string only. Missing: fallback UI (`getDerivedStateFromError`), component props, component name, onError/onReset callbacks, React Router integration, state management integration.

**Vue** (`@flareapp/vue`) — captures component name + info string. Missing: component props, Vue Router context, Pinia/Vuex state, component tree. Written in plain JS (no TypeScript).

**Config** — missing: `enabled` toggle, `sampleRate`, `ignoreErrors` patterns, `allowUrls`/`denyUrls`, `release` (for the user's app), transport customization.

---

## Roadmap: organized into projects

### Project 1: Core SDK hardening

Make `@flareapp/js` robust and feature-complete. This is the foundation everything else builds on.

- [ ] Switch from `window.onerror =` to `addEventListener('error')` / `addEventListener('unhandledrejection')` for robustness
- [ ] Automatic breadcrumbs: console output interception (`console.log/warn/error/info/debug`)
- [ ] Automatic breadcrumbs: DOM click tracking (element tag, CSS selector)
- [ ] Automatic breadcrumbs: Navigation / History API changes (`pushState`, `replaceState`, `popstate`)
- [ ] Automatic breadcrumbs: XHR and Fetch request tracking (method, URL, status, duration)
- [ ] User identification API: `flare.setUser({ id, name, email, ...custom })` with a `flare.clearUser()`
- [ ] Device/browser/OS context: parse user agent into structured data (browser name + version, OS name + version, device type)
- [ ] Screen/viewport context: `window.screen.width/height`, `window.innerWidth/innerHeight`
- [ ] Additional context: `navigator.language`, timezone, `navigator.onLine`
- [ ] Error cause chain traversal: follow `error.cause` to capture linked errors
- [ ] Handle non-Error promise rejections: wrap strings/numbers into a proper error instead of silently dropping them
- [ ] Client-side rate limiting: configurable max errors per minute to prevent error storms
- [ ] Sampling: `sampleRate` config option (0.0-1.0)
- [ ] Error deduplication: don't send the same error repeatedly within a short window
- [ ] Retry logic for report submission: retry with backoff on network failure
- [ ] `sendBeacon()` fallback for errors during page unload
- [ ] `ignoreErrors` config: array of strings/regexes to suppress known noise
- [ ] `allowUrls` / `denyUrls` config: filter errors by script URL
- [ ] `release` config: track the user's app version (separate from `sourcemapVersion`)
- [ ] `enabled` config toggle: easy on/off switch
- [ ] Release + announce

### Project 2: Enhanced React package

Make `@flareapp/react` a full-featured React error tracking integration.

- [ ] Fallback UI: implement `getDerivedStateFromError` so the boundary can render a fallback component
- [ ] Configurable fallback: `<FlareErrorBoundary fallback={<ErrorPage />}>` or render prop `fallback={(error, reset) => ...}`
- [ ] `onError` callback prop: let developers hook into error events
- [ ] `onReset` callback prop: for error recovery flows
- [ ] Capture component props from the error boundary's child tree
- [ ] Capture the erroring component's name (not just the stack)
- [ ] React Router integration: capture current route/path as context + navigation breadcrumbs
- [ ] Release + announce

### Project 3: Enhanced Vue package

Make `@flareapp/vue` a full-featured Vue error tracking integration.

- [ ] Rewrite in TypeScript (currently plain JS)
- [ ] Capture component props (configurable: `attachProps: true/false`)
- [ ] Capture full component name including parent hierarchy
- [ ] Vue Router integration: capture current route as context + navigation breadcrumbs
- [ ] Pinia/Vuex store state capture (opt-in)
- [ ] Release + announce

### Project 4: Svelte package (new `@flareapp/svelte`)

New framework integration — Svelte/SvelteKit is increasingly popular.

- [ ] Create `@flareapp/svelte` package in the monorepo
- [ ] Svelte error boundary component (or `handleError` hook)
- [ ] Capture component context (name, props)
- [ ] SvelteKit integration: `handleError` server/client hooks
- [ ] SvelteKit routing context as breadcrumbs
- [ ] Release + announce

### Project 5: Sourcemap support for more build tools

Currently Vite-only. Webpack and Turbopack are heavily used.

- [ ] Extract shared sourcemap upload core from `@flareapp/vite` (API client, upload logic, retry)
- [ ] `@flareapp/webpack` plugin: Webpack 4/5 sourcemap upload
- [ ] `@flareapp/turbopack` plugin: Turbopack (Next.js) sourcemap upload
- [ ] Consider: Rollup plugin, esbuild plugin (lower priority — Vite covers Rollup users)
- [ ] Release + announce

### Project 6: Node.js and other environments

Verify and ensure Flare works beyond the browser.

- [ ] Node.js: add `process.on('uncaughtException')` / `process.on('unhandledRejection')` handlers
- [ ] Node.js: add filesystem-based source code reader (fs.readFileSync) alongside the fetch-based browser reader
- [ ] Node.js: server context collection (hostname, process info, Node version)
- [ ] Electron: verify it works in both main and renderer processes, document setup
- [ ] React Native: verify it works, document setup, handle native crash edge cases
- [ ] Write environment-specific setup instructions for each
- [ ] Release + announce

### Project 7: Documentation overhaul

- [ ] Update frontend docs on flareapp.io
- [ ] Split "JavaScript" docs into separate sections: React, Vue, Svelte, JavaScript, Node.js
- [ ] Review existing docs for clarity & completeness
- [ ] Update spatie/flare-client-js internal docs (monorepo workflow, tagging versions, local dev setup)
- [ ] Release + announce

### Project 8: Internal tooling & DX

- [ ] Create a playground repo to test JavaScript integrations (with automated testing — internal tooling, not a public release)
- [ ] Evaluate build tools: keep tsup or migrate (tsup is working well, this may not be needed)

---

## Future considerations (not yet planned as projects)

- **Session replay** — would be a major undertaking
- **Performance monitoring / Web Vitals** — could be a lightweight add-on
- **Distributed tracing** — connecting frontend errors to backend spans
- **Feature flag integration** — linking errors to active feature flags
- **Tunnel / ad blocker bypass** — proxy events through the user's own server
- **Plugin/integration architecture** — modular, tree-shakeable, extensible system (would require significant refactoring)
- **Offline event queuing** — persist unsent events in localStorage/IndexedDB
- **Rage/dead click detection** — user frustration signals without explicit errors
