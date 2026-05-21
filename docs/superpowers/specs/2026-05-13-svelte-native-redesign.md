# Svelte-Native Client Redesign

## Summary

Redesign the Flare Svelte client to be idiomatically Svelte 5. Split into two packages: `@flareapp/svelte` (pure Svelte
5, no SvelteKit dependency) and `@flareapp/sveltekit` (SvelteKit-specific hooks, route context, client/server
separation). Add props serialization with full redaction support. Provide both wrapper and direct-call hook APIs.

## Motivation

The current `@flareapp/svelte` package was built by replicating patterns from the React and Vue clients. While
functional, it doesn't leverage Svelte 5's unique strengths and bundles SvelteKit-specific code that vanilla Svelte 5
users don't need. Svelte developers expect libraries to feel native to the framework.

Sentry's approach (no error boundary, stores-based, Svelte 3-5 compat) confirms there's an opportunity: by targeting
only Svelte 5 and using runes, snippets, and `$app/state`, Flare can provide a better developer experience than the
market leader.

## Design decisions

- **Svelte 5 only.** No backwards compatibility with Svelte 3/4. Enables runes, snippets, `svelte:boundary`.
- **Two packages.** `@flareapp/svelte` for any Svelte 5 app. `@flareapp/sveltekit` for SvelteKit-specific features.
- **Error hooks only for SvelteKit.** No load function wrapping, no navigation tracing, no form action handling. Focused
  on error tracking.
- **Props capture with full serialization.** Ported from Vue, adapted for Svelte 5 proxies (`$state.snapshot()`).
- **BYO fallback.** No pre-built fallback UI. Users provide their own via snippet.
- **Both hook API styles.** Wrapper for quick setup, direct call for control.
- **Build with svelte-package.** Both packages use the official Svelte library build tool.

---

## Package 1: `@flareapp/svelte`

### Purpose

Pure Svelte 5 error boundary and error handling. Works in any Svelte 5 app (SvelteKit, standalone, etc.).

### Peer dependencies

- `svelte ^5.0.0`
- `@flareapp/js ^2.0.0`

### Public API

```typescript
// Components
export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

// Handler factory
export { createFlareErrorHandler } from './createFlareErrorHandler';

// Types
export type { FlareSvelteContext, SvelteErrorOrigin, FlareErrorBoundaryProps, FlareErrorHandlerOptions } from './types';
```

### FlareErrorBoundary component

Uses `svelte:boundary` (Svelte 5 native error boundary).

**Props:**

| Prop                     | Type                          | Default                  | Description                                 |
| ------------------------ | ----------------------------- | ------------------------ | ------------------------------------------- |
| `resetKeys`              | `unknown[]`                   | `[]`                     | When any value changes, reset the boundary  |
| `beforeEvaluate`         | `(params) => boolean \| void` | -                        | Filter errors before processing             |
| `beforeSubmit`           | `(params) => context`         | -                        | Modify context before submission            |
| `afterSubmit`            | `(params) => void`            | -                        | Post-submission callback                    |
| `onReset`                | `(error: Error) => void`      | -                        | Called when boundary resets                 |
| `attachProps`            | `boolean`                     | `false`                  | Capture and serialize child component props |
| `propsMaxDepth`          | `number`                      | `2`                      | Max depth for props serialization           |
| `propsDenylist`          | `RegExp`                      | `DEFAULT_PROPS_DENYLIST` | Pattern for keys to redact                  |
| `replaceDefaultDenylist` | `boolean`                     | `false`                  | Replace (not extend) default deny list      |

**Snippet-based fallback:**

```svelte
<FlareErrorBoundary>
  <YourContent />

  {#snippet failed(error, reset)}
    <p>{error.message}</p>
    <button onclick={reset}>Retry</button>
  {/snippet}
</FlareErrorBoundary>
```

**Internal implementation patterns:**

- `$state.raw` for error objects (replaced, not mutated)
- `$effect` for resetKeys watching
- `$props()` for all props
- `$derived` for computed values dependent on props
- Async error handler chain

### Context shape

```typescript
interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: SvelteErrorOrigin; // 'render' | 'event' | 'effect' | 'unknown'
        componentProps?: Record<string, unknown>;
    };
}
```

### Props serialization

Ported from Vue's `serializeProps.ts`, adapted for Svelte 5.

**Svelte-specific adaptation:** Calls `$state.snapshot()` on Svelte proxy objects before walking them. This unwraps
reactive state to plain objects for safe serialization.

**Serialization rules:**

