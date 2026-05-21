# Svelte Context Enrichment

Adds component context, route context, and error origin detection to `@flareapp/svelte` error reports, bringing it closer to parity with `@flareapp/vue`.

## Approach: stack trace parsing + SvelteKit route detection

Zero runtime overhead. All extraction happens at error time only. No preprocessor, no build-time code injection, no Svelte context API usage.

- **Component context**: parse the error's stack trace to extract component names and hierarchy from `.svelte` frames.
- **Error origin**: detect whether the error occurred during render, an event handler, or an effect, using native browser frame patterns (never mangled in production).
- **Route context**: read SvelteKit's `$app/state` to capture current route info. Graceful fallback for non-SvelteKit apps.

## Context type

```typescript
interface FlareSvelteContext {
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

type SvelteErrorOrigin = 'render' | 'event' | 'effect' | 'unknown';

interface SvelteRouteContext {
    id: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
}
```

### Field definitions

- `componentName`: innermost (throwing) component name. Extracted from `functionName` in dev, filename stem as fallback. `null` if no `.svelte` frames found.
- `componentHierarchy`: ordered inner-to-outer, e.g. `["Button", "Card", "Layout", "App"]`. Empty array if unparseable.
- `errorOrigin`: best-effort classification of where in the component lifecycle the error occurred.
- `route`: SvelteKit route state at error time. Absent in non-SvelteKit apps.
- `svelteKit`: existing field, kept for server-side error handler. Contains HTTP status and message from SvelteKit's `handleError` hook.

## Component context extraction

New module: `src/extractComponentInfo.ts`

### Interface

```typescript
function extractComponentInfo(error: Error): {
    componentName: string | null;
    componentHierarchy: string[];
};
```

### Algorithm

1. Parse `error.stack` using `error-stack-parser`.
2. Filter frames where `fileName` contains `.svelte`.
3. For each matching frame, extract component name:
    - Use `functionName` if available (dev mode: Svelte 5 compiles `Button.svelte` to `function Button()`).
    - Fallback: extract filename stem from `fileName` (`/src/lib/Button.svelte` -> `Button`).
4. Deduplicate consecutive identical names (Svelte internal frames can cause adjacent duplicates).
5. First entry = `componentName`. Full list = `componentHierarchy`.

### Production behavior

In production builds, esbuild mangles function names (`Button` -> `Qe`) and bundles all code into chunks. Stack trace filenames point to bundle chunks, not original `.svelte` files. Client-side component extraction will produce mangled or empty results.

Flare's backend applies sourcemaps to stack traces separately. The client-side component context is best-effort; the backend-resolved stack trace provides accurate component identification in production.

### Dependency

`error-stack-parser` added as a direct dependency of `@flareapp/svelte`. Lightweight (~3KB). Avoids coupling to `@flareapp/js` internals.

## Error origin detection

New module: `src/getErrorOrigin.ts`

### Interface

```typescript
function getErrorOrigin(frames: StackFrame[]): SvelteErrorOrigin;
```

Takes the full parsed stack frames (not just `.svelte` frames) and returns a classification.

### Four categories

| Origin      | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `'render'`  | Error during component initialization or template evaluation        |
| `'event'`   | Error in a DOM event handler                                        |
| `'effect'`  | Error in a reactive effect or lifecycle hook (`onMount`, `$effect`) |
| `'unknown'` | Cannot determine origin                                             |

### Detection strategy: native browser frame patterns

Function names from application code are mangled in production, but browser-native frames are never mangled. Detection relies on native frame signals:

| Signal (never mangled)                                                                                                             | Origin      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Stack contains DOM event dispatch frames: `HTMLElement.onclick`, `EventTarget.dispatchEvent`, `addEventListener` callback patterns | `'event'`   |
| Stack contains async scheduling frames: `queueMicrotask`, `Promise.then`, `MutationObserver`                                       | `'effect'`  |
| Stack has `.svelte` frames, no event or async frames between error and component                                                   | `'render'`  |
| None of the above                                                                                                                  | `'unknown'` |

### Check order

1. `'event'` (most specific signal)
2. `'effect'` (async scheduling signal)
3. `'render'` (default when `.svelte` frames present with synchronous stack)
4. `'unknown'` (no `.svelte` frames at all)

### Limitations

