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

## Current mission

**Goal:** Make Flare's JavaScript error tracking good enough to stand on its own — not just an add-on for Laravel/PHP
users, but a worthy error tracker for JavaScript-only projects.

The frontend error monitoring is currently barebones. We need to research competitors (Sentry, PostHog, etc.), identify
gaps, and ship improvements as a series of projects. Each project gets a release and an announcement post.

## Research & discovery

- [x] Research Sentry — features, DX, SDK capabilities, what they do well
- [x] Research PostHog — error tracking features, session replay, context collection
- [x] Research other competitors (Bugsnag, Rollbar, LogRocket, Datadog RUM, New Relic, Raygun, Highlight.io)
- [x] Audit current Flare JS client capabilities in detail
- [x] Compile findings: what are we missing? What's table stakes vs. differentiators?
- [x] Organize findings + idea list into concrete projects with priorities

## Competitive research findings

### What every competitor has (table stakes we're missing)

| Feature | Sentry | Bugsnag | Rollbar | Flare |
|---|---|---|---|---|
| **Automatic breadcrumbs** (console, clicks, navigation, network) | Yes | Yes (best-in-class) | Yes ("telemetry") | Manual "glows" only |
| **User identification API** (`setUser()`) | Yes | Yes | Yes | None |
| **Device/browser/OS context** (parsed from UA) | Yes | Yes | Yes | Raw UA string only |
| **Sampling / rate limiting** | Yes | Yes | Yes (`itemsPerMinute`) | None |
| **addEventListener** (robust error capture) | Yes | Yes | Yes | Fragile `window.onerror =` assignment |
| **Error deduplication** | Yes | Yes | Yes | None |
| **Release/version tracking** | Yes | Yes | Yes | Only `sourcemapVersion` for sourcemaps |
| **ignoreErrors / URL filtering** | Yes | Yes | Yes | Must implement manually in hooks |
| **Error cause chaining** (`error.cause`) | Yes | Yes | No | None |
| **Retry logic** for report submission | Yes | Yes | Yes | None (single fetch, lost on failure) |
| **React Error Boundary with fallback UI** | Yes | Yes | Yes | No fallback, no getDerivedStateFromError |
| **Multiple sourcemap upload tools** | Vite/Webpack/Rollup/esbuild/CLI | CLI + Webpack | CLI + Webpack | Vite only |

### What differentiates the leaders

| Feature | Leader | Notes |
|---|---|---|
| Session replay linked to errors | LogRocket, Sentry, PostHog | Watch what user did before crash |
| Backend trace correlation | Datadog, New Relic | Link frontend error to backend span |
| Stability/crash-free scores | Bugsnag | Session-based release health tracking |
| Feature flag context | Bugsnag, PostHog, Datadog | Which flag variant caused the regression? |
| State management integration | LogRocket | Redux/Vuex snapshots at time of error |
| Rage/dead click detection | LogRocket, Datadog | User frustration signals |
| Performance monitoring / Web Vitals | Sentry, Datadog, New Relic | Tracing + Core Web Vitals |
| `guess_uncaught_frames` | Rollbar | Reconstruct missing stack frames heuristically |
| Plugin/integration architecture | Sentry, Bugsnag | Tree-shakeable, modular, extensible |
| Tunnel / ad blocker bypass | Sentry | Proxy events through your own server |

### Flare's existing unique strengths

- **Solution providers** — no competitor has programmatic "here's how to fix this" suggestions
- **Tiny bundle** — ~3-5KB gzipped vs Sentry's ~22KB+ core
- **Laravel/PHP ecosystem** — deep integration with the most popular PHP framework
- **Vite-first** — modern build tool support (most competitors still lead with Webpack)
- **Clean two-hook system** — `beforeEvaluate` (filter errors) + `beforeSubmit` (modify reports)

### Current gaps in Flare (detailed)

**Context collection** — only captures URL, user agent (raw string), referrer, readyState, cookies, query params. Missing: browser name/version, OS, device type, screen size, viewport, locale, timezone, online/offline status, memory, connection info.

**Breadcrumbs** — "glows" are manual only. No automatic capture of: console output, DOM clicks/inputs, navigation/history changes, XHR/fetch requests, network errors.

**Error handling** — uses `window.onerror =` / `window.onunhandledrejection =` assignment (can be overwritten by other scripts). Missing: `addEventListener` approach, console.error interception, timer/rAF wrapping, non-Error rejection handling (strings, numbers silently dropped).

**Networking** — single `fetch()` POST per error. No retry, no offline queue, no rate limiting, no batching, no `sendBeacon()` for unload, no request timeout.

**React** (`@flareapp/react`) — captures component stack string only. Missing: fallback UI (`getDerivedStateFromError`), component props, component name, onError/onReset callbacks, React Router integration, Redux/Zustand state.

**Vue** (`@flareapp/vue`) — captures component name + info string. Missing: component props, Vue Router context, Pinia/Vuex state, component tree. Written in plain JS (no TypeScript).

**Config** — missing: `enabled` toggle, `sampleRate`, `ignoreErrors` patterns, `allowUrls`/`denyUrls`, `release` (for the user's app), transport customization.

---

## Roadmap: organized into projects

### Project 1: Core SDK hardening (table stakes)

Make `@flareapp/js` robust and feature-complete with what every competitor ships. This is the foundation everything else builds on.

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

Make `@flareapp/react` competitive with Sentry's React integration.

- [ ] Fallback UI: implement `getDerivedStateFromError` so the boundary can render a fallback component
- [ ] Configurable fallback: `<FlareErrorBoundary fallback={<ErrorPage />}>` or render prop `fallback={(error, reset) => ...}`
- [ ] `onError` callback prop: let developers hook into error events
- [ ] `onReset` callback prop: for error recovery flows
- [ ] Capture component props from the error boundary's child tree
- [ ] Capture the erroring component's name (not just the stack)
- [ ] React Router integration: capture current route/path as context + navigation breadcrumbs
- [ ] Release + announce

### Project 3: Enhanced Vue package

Make `@flareapp/vue` competitive with Sentry's Vue integration.

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

These are features the leading competitors have but that may be out of scope for now:

- **Session replay** — would be a major undertaking (PostHog, Sentry, LogRocket all have this)
- **Performance monitoring / Web Vitals** — could be a lightweight add-on
- **Distributed tracing** — connecting frontend errors to backend spans (Datadog/New Relic territory)
- **Feature flag integration** — linking errors to active feature flags
- **Tunnel / ad blocker bypass** — proxy events through the user's own server
- **Plugin/integration architecture** — modular system like Sentry's integrations (would require significant refactoring)
- **Offline event queuing** — persist unsent events in localStorage/IndexedDB
- **Rage/dead click detection** — user frustration signals without explicit errors
