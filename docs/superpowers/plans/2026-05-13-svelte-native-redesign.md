# Svelte-Native Client Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `@flareapp/svelte` into two packages (`@flareapp/svelte` + `@flareapp/sveltekit`), add props serialization, and make the SvelteKit package provide both wrapper and direct-call hook APIs.

**Architecture:** The current `@flareapp/svelte` package bundles SvelteKit-specific code (error hooks, route context, `$app/state`). This refactor extracts that into a new `@flareapp/sveltekit` package with client/server sub-exports. The base `@flareapp/svelte` package becomes pure Svelte 5 (no SvelteKit dependency) and gains props serialization ported from `@flareapp/vue`.

**Tech Stack:** TypeScript 5.7, Svelte 5, SvelteKit 2, svelte-package, Vitest, @testing-library/svelte

---

## File Structure

### `@flareapp/svelte` (modified)

| File                                             | Action | Responsibility                                                                                                     |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `packages/svelte/src/index.ts`                   | Modify | Remove `flareSvelteErrorHandler` export, remove `SvelteRouteContext` type export                                   |
| `packages/svelte/src/types.ts`                   | Modify | Remove `SvelteRouteContext`, remove `route` and `svelteKit` fields from `FlareSvelteContext`, add `componentProps` |
| `packages/svelte/src/constants.ts`               | Modify | Add props serialization constants and `DEFAULT_PROPS_DENYLIST`                                                     |
| `packages/svelte/src/serializeProps.ts`          | Create | Props serialization with Svelte proxy unwrapping                                                                   |
| `packages/svelte/src/FlareErrorBoundary.svelte`  | Modify | Add props capture props (`attachProps`, `propsMaxDepth`, `propsDenylist`, `replaceDefaultDenylist`)                |
| `packages/svelte/src/createFlareErrorHandler.ts` | Modify | Remove route context import, accept optional props, remove `getRouteContext` call                                  |
| `packages/svelte/package.json`                   | Modify | Remove `@sveltejs/kit` peer dependency                                                                             |
| `packages/svelte/tests/serializeProps.test.ts`   | Create | Props serialization tests                                                                                          |

**Files to delete from `@flareapp/svelte`:**

- `packages/svelte/src/flareSvelteErrorHandler.ts` — moves to sveltekit package
- `packages/svelte/src/getRouteContext.ts` — moves to sveltekit package
- `packages/svelte/src/app-state.d.ts` — moves to sveltekit package
- `packages/svelte/tests/flareSvelteErrorHandler.test.ts` — moves to sveltekit package
- `packages/svelte/tests/getRouteContext.test.ts` — moves to sveltekit package
- `packages/svelte/tests/__mocks__/app-state.ts` — moves to sveltekit package

### `@flareapp/sveltekit` (new)

| File                                               | Action | Responsibility                            |
| -------------------------------------------------- | ------ | ----------------------------------------- |
| `packages/sveltekit/package.json`                  | Create | Package config with conditional exports   |
| `packages/sveltekit/tsconfig.json`                 | Create | TypeScript config extending root          |
| `packages/sveltekit/vitest.config.mts`             | Create | Vitest config with $app/state alias       |
| `packages/sveltekit/src/index.ts`                  | Create | Root export: re-exports @flareapp/svelte  |
| `packages/sveltekit/src/types.ts`                  | Create | SvelteKit-specific types                  |
| `packages/sveltekit/src/constants.ts`              | Create | PACKAGE_VERSION                           |
| `packages/sveltekit/src/identify.ts`               | Create | SvelteKit SDK/framework registration      |
| `packages/sveltekit/src/contextToAttributes.ts`    | Create | Transform SvelteKit context to Attributes |
| `packages/sveltekit/src/convertToError.ts`         | Create | Normalize unknown to Error                |
| `packages/sveltekit/src/client/index.ts`           | Create | Client sub-path exports                   |
| `packages/sveltekit/src/client/handleError.ts`     | Create | handleErrorWithFlare wrapper (client)     |
| `packages/sveltekit/src/client/captureError.ts`    | Create | Direct call API (client)                  |
| `packages/sveltekit/src/client/getRouteContext.ts` | Create | Route context from $app/state             |
| `packages/sveltekit/src/client/app-state.d.ts`     | Create | Type stub for $app/state                  |
| `packages/sveltekit/src/server/index.ts`           | Create | Server sub-path exports                   |
| `packages/sveltekit/src/server/handleError.ts`     | Create | handleErrorWithFlare wrapper (server)     |
| `packages/sveltekit/src/server/captureError.ts`    | Create | Direct call API (server)                  |

---

### Task 1: Add props serialization to `@flareapp/svelte`

Port `serializeProps` from `@flareapp/vue` to `@flareapp/svelte`, adapted for Svelte 5 proxies.

**Files:**

- Create: `packages/svelte/src/serializeProps.ts`
- Modify: `packages/svelte/src/constants.ts`
- Create: `packages/svelte/tests/serializeProps.test.ts`

- [ ] **Step 1: Add constants for props serialization**

In `packages/svelte/src/constants.ts`, add the props-related constants:

```typescript
import { resolveDenylist as baseResolveDenylist } from '@flareapp/js';

import { version } from '../package.json';

export const PACKAGE_VERSION = version;

export const DEFAULT_PROPS_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

export function resolveDenylist(custom?: RegExp, replaceDefault: boolean = false): RegExp {
    return baseResolveDenylist(custom, replaceDefault, DEFAULT_PROPS_DENYLIST);
}

export const MAX_PROP_STRING_LENGTH = 1000;

export const MAX_PROP_ARRAY_LENGTH = 100;

export const MAX_PROP_OBJECT_KEYS = 100;
```

- [ ] **Step 2: Write the failing tests for serializeProps**

