# Svelte Context Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add component context (name + hierarchy), error origin detection, and SvelteKit route context to `@flareapp/svelte` error reports via stack trace parsing and SvelteKit state access.

**Architecture:** Three new pure-function modules (`extractComponentInfo`, `getErrorOrigin`, `getRouteContext`) called at error time by the existing handlers. Zero runtime overhead — all work happens only when an error is caught. Route context uses a lazy dynamic import of `$app/state` with caching.

**Tech Stack:** TypeScript, error-stack-parser, Svelte 5, SvelteKit `$app/state`, Vitest

**Spec:** `docs/superpowers/specs/2026-05-06-svelte-context-enrichment-design.md`

---

## File structure

| Action | File                                                     | Responsibility                                                                           |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Modify | `packages/svelte/src/types.ts`                           | Expanded `FlareSvelteContext`, new `SvelteErrorOrigin` and `SvelteRouteContext` types    |
| Create | `packages/svelte/src/extractComponentInfo.ts`            | Parse error stack trace, extract component name + hierarchy                              |
| Create | `packages/svelte/src/getErrorOrigin.ts`                  | Classify error origin from stack frame patterns                                          |
| Create | `packages/svelte/src/getRouteContext.ts`                 | Read SvelteKit route state via lazy `$app/state` import                                  |
| Modify | `packages/svelte/src/createFlareErrorHandler.ts:16-32`   | Call new modules to build enriched context                                               |
| Modify | `packages/svelte/src/flareSvelteErrorHandler.ts:21-41`   | Add default component fields + route context                                             |
| Modify | `packages/svelte/src/FlareErrorBoundary.svelte:46-53`    | Delegate to enriched handler (no direct changes needed — uses `createFlareErrorHandler`) |
| Modify | `packages/svelte/src/index.ts:11`                        | Export new types                                                                         |
| Modify | `packages/svelte/package.json:44`                        | Add `error-stack-parser` dependency                                                      |
| Create | `packages/svelte/tests/extractComponentInfo.test.ts`     | Tests for component extraction                                                           |
| Create | `packages/svelte/tests/getErrorOrigin.test.ts`           | Tests for origin detection                                                               |
| Create | `packages/svelte/tests/getRouteContext.test.ts`          | Tests for route context                                                                  |
| Modify | `packages/svelte/tests/createFlareErrorHandler.test.ts`  | Update assertions for enriched context                                                   |
| Modify | `packages/svelte/tests/flareSvelteErrorHandler.test.ts`  | Update assertions for enriched context                                                   |
| Modify | `packages/svelte/tests/FlareErrorBoundary.test.ts:47-54` | Update assertions for enriched context                                                   |

---

### Task 1: Expand types

**Files:**

- Modify: `packages/svelte/src/types.ts`
- Modify: `packages/svelte/src/index.ts:11`

- [ ] **Step 1: Update `types.ts` with new types and expanded context**

```typescript
export type SvelteErrorOrigin = 'render' | 'event' | 'effect' | 'unknown';

export interface SvelteRouteContext {
    id: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
}

export interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: SvelteErrorOrigin;
        route?: SvelteRouteContext;
        svelteKit?: {
            status: number;
            message: string;
        };
    };
}
```

- [ ] **Step 2: Update `index.ts` exports**

Replace line 11 in `packages/svelte/src/index.ts`:

```typescript
export type { FlareSvelteContext, SvelteErrorOrigin, SvelteRouteContext } from './types';
```

- [ ] **Step 3: Run type check**

Run: `cd packages/svelte && npx tsc --noEmit`
Expected: Type errors in `createFlareErrorHandler.ts` and `flareSvelteErrorHandler.ts` because they now build context objects missing the new required fields (`componentName`, `componentHierarchy`, `errorOrigin`). This confirms the types are enforced. Tests will also fail for the same reason.

- [ ] **Step 4: Commit**

