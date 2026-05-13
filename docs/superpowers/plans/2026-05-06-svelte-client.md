# @flareapp/svelte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@flareapp/svelte` — a Svelte 5 error tracking package with an error boundary component, handler factory, and SvelteKit hook.

**Architecture:** Thin wrapper around `@flareapp/js`. Three exports: `FlareErrorBoundary` (Svelte component using `<svelte:boundary>`), `createFlareErrorHandler` (factory returning `onerror` callback), `flareSvelteErrorHandler` (SvelteKit `handleError` wrapper). All reporting goes through `flare.report()` from `@flareapp/js`.

**Tech Stack:** TypeScript 5.7, Svelte 5, tsdown (CJS + ESM + .d.ts), Vitest 4, @testing-library/svelte

**Spec:** `docs/superpowers/specs/2026-05-06-svelte-client-design.md`

---

## File Map

| File                                                    | Responsibility                            |
| ------------------------------------------------------- | ----------------------------------------- |
| `packages/svelte/package.json`                          | Package metadata, deps, scripts, exports  |
| `packages/svelte/tsconfig.json`                         | TS config extending root                  |
| `packages/svelte/vitest.config.ts`                      | Test config (jsdom)                       |
| `packages/svelte/.release-it.json`                      | Release config                            |
| `packages/svelte/src/index.ts`                          | Public API barrel                         |
| `packages/svelte/src/types.ts`                          | FlareSvelteContext type                   |
| `packages/svelte/src/constants.ts`                      | PACKAGE_VERSION                           |
| `packages/svelte/src/convertToError.ts`                 | Unknown-to-Error coercion                 |
| `packages/svelte/src/identify.ts`                       | SDK + framework identity registration     |
| `packages/svelte/src/contextToAttributes.ts`            | Context-to-Attributes conversion          |
| `packages/svelte/src/createFlareErrorHandler.ts`        | Handler factory                           |
| `packages/svelte/src/FlareErrorBoundary.svelte`         | Error boundary component                  |
| `packages/svelte/src/flareSvelteErrorHandler.ts`        | SvelteKit handleError wrapper             |
| `packages/svelte/tests/createFlareErrorHandler.test.ts` | Handler factory tests                     |
| `packages/svelte/tests/flareSvelteErrorHandler.test.ts` | SvelteKit handler tests                   |
| `packages/svelte/tests/FlareErrorBoundary.test.ts`      | Boundary component tests                  |
| `playground/svelte/index.html`                          | Svelte playground entry HTML              |
| `playground/svelte/main.ts`                             | Svelte playground bootstrap               |
| `playground/svelte/App.svelte`                          | Playground app shell                      |
| `playground/svelte/sections/RenderErrorSection.svelte`  | Render error demo                         |
| `playground/svelte/sections/ResetKeysSection.svelte`    | resetKeys demo                            |
| `playground/svelte/sections/OnClickErrorSection.svelte` | Click handler error demo                  |
| `playground/svelte/sections/AsyncErrorSection.svelte`   | Async error demo                          |
| `playground/svelte/sections/ManualReportSection.svelte` | Manual report demo                        |
| `playground/svelte/components/BuggyComponent.svelte`    | Component that throws on render           |
| `playground/svelte/components/Button.svelte`            | Styled button                             |
| `playground/svelte/components/TestSection.svelte`       | Section container                         |
| `playground/shared/createSidebar.ts`                    | Modify: add Svelte nav link               |
| `playground/index.html`                                 | Modify: add Svelte link                   |
| `playground/vite.config.ts`                             | Modify: add svelte plugin + entry + alias |
| `playground/package.json`                               | Modify: add svelte deps                   |
| `playground/.env.example`                               | Modify: add VITE_FLARE_SVELTE_KEY         |

---

### Task 1: Package scaffolding

**Files:**

- Create: `packages/svelte/package.json`
- Create: `packages/svelte/tsconfig.json`
- Create: `packages/svelte/vitest.config.ts`
- Create: `packages/svelte/.release-it.json`

- [ ] **Step 1: Create package.json**

