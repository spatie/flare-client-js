# Playwright E2E Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full E2E test suite that exercises all three playground pages (React, Vue, JS), mocks Flare's ingest endpoint via Playwright route interception, and validates report payloads.

**Architecture:** Playwright `webServer` starts the playground Vite dev server. A custom `FlareInterceptor` fixture intercepts all `fetch` calls to `ingress.flareapp.io`, responds with 201, and collects parsed report payloads. Three spec files (`react.spec.ts`, `vue.spec.ts`, `js.spec.ts`) exercise every section in every playground page.

**Tech Stack:** `@playwright/test`, Chromium only, TypeScript

---

## File Structure

| File | Purpose |
|------|---------|
| Create: `playwright.config.ts` | Playwright config with webServer, baseURL, Chromium-only |
| Create: `e2e/fixtures/flare-interceptor.ts` | Custom fixture: route interception, report collection, `waitForReport()` |
| Create: `e2e/react.spec.ts` | Tests for all 5 React playground sections |
| Create: `e2e/vue.spec.ts` | Tests for all 16 Vue playground sections |
| Create: `e2e/js.spec.ts` | Tests for all 8 JS playground sections |
| Modify: `package.json` | Add `test:e2e` script |
| Modify: `.gitignore` | Add Playwright artifacts |

---

### Task 1: Install Playwright and configure

**Files:**
- Modify: `package.json` (root)
- Create: `playwright.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install Playwright as root devDependency**

```bash
npm install --save-dev @playwright/test
```

- [ ] **Step 2: Install Chromium browser**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Add `test:e2e` script to root `package.json`**

Add to `"scripts"`:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:5173',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
    webServer: {
        command: 'npm run playground',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        env: {
            VITE_FLARE_JS_KEY: 'test-key-js',
            VITE_FLARE_REACT_KEY: 'test-key-react',
            VITE_FLARE_VUE_KEY: 'test-key-vue',
        },
    },
});
```

- [ ] **Step 5: Add Playwright artifacts to `.gitignore`**

Append:
```
# Playwright
test-results/
playwright-report/
```

- [ ] **Step 6: Verify config loads**

```bash
npx playwright test --list
```

Expected: `no tests found` (no spec files yet), exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json playwright.config.ts .gitignore
git commit -m "chore: add Playwright E2E infrastructure"
```

---

### Task 2: Create FlareInterceptor fixture

**Files:**
- Create: `e2e/fixtures/flare-interceptor.ts`

- [ ] **Step 1: Create `e2e/fixtures/` directory**

```bash
mkdir -p e2e/fixtures
```

- [ ] **Step 2: Create `e2e/fixtures/flare-interceptor.ts`**

```ts
import { test as base, type Page } from '@playwright/test';

type Report = {
    exceptionClass?: string | null;
    message?: string | null;
    seenAtUnixNano: number;
    stacktrace: unknown[];
    events: unknown[];
    attributes: Record<string, unknown>;
    isLog?: boolean;
    level?: string;
    context?: Record<string, unknown>;
    [key: string]: unknown;
};

type WaitForReportOptions = {
    timeout?: number;
    filter?: (report: Report) => boolean;
};

class FlareInterceptor {
    reports: Report[] = [];
    private listeners: Array<(report: Report) => void> = [];

    push(report: Report) {
        this.reports.push(report);
        const pending = this.listeners.slice();
        this.listeners = [];
        for (const cb of pending) cb(report);
    }

    waitForReport(options: WaitForReportOptions = {}): Promise<Report> {
        const { timeout = 5000, filter } = options;

        const match = filter ? this.reports.find(filter) : undefined;
        if (match) return Promise.resolve(match);

        return new Promise<Report>((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.listeners.indexOf(handler);
                if (idx !== -1) this.listeners.splice(idx, 1);
                reject(new Error(`waitForReport timed out after ${timeout}ms (${this.reports.length} reports captured)`));
            }, timeout);

            const handler = (report: Report) => {
                if (filter && !filter(report)) {
                    this.listeners.push(handler);
                    return;
                }
                clearTimeout(timer);
                resolve(report);
            };

            this.listeners.push(handler);
        });
    }

    clear() {
        this.reports = [];
        this.listeners = [];
    }
}

