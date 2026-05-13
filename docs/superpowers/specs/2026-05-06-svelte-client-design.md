# @flareapp/svelte -- Design Spec

**Date:** 2026-05-06
**Status:** Approved
**Branch:** feat/svelte-client

## Summary

New `@flareapp/svelte` package for Flare error tracking. Svelte 5 only. Provides a `FlareErrorBoundary` component, a `createFlareErrorHandler` factory for custom boundary usage, and a `flareSvelteErrorHandler` for SvelteKit's client-side `handleError` hook.

## Decisions

| Decision              | Choice                                                         | Rationale                                                                                                                |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Svelte version        | 5 only                                                         | Runes API is fundamentally different from Svelte 4. Supporting both adds complexity for diminishing returns.             |
| SvelteKit integration | Optional `handleError` wrapper in same package                 | SvelteKit is how most Svelte apps are built. Lightweight addition, no separate package.                                  |
| Context richness      | Minimal (component name + error origin). Design for extension. | Svelte 5 internal component tree is less publicly accessible than Vue's `$parent` chain. Ship solid first, extend later. |
| Error propagation     | Boundary prevents propagation                                  | Matches Vue behavior. Simple mental model: boundary owns subtree errors. SvelteKit `handleError` catches the rest.       |
| Architecture          | Component + handler factory + SvelteKit handler                | Covers both "give me a component" and "I'll wire it myself" use cases.                                                   |

## Package structure

```
packages/svelte/
  src/
    index.ts
    identify.ts
    FlareErrorBoundary.svelte
    createFlareErrorHandler.ts
    flareSvelteErrorHandler.ts
    convertToError.ts
    types.ts
  tests/
    FlareErrorBoundary.test.ts
    createFlareErrorHandler.test.ts
    flareSvelteErrorHandler.test.ts
  package.json
  tsconfig.json
  tsdown.config.ts
  vitest.config.ts
  .release-it.json
```

**package.json:**

- Name: `@flareapp/svelte`
- Version: `2.0.0`
- Peer deps: `@flareapp/js ^2.0.0`, `svelte ^5.0.0`
- Optional peer dep: `@sveltejs/kit ^2.0.0`
- Build: `tsdown` (CJS + ESM + .d.ts declarations)
- Same patterns as `@flareapp/react` and `@flareapp/vue`

## Public API

```typescript
// Component
export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

// Handler factory
export { createFlareErrorHandler } from './createFlareErrorHandler';
export type { FlareErrorHandlerOptions } from './createFlareErrorHandler';

// SvelteKit integration
export { flareSvelteErrorHandler } from './flareSvelteErrorHandler';
export type { FlareSvelteErrorHandlerOptions } from './flareSvelteErrorHandler';

// Types
export type { FlareSvelteContext } from './types';
```

## FlareErrorBoundary component

Svelte 5 component wrapping `<svelte:boundary>`.

### Props

```typescript
interface Props {
    children: Snippet;
    failed?: Snippet<[error: Error, reset: () => void]>;
    resetKeys?: unknown[];
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
    onReset?: (error: Error | null) => void;
}
```