| Type                        | Serialized as                      |
| --------------------------- | ---------------------------------- |
| `string`                    | Truncated at 1000 chars            |
| `number`, `boolean`, `null` | As-is                              |
| `undefined`                 | `'[undefined]'`                    |
| `function`                  | `'[Function]'`                     |
| `symbol`                    | `'[Symbol]'`                       |
| `bigint`                    | `.toString()`                      |
| `Date`, `Map`, `Set`        | `'[Object]'`                       |
| Plain object                | Recurse (max depth, max 100 keys)  |
| Array                       | Recurse (max depth, max 100 items) |
| Circular ref                | `'[Circular]'`                     |
| Denied key                  | `'[Redacted]'`                     |

**Configuration constants:**

- `MAX_PROP_STRING_LENGTH`: 1000
- `MAX_PROP_ARRAY_LENGTH`: 100
- `MAX_PROP_OBJECT_KEYS`: 100
- `DEFAULT_PROPS_DENYLIST`:
  `/password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i`

### File structure

```
packages/svelte/
  src/
    index.ts
    types.ts
    constants.ts
    FlareErrorBoundary.svelte
    createFlareErrorHandler.ts
    convertToError.ts
    contextToAttributes.ts
    extractComponentInfo.ts
    getErrorOrigin.ts
    identify.ts
    serializeProps.ts           # NEW
  tests/
    FlareErrorBoundary.test.ts
    serializeProps.test.ts      # NEW
    createFlareErrorHandler.test.ts
    extractComponentInfo.test.ts
    getErrorOrigin.test.ts
  package.json
  svelte.config.js
  tsconfig.json
```

---

## Package 2: `@flareapp/sveltekit`

### Purpose

SvelteKit-specific integration. Provides error hook handlers and route context extraction. Depends on `@flareapp/svelte`
for the error boundary component.

### Peer dependencies

- `svelte ^5.0.0`
- `@flareapp/js ^2.0.0`
- `@flareapp/svelte ^2.0.0`
- `@sveltejs/kit ^2.0.0`

### Package exports (conditional)

```json
{
    "exports": {
        ".": {
            "types": "./dist/index.d.ts",
            "svelte": "./dist/index.js"
        },
        "./client": {
            "types": "./dist/client/index.d.ts",
            "svelte": "./dist/client/index.js"
        },
        "./server": {
            "types": "./dist/server/index.d.ts",
            "svelte": "./dist/server/index.js"
        }
    }
}
```

### Public API

**Root export** (`@flareapp/sveltekit`):

```typescript
// Re-export everything from @flareapp/svelte for convenience
// (so SvelteKit users can import FlareErrorBoundary from @flareapp/sveltekit)
export * from '@flareapp/svelte';
```

Note: the root export only re-exports `@flareapp/svelte`. It does NOT re-export client/server handlers because those
must be imported from the correct sub-path to avoid cross-environment contamination (importing server code in the
browser or vice versa).

**Client export** (`@flareapp/sveltekit/client`):

```typescript
export { handleErrorWithFlare } from './handleError';
export { captureError } from './captureError';
export type { HandleErrorWithFlareOptions } from '../types';
```

**Server export** (`@flareapp/sveltekit/server`):

```typescript
export { handleErrorWithFlare } from './handleError';
export { captureError } from './captureError';
export type { HandleErrorWithFlareOptions } from '../types';
```

### Hook APIs

**Wrapper style (recommended):**

```typescript
// hooks.client.ts
import { handleErrorWithFlare } from '@flareapp/sveltekit/client';
export const handleError = handleErrorWithFlare();

// With custom handler:
export const handleError = handleErrorWithFlare(({ error, event, status, message }) => {
    console.error('Custom:', error);
});

// With options:
export const handleError = handleErrorWithFlare({
    beforeSubmit: ({ context }) => context,
});
```

**Direct call style (advanced):**

```typescript
// hooks.client.ts
import { captureError } from '@flareapp/sveltekit/client';

export function handleError({ error, event, status, message }) {
    captureError(error, { event, status, message });
    // user's own logic
}
```

**Server hooks follow the same pattern:**

```typescript
// hooks.server.ts
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';
export const handleError = handleErrorWithFlare();
```

### Error filtering

- Skip 4xx status codes (expected errors in SvelteKit, not worth reporting)
- Only capture 5xx and unhandled errors

### Route context

Extracted automatically from `$app/state` (client) or the `event` object (server).

```typescript
interface SvelteKitRouteContext {
    routeId: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>; // Redacted via DEFAULT_URL_DENYLIST
    status?: number;
    message?: string;
}
```

Query parameters are redacted using `DEFAULT_URL_DENYLIST` from `@flareapp/js`.

### SDK identification