Create `packages/svelte/tests/serializeProps.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { DEFAULT_PROPS_DENYLIST, MAX_PROP_ARRAY_LENGTH, MAX_PROP_OBJECT_KEYS } from '../src/constants';
import { serializeProps } from '../src/serializeProps';

describe('serializeProps', () => {
    test('serializes primitive values', () => {
        const result = serializeProps({ name: 'Alice', age: 30, active: true, score: null }, 2);
        expect(result).toEqual({ name: 'Alice', age: 30, active: true, score: null });
    });

    test('serializes undefined as [undefined]', () => {
        const result = serializeProps({ value: undefined }, 2);
        expect(result).toEqual({ value: '[undefined]' });
    });

    test('serializes functions as [Function]', () => {
        const result = serializeProps({ onClick: () => {} }, 2);
        expect(result).toEqual({ onClick: '[Function]' });
    });

    test('serializes symbols as [Symbol]', () => {
        const result = serializeProps({ id: Symbol('test') }, 2);
        expect(result).toEqual({ id: '[Symbol]' });
    });

    test('serializes bigint as string', () => {
        const result = serializeProps({ big: BigInt(42) }, 2);
        expect(result).toEqual({ big: '42' });
    });

    test('truncates long strings', () => {
        const longString = 'a'.repeat(1500);
        const result = serializeProps({ text: longString }, 2);
        const serialized = result.text as string;
        expect(serialized.length).toBeLessThan(longString.length);
        expect(serialized).toContain('truncated');
    });

    test('respects max depth for nested objects', () => {
        const result = serializeProps({ nested: { deep: { deeper: 'value' } } }, 1);
        expect(result).toEqual({ nested: { deep: '[Object]' } });
    });

    test('respects max depth for nested arrays', () => {
        const result = serializeProps({ items: [['nested']] }, 1);
        expect(result).toEqual({ items: ['[Array]'] });
    });

    test('detects circular references', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const result = serializeProps(obj, 2);
        expect(result).toEqual({ a: 1, self: '[Circular]' });
    });

    test('redacts keys matching denylist', () => {
        const result = serializeProps({ username: 'alice', password: 'secret123', token: 'abc' }, 2);
        expect(result).toEqual({
            username: 'alice',
            password: '[redacted]',
            token: '[redacted]',
        });
    });

    test('accepts custom denylist', () => {
        const customDenylist = /^secret_/i;
        const result = serializeProps({ secret_key: 'value', password: 'pass', normal: 'ok' }, 2, customDenylist);
        expect(result.secret_key).toBe('[redacted]');
        expect(result.password).toBe('[redacted]');
        expect(result.normal).toBe('ok');
    });

    test('limits array length', () => {
        const largeArray = Array.from({ length: 150 }, (_, i) => i);
        const result = serializeProps({ items: largeArray }, 2);
        const items = result.items as unknown[];
        expect(items.length).toBe(MAX_PROP_ARRAY_LENGTH + 1);
        expect(items[items.length - 1]).toContain('more items');
    });

    test('limits object keys', () => {
        const largeObj: Record<string, number> = {};
        for (let i = 0; i < 150; i++) {
            largeObj[`key${i}`] = i;
        }
        const result = serializeProps(largeObj, 2);
        const keys = Object.keys(result);
        expect(keys.length).toBe(MAX_PROP_OBJECT_KEYS + 1);
        expect(result['…']).toContain('more keys');
    });

    test('handles class instances as [Object]', () => {
        const result = serializeProps({ date: new Date(), map: new Map() }, 2);
        expect(result).toEqual({ date: '[Object]', map: '[Object]' });
    });

    test('unwraps Svelte $state proxies via snapshot', () => {
        const proxy = new Proxy(
            { count: 5 },
            {
                get(target, prop) {
                    if (prop === Symbol.toStringTag) return 'Proxy';
                    return Reflect.get(target, prop);
                },
            }
        );
        const result = serializeProps({ state: proxy }, 2);
        expect(result.state).toBe('[Object]');
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/svelte && npx vitest run tests/serializeProps.test.ts`
Expected: FAIL — `serializeProps` module not found

- [ ] **Step 4: Create serializeProps.ts**

Create `packages/svelte/src/serializeProps.ts`:

```typescript
import {
    DEFAULT_PROPS_DENYLIST,
    MAX_PROP_ARRAY_LENGTH,
    MAX_PROP_OBJECT_KEYS,
    MAX_PROP_STRING_LENGTH,
} from './constants';

export function serializeProps(
    value: Record<string, unknown>,
    maxDepth: number,
    denylist: RegExp = DEFAULT_PROPS_DENYLIST
): Record<string, unknown> {
    return serialize(value, 0, maxDepth, new WeakSet(), denylist) as Record<string, unknown>;
}

function serialize(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>, denylist: RegExp): unknown {
    if (value === null) {
        return null;
    }

    if (value === undefined) {
        return '[undefined]';
    }

    const type = typeof value;

    if (type === 'function') {
        return '[Function]';
    }

    if (type === 'symbol') {
        return '[Symbol]';
    }

    if (type === 'bigint') {
        return (value as bigint).toString();
    }

    if (type === 'string') {
        return truncateString(value as string);
    }

    if (type !== 'object') {
        return value;
    }

    if (seen.has(value as object)) {
        return '[Circular]';
    }

    if (Array.isArray(value)) {
        if (depth > maxDepth) {
            return '[Array]';
        }

        seen.add(value);

        const slice = value.length > MAX_PROP_ARRAY_LENGTH ? value.slice(0, MAX_PROP_ARRAY_LENGTH) : value;
        const out: unknown[] = slice.map((item) => serialize(item, depth + 1, maxDepth, seen, denylist));

        if (value.length > MAX_PROP_ARRAY_LENGTH) {
            out.push(`[… ${value.length - MAX_PROP_ARRAY_LENGTH} more items]`);
        }

        seen.delete(value);

        return out;
    }

    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    seen.add(value);

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value);
    const limitedKeys = keys.length > MAX_PROP_OBJECT_KEYS ? keys.slice(0, MAX_PROP_OBJECT_KEYS) : keys;

    for (const key of limitedKeys) {
        if (denylist.test(key)) {
            out[key] = '[redacted]';
            continue;
        }

        out[key] = serialize(value[key], depth + 1, maxDepth, seen, denylist);
    }

    if (keys.length > MAX_PROP_OBJECT_KEYS) {
        out['…'] = `[${keys.length - MAX_PROP_OBJECT_KEYS} more keys]`;
    }

    seen.delete(value);

    return out;
}

function truncateString(value: string): string {
    if (value.length <= MAX_PROP_STRING_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_PROP_STRING_LENGTH)}…[truncated ${value.length - MAX_PROP_STRING_LENGTH} chars]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/svelte && npx vitest run tests/serializeProps.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/src/constants.ts packages/svelte/src/serializeProps.ts packages/svelte/tests/serializeProps.test.ts
git commit -m "feat(svelte): add props serialization ported from Vue"
```