```bash
git add packages/svelte/src/types.ts packages/svelte/src/index.ts
git commit -m "feat(svelte): expand FlareSvelteContext with component, origin, and route types"
```

---

### Task 2: Implement `extractComponentInfo`

**Files:**

- Create: `packages/svelte/src/extractComponentInfo.ts`
- Create: `packages/svelte/tests/extractComponentInfo.test.ts`
- Modify: `packages/svelte/package.json`

- [ ] **Step 1: Add `error-stack-parser` dependency**

Run: `cd packages/svelte && npm install error-stack-parser`

- [ ] **Step 2: Write failing tests**

Create `packages/svelte/tests/extractComponentInfo.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { extractComponentInfo } from '../src/extractComponentInfo';

describe('extractComponentInfo', () => {
    test('extracts component name and hierarchy from dev-like stack trace', () => {
        const error = new Error('test');
        error.stack = [
            'Error: test',
            '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
            '    at Object.children (http://localhost:5173/src/lib/Card.svelte:8:3)',
            '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
            '    at Layout (http://localhost:5173/src/routes/Layout.svelte:3:1)',
            '    at App (http://localhost:5173/src/App.svelte:1:1)',
        ].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card', 'Layout', 'App']);
    });

    test('extracts component name from fileName when functionName is unavailable', () => {
        const error = new Error('test');
        error.stack = ['Error: test', '    at http://localhost:5173/src/lib/MyComponent.svelte:10:5'].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBe('MyComponent');
        expect(result.componentHierarchy).toEqual(['MyComponent']);
    });

    test('deduplicates consecutive identical component names', () => {
        const error = new Error('test');
        error.stack = [
            'Error: test',
            '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
            '    at Button (http://localhost:5173/src/lib/Button.svelte:8:3)',
            '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
        ].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card']);
    });

    test('returns null name and empty hierarchy when no .svelte frames found', () => {
        const error = new Error('test');
        error.stack = [
            'Error: test',
            '    at someFunction (http://localhost:5173/src/utils.ts:5:1)',
            '    at main (http://localhost:5173/src/main.ts:1:1)',
        ].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('returns null name and empty hierarchy for production mangled stack', () => {
        const error = new Error('test');
        error.stack = [
            'Error: test',
            '    at Qe (http://example.com/assets/svelte-abc123.js:42:15)',
            '    at jt (http://example.com/assets/svelte-abc123.js:38:10)',
        ].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('handles error with no stack trace gracefully', () => {
        const error = new Error('test');
        error.stack = undefined;

        const result = extractComponentInfo(error);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('filters out non-svelte frames from hierarchy', () => {
        const error = new Error('test');
        error.stack = [
            'Error: test',
            '    at throwError (http://localhost:5173/src/utils.ts:5:1)',
            '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
            '    at createEffect (http://localhost:5173/node_modules/svelte/internal:100:5)',
            '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
        ].join('\n');

        const result = extractComponentInfo(error);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card']);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/extractComponentInfo.test.ts`
Expected: FAIL — module `../src/extractComponentInfo` not found.

- [ ] **Step 4: Implement `extractComponentInfo`**

Create `packages/svelte/src/extractComponentInfo.ts`:

```typescript
import ErrorStackParser from 'error-stack-parser';

interface ComponentInfo {
    componentName: string | null;
    componentHierarchy: string[];
}

export function extractComponentInfo(error: Error): ComponentInfo {
    let frames: ErrorStackParser.StackFrame[];

    try {
        frames = ErrorStackParser.parse(error);
    } catch {
        return { componentName: null, componentHierarchy: [] };
    }

    const svelteFrames = frames.filter((frame) => frame.fileName && frame.fileName.includes('.svelte'));

    if (svelteFrames.length === 0) {
        return { componentName: null, componentHierarchy: [] };
    }

    const names: string[] = [];

    for (const frame of svelteFrames) {
        const name = extractName(frame);

        if (name && name !== names[names.length - 1]) {
            names.push(name);
        }
    }

    return {
        componentName: names[0] ?? null,
        componentHierarchy: names,
    };
}

function extractName(frame: ErrorStackParser.StackFrame): string | null {
    if (frame.functionName && frame.functionName !== '<anonymous>' && !frame.functionName.includes('.')) {
        return frame.functionName;
    }

    if (frame.fileName) {
        const match = frame.fileName.match(/([^/]+)\.svelte/);
        return match?.[1] ?? null;
    }

    return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/svelte && npx vitest run tests/extractComponentInfo.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/src/extractComponentInfo.ts packages/svelte/tests/extractComponentInfo.test.ts packages/svelte/package.json package-lock.json
git commit -m "feat(svelte): add stack-trace-based component info extraction"
```