async function setupInterceptor(page: Page): Promise<FlareInterceptor> {
    const interceptor = new FlareInterceptor();

    await page.route('**/ingress.flareapp.io/**', async (route) => {
        const request = route.request();
        const body = request.postDataJSON();
        if (body) interceptor.push(body as Report);
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    page.on('pageerror', () => {});

    return interceptor;
}

export const test = base.extend<{ flare: FlareInterceptor }>({
    flare: async ({ page }, use) => {
        const interceptor = await setupInterceptor(page);
        await use(interceptor);
    },
});

export { expect } from '@playwright/test';
export type { Report };
```

- [ ] **Step 3: Verify file compiles**

```bash
npx playwright test --list
```

Expected: `no tests found`, exits 0, no TS compilation errors.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/flare-interceptor.ts
git commit -m "feat: add FlareInterceptor Playwright fixture"
```

---

### Task 3: React E2E tests

**Files:**
- Create: `e2e/react.spec.ts`

**Reference files (read-only, for button labels and error messages):**
- `playground/react/sections/RenderErrorSection.tsx` — button: "Trigger render error", fallback text: "Something went wrong:", reset button: "Try again"
- `playground/react/sections/ResetKeysSection.tsx` — button: "Trigger error", reset button: "Increment resetKey (auto-reset)", success text: "ConditionallyBuggyComponent rendered successfully!"
- `playground/react/sections/OnClickErrorSection.tsx` — button: "Throw in onClick", error message: "Error in React onClick handler"
- `playground/react/sections/AsyncErrorSection.tsx` — button: "Async error in useEffect", error message: "Async error in React useEffect"
- `playground/react/sections/ManualReportSection.tsx` — button: "flare.report() from component", error message: "Manually reported from React"
- `playground/react/components/BuggyComponent.tsx` — throws "BuggyComponent render error"

- [ ] **Step 1: Create `e2e/react.spec.ts`**

```ts
import { test, expect, type Report } from './fixtures/flare-interceptor';

test.describe('React playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/react/');
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report is sent with componentStack', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            expect(report.message).toContain('BuggyComponent render error');
            expect(report.stacktrace.length).toBeGreaterThan(0);
            expect(report.seenAtUnixNano).toBeGreaterThan(0);

            const custom = report.attributes['context.custom'] as Record<string, unknown>;
            expect(custom).toBeDefined();
            expect(custom.react).toBeDefined();
            const react = custom.react as Record<string, unknown>;
            expect(react.componentStack).toBeDefined();
            expect(Array.isArray(react.componentStack)).toBe(true);
        });

        test('onReset clears fallback', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();
            await page.getByRole('button', { name: 'Try again' }).click();
            await expect(page.getByText('Something went wrong:')).not.toBeVisible();
        });
    });

    test.describe('ResetKeys section', () => {
        test('resetKeys auto-resets boundary after error', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('ConditionallyBuggyComponent') ?? false,
            });

            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            await expect(
                page.getByText('Boundary caught: ConditionallyBuggyComponent render error')
            ).toBeVisible();

            await page.getByRole('button', { name: 'Increment resetKey (auto-reset)' }).click();

            await expect(
                page.getByText('ConditionallyBuggyComponent rendered successfully!')
            ).toBeVisible();
        });
    });

    test.describe('OnClick section', () => {
        test('onClick error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('onClick handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in onClick' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Error in React onClick handler');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error') ?? false,
            });
            await page.getByRole('button', { name: 'Async error in useEffect' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in React useEffect');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('ManualReport section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from React');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });
});
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/react.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/react.spec.ts
git commit -m "test: add React E2E tests"
```

---

### Task 4: Vue E2E tests — error boundary and error origins

**Files:**
- Create: `e2e/vue.spec.ts`

**Reference files (read-only):**
- `playground/vue/Home.vue` — renders all sections
- `playground/vue/sections/RenderErrorSection.vue` — button: "Trigger render error", fallback: "Something went wrong:", reset: "Try again", error: "BuggyComponent render error in Vue"
- `playground/vue/sections/ResetKeysSection.vue` — button: "Trigger error", reset: "Increment reset key (counter: N)", fallback text: "Error caught:"
- `playground/vue/sections/OnClickErrorSection.vue` — button: "Throw in @click", error: "Error in Vue @click handler"
- `playground/vue/sections/LifecycleErrorSection.vue` — button: "Error in onMounted (origin: lifecycle)", error: "Error thrown in onMounted lifecycle hook"
- `playground/vue/sections/WatcherErrorSection.vue` — button: "Error in watch callback (origin: watcher)", error: "Sync throw inside watch callback"
- `playground/vue/sections/AsyncErrorSection.vue` — button: "Async error in watch", error: "Async error in Vue watch"

- [ ] **Step 1: Create `e2e/vue.spec.ts` with error boundary and error origin tests**

```ts
import { test, expect, type Report } from './fixtures/flare-interceptor';

function vueContext(report: Report) {
    const custom = report.attributes['context.custom'] as Record<string, unknown> | undefined;
    return custom?.vue as Record<string, unknown> | undefined;
}

test.describe('Vue playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/vue/');
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report has vue context', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error in Vue') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.componentName).toBeDefined();
            expect(vue!.errorOrigin).toBeDefined();
            expect(vue!.componentHierarchy).toBeDefined();
            expect(Array.isArray(vue!.componentHierarchy)).toBe(true);
            expect(vue!.componentHierarchyFrames).toBeDefined();
            expect(Array.isArray(vue!.componentHierarchyFrames)).toBe(true);
        });

        test('reset clears fallback', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error in Vue') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();
            await page.getByRole('button', { name: 'Try again' }).click();
            await expect(page.getByText('Something went wrong:')).not.toBeVisible();
        });
    });

    test.describe('ResetKeys section', () => {
        test('auto-resets boundary when resetKey changes', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('ConditionallyBuggyComponent') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            await expect(page.getByText('Error caught:')).toBeVisible();

            await page.getByRole('button', { name: /Increment reset key/ }).click();
            await expect(page.getByText('Error caught:')).not.toBeVisible();
        });
    });

    test.describe('OnClick section', () => {
        test('report sent with errorOrigin event', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Vue @click handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in @click' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('event');
        });
    });

    test.describe('Lifecycle section', () => {
        test('report sent with errorOrigin lifecycle', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('onMounted') ?? false,
            });
            await page.getByRole('button', { name: 'Error in onMounted (origin: lifecycle)' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('lifecycle');
        });
    });

    test.describe('Watcher section', () => {
        test('report sent with errorOrigin watcher', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('watch callback') ?? false,
            });
            await page.getByRole('button', { name: 'Error in watch callback (origin: watcher)' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('watcher');
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error in Vue watch') ?? false,
            });
            await page.getByRole('button', { name: 'Async error in watch' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in Vue watch');
        });
    });
});
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/vue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/vue.spec.ts
git commit -m "test: add Vue E2E tests — boundaries and error origins"
```

---

### Task 5: Vue E2E tests — edge cases (non-error throw, warnings, props, nested boundaries)

**Files:**
- Modify: `e2e/vue.spec.ts`

**Reference files (read-only):**
- `playground/vue/sections/NonErrorThrowSection.vue` — button: "Throw non-Error value", thrown string: "plain string thrown from Vue @click (not an Error instance)"
- `playground/vue/sections/VueWarningSection.vue` — button: "Trigger Vue warning"
- `playground/vue/sections/AttachPropsSection.vue` — button: "Trigger attachProps demo", error: "attachProps demo error"
- `playground/vue/sections/DenylistPropsSection.vue` — button: "Trigger default denylist demo", error: "DenylistPropsDemo threw", sensitive: password, authToken, apiKey, sessionId, pin, cvv
- `playground/vue/sections/NestedBoundariesSection.vue` — button: "Trigger nested boundaries", inner fallback: "Inner boundary caught:", outer fallback (should NOT appear): "OUTER boundary rendered"

- [ ] **Step 1: Add edge case tests to `e2e/vue.spec.ts`**

Append inside the `'Vue playground'` describe block:

```ts
    test.describe('NonErrorThrow section', () => {
        test('string throw is converted and reported', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('plain string thrown') ?? false,
            });
            await page.getByRole('button', { name: 'Throw non-Error value' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('plain string thrown from Vue @click');
        });
    });

    test.describe('VueWarning section', () => {
        test('vue warning sends report with type warning', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => {
                    const custom = r.attributes['context.custom'] as Record<string, unknown> | undefined;
                    const vue = custom?.vue as Record<string, unknown> | undefined;
                    return vue?.type === 'warning';
                },
            });
            await page.getByRole('button', { name: 'Trigger Vue warning' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.type).toBe('warning');
        });
    });

    test.describe('AttachProps section', () => {
        test('report includes serialized componentProps', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('attachProps demo error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger attachProps demo' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.componentProps).toBeDefined();
            const props = vue!.componentProps as Record<string, unknown>;
            const config = props.config as Record<string, unknown>;
            expect(config.theme).toBe('dark');
        });
    });

    test.describe('DenylistProps section', () => {
        test('sensitive props are redacted', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('DenylistPropsDemo threw') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger default denylist demo' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            const props = vue!.componentProps as Record<string, unknown>;
            expect(props.username).toBe('alice');
            expect(props.password).toBe('[redacted]');
            expect(props.authToken).toBe('[redacted]');
            expect(props.apiKey).toBe('[redacted]');
            expect(props.sessionId).toBe('[redacted]');
            const config = props.config as Record<string, unknown>;
            expect(config.pin).toBe('[redacted]');
            expect(config.cvv).toBe('[redacted]');
            expect(config.theme).toBe('dark');
            expect(config.regular).toBe('visible');
        });
    });

    test.describe('NestedBoundaries section', () => {
        test('only inner boundary catches, one report sent', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('nested boundary test') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger nested boundaries' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Inner boundary caught:')).toBeVisible();
            await expect(page.getByText('OUTER boundary rendered')).not.toBeVisible();

            expect(report.message).toContain('Error thrown inside nested boundary test');

            // Wait briefly then verify no second report arrived
            await page.waitForTimeout(500);
            const nestedReports = flare.reports.filter(
                (r) => r.message?.includes('nested boundary test') ?? false
            );
            expect(nestedReports).toHaveLength(1);
        });
    });
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/vue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/vue.spec.ts
git commit -m "test: add Vue E2E tests — edge cases (non-error, warnings, props, nested)"
```

---

### Task 6: Vue E2E tests — manual reporting, enrichment, hooks

**Files:**
- Modify: `e2e/vue.spec.ts`

**Reference files (read-only):**
- `playground/vue/sections/ManualReportingSection.vue` — buttons: "flare.report() from component", "flare.reportMessage()", "flare.test()"
- `playground/vue/sections/EnrichmentSection.vue` — buttons: "Error with glows", "Error with custom context"
- `playground/vue/sections/HooksSection.vue` — buttons: "beforeEvaluate (suppress)", "beforeSubmit (modify)"

- [ ] **Step 1: Add manual reporting, enrichment, and hooks tests**

Append inside the `'Vue playground'` describe block:

```ts
    test.describe('ManualReporting section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported from Vue') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from Vue');
        });

        test('flare.reportMessage() sends log report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.isLog === true,
            });
            await page.getByRole('button', { name: 'flare.reportMessage()' }).click();
            const report = await reportPromise;

            expect(report.isLog).toBe(true);
            expect(report.message).toContain('manually reported message from Vue');
        });

        test('flare.test() sends synthetic report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Flare client is set up correctly') ?? false,
            });
            await page.getByRole('button', { name: 'flare.test()' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Flare client is set up correctly');
        });
    });

    test.describe('Enrichment section', () => {
        test('glows are included as events', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Payment processing failed') ?? false,
            });
            await page.getByRole('button', { name: 'Error with glows' }).click();
            const report = await reportPromise;

            expect(report.events.length).toBeGreaterThanOrEqual(3);
        });

        test('custom context is included in attributes', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error with custom context attached') ?? false,
            });
            await page.getByRole('button', { name: 'Error with custom context' }).click();
            const report = await reportPromise;

            const custom = report.attributes['context.custom'] as Record<string, unknown>;
            expect(custom).toBeDefined();
            expect(custom.user_id).toBe('usr_12345');
            expect(custom.plan).toBe('pro');

            const flags = report.attributes['context.feature_flags'] as Record<string, unknown>;
            expect(flags).toBeDefined();
            expect(flags.new_checkout).toBe(true);
            expect(flags.dark_mode).toBe(false);
        });
    });

    test.describe('Hooks section', () => {
        test('beforeEvaluate suppresses report', async ({ page, flare }) => {
            const initialCount = flare.reports.length;

            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('Error was suppressed by beforeEvaluate'),
            });
            await page.getByRole('button', { name: 'beforeEvaluate (suppress)' }).click();
            await consolePromise;

            // Wait briefly to ensure no report arrives
            await page.waitForTimeout(500);
            expect(flare.reports.length).toBe(initialCount);
        });

        test('beforeSubmit mutates report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error modified by beforeSubmit') ?? false,
            });
            await page.getByRole('button', { name: 'beforeSubmit (modify)' }).click();
            const report = await reportPromise;

            const context = report.context as Record<string, unknown> | undefined;
            expect(context).toBeDefined();
            const hook = context!.custom_hook as Record<string, unknown>;
            expect(hook).toBeDefined();
            expect(hook.injected_by).toBe('beforeSubmit hook');
            expect(hook.timestamp).toBeGreaterThan(0);
        });
    });
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/vue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/vue.spec.ts
git commit -m "test: add Vue E2E tests — manual reporting, enrichment, hooks"
```

---

### Task 7: Vue E2E tests — route context and route denylist

**Files:**
- Modify: `e2e/vue.spec.ts`

**Reference files (read-only):**
- `playground/vue/router.ts` — routes: `/` (home), `/users/:id` (user-profile)
- `playground/vue/App.vue` — nav links: "User 42" (to="/users/42?tab=settings"), "User 77 (denylisted query)" (to="/users/77?token=sk_secret_123&session_id=sess_abc&tab=public&tag=a&tag=b")
- `playground/vue/sections/RouteContextSection.vue` — buttons: "Throw error on this route", "flare.report() on this route"
- `playground/vue/sections/RouteDenylistSection.vue` — button: "Route denylist demo (log context.vue.route)"

- [ ] **Step 1: Add route context tests**

These tests navigate to user profile pages (different from Home), so they need their own `beforeEach`. Add as a separate describe block at the same level as `'Vue playground'`:

```ts
test.describe('Vue route context', () => {
    test('report includes route path, params, and query', async ({ page, flare }) => {
        await page.goto('/vue/');
        await page.getByRole('link', { name: 'User 42' }).click();
        await page.waitForURL('**/users/42**');

        const reportPromise = flare.waitForReport({
            filter: (r) => r.message?.includes('Error on user profile') ?? false,
        });
        await page.getByRole('button', { name: 'Throw error on this route' }).click();
        const report = await reportPromise;

        const vue = vueContext(report);
        expect(vue).toBeDefined();
        const route = vue!.route as Record<string, unknown>;
        expect(route).toBeDefined();
        expect(route.path).toBe('/users/42');
        expect((route.params as Record<string, unknown>).id).toBe('42');
        expect((route.query as Record<string, unknown>).tab).toBe('settings');
    });
});

test.describe('Vue route denylist', () => {
    test('sensitive query params are redacted', async ({ page, flare }) => {
        await page.goto('/vue/');
        await page.getByRole('link', { name: 'User 77 (denylisted query)' }).click();
        await page.waitForURL('**/users/77**');

        const reportPromise = flare.waitForReport({
            filter: (r) => r.message?.includes('Route denylist demo error') ?? false,
        });
        await page.getByRole('button', { name: /Route denylist demo/ }).click();
        const report = await reportPromise;

        const vue = vueContext(report);
        expect(vue).toBeDefined();
        const route = vue!.route as Record<string, unknown>;
        expect(route).toBeDefined();
        const query = route.query as Record<string, unknown>;
        expect(query.token).toBe('[redacted]');
        expect(query.session_id).toBe('[redacted]');
        expect(query.tab).toBe('public');
    });
});
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/vue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/vue.spec.ts
git commit -m "test: add Vue E2E tests — route context and denylist"
```

---

### Task 8: JS E2E tests

**Files:**
- Create: `e2e/js.spec.ts`

**Reference files (read-only):**
- `playground/js/sections/TypeErrorSection.ts` — button: "TypeError (null access)"
- `playground/js/sections/TimeoutErrorSection.ts` — button: "Throw error in setTimeout"
- `playground/js/sections/CauseChainSection.ts` — button: "Error with cause chain"
- `playground/js/sections/PromiseRejectionSection.ts` — buttons: "Reject with Error", "Reject with string"
- `playground/js/sections/ManualReportingSection.ts` — buttons: "flare.report(error)", "flare.reportMessage()", "flare.test()"
- `playground/js/sections/EnrichmentSection.ts` — buttons: "Error with glows", "Error with custom context"
- `playground/js/sections/HooksSection.ts` — buttons: "beforeEvaluate (suppress)", "beforeSubmit (modify)"
- `playground/js/sections/RapidFireSection.ts` — button: "Rapid-fire 50 errors"

- [ ] **Step 1: Create `e2e/js.spec.ts`**

```ts
import { test, expect } from './fixtures/flare-interceptor';

test.describe('JS playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/js/');
    });

    test.describe('TypeError section', () => {
        test('TypeError sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) =>
                    r.exceptionClass === 'TypeError' || (r.message?.includes('null') ?? false),
            });
            await page.getByRole('button', { name: 'TypeError (null access)' }).click();
            const report = await reportPromise;

            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('Timeout section', () => {
        test('setTimeout error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Throw error in setTimeout' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('CauseChain section', () => {
        test('error with cause sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('cause') ?? r.message?.includes('Outer') ?? false,
            });
            await page.getByRole('button', { name: 'Error with cause chain' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('PromiseRejection section', () => {
        test('promise rejection with Error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Reject with Error' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });

        test('promise rejection with string sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('string') ?? false,
            });
            await page.getByRole('button', { name: 'Reject with string' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
        });
    });

    test.describe('ManualReporting section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report(error)' }).click();
            const report = await reportPromise;

            expect(report.stacktrace.length).toBeGreaterThan(0);
        });

        test('flare.reportMessage() sends log report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.isLog === true,
            });
            await page.getByRole('button', { name: 'flare.reportMessage()' }).click();
            const report = await reportPromise;

            expect(report.isLog).toBe(true);
        });

        test('flare.test() sends synthetic report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Flare client is set up correctly') ?? false,
            });
            await page.getByRole('button', { name: 'flare.test()' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Flare client is set up correctly');
        });
    });

    test.describe('Enrichment section', () => {
        test('glows are included as events', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Payment processing failed') ?? false,
            });
            await page.getByRole('button', { name: 'Error with glows' }).click();
            const report = await reportPromise;

            expect(report.events.length).toBeGreaterThanOrEqual(3);
        });

        test('custom context in attributes', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error with custom context attached') ?? false,
            });
            await page.getByRole('button', { name: 'Error with custom context' }).click();
            const report = await reportPromise;

            const custom = report.attributes['context.custom'] as Record<string, unknown>;
            expect(custom).toBeDefined();
            expect(custom.user_id).toBe('usr_12345');
            expect(custom.plan).toBe('pro');

            const flags = report.attributes['context.feature_flags'] as Record<string, unknown>;
            expect(flags).toBeDefined();
            expect(flags.new_checkout).toBe(true);
            expect(flags.dark_mode).toBe(false);
        });
    });

    test.describe('Hooks section', () => {
        test('beforeEvaluate suppresses report', async ({ page, flare }) => {
            const initialCount = flare.reports.length;

            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('Error was suppressed by beforeEvaluate'),
            });
            await page.getByRole('button', { name: 'beforeEvaluate (suppress)' }).click();
            await consolePromise;

            await page.waitForTimeout(500);
            expect(flare.reports.length).toBe(initialCount);
        });

        test('beforeSubmit mutates report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error modified by beforeSubmit') ?? false,
            });
            await page.getByRole('button', { name: 'beforeSubmit (modify)' }).click();
            const report = await reportPromise;

            const context = report.context as Record<string, unknown> | undefined;
            expect(context).toBeDefined();
            const hook = context!.custom_hook as Record<string, unknown>;
            expect(hook).toBeDefined();
            expect(hook.injected_by).toBe('beforeSubmit hook');
        });
    });

    test.describe('RapidFire section', () => {
        test('multiple reports sent from rapid-fire errors', async ({ page, flare }) => {
            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('All 50 errors submitted'),
                timeout: 10_000,
            });
            await page.getByRole('button', { name: 'Rapid-fire 50 errors' }).click();
            await consolePromise;

            // Wait for network to settle
            await page.waitForTimeout(1000);
            expect(flare.reports.length).toBeGreaterThan(0);
        });
    });
});
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test e2e/js.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Fix any failures and re-run until green**

- [ ] **Step 4: Commit**

```bash
git add e2e/js.spec.ts
git commit -m "test: add JS E2E tests"
```

---

### Task 9: Full suite validation

**Files:** None (read-only verification)

- [ ] **Step 1: Run entire E2E suite**

```bash
npx playwright test
```

Expected: all tests pass across all three spec files.

- [ ] **Step 2: Run with verbose output to verify test names**

```bash
npx playwright test --reporter=list
```

Expected: test names are descriptive and organized by page/section.

- [ ] **Step 3: Verify no unintended files changed**

```bash
git status
```

Expected: only the files from this plan are modified/created.

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "test: finalize E2E test suite"
```