---

### Task 2: Update types and remove SvelteKit-specific code from `@flareapp/svelte`

Strip SvelteKit dependencies from the base package. Update types to add `componentProps` and remove SvelteKit fields.

**Files:**

- Modify: `packages/svelte/src/types.ts`
- Modify: `packages/svelte/src/index.ts`
- Modify: `packages/svelte/src/createFlareErrorHandler.ts`
- Modify: `packages/svelte/package.json`
- Delete: `packages/svelte/src/flareSvelteErrorHandler.ts`
- Delete: `packages/svelte/src/getRouteContext.ts`
- Delete: `packages/svelte/src/app-state.d.ts`
- Delete: `packages/svelte/tests/flareSvelteErrorHandler.test.ts`
- Delete: `packages/svelte/tests/getRouteContext.test.ts`
- Modify: `packages/svelte/vitest.config.mts`

- [ ] **Step 1: Update types.ts**

Replace `packages/svelte/src/types.ts` with:

```typescript
export type SvelteErrorOrigin = 'render' | 'event' | 'effect' | 'unknown';

export interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: SvelteErrorOrigin;
        componentProps?: Record<string, unknown>;
    };
}
```

Note: `SvelteRouteContext` and the `route`/`svelteKit` fields move to `@flareapp/sveltekit`.

- [ ] **Step 2: Update createFlareErrorHandler.ts**

Remove the `getRouteContext` import and call. The handler no longer fetches route context — that's the SvelteKit package's job.

Replace `packages/svelte/src/createFlareErrorHandler.ts` with:

```typescript
import { flare } from '@flareapp/js';
import ErrorStackParser from 'error-stack-parser';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { extractComponentInfo } from './extractComponentInfo';
import { getErrorOrigin } from './getErrorOrigin';
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

        let frames: ErrorStackParser.StackFrame[] = [];
        try {
            frames = ErrorStackParser.parse(error);
        } catch {
            // unparseable stack
        }

        const { componentName, componentHierarchy } = extractComponentInfo(frames);
        const errorOrigin = getErrorOrigin(frames);

        let context: FlareSvelteContext = {
            svelte: {
                componentName,
                componentHierarchy,
                errorOrigin,
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

- [ ] **Step 3: Update index.ts**

Remove `flareSvelteErrorHandler` and `SvelteRouteContext` exports. Replace `packages/svelte/src/index.ts` with:

```typescript
import { registerSvelteSdkIdentity } from './identify';

registerSvelteSdkIdentity();

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';

export { serializeProps } from './serializeProps';