---

### Task 3: Implement `getErrorOrigin`

**Files:**

- Create: `packages/svelte/src/getErrorOrigin.ts`
- Create: `packages/svelte/tests/getErrorOrigin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/svelte/tests/getErrorOrigin.test.ts`:

```typescript
import ErrorStackParser from 'error-stack-parser';
import { describe, expect, test } from 'vitest';

import { getErrorOrigin } from '../src/getErrorOrigin';

function makeFrames(lines: string[]): ErrorStackParser.StackFrame[] {
    const error = new Error('test');
    error.stack = ['Error: test', ...lines.map((l) => `    at ${l}`)].join('\n');

    return ErrorStackParser.parse(error);
}

describe('getErrorOrigin', () => {
    test('detects event origin from DOM event dispatch frames', () => {
        const frames = makeFrames([
            'handleClick (http://localhost:5173/src/lib/Button.svelte:5:9)',
            'HTMLButtonElement.onclick (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects event origin from addEventListener pattern', () => {
        const frames = makeFrames([
            'callback (http://localhost:5173/src/lib/Form.svelte:10:5)',
            'EventTarget.addEventListener (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects event origin from dispatchEvent', () => {
        const frames = makeFrames([
            'handler (http://localhost:5173/src/lib/Input.svelte:3:1)',
            'EventTarget.dispatchEvent (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects effect origin from queueMicrotask', () => {
        const frames = makeFrames([
            'update (http://localhost:5173/src/lib/Counter.svelte:8:5)',
            'flush (http://localhost:5173/node_modules/svelte/internal:200:3)',
            'queueMicrotask (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('effect');
    });

    test('detects effect origin from Promise.then', () => {
        const frames = makeFrames([
            'callback (http://localhost:5173/src/lib/Loader.svelte:15:3)',
            'Promise.then (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('effect');
    });

    test('detects render origin from synchronous svelte-only stack', () => {
        const frames = makeFrames([
            'Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
            'Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
            'App (http://localhost:5173/src/App.svelte:1:1)',
        ]);

        expect(getErrorOrigin(frames)).toBe('render');
    });

    test('returns unknown when no svelte frames and no recognizable pattern', () => {
        const frames = makeFrames([
            'someFunction (http://localhost:5173/src/utils.ts:5:1)',
            'main (http://localhost:5173/src/main.ts:1:1)',
        ]);

        expect(getErrorOrigin(frames)).toBe('unknown');
    });

    test('returns unknown for empty frames', () => {
        expect(getErrorOrigin([])).toBe('unknown');
    });

    test('event takes priority over effect when both signals present', () => {
        const frames = makeFrames([
            'handler (http://localhost:5173/src/lib/Button.svelte:5:9)',
            'HTMLButtonElement.onclick (native)',
            'queueMicrotask (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/getErrorOrigin.test.ts`
Expected: FAIL — module `../src/getErrorOrigin` not found.

- [ ] **Step 3: Implement `getErrorOrigin`**

Create `packages/svelte/src/getErrorOrigin.ts`:

```typescript
import type ErrorStackParser from 'error-stack-parser';

import type { SvelteErrorOrigin } from './types';

const EVENT_PATTERNS = [
    /\.onclick\b/i,
    /\.onsubmit\b/i,
    /\.onchange\b/i,
    /\.oninput\b/i,
    /\.onkeydown\b/i,
    /\.onkeyup\b/i,
    /\.onfocus\b/i,
    /\.onblur\b/i,
    /\.onmouse/i,
    /\.onpointer/i,
    /\.ontouch/i,
    /addEventListener/,
    /dispatchEvent/,
    /EventTarget\./,
    /HTMLElement\./,
    /HTMLButtonElement\./,
    /HTMLInputElement\./,
    /HTMLFormElement\./,
];

const EFFECT_PATTERNS = [/queueMicrotask/, /Promise\.then/, /Promise\.catch/, /MutationObserver/];

export function getErrorOrigin(frames: ErrorStackParser.StackFrame[]): SvelteErrorOrigin {
    if (frames.length === 0) {
        return 'unknown';
    }

    const frameStrings = frames.map((f) => `${f.functionName ?? ''} ${f.fileName ?? ''} ${f.source ?? ''}`);

    if (frameStrings.some((s) => EVENT_PATTERNS.some((p) => p.test(s)))) {
        return 'event';
    }

    if (frameStrings.some((s) => EFFECT_PATTERNS.some((p) => p.test(s)))) {
        return 'effect';
    }

    const hasSvelteFrame = frames.some((f) => f.fileName?.includes('.svelte'));

    if (hasSvelteFrame) {
        return 'render';
    }

    return 'unknown';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/svelte && npx vitest run tests/getErrorOrigin.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/getErrorOrigin.ts packages/svelte/tests/getErrorOrigin.test.ts
git commit -m "feat(svelte): add error origin detection from stack frame patterns"
```

---

### Task 4: Implement `getRouteContext`

**Files:**

- Create: `packages/svelte/src/getRouteContext.ts`
- Create: `packages/svelte/tests/getRouteContext.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/svelte/tests/getRouteContext.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getRouteContext } from '../src/getRouteContext';

vi.mock('@flareapp/js', () => ({
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

const mockPage = {
    url: new URL('http://localhost/users/42?search=hello&token=secret123'),
    params: { id: '42' },
    route: { id: '/users/[id]' },
};

let appStateModule: { page: typeof mockPage } | null = null;

vi.mock('$app/state', () => {
    return new Proxy(
        {},
        {
            get(_target, prop) {
                if (!appStateModule) {
                    throw new Error('$app/state not available');
                }
                return appStateModule[prop as keyof typeof appStateModule];
            },
        }
    );
});

beforeEach(() => {
    appStateModule = null;
});

describe('getRouteContext', () => {
    test('extracts route context from SvelteKit page state', async () => {
        appStateModule = { page: mockPage };

        const result = await getRouteContext();

        expect(result).toEqual({
            id: '/users/[id]',
            url: '/users/42',
            params: { id: '42' },
            query: { search: 'hello', token: '[redacted]' },
        });
    });

    test('redacts sensitive query params', async () => {
        appStateModule = {
            page: {
                ...mockPage,
                url: new URL('http://localhost/login?password=123&username=alice&session=abc'),
            },
        };

        const result = await getRouteContext();

        expect(result!.query).toEqual({
            password: '[redacted]',
            username: 'alice',
            session: '[redacted]',
        });
    });

    test('returns null when $app/state is unavailable', async () => {
        appStateModule = null;

        const result = await getRouteContext();

        expect(result).toBeNull();
    });

    test('handles route with no query params', async () => {
        appStateModule = {
            page: {
                ...mockPage,
                url: new URL('http://localhost/users/42'),
            },
        };

        const result = await getRouteContext();

        expect(result).toEqual({
            id: '/users/[id]',
            url: '/users/42',
            params: { id: '42' },
            query: {},
        });
    });

    test('handles null route id', async () => {
        appStateModule = {
            page: {
                ...mockPage,
                route: { id: null },
            },
        };

        const result = await getRouteContext();

        expect(result!.id).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/getRouteContext.test.ts`