```json
{
    "name": "@flareapp/svelte",
    "version": "2.0.0",
    "description": "Svelte client for flareapp.io",
    "homepage": "https://flareapp.io",
    "bugs": "https://github.com/spatie/flare-client-js/issues",
    "repository": {
        "type": "git",
        "url": "git+https://github.com/spatie/flare-client-js.git"
    },
    "license": "MIT",
    "author": {
        "name": "Spatie",
        "email": "info@spatie.be"
    },
    "contributors": [
        "Adriaan Marain <adriaan@spatie.be>",
        "Alex Vanderbist <alex@spatie.be>",
        "Dries Heyninck <dries@spatie.be>",
        "Freek Van der Herten <freek@spatie.be>",
        "Sebastian De Deyne <sebastian@spatie.be>",
        "Sébastien Henau <seba@spatie.be>"
    ],
    "main": "./dist/index.cjs",
    "module": "./dist/index.mjs",
    "types": "./dist/index.d.cts",
    "exports": {
        ".": {
            "import": {
                "types": "./dist/index.d.mts",
                "default": "./dist/index.mjs"
            },
            "require": {
                "types": "./dist/index.d.cts",
                "default": "./dist/index.cjs"
            }
        }
    },
    "scripts": {
        "prepublishOnly": "npm run build",
        "build": "tsdown src/index.ts --format cjs,esm --dts --env.PACKAGE_VERSION=\"$(node -p \"require('./package.json').version\")\" --clean",
        "test": "vitest run",
        "typescript": "tsc --noEmit",
        "release": "release-it"
    },
    "devDependencies": {
        "@flareapp/js": "file:../js",
        "@testing-library/svelte": "^5.0.0",
        "jsdom": "^26.1.0",
        "svelte": "^5.0.0",
        "tsdown": "^0.20.3",
        "typescript": "^5.7.0",
        "vitest": "^4.0.0"
    },
    "peerDependencies": {
        "@flareapp/js": "^2.0.0",
        "svelte": "^5.0.0"
    },
    "publishConfig": {
        "access": "public"
    }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
    "extends": "../../tsconfig.json",
    "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    test: {
        environment: 'jsdom',
    },
});
```

Note: `@sveltejs/vite-plugin-svelte` is needed for vitest to compile `.svelte` files. Add it as a devDependency in package.json:

Update the devDependencies in package.json to add `"@sveltejs/vite-plugin-svelte": "^5.0.0"`.

- [ ] **Step 4: Create .release-it.json**

```json
{
    "git": {
        "tagName": "@flareapp/svelte@${version}",
        "tagAnnotation": "Release @flareapp/svelte@${version}",
        "commitMessage": "chore: release @flareapp/svelte@${version}",
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

- [ ] **Step 5: Install dependencies**

Run from repo root:

```bash
npm install
```

This picks up the new workspace and installs all deps.

- [ ] **Step 6: Verify setup**

Run:

```bash
cd packages/svelte && npx tsc --noEmit
```

Expected: succeeds (no source files yet, no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/svelte/package.json packages/svelte/tsconfig.json packages/svelte/vitest.config.ts packages/svelte/.release-it.json package-lock.json
git commit -m "chore(svelte): scaffold package with build, test, and release config"
```

---

### Task 2: Types, constants, and utilities

**Files:**

- Create: `packages/svelte/src/types.ts`
- Create: `packages/svelte/src/constants.ts`
- Create: `packages/svelte/src/convertToError.ts`
- Create: `packages/svelte/src/contextToAttributes.ts`

- [ ] **Step 1: Create types.ts**

```typescript
export interface FlareSvelteContext {
    svelte: {
        svelteKit?: {
            status: number;
            message: string;
        };
    };
}
```

- [ ] **Step 2: Create constants.ts**

```typescript
declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;

export const PACKAGE_VERSION =
    typeof process !== 'undefined' && typeof process.env?.PACKAGE_VERSION !== 'undefined'
        ? process.env.PACKAGE_VERSION
        : '?';
```

- [ ] **Step 3: Create convertToError.ts**

```typescript
export function convertToError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }

    return new Error(String(error));
}
```

Note: matches Vue's `convertToError` exactly. No JSON.stringify attempt — keeps it simple and consistent with existing packages.

- [ ] **Step 4: Create contextToAttributes.ts**

```typescript
import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareSvelteContext } from './types';

export function contextToAttributes(context: FlareSvelteContext): Attributes {
    return {
        'context.custom': {
            framework: 'svelte',
            svelte: context.svelte as AttributeValue,
        },
    };
}
```

- [ ] **Step 5: Verify types compile**

Run:

```bash
cd packages/svelte && npx tsc --noEmit
```

Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/src/types.ts packages/svelte/src/constants.ts packages/svelte/src/convertToError.ts packages/svelte/src/contextToAttributes.ts
git commit -m "feat(svelte): add types, constants, and utility modules"
```

---

### Task 3: identify module

**Files:**

- Create: `packages/svelte/src/identify.ts`

- [ ] **Step 1: Create identify.ts**

```typescript
import { flare } from '@flareapp/js';
import { VERSION } from 'svelte';

import { PACKAGE_VERSION } from './constants';

let registered = false;