export { DEFAULT_PROPS_DENYLIST, resolveDenylist } from './constants';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types';
```

- [ ] **Step 4: Remove @sveltejs/kit peer dependency from package.json**

In `packages/svelte/package.json`, remove the `@sveltejs/kit` peer dependency and its `peerDependenciesMeta` entry. The `peerDependencies` section should become:

```json
"peerDependencies": {
    "@flareapp/js": "^2.0.0",
    "svelte": "^5.0.0"
}
```

Remove the entire `peerDependenciesMeta` section.

- [ ] **Step 5: Delete SvelteKit-specific files**

```bash
rm packages/svelte/src/flareSvelteErrorHandler.ts
rm packages/svelte/src/getRouteContext.ts
rm packages/svelte/src/app-state.d.ts
rm packages/svelte/tests/flareSvelteErrorHandler.test.ts
rm packages/svelte/tests/getRouteContext.test.ts
rm -r packages/svelte/tests/__mocks__
```

- [ ] **Step 6: Remove $app/state alias from vitest.config.mts**

Replace `packages/svelte/vitest.config.mts` with:

```typescript
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [svelte({ hot: false }), svelteTesting()],
    test: {
        environment: 'jsdom',
    },
});
```

- [ ] **Step 7: Update existing tests that reference removed types/fields**

In `packages/svelte/tests/FlareErrorBoundary.test.ts`:

Remove the `vi.mock('$app/state', ...)` block (lines 23-25). Also remove `DEFAULT_URL_DENYLIST` from the `@flareapp/js` mock since it's no longer used by this package's code under test. The `beforeSubmit` test (line 77-78) creates a custom context with a `svelteKit` field — update it to remove that field since `FlareSvelteContext` no longer has it:

```typescript
const customContext: FlareSvelteContext = {
    svelte: {
        componentName: 'Custom',
        componentHierarchy: ['Custom'],
        errorOrigin: 'render',
    },
};
```

In `packages/svelte/tests/createFlareErrorHandler.test.ts`:

Remove the `vi.mock('$app/state', ...)` block (lines 18-20). Remove `DEFAULT_URL_DENYLIST` from the `@flareapp/js` mock. Update the `beforeSubmit` test (lines 78-85) — remove the `svelteKit` field from the custom context:

```typescript
const customContext: FlareSvelteContext = {
    svelte: {
        componentName: 'Custom',
        componentHierarchy: ['Custom'],
        errorOrigin: 'render',
    },
};
```

- [ ] **Step 8: Run all svelte package tests**

Run: `cd packages/svelte && npx vitest run`
Expected: All tests PASS (fewer tests now — route context and error handler tests removed)

- [ ] **Step 9: Commit**

```bash
git add -A packages/svelte/
git commit -m "refactor(svelte): remove SvelteKit-specific code from base package"
```

---

### Task 3: Add props capture to FlareErrorBoundary

Wire up the `attachProps`, `propsMaxDepth`, `propsDenylist`, and `replaceDefaultDenylist` props on the error boundary component.

**Files:**

- Modify: `packages/svelte/src/FlareErrorBoundary.svelte`
- Modify: `packages/svelte/src/createFlareErrorHandler.ts`
- Modify: `packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte`
- Modify: `packages/svelte/tests/FlareErrorBoundary.test.ts`

- [ ] **Step 1: Update createFlareErrorHandler to accept serialized props**

The handler needs to accept an optional `componentProps` parameter that the boundary can pass in after serialization. Modify `packages/svelte/src/createFlareErrorHandler.ts` — add `componentProps` to the handler's second argument:

Replace the `createFlareErrorHandler` function signature and handler body:

```typescript
export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export interface FlareErrorHandlerCallOptions {
    componentProps?: Record<string, unknown>;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return async (rawError: unknown, _reset: () => void, callOptions?: FlareErrorHandlerCallOptions) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        let frames: ErrorStackParser.StackFrame[] = [];
        try {
            frames = ErrorStackParser.parse(error);
        } catch {
            // unparseable stack
        }

        const { componentName, componentHierarchy } = extractComponentInfo(frames);
        const errorOrigin = getErrorOrigin(frames);

        let context: FlareSvelteContext = {
            svelte: {
                componentName,
                componentHierarchy,
                errorOrigin,
                ...(callOptions?.componentProps ? { componentProps: callOptions.componentProps } : {}),
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

- [ ] **Step 2: Update FlareErrorBoundary.svelte with props capture props**

Replace `packages/svelte/src/FlareErrorBoundary.svelte` with:

```svelte
<script lang="ts">
    import type { Snippet } from 'svelte';

    import { DEFAULT_PROPS_DENYLIST, resolveDenylist } from './constants';
    import { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';
    import { serializeProps } from './serializeProps';

    interface Props {
        children: Snippet;
        failed?: Snippet<[error: Error, reset: () => void]>;
        resetKeys?: unknown[];
        beforeEvaluate?: FlareErrorHandlerOptions['beforeEvaluate'];
        beforeSubmit?: FlareErrorHandlerOptions['beforeSubmit'];
        afterSubmit?: FlareErrorHandlerOptions['afterSubmit'];
        onReset?: (error: Error | null) => void;
        attachProps?: boolean;
        propsMaxDepth?: number;
        propsDenylist?: RegExp;
        replaceDefaultDenylist?: boolean;
    }

    let {
        children,
        failed: fallbackSnippet,
        resetKeys,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
        attachProps = false,
        propsMaxDepth = 2,
        propsDenylist,
        replaceDefaultDenylist = false,
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

    const resolvedDenylist = $derived(resolveDenylist(propsDenylist, replaceDefaultDenylist));
    const handler = $derived(createFlareErrorHandler({ beforeEvaluate, beforeSubmit, afterSubmit }));

    function onerror(rawError: unknown, reset: () => void) {
        resetBoundary = reset;
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        currentError = error;

        handler(rawError, reset, {
            componentProps: attachProps
                ? serializeProps($state.snapshot($$props) as Record<string, unknown>, propsMaxDepth, resolvedDenylist)
                : undefined,
        });
    }
</script>

<svelte:boundary {onerror}>
    {@render children()}

    {#snippet failed(error, reset)}
        {#if fallbackSnippet}
            {@render fallbackSnippet(error instanceof Error ? error : new Error(String(error)), handleReset)}
        {/if}
    {/snippet}
</svelte:boundary>
```

Note: `$$props` gives access to all props passed to the component. Using `$state.snapshot()` unwraps any reactive proxies. We serialize the boundary's own props (not the child's props — Svelte doesn't give us access to those from the boundary). This is a limitation acknowledged in the design — the captured props show the boundary's configuration and any data passed through it.

**Important caveat:** If `$$props` is not available in Svelte 5 runes mode (it's a legacy feature), we need to manually construct the props object from the destructured values. In that case, the `onerror` function would need adjustment. Verify during implementation whether `$$props` works in runes mode. If not, construct the props manually:

```typescript
const capturedProps = {
    resetKeys,
    attachProps,
    propsMaxDepth,
    // ... etc
};
```

- [ ] **Step 3: Update BoundaryWithBuggyChild fixture**

Add the new props to the fixture. Modify `packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte`:

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
        attachProps?: boolean;
        propsMaxDepth?: number;
        propsDenylist?: RegExp;
        replaceDefaultDenylist?: boolean;
    }

    let {
        shouldThrow = true,
        beforeEvaluate,
        beforeSubmit,
        afterSubmit,
        onReset,
        resetKeys,
        attachProps,
        propsMaxDepth,
        propsDenylist,
        replaceDefaultDenylist,
    }: Props = $props();
</script>

<FlareErrorBoundary
    {beforeEvaluate}
    {beforeSubmit}
    {afterSubmit}
    {onReset}
    {resetKeys}
    {attachProps}
    {propsMaxDepth}
    {propsDenylist}
    {replaceDefaultDenylist}
>
    {#if shouldThrow}
        {(() => {
            throw new Error('BuggyComponent render error');
        })()}
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

- [ ] **Step 4: Write failing tests for props capture**

Add tests to `packages/svelte/tests/FlareErrorBoundary.test.ts`:

```typescript
test('does not capture props by default', async () => {
    render(BoundaryWithBuggyChild);
    await new Promise((r) => setTimeout(r, 0));
    const attributes = mockReport.mock.calls[0][1];
    expect(attributes['context.custom'].svelte.componentProps).toBeUndefined();
});

test('captures serialized props when attachProps is true', async () => {
    render(BoundaryWithBuggyChild, {
        props: { attachProps: true, shouldThrow: true },
    });
    await new Promise((r) => setTimeout(r, 0));
    const attributes = mockReport.mock.calls[0][1];
    expect(attributes['context.custom'].svelte.componentProps).toBeDefined();
    expect(typeof attributes['context.custom'].svelte.componentProps).toBe('object');
});

test('redacts sensitive props when attachProps is true', async () => {
    render(BoundaryWithBuggyChild, {
        props: { attachProps: true, shouldThrow: true },
    });
    await new Promise((r) => setTimeout(r, 0));
    const attributes = mockReport.mock.calls[0][1];
    const props = attributes['context.custom'].svelte.componentProps;
    if (props && 'propsDenylist' in props) {
        expect(props.propsDenylist).toBe('[Object]');
    }
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/svelte && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/
git commit -m "feat(svelte): add props capture to FlareErrorBoundary"
```

---

### Task 4: Create `@flareapp/sveltekit` package scaffold

Create the new package with package.json, tsconfig, vitest config, and basic structure.

**Files:**

- Create: `packages/sveltekit/package.json`
- Create: `packages/sveltekit/tsconfig.json`
- Create: `packages/sveltekit/vitest.config.mts`
- Create: `packages/sveltekit/src/constants.ts`
- Create: `packages/sveltekit/src/types.ts`
- Create: `packages/sveltekit/src/convertToError.ts`
- Create: `packages/sveltekit/src/contextToAttributes.ts`
- Create: `packages/sveltekit/src/identify.ts`
- Create: `packages/sveltekit/src/index.ts`

- [ ] **Step 1: Create package.json**

Create `packages/sveltekit/package.json`:

```json
{
    "name": "@flareapp/sveltekit",
    "version": "2.0.0",
    "description": "SvelteKit integration for flareapp.io",
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
    "main": "./dist/index.js",
    "module": "./dist/index.js",
    "svelte": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": {
            "svelte": "./dist/index.js",
            "import": {
                "types": "./dist/index.d.ts",
                "default": "./dist/index.js"
            }
        },
        "./client": {
            "svelte": "./dist/client/index.js",
            "import": {
                "types": "./dist/client/index.d.ts",
                "default": "./dist/client/index.js"
            }
        },
        "./server": {
            "svelte": "./dist/server/index.js",
            "import": {
                "types": "./dist/server/index.d.ts",
                "default": "./dist/server/index.js"
            }
        }
    },
    "scripts": {
        "prepublishOnly": "npm run build",
        "build": "svelte-package -i src -o dist",
        "test": "vitest run",
        "typescript": "tsc --noEmit",
        "release": "release-it"
    },
    "devDependencies": {
        "@flareapp/js": "file:../js",
        "@flareapp/svelte": "file:../svelte",
        "@sveltejs/kit": "^2.0.0",
        "@sveltejs/package": "^2.5.7",
        "@sveltejs/vite-plugin-svelte": "^5.0.0",
        "svelte": "^5.0.0",
        "typescript": "^5.7.0",
        "vitest": "^4.0.0"
    },
    "peerDependencies": {
        "@flareapp/js": "^2.0.0",
        "@flareapp/svelte": "^2.0.0",
        "@sveltejs/kit": "^2.0.0",
        "svelte": "^5.0.0"
    },
    "publishConfig": {
        "access": "public"
    }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/sveltekit/tsconfig.json`:

```json
{
    "extends": "../../tsconfig.json",
    "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.mts**

Create `packages/sveltekit/vitest.config.mts`:

```typescript
import path from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    resolve: {
        alias: {
            '$app/state': path.resolve('./tests/__mocks__/app-state.ts'),
        },
    },
    test: {
        environment: 'node',
    },
});
```

- [ ] **Step 4: Create src/constants.ts**

Create `packages/sveltekit/src/constants.ts`:

```typescript
import { version } from '../package.json';

export const PACKAGE_VERSION = version;
```

- [ ] **Step 5: Create src/types.ts**

Create `packages/sveltekit/src/types.ts`:

```typescript
import type { FlareSvelteContext } from '@flareapp/svelte';

export interface SvelteKitRouteContext {
    routeId: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
}

export interface FlareSvelteKitContext extends FlareSvelteContext {
    svelte: FlareSvelteContext['svelte'] & {
        svelteKit?: SvelteKitRouteContext & {
            status?: number;
            message?: string;
        };
    };
}

export interface HandleErrorWithFlareOptions {
    beforeEvaluate?: (params: { error: Error; status: number; message: string }) => void;
    beforeSubmit?: (params: {
        error: Error;
        status: number;
        message: string;
        context: FlareSvelteKitContext;
    }) => FlareSvelteKitContext;
    afterSubmit?: (params: { error: Error; status: number; message: string; context: FlareSvelteKitContext }) => void;
}
```

- [ ] **Step 6: Create src/convertToError.ts**

Create `packages/sveltekit/src/convertToError.ts`:

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

- [ ] **Step 7: Create src/contextToAttributes.ts**

Create `packages/sveltekit/src/contextToAttributes.ts`:

```typescript
import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareSvelteKitContext } from './types';

export function contextToAttributes(context: FlareSvelteKitContext): Attributes {
    return {
        'context.custom': {
            framework: 'svelte',
            svelte: context.svelte as unknown as AttributeValue,
        },
    };
}
```

- [ ] **Step 8: Create src/identify.ts**

Create `packages/sveltekit/src/identify.ts`:

```typescript
import { flare } from '@flareapp/js';

import { PACKAGE_VERSION } from './constants';

let registered = false;

export function registerSvelteKitSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'SvelteKit' });
}
```

- [ ] **Step 9: Create src/index.ts**

Create `packages/sveltekit/src/index.ts`:

```typescript
export * from '@flareapp/svelte';
```

- [ ] **Step 10: Run npm install to set up workspace links**

Run: `npm install`
Expected: workspace linking resolves `@flareapp/sveltekit`

- [ ] **Step 11: Commit**

```bash
git add packages/sveltekit/
git commit -m "feat(sveltekit): create package scaffold"
```

---

### Task 5: Implement `@flareapp/sveltekit` client sub-path

Build the client-side error handling: `handleErrorWithFlare`, `captureError`, and route context.

**Files:**

- Create: `packages/sveltekit/src/client/index.ts`
- Create: `packages/sveltekit/src/client/handleError.ts`
- Create: `packages/sveltekit/src/client/captureError.ts`
- Create: `packages/sveltekit/src/client/getRouteContext.ts`
- Create: `packages/sveltekit/src/client/app-state.d.ts`
- Create: `packages/sveltekit/tests/__mocks__/app-state.ts`
- Create: `packages/sveltekit/tests/client/handleError.test.ts`
- Create: `packages/sveltekit/tests/client/captureError.test.ts`
- Create: `packages/sveltekit/tests/client/getRouteContext.test.ts`

- [ ] **Step 1: Create app-state.d.ts**

Create `packages/sveltekit/src/client/app-state.d.ts`:

```typescript
declare module '$app/state' {
    const page: {
        url: URL;
        params: Record<string, string>;
        route: { id: string | null };
    };
}
```

- [ ] **Step 2: Create getRouteContext.ts**

Create `packages/sveltekit/src/client/getRouteContext.ts` (moved from svelte package):

```typescript
import { DEFAULT_URL_DENYLIST } from '@flareapp/js';