When `@flareapp/sveltekit` is used, it overrides `@flareapp/svelte`'s SDK registration:

```typescript
flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
flare.setFramework({ name: 'SvelteKit', version: svelteKitVersion });
```

### Extended context shape

When SvelteKit is active, the context includes the SvelteKit-specific fields:

```typescript
interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: SvelteErrorOrigin;
        componentProps?: Record<string, unknown>;
        svelteKit?: SvelteKitRouteContext;
    };
}
```

### File structure

```
packages/sveltekit/
  src/
    index.ts                     # Root: re-exports @flareapp/svelte + client + server
    types.ts                     # SvelteKit-specific types
    constants.ts                 # PACKAGE_VERSION
    identify.ts                  # SvelteKit SDK/framework registration
    client/
      index.ts                   # Client exports
      handleError.ts             # handleErrorWithFlare wrapper (client)
      captureError.ts            # Direct call API (client)
      getRouteContext.ts         # Route context from $app/state
    server/
      index.ts                   # Server exports
      handleError.ts             # handleErrorWithFlare wrapper (server)
      captureError.ts            # Direct call API (server)
  tests/
    client/
      handleError.test.ts
      captureError.test.ts
      getRouteContext.test.ts
    server/
      handleError.test.ts
      captureError.test.ts
    identify.test.ts
  package.json
  svelte.config.js
  tsconfig.json
```

---

## Migration from current `@flareapp/svelte`

### What moves to `@flareapp/sveltekit`

| Current file                 | New location                                                 |
| ---------------------------- | ------------------------------------------------------------ |
| `flareSvelteErrorHandler.ts` | Split into `client/handleError.ts` + `server/handleError.ts` |
| `getRouteContext.ts`         | `client/getRouteContext.ts`                                  |
| `app-state.d.ts`             | `client/app-state.d.ts`                                      |

### What stays in `@flareapp/svelte`

Everything else: boundary component, handler factory, context extraction, error origin detection, identify, types,
constants, convertToError, contextToAttributes.

### What's new

- `serializeProps.ts` in `@flareapp/svelte`
- `attachProps`, `propsMaxDepth`, `propsDenylist`, `replaceDefaultDenylist` props on `FlareErrorBoundary`
- Entire `@flareapp/sveltekit` package
- `captureError` direct-call API in both client and server

### Breaking changes

- `flareSvelteErrorHandler` moves from `@flareapp/svelte` to `@flareapp/sveltekit/server`
- Route context extraction moves to `@flareapp/sveltekit`
- Users who imported `flareSvelteErrorHandler` from `@flareapp/svelte` need to install `@flareapp/sveltekit` and update
  imports
- Since the package is new and has few users, this is acceptable

---

## Testing strategy

### `@flareapp/svelte` tests

- Error boundary rendering: children rendered, errors caught, fallback snippet shown
- Reset mechanism: resetKeys changes trigger reset, reset function from fallback works
- Props serialization: depth limits, size bounds, cycle detection, redaction, Svelte proxy unwrapping
- Hook callbacks: beforeEvaluate/beforeSubmit/afterSubmit called in correct order with correct params
- beforeEvaluate returning false skips submission
- Component context: name extraction, hierarchy building, error origin classification
- Error conversion: non-Error values normalized

### `@flareapp/sveltekit` tests

- handleErrorWithFlare wrapper: calls flare.report, passes through to user handler, composes correctly
- 4xx filtering: 4xx errors skipped, 5xx errors captured
- captureError direct call: reports with correct context shape
- Route context: extracts route ID, params, query; redacts sensitive query params
- SDK identification: correct SDK info and framework version registered
- Server variant: same tests but for server-side hooks

### Test tooling

Vitest + `@testing-library/svelte` (already in use).

---

## Svelte 5 patterns used

Per the svelte-core-bestpractices skill:

- `$state.raw` for error objects (replaced, not mutated — avoids proxy overhead)
- `$derived` for computed values from props (not `$effect` assignments)
- `$effect` only for resetKeys watching (side effect, not derivation)
- `$props()` for all component props
- `{#snippet ...}` and `{@render ...}` for fallback (not slots)
- `onclick={...}` event syntax (not `on:click`)
- Runes mode throughout (no legacy `$:`, `export let`, etc.)
- `$state.snapshot()` for unwrapping proxies before serialization

---

## Out of scope

- Load function wrapping/instrumentation
- Navigation tracking / breadcrumbs
- Form action error handling
- Svelte preprocessor for component tracking
- Pre-built fallback UI component
- Reactive Flare context via Svelte's createContext
- Svelte 3/4 compatibility
- Performance tracing