export function registerSvelteSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'Svelte', version: VERSION });
}
```

Note: follows React's pattern — explicit function with idempotence guard, called from index.ts. `VERSION` is exported from `svelte` (the main package, not `svelte/compiler`).

- [ ] **Step 2: Verify types compile**

Run:

```bash
cd packages/svelte && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/svelte/src/identify.ts
git commit -m "feat(svelte): add SDK identity registration"
```

---

### Task 4: createFlareErrorHandler (TDD)

**Files:**

- Create: `packages/svelte/tests/createFlareErrorHandler.test.ts`
- Create: `packages/svelte/src/createFlareErrorHandler.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createFlareErrorHandler } from '../src/createFlareErrorHandler';
import type { FlareSvelteContext } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('createFlareErrorHandler', () => {
    test('returns a function', () => {
        const handler = createFlareErrorHandler();
        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', () => {
        const handler = createFlareErrorHandler();
        const error = new Error('test error');

        handler(error, () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', () => {
        const handler = createFlareErrorHandler();

        handler('string error', () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes svelte context in attributes', () => {
        const handler = createFlareErrorHandler();

        handler(new Error('test'), () => {});

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: {},
        });
    });

    test('calls beforeEvaluate with converted error', () => {
        const beforeEvaluate = vi.fn();
        const handler = createFlareErrorHandler({ beforeEvaluate });
        const error = new Error('test');

        handler(error, () => {});

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate).toHaveBeenCalledWith({ error });
    });

    test('calls beforeSubmit with error and context, uses returned context', () => {
        const customContext: FlareSvelteContext = {
            svelte: { svelteKit: { status: 500, message: 'custom' } },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        const handler = createFlareErrorHandler({ beforeSubmit });

        handler(new Error('test'), () => {});

        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(beforeSubmit.mock.calls[0][0].error).toBeInstanceOf(Error);
        expect(beforeSubmit.mock.calls[0][0].context).toEqual({ svelte: {} });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error and final context', () => {
        const afterSubmit = vi.fn();
        const handler = createFlareErrorHandler({ afterSubmit });
        const error = new Error('test');

        handler(error, () => {});

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit).toHaveBeenCalledWith({
            error,
            context: { svelte: {} },
        });
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = createFlareErrorHandler({
            beforeEvaluate: () => callOrder.push('beforeEvaluate'),
            beforeSubmit: ({ context }) => {
                callOrder.push('beforeSubmit');
                return context;
            },
            afterSubmit: () => callOrder.push('afterSubmit'),
        });

        handler(new Error('test'), () => {});

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('works with no options', () => {
        const handler = createFlareErrorHandler();

        handler(new Error('test'), () => {});

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = createFlareErrorHandler();

        handler(new Error('test'), () => {});

        // Flush microtask queue — no unhandled rejection
        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { registerSvelteSdkIdentity } from './identify';
import type { FlareSvelteContext } from './types';

registerSvelteSdkIdentity();

export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return (rawError: unknown, _reset: () => void) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        let context: FlareSvelteContext = { svelte: {} };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, context });
        }

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, context });
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/tests/createFlareErrorHandler.test.ts packages/svelte/src/createFlareErrorHandler.ts
git commit -m "feat(svelte): add createFlareErrorHandler factory with tests"
```

---

### Task 5: flareSvelteErrorHandler (TDD)

**Files:**

- Create: `packages/svelte/tests/flareSvelteErrorHandler.test.ts`
- Create: `packages/svelte/src/flareSvelteErrorHandler.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { flareSvelteErrorHandler } from '../src/flareSvelteErrorHandler';
import type { FlareSvelteContext } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('flareSvelteErrorHandler', () => {
    test('returns a function', () => {
        const handler = flareSvelteErrorHandler();
        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', () => {
        const handler = flareSvelteErrorHandler();
        const error = new Error('test error');

        handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', () => {
        const handler = flareSvelteErrorHandler();

        handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes svelteKit context with status and message in attributes', () => {
        const handler = flareSvelteErrorHandler();

        handler({ error: new Error('test'), status: 404, message: 'Not Found' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: {
                svelteKit: { status: 404, message: 'Not Found' },
            },
        });
    });

    test('calls beforeEvaluate with error, status, and message', () => {
        const beforeEvaluate = vi.fn();
        const handler = flareSvelteErrorHandler({ beforeEvaluate });
        const error = new Error('test');

        handler({ error, status: 500, message: 'Internal Error' });

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate).toHaveBeenCalledWith({ error, status: 500, message: 'Internal Error' });
    });

    test('calls beforeSubmit with error, status, message, and context', () => {
        const customContext: FlareSvelteContext = {
            svelte: { svelteKit: { status: 503, message: 'overridden' } },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        const handler = flareSvelteErrorHandler({ beforeSubmit });

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const params = beforeSubmit.mock.calls[0][0];
        expect(params.status).toBe(500);
        expect(params.message).toBe('Internal Error');
        expect(params.context.svelte.svelteKit).toEqual({ status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error, status, message, and final context', () => {
        const afterSubmit = vi.fn();
        const handler = flareSvelteErrorHandler({ afterSubmit });
        const error = new Error('test');

        handler({ error, status: 500, message: 'Internal Error' });

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBe(error);
        expect(afterSubmit.mock.calls[0][0].status).toBe(500);
        expect(afterSubmit.mock.calls[0][0].message).toBe('Internal Error');
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = flareSvelteErrorHandler({
            beforeEvaluate: () => callOrder.push('beforeEvaluate'),
            beforeSubmit: ({ context }) => {
                callOrder.push('beforeSubmit');
                return context;
            },
            afterSubmit: () => callOrder.push('afterSubmit'),
        });

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('works with no options', () => {
        const handler = flareSvelteErrorHandler();

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = flareSvelteErrorHandler();

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/svelte && npx vitest run tests/flareSvelteErrorHandler.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { registerSvelteSdkIdentity } from './identify';
import type { FlareSvelteContext } from './types';

registerSvelteSdkIdentity();

export interface FlareSvelteErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error; status: number; message: string }) => void;
    beforeSubmit?: (params: {
        error: Error;
        status: number;
        message: string;
        context: FlareSvelteContext;
    }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; status: number; message: string; context: FlareSvelteContext }) => void;
}

export function flareSvelteErrorHandler(options?: FlareSvelteErrorHandlerOptions) {
    return ({ error: rawError, status, message }: { error: unknown; status: number; message: string }) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error, status, message });

        let context: FlareSvelteContext = {
            svelte: {
                svelteKit: { status, message },
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, status, message, context });
        }

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, status, message, context });
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/svelte && npx vitest run tests/flareSvelteErrorHandler.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/tests/flareSvelteErrorHandler.test.ts packages/svelte/src/flareSvelteErrorHandler.ts
git commit -m "feat(svelte): add flareSvelteErrorHandler for SvelteKit with tests"
```

---

### Task 6: FlareErrorBoundary component (TDD)

**Files:**

- Create: `packages/svelte/tests/FlareErrorBoundary.test.ts`
- Create: `packages/svelte/src/FlareErrorBoundary.svelte`

This is the most complex task. `@testing-library/svelte` v5 supports Svelte 5. Testing Svelte 5 components that use `<svelte:boundary>` with snippets requires rendering wrapper components in tests.

- [ ] **Step 1: Write the tests**

```typescript
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import FlareErrorBoundary from '../src/FlareErrorBoundary.svelte';
import type { FlareSvelteContext } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    mockReport.mockClear();
});