Expected: FAIL — module `../src/getRouteContext` not found.

- [ ] **Step 3: Implement `getRouteContext`**

Create `packages/svelte/src/getRouteContext.ts`:

```typescript
import { DEFAULT_URL_DENYLIST } from '@flareapp/js';

import type { SvelteRouteContext } from './types';

let cachedImport: Promise<typeof import('$app/state')> | null = null;
let importFailed = false;

function loadAppState(): Promise<typeof import('$app/state')> | null {
    if (importFailed) {
        return null;
    }

    if (!cachedImport) {
        cachedImport = import('$app/state').catch(() => {
            importFailed = true;
            cachedImport = null;
            throw new Error('$app/state not available');
        });
    }

    return cachedImport;
}

function redactQueryParams(searchParams: URLSearchParams): Record<string, string> {
    const result: Record<string, string> = {};

    searchParams.forEach((value, key) => {
        result[key] = DEFAULT_URL_DENYLIST.test(key) ? '[redacted]' : value;
    });

    return result;
}

export async function getRouteContext(): Promise<SvelteRouteContext | null> {
    const importPromise = loadAppState();

    if (!importPromise) {
        return null;
    }

    try {
        const { page } = await importPromise;

        return {
            id: page.route?.id ?? null,
            url: page.url.pathname,
            params: { ...page.params },
            query: redactQueryParams(page.url.searchParams),
        };
    } catch {
        return null;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/svelte && npx vitest run tests/getRouteContext.test.ts`
Expected: All 5 tests PASS.

Note: the `$app/state` mock in the test uses a Proxy to simulate SvelteKit's virtual module. In the actual published package, `$app/state` is marked as external in the build config and resolved by the consumer's Vite build. The cached dynamic import pattern ensures the import only happens once and fails gracefully for non-SvelteKit apps.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/getRouteContext.ts packages/svelte/tests/getRouteContext.test.ts
git commit -m "feat(svelte): add SvelteKit route context extraction"
```

---

### Task 5: Integrate into `createFlareErrorHandler`

**Files:**

- Modify: `packages/svelte/src/createFlareErrorHandler.ts`
- Modify: `packages/svelte/tests/createFlareErrorHandler.test.ts`

- [ ] **Step 1: Update the test for enriched context**

In `packages/svelte/tests/createFlareErrorHandler.test.ts`, update the `'passes svelte context in attributes'` test (line 47) and the `'calls beforeSubmit with error and context, uses returned context'` test (line 70), and the `'calls afterSubmit with error and final context'` test (line 90). Also update the `beforeSubmit` mock default context (line 81) and `afterSubmit` assertion (line 98-101).

Replace the entire test file with:

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
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

vi.mock('$app/state', () => {
    throw new Error('$app/state not available');
});

beforeEach(() => {
    mockReport.mockClear();
});

describe('createFlareErrorHandler', () => {
    test('returns a function', () => {
        const handler = createFlareErrorHandler();
        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', async () => {
        const handler = createFlareErrorHandler();
        const error = new Error('test error');

        await handler(error, () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', async () => {
        const handler = createFlareErrorHandler();

        await handler('string error', () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes enriched svelte context in attributes', async () => {
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        const attributes = mockReport.mock.calls[0][1];
        const svelte = attributes['context.custom'].svelte;
        expect(svelte.componentName).toBeDefined();
        expect(svelte.componentHierarchy).toBeInstanceOf(Array);
        expect(svelte.errorOrigin).toBeDefined();
        expect(attributes['context.custom'].framework).toBe('svelte');
    });

    test('calls beforeEvaluate with converted error', async () => {
        const beforeEvaluate = vi.fn();
        const handler = createFlareErrorHandler({ beforeEvaluate });
        const error = new Error('test');

        await handler(error, () => {});

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate).toHaveBeenCalledWith({ error });
    });

    test('calls beforeSubmit with error and enriched context, uses returned context', async () => {
        const customContext: FlareSvelteContext = {
            svelte: {
                componentName: 'Custom',
                componentHierarchy: ['Custom'],
                errorOrigin: 'render',
                svelteKit: { status: 500, message: 'custom' },
            },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        const handler = createFlareErrorHandler({ beforeSubmit });

        await handler(new Error('test'), () => {});

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const params = beforeSubmit.mock.calls[0][0];
        expect(params.error).toBeInstanceOf(Error);
        expect(params.context.svelte.componentName).toBeDefined();
        expect(params.context.svelte.errorOrigin).toBeDefined();

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error and final context', async () => {
        const afterSubmit = vi.fn();
        const handler = createFlareErrorHandler({ afterSubmit });
        const error = new Error('test');

        await handler(error, () => {});

        expect(afterSubmit).toHaveBeenCalledOnce();
        const params = afterSubmit.mock.calls[0][0];
        expect(params.error).toBe(error);
        expect(params.context.svelte.componentName).toBeDefined();
        expect(params.context.svelte.errorOrigin).toBeDefined();
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
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

        await handler(new Error('test'), () => {});

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('works with no options', async () => {
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts`
Expected: FAIL — the handler does not yet produce the enriched context.