import type { SvelteKitRouteContext } from '../types';

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

export async function getRouteContext(): Promise<SvelteKitRouteContext | null> {
    const importPromise = loadAppState();

    if (!importPromise) {
        return null;
    }

    try {
        const { page } = await importPromise;

        return {
            routeId: page.route?.id ?? null,
            url: page.url.pathname,
            params: { ...page.params },
            query: redactQueryParams(page.url.searchParams),
        };
    } catch {
        return null;
    }
}
```

Note: the field is renamed from `id` to `routeId` to match the spec's `SvelteKitRouteContext` interface.

- [ ] **Step 3: Create captureError.ts (client)**

Create `packages/sveltekit/src/client/captureError.ts`:

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { convertToError } from '../convertToError';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext } from '../types';

import { getRouteContext } from './getRouteContext';

registerSvelteKitSdkIdentity();

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export async function captureError(rawError: unknown, options?: CaptureErrorOptions): Promise<void> {
    const error = convertToError(rawError);
    const route = await getRouteContext();

    const context: FlareSvelteKitContext = {
        svelte: {
            componentName: null,
            componentHierarchy: [],
            errorOrigin: 'unknown',
            ...(route
                ? {
                      svelteKit: {
                          ...route,
                          ...(options?.status !== undefined ? { status: options.status } : {}),
                          ...(options?.message !== undefined ? { message: options.message } : {}),
                      },
                  }
                : {
                      ...(options?.status !== undefined || options?.message !== undefined
                          ? {
                                svelteKit: {
                                    routeId: null,
                                    url: '',
                                    params: {},
                                    query: {},
                                    ...(options?.status !== undefined ? { status: options.status } : {}),
                                    ...(options?.message !== undefined ? { message: options.message } : {}),
                                },
                            }
                          : {}),
                  }),
        },
    };

    Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});
}
```