describe('FlareErrorBoundary', () => {
    test('renders children when no error occurs', () => {
        const { getByText } = render(FlareErrorBoundary, {
            props: {
                children: createSnippet(() => {
                    const el = document.createElement('p');
                    el.textContent = 'Hello world';
                    return el;
                }),
            },
        });

        expect(getByText('Hello world')).toBeTruthy();
    });
});
```

Note: testing Svelte 5 boundary components with `@testing-library/svelte` is tricky because snippets can't be easily created programmatically from tests. The test approach will depend on what `@testing-library/svelte` v5 supports. An alternative is to create small test-only `.svelte` wrapper components in `tests/fixtures/` that use `FlareErrorBoundary` with specific children and fallbacks, then render those in tests.

**Practical test approach — use fixture components:**

Create `packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte`:

```svelte
<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
    import type { FlareSvelteContext } from '../../src/types';

    interface Props {
        shouldThrow?: boolean;
        beforeEvaluate?: (params: { error: Error }) => void;
        beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
        afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
        onReset?: (error: Error | null) => void;
        resetKeys?: unknown[];
    }

    let {
        shouldThrow = true,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
        resetKeys,
    }: Props = $props();
</script>

<FlareErrorBoundary {beforeEvaluate} {beforeSubmit} {afterSubmit} {onReset} {resetKeys}>
    {#if shouldThrow}
        {(() => { throw new Error('BuggyComponent render error'); })()}
    {:else}
        <p>Child rendered successfully</p>
    {/if}

    {#snippet failed(error, reset)}
        <div>
            <p data-testid="error-message">Error: {error.message}</p>
            <button data-testid="reset-button" onclick={reset}>Reset</button>
        </div>
    {/snippet}
</FlareErrorBoundary>
```

Create `packages/svelte/tests/fixtures/BoundaryWithoutFallback.svelte`:

```svelte
<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
</script>

<FlareErrorBoundary>
    {(() => { throw new Error('BuggyComponent render error'); })()}
</FlareErrorBoundary>
```

Create `packages/svelte/tests/fixtures/BoundaryWithChildren.svelte`:

```svelte
<script lang="ts">
    import FlareErrorBoundary from '../../src/FlareErrorBoundary.svelte';
</script>

<FlareErrorBoundary>
    <p>Hello world</p>

    {#snippet failed(error, reset)}
        <p>Fallback</p>
    {/snippet}
</FlareErrorBoundary>
```

Now the actual tests using these fixtures:

```typescript
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { FlareSvelteContext } from '../src/types';

import BoundaryWithBuggyChild from './fixtures/BoundaryWithBuggyChild.svelte';
import BoundaryWithChildren from './fixtures/BoundaryWithChildren.svelte';
import BoundaryWithoutFallback from './fixtures/BoundaryWithoutFallback.svelte';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    mockReport.mockClear();
});

describe('FlareErrorBoundary', () => {
    test('renders children when no error occurs', () => {
        const { getByText } = render(BoundaryWithChildren);

        expect(getByText('Hello world')).toBeTruthy();
    });

    test('catches error and renders fallback', () => {
        const { getByTestId } = render(BoundaryWithBuggyChild);

        expect(getByTestId('error-message').textContent).toBe('Error: BuggyComponent render error');
    });

    test('reports error to Flare on catch', () => {
        render(BoundaryWithBuggyChild);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('BuggyComponent render error');
    });

    test('passes svelte context in attributes', () => {
        render(BoundaryWithBuggyChild);

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: {},
        });
    });

    test('calls beforeEvaluate with error', () => {
        const beforeEvaluate = vi.fn();
        render(BoundaryWithBuggyChild, { props: { beforeEvaluate } });

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate.mock.calls[0][0].error).toBeInstanceOf(Error);
    });

    test('calls beforeSubmit with error and context, uses returned context', () => {
        const customContext: FlareSvelteContext = {
            svelte: { svelteKit: { status: 500, message: 'custom' } },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);

        render(BoundaryWithBuggyChild, { props: { beforeSubmit } });

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error and context', () => {
        const afterSubmit = vi.fn();
        render(BoundaryWithBuggyChild, { props: { afterSubmit } });

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBeInstanceOf(Error);
        expect(afterSubmit.mock.calls[0][0].context).toEqual({ svelte: {} });
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        render(BoundaryWithBuggyChild, {
            props: {
                beforeEvaluate: () => callOrder.push('beforeEvaluate'),
                beforeSubmit: ({ context }: { context: FlareSvelteContext }) => {
                    callOrder.push('beforeSubmit');
                    return context;
                },
                afterSubmit: () => callOrder.push('afterSubmit'),
            },
        });

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));

        render(BoundaryWithBuggyChild);

        await new Promise((r) => setTimeout(r, 0));
    });

    test('reset clears error and re-renders children', async () => {
        const { getByTestId, getByText, rerender } = render(BoundaryWithBuggyChild);

        expect(getByTestId('error-message')).toBeTruthy();

        await rerender({ shouldThrow: false });
        getByTestId('reset-button').click();
        await tick();

        expect(getByText('Child rendered successfully')).toBeTruthy();
    });

    test('calls onReset with the error when resetting', async () => {
        const onReset = vi.fn();
        const { getByTestId, rerender } = render(BoundaryWithBuggyChild, { props: { onReset } });

        await rerender({ shouldThrow: false, onReset });
        getByTestId('reset-button').click();
        await tick();

        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    test('content removed silently when no fallback snippet provided', () => {
        const { container } = render(BoundaryWithoutFallback);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(container.textContent?.trim()).toBe('');
    });
});
```

Note: `resetKeys` tests may need additional fixture components or dynamic prop updates. The exact assertions may need adjustment based on how `@testing-library/svelte` handles Svelte 5 reactivity. The engineer should add or adapt tests during implementation if the testing library behaves differently than expected.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/svelte && npx vitest run tests/FlareErrorBoundary.test.ts
```