### Implementation

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { FlareSvelteContext } from './types';
  import { createFlareErrorHandler } from './createFlareErrorHandler';
  import './identify';

  interface Props {
    children: Snippet;
    failed?: Snippet<[error: Error, reset: () => void]>;
    resetKeys?: unknown[];
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
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

  // Reset when resetKeys change (skip first run)
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
    const handler = createFlareErrorHandler({ beforeEvaluate, beforeSubmit, afterSubmit });
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    currentError = error;
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

### Behavior

- Consumer's `failed` prop destructured as `fallbackSnippet` to avoid name collision with boundary's special `failed` snippet.
- Reset passed to consumer is `handleReset` (wrapper), not raw boundary reset. Clears state and fires `onReset`.
- `resetKeys` tracked via `$effect` with serialized JSON comparison, skips first run.
- Error propagation stopped by boundary.
- No fallback snippet provided = error caught and reported, content removed silently.
- Component delegates core reporting logic to `createFlareErrorHandler` to avoid duplication.

### Usage

```svelte
<FlareErrorBoundary
  beforeSubmit={({ error, context }) => context}
  afterSubmit={({ error, context }) => console.log('reported', error)}
>
  <MyApp />
  {#snippet failed(error, reset)}
    <p>Something went wrong: {error.message}</p>
    <button onclick={reset}>Retry</button>
  {/snippet}
</FlareErrorBoundary>
```

## createFlareErrorHandler factory

Returns a callback matching `<svelte:boundary>`'s `onerror` signature. Used internally by FlareErrorBoundary and available for users who want custom boundary wiring.

```typescript
import { flare } from '@flareapp/js';
import { convertToError } from './convertToError';
import type { FlareSvelteContext } from './types';
import './identify';

export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return (rawError: unknown, reset: () => void) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        let context: FlareSvelteContext = { svelte: {} };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, context });
        }

        flare.report(error, { context: { custom: context } }).catch(() => {});

        options?.afterSubmit?.({ error, context });
    };
}
```

### Usage

```svelte
<svelte:boundary onerror={createFlareErrorHandler({ afterSubmit: ({ error }) => log(error) })}>
  <MyApp />
  {#snippet failed(error, reset)}
    <p>{error.message}</p>
    <button onclick={reset}>Retry</button>
  {/snippet}
</svelte:boundary>
```

## flareSvelteErrorHandler (SvelteKit)

Wraps SvelteKit's client-side `handleError` hook signature.

```typescript
import { flare } from '@flareapp/js';
import { convertToError } from './convertToError';
import type { FlareSvelteContext } from './types';
import './identify';

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

        flare.report(error, { context: { custom: context } }).catch(() => {});

        options?.afterSubmit?.({ error, status, message, context });
    };
}
```

### Usage

```typescript
// src/hooks.client.ts
import { flareSvelteErrorHandler } from '@flareapp/svelte';

export const handleError = flareSvelteErrorHandler({
    beforeSubmit: ({ error, status, context }) => {
        console.log(`[${status}]`, error.message);
        return context;
    },
});
```

## Types

```typescript
// types.ts
export interface FlareSvelteContext {
    svelte: {
        svelteKit?: {
            status: number;
            message: string;
        };
    };
}
```

Designed for extension. Future additions (component hierarchy, props, error origin) add fields to `svelte`:

```typescript
// future shape
svelte: {
  componentName?: string;
  componentHierarchy?: string[];
  svelteKit?: { status: number; message: string };
}
```

## Utilities

```typescript
// convertToError.ts
export function convertToError(value: unknown): Error {
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    try {
        return new Error(JSON.stringify(value));
    } catch {
        return new Error(String(value));
    }
}
```

```typescript
// identify.ts
import { flare } from '@flareapp/js';
import { VERSION as svelteVersion } from 'svelte';

let identified = false;

if (!identified) {
    identified = true;
    flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'Svelte', version: svelteVersion });
}
```

`PACKAGE_VERSION` injected at build time by tsdown. `VERSION` from `svelte` gives runtime Svelte version.

## Tests

All tests use vitest + jsdom. Mock `@flareapp/js` to test in isolation.

### FlareErrorBoundary.test.ts

Using `@testing-library/svelte`:

- Renders children when no error
- Catches error, reports to Flare, renders fallback snippet
- Passes error and reset function to fallback
- Reset clears error state, re-renders children
- Calls `beforeEvaluate` with error
- Calls `beforeSubmit` with error + context, uses returned context
- Calls `afterSubmit` after report
- Hook call order: beforeEvaluate -> beforeSubmit -> report -> afterSubmit
- Swallows report rejection (no unhandled promise)
- `resetKeys` change triggers reset when in error state
- `resetKeys` change does nothing when no error
- `onReset` called with error on reset
- No fallback snippet = content removed silently on error

### createFlareErrorHandler.test.ts

- Returns function matching `(error, reset)` signature
- Reports error to Flare with svelte context
- Calls all three hooks in order
- Works with no options
- Converts non-Error values to Error

### flareSvelteErrorHandler.test.ts

- Returns function matching SvelteKit `handleError` signature `{ error, status, message }`
- Reports error with svelteKit context (status + message)
- Calls all three hooks with status and message params
- Works with no options
- Converts non-Error values to Error

## Playground

Add Svelte playground page alongside existing React and Vue pages.

### New files

```
playground/
  svelte/
    index.html
    main.ts
    App.svelte
    sections/
      RenderErrorSection.svelte
      ResetKeysSection.svelte
      OnClickErrorSection.svelte
      AsyncErrorSection.svelte
      ManualReportSection.svelte
    components/
      BuggyComponent.svelte
      Button.svelte
      TestSection.svelte
```

### Integration

- Vite config: add svelte entry point to multi-page setup, add `@sveltejs/vite-plugin-svelte`
- playground/package.json: add `svelte`, `@sveltejs/vite-plugin-svelte` as dev deps, `@flareapp/svelte` as local dep
- Same structure as React/Vue playgrounds, each section tests one error scenario

## Out of scope (future work)

- Component hierarchy walking (needs stable Svelte 5 internals)
- Props serialization via `$props()` rune
- Error origin classification (render vs lifecycle vs event)
- Server-side SvelteKit hooks (`hooks.server.ts`)
- SvelteKit route context capture
