# Playwright E2E Test Suite for Playground

## Summary

Full E2E test suite using Playwright that exercises all three playground pages (React, Vue, JS). Mocks the Flare ingest endpoint via route interception, validates report payloads at medium depth with selective deep checks for framework-specific context fields.

## Project setup

- **Dependency:** `@playwright/test` added as root devDependency.
- **Config:** `playwright.config.ts` at repo root.
- **Script:** `"test:e2e": "playwright test"` in root `package.json`.
- **Directory structure:**

```
playwright.config.ts
e2e/
  fixtures/
    flare-interceptor.ts
  react.spec.ts
  vue.spec.ts
  js.spec.ts
```

### Playwright config

- `webServer`: runs `npm run playground` (builds all packages, starts Vite dev server).
- `webServer.env`: dummy Flare API keys (`VITE_FLARE_JS_KEY`, `VITE_FLARE_REACT_KEY`, `VITE_FLARE_VUE_KEY`) so `flare.light()` initializes without warnings.
- `baseURL`: `http://localhost:5173`.
- `reuseExistingServer: true` so re-runs don't fail if dev server is already up.
- Single browser: Chromium only (not cross-browser compat tests).

## FlareInterceptor fixture

Custom Playwright fixture (`e2e/fixtures/flare-interceptor.ts`) that:

1. Intercepts all requests matching `**/ingress.flareapp.io/**` via `page.route()`.
2. Responds with HTTP 201 + empty JSON body.
3. Parses and collects request bodies into an internal array.
4. Registers a no-op `pageerror` handler (tests intentionally trigger uncaught errors).

### API

- `reports`: array of captured `Report` payloads (typed from `packages/js/src/types.ts`).
- `waitForReport(options?)`: returns a Promise resolving to the next intercepted report. Options: `timeout` (default 5s), `filter` predicate `(report) => boolean`.
- `clear()`: resets collected reports array.

### Usage pattern

```ts
test('render error sends report', async ({ page, flare }) => {
    await page.goto('/react/');
    const report = flare.waitForReport();
    await page.getByRole('button', { name: 'Trigger render error' }).click();
    const payload = await report;
    expect(payload.message).toContain('BuggyComponent');
});
```

`waitForReport()` is called before the click to avoid race conditions.

## Validation depth

- **Medium (all reports):** Validate structure has `stacktrace`, `message`, `events`, `attributes`, `seenAtUnixNano`.
- **Selective deep (framework-specific):**
  - React: `attributes['react.componentStack']` present for boundary-caught errors.
  - Vue: `vue.componentName`, `vue.errorOrigin`, `vue.componentHierarchy`, `vue.componentHierarchyFrames` in attributes. `vue.route` for route-aware tests. `vue.componentProps` for attachProps tests.
  - JS: no framework-specific fields.

## Test coverage

### React (`e2e/react.spec.ts`)

| Section | Assertions |
|---------|------------|
| RenderError | Fallback UI visible. Report has message containing "BuggyComponent". `react.componentStack` in attributes. "Try again" click resets boundary (fallback disappears). |
| ResetKeys | Error triggers fallback. Incrementing resetKey auto-resets boundary (success text visible). Report sent on initial error. |
| OnClick | Report sent with "onClick handler" in message. Page remains functional. |
| Async | Report sent with "Async error" in message. |
| ManualReport | Report sent with "Manually reported" in message. |

### Vue (`e2e/vue.spec.ts`)

| Section | Assertions |
|---------|------------|
| RenderError | Fallback renders. Report has `vue.componentName`, `vue.componentHierarchy`, `vue.errorOrigin`. |
| ResetKeys | Error then auto-reset via key increment. |
| OnClick | Report sent, `vue.errorOrigin` = `"event"`. |
| Lifecycle | Report sent, `vue.errorOrigin` = `"lifecycle"`. |
| Watcher | Report sent, `vue.errorOrigin` = `"watcher"`. |
| Async | Report sent (unhandled rejection). |
| NonErrorThrow | String thrown, report still sent with the string in message. |
| VueWarning | Report sent with `vue.type` = `"warning"`. |
| AttachProps | `vue.componentProps` present, nested objects serialized. |
| DenylistProps | Sensitive props (`password`, `apiKey`, `sessionId`, `pin`, `cvv`) redacted. |
| NestedBoundaries | One report only (inner boundary catches). |
| ManualReport | Three reports: `report()`, `reportMessage()`, `test()`. |
| Enrichment | Glows in `events`, custom context in `attributes`. |
| Hooks | `beforeEvaluate` suppress = no report. `beforeSubmit` mutate = modified field in report. |
| RouteContext | `vue.route.path`, `vue.route.params`, `vue.route.query` present. |
| RouteDenylist | Sensitive query params (`token`, `session_id`) redacted. |

### JS (`e2e/js.spec.ts`)

| Section | Assertions |
|---------|------------|
| TypeError | Report sent with TypeError in class or message. |
| Timeout | Report sent from setTimeout error. |
| CauseChain | Report sent with error cause info. |
| PromiseRejection | Report(s) sent for unhandled rejection. |
| ManualReport | Three reports: `report()`, `reportMessage()`, `test()`. |
| Enrichment | Glows in `events`, custom context in `attributes`. |
| Hooks | Suppress via `beforeEvaluate`, mutate via `beforeSubmit`. |
| RapidFire | Multiple reports sent (assert count > 0, not exact 50). |

## Error handling in tests

- Fixture registers a no-op `page.on('pageerror')` handler by default since tests intentionally throw uncaught errors.
- Individual tests can opt into strict mode if needed.
- Console assertions (`page.on('console')`) used selectively where console output is the only observable side effect (e.g. `onReset` callback).

## Test isolation

- Each test navigates fresh to the page URL.
- Each test gets a fresh `FlareInterceptor` via Playwright fixture scoping.
- No shared state between tests.

## Out of scope

- Cross-browser testing (Chromium only).
- Visual regression testing.
- Performance/load testing.
- Testing Vite sourcemap upload plugin behavior.