Expected: FAIL (component not found).

- [ ] **Step 3: Write the FlareErrorBoundary component**

Create `packages/svelte/src/FlareErrorBoundary.svelte`:

```svelte
<script lang="ts">
    import type { Snippet } from 'svelte';

    import { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';
    import type { FlareSvelteContext } from './types';

    interface Props {
        children: Snippet;
        failed?: Snippet<[error: Error, reset: () => void]>;
        resetKeys?: unknown[];
        beforeEvaluate?: FlareErrorHandlerOptions['beforeEvaluate'];
        beforeSubmit?: FlareErrorHandlerOptions['beforeSubmit'];
        afterSubmit?: FlareErrorHandlerOptions['afterSubmit'];
        onReset?: (error: Error | null) => void;
    }

    let {
        children,
        failed: fallbackSnippet,
        resetKeys,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
    }: Props = $props();

    let currentError: Error | null = $state(null);
    let resetBoundary: (() => void) | null = $state(null);

    let previousKeys: string | undefined;
    $effect(() => {
        const serialized = JSON.stringify(resetKeys);
        if (previousKeys !== undefined && serialized !== previousKeys && currentError) {
            handleReset();
        }
        previousKeys = serialized;
    });

    function handleReset() {
        const error = currentError;
        currentError = null;
        onReset?.(error);
        resetBoundary?.();
        resetBoundary = null;
    }

    function onerror(rawError: unknown, reset: () => void) {
        resetBoundary = reset;
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        currentError = error;

        const handler = createFlareErrorHandler({ beforeEvaluate, beforeSubmit, afterSubmit });
        handler(rawError, reset);
    }
</script>

<svelte:boundary {onerror}>
    {@render children()}

    {#snippet failed(error, reset)}
        {#if fallbackSnippet}
            {@render fallbackSnippet(error, handleReset)}
        {/if}
    {/snippet}
</svelte:boundary>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/svelte && npx vitest run tests/FlareErrorBoundary.test.ts
```