- Cannot distinguish `onMount` from `$effect` in production (both go through Svelte's scheduler via microtask). Both report as `'effect'`.
- In dev mode, readable function names could allow finer distinction, but we intentionally keep the same four categories in both environments for consistency.

## Route context

New module: `src/getRouteContext.ts`

### Interface

```typescript
function getRouteContext(): SvelteRouteContext | null;
```

### Implementation

1. Import `page` from `$app/state` (SvelteKit 2.12+, Svelte 5).
2. If unavailable (non-SvelteKit app or import fails), return `null`.
3. Extract route properties from the `page` object:
    - `id`: `page.route.id` (parameterized route, e.g. `/users/[id]`)
    - `url`: `page.url.pathname`
    - `params`: `page.params`
    - `query`: `Object.fromEntries(page.url.searchParams)`, with sensitive param names redacted using `DEFAULT_PROPS_DENYLIST` from `@flareapp/js`

### Build config

`$app/state` is a SvelteKit virtual module. The `tsdown` config for `@flareapp/svelte` must mark it as external so the import survives into the published package. The consuming SvelteKit app's Vite build resolves it at build time.

### Non-SvelteKit fallback

The `$app/state` import is a static import at the top of `getRouteContext.ts`, marked as external in the build config. In a SvelteKit app, the consuming app's Vite build resolves it. In a non-SvelteKit app, the import fails at module load time.

To handle this, `getRouteContext` is imported lazily via dynamic `import()` by the handlers that call it. The dynamic import is wrapped in a try-catch: if it fails (non-SvelteKit), route context is `null`. The result is cached after the first attempt so the dynamic import only runs once.

### Sensitive data redaction

Query params may contain tokens or PII. Known sensitive param names (matching patterns like `token`, `password`, `secret`, `key`, `auth`, `session`) are redacted to `'[redacted]'` using `DEFAULT_PROPS_DENYLIST` from `@flareapp/js`, consistent with the Vue package's `fullPath` redaction.

## Integration points

### `FlareErrorBoundary.svelte`

Before reporting, calls `extractComponentInfo(error)`, `getErrorOrigin(frames)`, and `getRouteContext()`. Builds full `FlareSvelteContext` with all fields populated. User's `beforeSubmit` hook can modify the context before it ships.

### `createFlareErrorHandler`

Same enrichment as `FlareErrorBoundary`. Extracts component info and error origin from the error's stack trace. Gets route context. Builds full context.

### `flareSvelteErrorHandler`

Minimal changes. Server-side errors don't have browser stack traces with `.svelte` frames. Adds route context from server-side `$app/state` if available. Sets `componentName: null`, `componentHierarchy: []`, `errorOrigin: 'unknown'`. Retains existing `svelteKit.status` and `svelteKit.message`.

### Shared logic

`extractComponentInfo`, `getErrorOrigin`, and `getRouteContext` are standalone functions. All three handlers call them to avoid duplication.

## Public API changes

### New exports from `@flareapp/svelte`

- `SvelteErrorOrigin` (type)
- `SvelteRouteContext` (type)

### Updated exports

- `FlareSvelteContext` (type, expanded with new fields)

### Internal modules (not exported)

- `extractComponentInfo`
- `getErrorOrigin`
- `getRouteContext`

## Dependencies

### New

- `error-stack-parser`: direct dependency (~3KB). Stack trace parsing.

### Build config

- `$app/state`: marked as external in `tsdown` config.

### Peer dependencies

No changes. `@flareapp/js` ^2.0.0 and `svelte` ^5.0.0 remain. `@sveltejs/kit` stays optional.

## Testing strategy

### `extractComponentInfo`

- Dev-like stack trace with `.svelte` filenames and readable function names: extracts correct component name and hierarchy.
- Production-like stack trace with mangled names and bundle filenames: returns `null` / empty array gracefully.
- Stack trace with no `.svelte` frames: returns `null` / empty array.
- Consecutive duplicate component names are deduplicated.
- Non-Error input (string thrown): handled gracefully.

### `getErrorOrigin`

- Stack with DOM event frames (`HTMLElement.onclick`): returns `'event'`.
- Stack with async scheduling frames (`queueMicrotask`): returns `'effect'`.
- Synchronous stack with `.svelte` frames only: returns `'render'`.
- Stack with no recognizable frames: returns `'unknown'`.

### `getRouteContext`

- Mock `$app/state` with page object: returns correct route context.
- `$app/state` unavailable: returns `null`.
- Query params with sensitive names: values are redacted.

### Integration tests

- `FlareErrorBoundary` reports with component name, hierarchy, origin, and route in context.
- `createFlareErrorHandler` produces same context shape.
- `flareSvelteErrorHandler` includes route but no component info.
- `beforeSubmit` hook receives and can modify the enriched context.