- [ ] **Step 4: Create handleError.ts (client)**

Create `packages/sveltekit/src/client/handleError.ts`:

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { convertToError } from '../convertToError';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext, HandleErrorWithFlareOptions } from '../types';

import { getRouteContext } from './getRouteContext';

registerSvelteKitSdkIdentity();

interface HandleErrorInput {
    error: unknown;
    event?: unknown;
    status: number;
    message: string;
}

type HandleErrorFn = (input: HandleErrorInput) => void | Promise<void>;

function is4xxError(input: HandleErrorInput): boolean {
    return input.status >= 400 && input.status < 500;
}

export function handleErrorWithFlare(handlerOrOptions?: HandleErrorFn | HandleErrorWithFlareOptions): HandleErrorFn {
    const isOptions =
        handlerOrOptions !== undefined && typeof handlerOrOptions === 'object' && handlerOrOptions !== null;
    const userHandler: HandleErrorFn | undefined =
        typeof handlerOrOptions === 'function' ? handlerOrOptions : undefined;
    const options: HandleErrorWithFlareOptions | undefined = isOptions ? handlerOrOptions : undefined;

    return async (input: HandleErrorInput) => {
        if (is4xxError(input)) {
            userHandler?.(input);
            return;
        }

        const error = convertToError(input.error);

        options?.beforeEvaluate?.({ error, status: input.status, message: input.message });

        const route = await getRouteContext();

        let context: FlareSvelteKitContext = {
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                svelteKit: {
                    ...(route ?? { routeId: null, url: '', params: {}, query: {} }),
                    status: input.status,
                    message: input.message,
                },
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, status: input.status, message: input.message, context });
        }

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, status: input.status, message: input.message, context });

        userHandler?.(input);
    };
}
```

- [ ] **Step 5: Create client/index.ts**

Create `packages/sveltekit/src/client/index.ts`:

```typescript
export { handleErrorWithFlare } from './handleError';
export { captureError, type CaptureErrorOptions } from './captureError';
export type { HandleErrorWithFlareOptions } from '../types';
```

- [ ] **Step 6: Create test mock**

Create `packages/sveltekit/tests/__mocks__/app-state.ts`:

```typescript
export const page = {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
};
```

- [ ] **Step 7: Write tests for getRouteContext**

Create `packages/sveltekit/tests/client/getRouteContext.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getRouteContext } from '../../src/client/getRouteContext';