Expected: tests PASS. Some tests involving reset/rerender may need adjustment based on actual `@testing-library/svelte` v5 behavior with Svelte 5 reactivity.

- [ ] **Step 5: Run all tests together**

Run:

```bash
cd packages/svelte && npx vitest run
```

Expected: all tests across all 3 test files PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/tests/ packages/svelte/src/FlareErrorBoundary.svelte
git commit -m "feat(svelte): add FlareErrorBoundary component with tests"
```

---

### Task 7: Public API barrel and build verification

**Files:**

- Create: `packages/svelte/src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
import { registerSvelteSdkIdentity } from './identify';

registerSvelteSdkIdentity();

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';

export { flareSvelteErrorHandler, type FlareSvelteErrorHandlerOptions } from './flareSvelteErrorHandler';

export type { FlareSvelteContext } from './types';
```

- [ ] **Step 2: Type-check**

Run:

```bash
cd packages/svelte && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
cd packages/svelte && npm run build
```

Expected: produces `dist/index.cjs`, `dist/index.mjs`, `dist/index.d.cts`, `dist/index.d.mts`. No errors.

Note: tsdown needs to handle `.svelte` files. If the build fails because tsdown can't process Svelte files natively, the build script may need adjustment. Potential solutions:

1. Use `svelte-package` from `@sveltejs/package` instead of tsdown — this is the standard Svelte library build tool.
2. Or precompile the Svelte component to JS before tsdown processes it.

If tsdown doesn't work, switch to `svelte-package`:

- Replace build script: `"build": "svelte-package -i src -o dist"`
- Add `"svelte": "./dist/FlareErrorBoundary.svelte"` to package.json exports
- Add `@sveltejs/package` as devDependency
- Adjust exports field for svelte-package output format

The engineer should try tsdown first and fall back to `svelte-package` if needed.

- [ ] **Step 4: Run all tests one more time**

Run:

```bash
cd packages/svelte && npx vitest run
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/index.ts
git commit -m "feat(svelte): add public API barrel and verify build"
```

---

### Task 8: Playground — Svelte page

**Files:**

- Create: `playground/svelte/index.html`
- Create: `playground/svelte/main.ts`
- Create: `playground/svelte/App.svelte`
- Create: `playground/svelte/components/BuggyComponent.svelte`
- Create: `playground/svelte/components/Button.svelte`
- Create: `playground/svelte/components/TestSection.svelte`
- Create: `playground/svelte/sections/RenderErrorSection.svelte`
- Create: `playground/svelte/sections/ResetKeysSection.svelte`
- Create: `playground/svelte/sections/OnClickErrorSection.svelte`
- Create: `playground/svelte/sections/AsyncErrorSection.svelte`
- Create: `playground/svelte/sections/ManualReportSection.svelte`
- Modify: `playground/vite.config.ts`
- Modify: `playground/package.json`
- Modify: `playground/shared/createSidebar.ts`
- Modify: `playground/index.html`
- Modify: `playground/.env.example`

- [ ] **Step 1: Create playground/svelte/index.html**

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta content="width=device-width, initial-scale=1.0" name="viewport" />
        <title>Svelte - Flare Playground</title>
        <link href="/shared/styles.css" rel="stylesheet" />
    </head>
    <body class="grid grid-cols-[14rem_1fr] min-h-screen bg-gray-50 text-gray-900">
        <div class="relative bg-white border-r border-gray-200" data-active="svelte" data-slot="sidebar"></div>
        <main class="p-10 space-y-4">
            <h1 class="text-2xl font-bold">Svelte</h1>
            <div id="root"></div>
        </main>
        <script src="/svelte/main.ts" type="module"></script>
    </body>
</html>
```

- [ ] **Step 2: Create playground/svelte/main.ts**