- [ ] **Step 3: Update `createFlareErrorHandler.ts`**

Replace the full file `packages/svelte/src/createFlareErrorHandler.ts`:

```typescript
import { flare } from '@flareapp/js';
import ErrorStackParser from 'error-stack-parser';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { extractComponentInfo } from './extractComponentInfo';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { registerSvelteSdkIdentity } from './identify';
import type { FlareSvelteContext } from './types';

registerSvelteSdkIdentity();

export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return async (rawError: unknown, _reset: () => void) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        const { componentName, componentHierarchy } = extractComponentInfo(error);

        let frames: ErrorStackParser.StackFrame[] = [];
        try {
            frames = ErrorStackParser.parse(error);
        } catch {
            // unparseable stack
        }

        const errorOrigin = getErrorOrigin(frames);
        const route = await getRouteContext();

        let context: FlareSvelteContext = {
            svelte: {
                componentName,
                componentHierarchy,
                errorOrigin,
                ...(route ? { route } : {}),
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, context });
        }

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, context });
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/createFlareErrorHandler.ts packages/svelte/tests/createFlareErrorHandler.test.ts
git commit -m "feat(svelte): integrate context enrichment into createFlareErrorHandler"
```

---

### Task 6: Integrate into `flareSvelteErrorHandler`

**Files:**

- Modify: `packages/svelte/src/flareSvelteErrorHandler.ts`
- Modify: `packages/svelte/tests/flareSvelteErrorHandler.test.ts`

- [ ] **Step 1: Update the tests for enriched context**

Replace the entire test file `packages/svelte/tests/flareSvelteErrorHandler.test.ts`:

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
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

vi.mock('$app/state', () => {
    throw new Error('$app/state not available');
});

beforeEach(() => {
    mockReport.mockClear();
});