vi.mock('@flareapp/js', () => ({
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

const mockPage = await vi.hoisted(async () => {
    const { page } = await import('../../tests/__mocks__/app-state');
    return page;
});

vi.mock('$app/state', () => ({
    page: mockPage,
}));

beforeEach(() => {
    mockPage.url = new URL('http://localhost/');
    mockPage.params = {};
    mockPage.route = { id: null };
});

describe('getRouteContext', () => {
    test('extracts route context from page state', async () => {
        mockPage.url = new URL('http://localhost/users/42?sort=name');
        mockPage.params = { id: '42' };
        mockPage.route = { id: '/users/[id]' };

        const context = await getRouteContext();

        expect(context).toEqual({
            routeId: '/users/[id]',
            url: '/users/42',
            params: { id: '42' },
            query: { sort: 'name' },
        });
    });

    test('redacts sensitive query params', async () => {
        mockPage.url = new URL('http://localhost/login?username=alice&password=secret&token=abc');

        const context = await getRouteContext();

        expect(context?.query).toEqual({
            username: 'alice',
            password: '[redacted]',
            token: '[redacted]',
        });
    });

    test('handles null route id', async () => {
        mockPage.route = { id: null };

        const context = await getRouteContext();

        expect(context?.routeId).toBeNull();
    });

    test('handles routes with no query params', async () => {
        mockPage.url = new URL('http://localhost/about');

        const context = await getRouteContext();

        expect(context?.query).toEqual({});
    });
});
```

- [ ] **Step 8: Write tests for handleErrorWithFlare (client)**

Create `packages/sveltekit/tests/client/handleError.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { handleErrorWithFlare } from '../../src/client/handleError';

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

vi.mock('@flareapp/svelte', () => ({}));

vi.mock('$app/state', () => ({
    page: {
        url: new URL('http://localhost/test'),
        params: {},
        route: { id: '/test' },
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('handleErrorWithFlare (client)', () => {
    test('returns a function', () => {
        const handler = handleErrorWithFlare();
        expect(typeof handler).toBe('function');
    });

    test('reports 5xx errors to flare', async () => {
        const handler = handleErrorWithFlare();
        const error = new Error('server error');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('server error');
    });

    test('skips 4xx errors', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('passes svelteKit context in attributes', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].framework).toBe('svelte');
        expect(attributes['context.custom'].svelte.svelteKit).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('passes through to user handler', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls user handler for 4xx errors without reporting', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('accepts options with hooks', async () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = handleErrorWithFlare({
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

    test('converts non-Error values', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 9: Write tests for captureError (client)**

Create `packages/sveltekit/tests/client/captureError.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { captureError } from '../../src/client/captureError';

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

vi.mock('@flareapp/svelte', () => ({}));

vi.mock('$app/state', () => ({
    page: {
        url: new URL('http://localhost/test'),
        params: {},
        route: { id: '/test' },
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('captureError (client)', () => {
    test('reports error to flare', async () => {
        const error = new Error('test error');
        await captureError(error);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values', async () => {
        await captureError('string error');

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('includes route context', async () => {
        await captureError(new Error('test'));

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit.routeId).toBe('/test');
    });

    test('includes status and message when provided', async () => {
        await captureError(new Error('test'), { status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('works without options', async () => {
        await captureError(new Error('test'));

        expect(mockReport).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 10: Run tests**

Run: `cd packages/sveltekit && npx vitest run`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add packages/sveltekit/
git commit -m "feat(sveltekit): implement client sub-path with handleError, captureError, route context"
```

---

### Task 6: Implement `@flareapp/sveltekit` server sub-path

Build the server-side error handling: `handleErrorWithFlare` and `captureError` for `hooks.server.ts`.

**Files:**

- Create: `packages/sveltekit/src/server/index.ts`
- Create: `packages/sveltekit/src/server/handleError.ts`
- Create: `packages/sveltekit/src/server/captureError.ts`
- Create: `packages/sveltekit/tests/server/handleError.test.ts`
- Create: `packages/sveltekit/tests/server/captureError.test.ts`

- [ ] **Step 1: Create captureError.ts (server)**

Create `packages/sveltekit/src/server/captureError.ts`:

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { convertToError } from '../convertToError';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext } from '../types';

registerSvelteKitSdkIdentity();

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export async function captureError(rawError: unknown, options?: CaptureErrorOptions): Promise<void> {
    const error = convertToError(rawError);

    const context: FlareSvelteKitContext = {
        svelte: {
            componentName: null,
            componentHierarchy: [],
            errorOrigin: 'unknown',
            ...(options?.status !== undefined || options?.message !== undefined
                ? {
                      svelteKit: {
                          routeId: null,
                          url: '',
                          params: {},
                          query: {},
                          ...(options?.status !== undefined ? { status: options.status } : {}),
                          ...(options?.message !== undefined ? { message: options.message } : {}),
                      },
                  }
                : {}),
        },
    };

    Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});
}
```

Note: the server version does NOT use `$app/state` (that's client-only). Route information from the server's `event` object could be added later but is out of scope for now — users who need it can use `beforeSubmit`.

- [ ] **Step 2: Create handleError.ts (server)**

Create `packages/sveltekit/src/server/handleError.ts`:

```typescript
import { flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { convertToError } from '../convertToError';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext, HandleErrorWithFlareOptions } from '../types';

registerSvelteKitSdkIdentity();

interface HandleErrorInput {
    error: unknown;
    event?: unknown;
    status: number;
    message: string;
}

type HandleErrorFn = (input: HandleErrorInput) => void | Promise<void>;

function is4xxError(input: HandleErrorInput): boolean {
    return input.status >= 400 && input.status < 500;
}

export function handleErrorWithFlare(handlerOrOptions?: HandleErrorFn | HandleErrorWithFlareOptions): HandleErrorFn {
    const isOptions =
        handlerOrOptions !== undefined && typeof handlerOrOptions === 'object' && handlerOrOptions !== null;
    const userHandler: HandleErrorFn | undefined =
        typeof handlerOrOptions === 'function' ? handlerOrOptions : undefined;
    const options: HandleErrorWithFlareOptions | undefined = isOptions ? handlerOrOptions : undefined;

    return async (input: HandleErrorInput) => {
        if (is4xxError(input)) {
            userHandler?.(input);
            return;
        }

        const error = convertToError(input.error);

        options?.beforeEvaluate?.({ error, status: input.status, message: input.message });

        let context: FlareSvelteKitContext = {
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                svelteKit: {
                    routeId: null,
                    url: '',
                    params: {},
                    query: {},
                    status: input.status,
                    message: input.message,
                },
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, status: input.status, message: input.message, context });
        }

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, status: input.status, message: input.message, context });

        userHandler?.(input);
    };
}
```

- [ ] **Step 3: Create server/index.ts**

Create `packages/sveltekit/src/server/index.ts`:

```typescript
export { handleErrorWithFlare } from './handleError';
export { captureError, type CaptureErrorOptions } from './captureError';
export type { HandleErrorWithFlareOptions } from '../types';
```

- [ ] **Step 4: Write tests for handleErrorWithFlare (server)**

Create `packages/sveltekit/tests/server/handleError.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { handleErrorWithFlare } from '../../src/server/handleError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

vi.mock('@flareapp/svelte', () => ({}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('handleErrorWithFlare (server)', () => {
    test('returns a function', () => {
        const handler = handleErrorWithFlare();
        expect(typeof handler).toBe('function');
    });

    test('reports 5xx errors to flare', async () => {
        const handler = handleErrorWithFlare();
        const error = new Error('server error');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0].message).toBe('server error');
    });

    test('skips 4xx errors', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('passes svelteKit context in attributes', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].framework).toBe('svelte');
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('passes through to user handler', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls user handler for 4xx errors without reporting', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = handleErrorWithFlare({
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

    test('converts non-Error values', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
```

- [ ] **Step 5: Write tests for captureError (server)**

Create `packages/sveltekit/tests/server/captureError.test.ts`:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { captureError } from '../../src/server/captureError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
}));

vi.mock('@flareapp/svelte', () => ({}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('captureError (server)', () => {
    test('reports error to flare', async () => {
        const error = new Error('test error');
        await captureError(error);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values', async () => {
        await captureError('string error');

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('includes status and message when provided', async () => {
        await captureError(new Error('test'), { status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('works without options', async () => {
        await captureError(new Error('test'));

        expect(mockReport).toHaveBeenCalledOnce();
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit).toBeUndefined();
    });
});
```

- [ ] **Step 6: Run all sveltekit tests**

Run: `cd packages/sveltekit && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/sveltekit/src/server/ packages/sveltekit/tests/server/
git commit -m "feat(sveltekit): implement server sub-path with handleError and captureError"
```

---

### Task 7: Final integration verification

Run all tests across the monorepo, verify type-checking, and ensure builds succeed.

**Files:** None (verification only)

- [ ] **Step 1: Install dependencies**

Run: `npm install`
Expected: Clean install with workspace linking

- [ ] **Step 2: Type-check all packages**

Run: `npm run typescript`
Expected: No type errors

- [ ] **Step 3: Build all packages**

Run: `npm run build`
Expected: Clean build (svelte package builds before sveltekit since sveltekit depends on it)

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: All tests pass across all packages

- [ ] **Step 5: Verify svelte package exports**

Run: `node -e "const pkg = require('./packages/svelte/package.json'); console.log(JSON.stringify(pkg.peerDependencies, null, 2))"`
Expected: No `@sveltejs/kit` in peer dependencies

- [ ] **Step 6: Verify sveltekit package exports**

Run: `node -e "const pkg = require('./packages/sveltekit/package.json'); console.log(JSON.stringify(pkg.exports, null, 2))"`
Expected: Three exports: `.`, `./client`, `./server`

- [ ] **Step 7: Commit any fixes**

If any issues found in steps 1-6, fix and commit:

```bash
git add -A
git commit -m "fix: resolve integration issues from svelte/sveltekit split"
```

---

### Task 8: Update CLAUDE.md monorepo table

Update the monorepo structure table in CLAUDE.md to include the new sveltekit package.

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update monorepo structure table**

In `CLAUDE.md`, update the monorepo structure table to add the sveltekit package and update the svelte description:

```markdown
| Package              | npm name              | Purpose                                                           |
| -------------------- | --------------------- | ----------------------------------------------------------------- |
| `packages/js`        | `@flareapp/js`        | Core client — error capture, stack traces, context, API reporting |
| `packages/react`     | `@flareapp/react`     | React `FlareErrorBoundary` error boundary component               |
| `packages/vue`       | `@flareapp/vue`       | Vue error handler plugin (`flareVue()`)                           |
| `packages/svelte`    | `@flareapp/svelte`    | Svelte 5 `FlareErrorBoundary` with props serialization            |
| `packages/sveltekit` | `@flareapp/sveltekit` | SvelteKit error hooks (`handleErrorWithFlare`) + route context    |
| `packages/vite`      | `@flareapp/vite`      | Vite build plugin for sourcemap upload with retry logic           |
| `playground`         | (private)             | Local dev/test app for all integrations (JS, React, Vue, Svelte)  |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update monorepo structure table with sveltekit package"
```