```typescript
import { mount } from 'svelte';

import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';

import App from './App.svelte';

initFlare(import.meta.env.VITE_FLARE_SVELTE_KEY);

createSidebar();

mount(App, { target: document.querySelector('#root')! });
```

- [ ] **Step 3: Create playground/svelte/App.svelte**

```svelte
<script lang="ts">
    import RenderErrorSection from './sections/RenderErrorSection.svelte';
    import ResetKeysSection from './sections/ResetKeysSection.svelte';
    import OnClickErrorSection from './sections/OnClickErrorSection.svelte';
    import AsyncErrorSection from './sections/AsyncErrorSection.svelte';
    import ManualReportSection from './sections/ManualReportSection.svelte';
</script>

<RenderErrorSection />
<ResetKeysSection />
<OnClickErrorSection />
<AsyncErrorSection />
<ManualReportSection />
```

- [ ] **Step 4: Create playground/svelte/components/BuggyComponent.svelte**

```svelte
<script lang="ts">
    throw new Error('BuggyComponent render error');
</script>
```

- [ ] **Step 5: Create playground/svelte/components/Button.svelte**

```svelte
<script lang="ts">
    import type { HTMLButtonAttributes } from 'svelte/elements';

    let { children, ...rest }: HTMLButtonAttributes = $props();
</script>

<button
    class="cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200"
    {...rest}
>
    {@render children?.()}
</button>
```

- [ ] **Step 6: Create playground/svelte/components/TestSection.svelte**

```svelte
<script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
        title: string;
        description: string;
        children: Snippet;
    }

    let { title, description, children }: Props = $props();
</script>

<section class="border-t border-gray-200 py-6 first:border-t-0 first:pt-0">
    <h2 class="text-base font-semibold text-gray-900">{title}</h2>
    <p class="mt-1 text-sm text-gray-600">{description}</p>
    <div class="mt-3">
        {@render children()}
    </div>
</section>
```

- [ ] **Step 7: Create playground/svelte/sections/RenderErrorSection.svelte**

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import { flare } from '../../shared/initFlare';
    import BuggyComponent from '../components/BuggyComponent.svelte';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';

    let showBuggy = $state(false);
</script>