describe('flareSvelteErrorHandler', () => {
    test('returns a function', () => {
        const handler = flareSvelteErrorHandler();
        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', async () => {
        const handler = flareSvelteErrorHandler();
        const error = new Error('test error');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', async () => {
        const handler = flareSvelteErrorHandler();

        await handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes svelteKit context with default component fields in attributes', async () => {
        const handler = flareSvelteErrorHandler();

        await handler({ error: new Error('test'), status: 404, message: 'Not Found' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                svelteKit: { status: 404, message: 'Not Found' },
            },
        });
    });

    test('calls beforeEvaluate with error, status, and message', async () => {
        const beforeEvaluate = vi.fn();
        const handler = flareSvelteErrorHandler({ beforeEvaluate });
        const error = new Error('test');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate).toHaveBeenCalledWith({ error, status: 500, message: 'Internal Error' });
    });

    test('calls beforeSubmit with error, status, message, and context', async () => {
        const customContext: FlareSvelteContext = {
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                svelteKit: { status: 503, message: 'overridden' },
            },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        const handler = flareSvelteErrorHandler({ beforeSubmit });

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

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

    test('calls afterSubmit with error, status, message, and final context', async () => {
        const afterSubmit = vi.fn();
        const handler = flareSvelteErrorHandler({ afterSubmit });
        const error = new Error('test');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBe(error);
        expect(afterSubmit.mock.calls[0][0].status).toBe(500);
        expect(afterSubmit.mock.calls[0][0].message).toBe('Internal Error');
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
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

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('works with no options', async () => {
        const handler = flareSvelteErrorHandler();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = flareSvelteErrorHandler();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/flareSvelteErrorHandler.test.ts`
Expected: FAIL — context shape doesn't match new expected structure.

- [ ] **Step 3: Update `flareSvelteErrorHandler.ts`**

Replace the full file `packages/svelte/src/flareSvelteErrorHandler.ts`:

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { getRouteContext } from './getRouteContext';
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
    return async ({ error: rawError, status, message }: { error: unknown; status: number; message: string }) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error, status, message });

        const route = await getRouteContext();

        let context: FlareSvelteContext = {
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                ...(route ? { route } : {}),
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

Run: `cd packages/svelte && npx vitest run tests/flareSvelteErrorHandler.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/flareSvelteErrorHandler.ts packages/svelte/tests/flareSvelteErrorHandler.test.ts
git commit -m "feat(svelte): integrate context enrichment into flareSvelteErrorHandler"
```

---

### Task 7: Update `FlareErrorBoundary` tests

The `FlareErrorBoundary` component delegates to `createFlareErrorHandler`, which now produces enriched context. The component itself doesn't need code changes, but its tests need updated assertions.

**Files:**

- Modify: `packages/svelte/tests/FlareErrorBoundary.test.ts:47-54,63-88,98-101`

- [ ] **Step 1: Update `FlareErrorBoundary.test.ts`**

In `packages/svelte/tests/FlareErrorBoundary.test.ts`, add the `$app/state` mock alongside the existing `@flareapp/js` mock (after line 18):

```typescript
vi.mock('$app/state', () => {
    throw new Error('$app/state not available');
});
```

Update the `'passes svelte context in attributes'` test (lines 47-54) to check for the new enriched fields:

```typescript
test('passes enriched svelte context in attributes', async () => {
    render(BoundaryWithBuggyChild);
    await new Promise((r) => setTimeout(r, 0));
    const attributes = mockReport.mock.calls[0][1];
    const svelte = attributes['context.custom'].svelte;
    expect(attributes['context.custom'].framework).toBe('svelte');
    expect(svelte.componentName).toBeDefined();
    expect(svelte.componentHierarchy).toBeInstanceOf(Array);
    expect(svelte.errorOrigin).toBeDefined();
});
```

Update the `'calls beforeSubmit with error and context, uses returned context'` test (lines 63-76). The initial context passed to `beforeSubmit` now has the new fields:

```typescript
test('calls beforeSubmit with error and enriched context, uses returned context', async () => {
    const customContext: FlareSvelteContext = {
        svelte: {
            componentName: 'Custom',
            componentHierarchy: ['Custom'],
            errorOrigin: 'render',
            svelteKit: { status: 500, message: 'custom' },
        },
    };
    const beforeSubmit = vi.fn().mockReturnValue(customContext);
    render(BoundaryWithBuggyChild, { props: { beforeSubmit } });
    await new Promise((r) => setTimeout(r, 0));
    expect(beforeSubmit).toHaveBeenCalledOnce();
    const params = beforeSubmit.mock.calls[0][0];
    expect(params.context.svelte.componentName).toBeDefined();
    expect(params.context.svelte.errorOrigin).toBeDefined();
    const attributes = mockReport.mock.calls[0][1];
    expect(attributes['context.custom']).toEqual({
        framework: 'svelte',
        svelte: customContext.svelte,
    });
});
```

Update the `'calls afterSubmit with error and context'` test (lines 77-83):

```typescript
test('calls afterSubmit with error and enriched context', async () => {
    const afterSubmit = vi.fn();
    render(BoundaryWithBuggyChild, { props: { afterSubmit } });
    await new Promise((r) => setTimeout(r, 0));
    expect(afterSubmit).toHaveBeenCalledOnce();
    expect(afterSubmit.mock.calls[0][0].error).toBeInstanceOf(Error);
    expect(afterSubmit.mock.calls[0][0].context.svelte.componentName).toBeDefined();
    expect(afterSubmit.mock.calls[0][0].context.svelte.errorOrigin).toBeDefined();
});
```

Note: The `createFlareErrorHandler` return type is now `async`. The `FlareErrorBoundary` calls it as fire-and-forget, so the component itself doesn't need changes. But tests that check `mockReport` may need a microtask flush (`await new Promise(r => setTimeout(r, 0))`) to wait for the async `getRouteContext()` call to settle before assertions run.

- [ ] **Step 2: Run all FlareErrorBoundary tests**

Run: `cd packages/svelte && npx vitest run tests/FlareErrorBoundary.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/svelte/tests/FlareErrorBoundary.test.ts
git commit -m "test(svelte): update FlareErrorBoundary tests for enriched context"
```

---

### Task 8: Update `FlareErrorBoundary` component for async handler

The `createFlareErrorHandler` now returns an async function. The `FlareErrorBoundary`'s `onerror` callback calls this handler, but `<svelte:boundary>`'s `onerror` is synchronous. The async handler works fine as fire-and-forget (the promise rejection is already caught internally), but we should make sure the component handles this correctly.

**Files:**

- Modify: `packages/svelte/src/FlareErrorBoundary.svelte:46-53`

- [ ] **Step 1: Verify current behavior**

The current `onerror` function (line 46-53) calls `handler(rawError, reset)` synchronously. Since the handler is now async, this returns a Promise. The error state (`currentError`, `resetBoundary`) is set before the handler call, so the UI update is synchronous. The handler's async work (route context fetch) happens in the background. No code change needed in the component — the fire-and-forget pattern works.

Run the full test suite to confirm:

Run: `cd packages/svelte && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run type check**

Run: `cd packages/svelte && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit (if any changes were needed)**

If type errors required changes, commit them. Otherwise skip this step.

---

### Task 9: Build config — mark `$app/state` as external

**Files:**

- Modify: `packages/svelte/package.json`

- [ ] **Step 1: Check current build behavior**

Run: `cd packages/svelte && npm run build`

Check if the build fails or warns about `$app/state` import. The `svelte-package` tool should handle external imports correctly since SvelteKit libraries commonly import from `$app/*`.

- [ ] **Step 2: Verify the output**

Run: `grep -r '\$app/state' packages/svelte/dist/`

Expected: The `import('$app/state')` call should appear in the dist output as-is (not bundled/resolved). `svelte-package` copies source files with minimal transformation, so virtual module imports are preserved by default.

- [ ] **Step 3: Commit (if config changes were needed)**

If `svelte-package` does not handle `$app/state` correctly and config changes were needed, commit them. Otherwise skip.

---

### Task 10: Run full test suite and type check

- [ ] **Step 1: Run all tests across the monorepo**

Run: `npm run test` (from repo root)
Expected: All tests PASS across all packages.

- [ ] **Step 2: Run type check across the monorepo**

Run: `npm run typescript` (from repo root)
Expected: No type errors.

- [ ] **Step 3: Run build across the monorepo**

Run: `npm run build` (from repo root)
Expected: All packages build successfully.

- [ ] **Step 4: Final commit if any fixes were needed**

If any cross-package issues were found and fixed, commit them.