<TestSection
    title="Render error caught by FlareErrorBoundary"
    description="Throws during render inside a FlareErrorBoundary. Fallback renders, afterSubmit fires, and resetting unmounts the component so it can be retried."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button onclick={() => {
            console.log('Triggering render error via BuggyComponent');
            showBuggy = true;
        }}>
            Trigger render error
        </Button>
        <Button onclick={() => {
            showBuggy = false;
            console.log('Reset BuggyComponent state');
        }}>
            Reset render error
        </Button>
    </div>
    {#if showBuggy}
        <div class="mt-3">
            <FlareErrorBoundary
                afterSubmit={() => console.log('FlareErrorBoundary afterSubmit callback')}
                onReset={() => console.log('FlareErrorBoundary onReset callback')}
                beforeEvaluate={() => {
                    flare.addContext('playground', 'test');
                    flare.addContext('showBuggy', showBuggy);
                }}
            >
                <BuggyComponent />

                {#snippet failed(error, reset)}
                    <div class="space-y-1">
                        <p>Something went wrong: {error.message}</p>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            onclick={reset}
                        >
                            Try again
                        </button>
                    </div>
                {/snippet}
            </FlareErrorBoundary>
        </div>
    {/if}
</TestSection>
```

- [ ] **Step 8: Create playground/svelte/sections/ResetKeysSection.svelte**

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';

    let shouldThrow = $state(false);
    let resetCounter = $state(0);
</script>

<TestSection
    title="resetKeys auto-reset"
    description="Triggers an error, then increments a resetKey to auto-reset the boundary. The onReset callback fires, and the child re-renders without error."
>
    <div class="flex flex-wrap items-center gap-3">
        <Button onclick={() => (shouldThrow = true)}>Trigger error</Button>
        <Button onclick={() => {
            shouldThrow = false;
            resetCounter++;
            console.log('Incremented resetKey to', resetCounter);
        }}>
            Increment resetKey (auto-reset)
        </Button>
    </div>
    <p class="mt-2 text-xs text-gray-500">
        resetCounter: {resetCounter} | shouldThrow: {String(shouldThrow)}
    </p>
    <div class="mt-3">
        <FlareErrorBoundary
            resetKeys={[resetCounter]}
            onReset={(error) => console.log('FlareErrorBoundary onReset via resetKeys, error was:', error?.message)}
        >
            {#if shouldThrow}
                {(() => { throw new Error('ConditionallyBuggyComponent error'); })()}
            {:else}
                <p class="text-sm text-green-700">Child rendered successfully (no error)</p>
            {/if}

            {#snippet failed(error)}
                <p class="text-sm text-red-700">
                    Boundary caught: {error.message} — increment resetKey to recover.
                </p>
            {/snippet}
        </FlareErrorBoundary>
    </div>
</TestSection>
```

- [ ] **Step 9: Create playground/svelte/sections/OnClickErrorSection.svelte**

```svelte
<script lang="ts">
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Uncaught error in an event handler"
    description="Throws synchronously inside onclick. Not caught by the boundary, handled by the global window.onerror listener."
>
    <Button onclick={() => {
        console.log('Throwing error in onclick handler');
        throw new Error('Error in Svelte onclick handler');
    }}>
        Throw in onclick
    </Button>
</TestSection>
```

- [ ] **Step 10: Create playground/svelte/sections/AsyncErrorSection.svelte**

```svelte
<script lang="ts">
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Async error"
    description="Triggers an unhandled promise rejection. Captured via window.onunhandledrejection."
>
    <Button onclick={() => {
        console.log('Triggering async error');
        Promise.reject(new Error('Async error in Svelte component'));
    }}>
        Async error (unhandled rejection)
    </Button>
</TestSection>
```

- [ ] **Step 11: Create playground/svelte/sections/ManualReportSection.svelte**

```svelte
<script lang="ts">
    import { flare } from '../../shared/initFlare';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Manual flare.report()"
    description="Calls flare.report() directly with a synthetic error. No throw, no listener involvement."
>
    <Button onclick={() => {
        console.log('Calling flare.report() from Svelte component');
        flare.report(new Error('Manually reported from Svelte'));
    }}>
        flare.report() from component
    </Button>
</TestSection>
```

- [ ] **Step 12: Update playground/package.json**

Add to `dependencies`:

```json
"@flareapp/svelte": "*"
```

Add to `devDependencies`:

```json
"@sveltejs/vite-plugin-svelte": "^5.0.0",
"svelte": "^5.0.0"
```

- [ ] **Step 13: Update playground/vite.config.ts**

Add svelte import at top:

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';
```

Add to `resolve.alias`:

```typescript
'@flareapp/svelte': resolve(__dirname, '../packages/svelte/src/index.ts'),
```

Add to `plugins` array (after `vue()`):

```typescript
svelte(),
```

Add to `build.rollupOptions.input`:

```typescript
svelte: resolve(__dirname, 'svelte/index.html'),
```

Add a sourcemap uploader instance for svelte:

```typescript
flareSourcemapUploader({
    key: env.VITE_FLARE_SVELTE_KEY,
}),
```

- [ ] **Step 14: Update playground/shared/createSidebar.ts**

Add after the Vue nav link:

```html
<a href="/svelte/" class="rounded-md px-3 py-2 text-sm font-medium ${getActive('svelte')}">Svelte</a>
```

- [ ] **Step 15: Update playground/index.html**

Add a new `<li>` after the Vue link:

```html
<li>
    <a class="rounded-md px-3 py-2 text-sm font-medium bg-black text-white" href="/svelte/index.html"
        >Svelte playground</a
    >
</li>
```

- [ ] **Step 16: Update playground/.env.example**

Add:

```
VITE_FLARE_SVELTE_KEY=
```

- [ ] **Step 17: Install dependencies**

Run from repo root:

```bash
npm install
```

- [ ] **Step 18: Start playground and verify**

Run from repo root:

```bash
npm run playground
```

Navigate to `http://localhost:5173/svelte/`. Verify:

1. Sidebar shows Svelte link, highlighted as active
2. All sections render
3. "Trigger render error" shows error boundary with fallback
4. "Try again" resets the boundary
5. resetKeys section works as expected
6. onClick error appears in console (caught by window.onerror)
7. Async error appears in console (caught by window.onunhandledrejection)
8. Manual report sends to Flare (check network tab or console in debug mode)

- [ ] **Step 19: Commit**

```bash
git add playground/ packages/svelte/
git commit -m "feat(svelte): add playground page with all error scenario demos"
```

---

### Task 9: Full CI verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests across the monorepo**

Run from repo root:

```bash
npm run test
```

Expected: all tests PASS across js, react, vue, and svelte packages.

- [ ] **Step 2: Run type-check across the monorepo**

Run from repo root:

```bash
npm run typescript
```

Expected: PASS.

- [ ] **Step 3: Build all packages**

Run from repo root:

```bash
npm run build
```

Expected: all packages build cleanly.

- [ ] **Step 4: Run Prettier**

Run from repo root:

```bash
npm run format
```

- [ ] **Step 5: Final commit if formatting changed anything**

```bash
git add -A
git commit -m "style(svelte): apply Prettier formatting"
```

Only commit if there are changes. Skip if working tree is clean.
