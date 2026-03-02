# Vue Improvements Research

## Current state of `@flareapp/vue`

The Vue package (`packages/vue/src/index.ts`) is a 26-line file with a single export: `flareVue(app)`. It hooks into
`app.config.errorHandler`, captures a basic component name + the `info` string, and forwards to `flare.report()`.

Current context sent to Flare:

```typescript
{
    vue: { info, componentName }
}
```

That's the entire feature set.

---

## Competitor analysis

### Sentry (`@sentry/vue`)

The most comprehensive Vue integration of any competitor. Dedicated package.

**Error handler:**

- Hooks into `app.config.errorHandler`
- Preserves existing error handler
- Uses `setTimeout()` to defer `captureException()` to the next tick (ensures breadcrumbs are recorded first)

**Vue-specific context collection:**

- `componentName` -- resolved from `$options.name`, `_componentTag`, `__name`, or `__file` (strips `.vue` extension,
  converts to PascalCase). Falls back to `<Root>` or `<Anonymous>`.
- `lifecycleHook` -- the specific lifecycle hook or handler where the error occurred
- `propsData` -- all component props (from `$options.propsData` for Vue 2, `$props` for Vue 3). Controllable via
  `attachProps: true|false` option.
- `trace` -- full component hierarchy trace by walking `$parent` references. Detects recursive components and annotates
  them with repetition counts.

**Configuration options (`vueIntegration()`):**

- `app` -- Vue 3 app instance (or multiple apps via array)
- `attachProps` (boolean, default `true`) -- attach component props to error events
- `attachErrorHandler` (boolean, default `true`) -- hook into Vue's error handler
- `logErrors` (boolean, default `true`) -- whether to also call Vue's original error logging
- `tracingOptions.trackComponents` -- enable component performance tracking
- `tracingOptions.hooks` -- array of lifecycle hooks to track
- `tracingOptions.timeout` -- root rendering span timeout

**Vue Router integration:**

- `browserTracingIntegration({ router })` accepts a Vue Router instance
- Supports Vue Router v2, v3, and v4
- Hooks into `router.beforeEach` and `router.onError`
- Creates page load/navigation spans automatically
- Extracts parameterized route names (e.g., `/users/:id` instead of `/users/123`)

**Pinia integration:**

- `createSentryPiniaPlugin()` attaches to Pinia stores
- Captures full state snapshots on error
- Creates breadcrumbs for state mutations
- Configurable transformers to strip sensitive data

**Does NOT offer:** Vue error boundary component.

### Bugsnag (`@bugsnag/plugin-vue`)

**Error handler:**

- Hooks into `app.config.errorHandler`
- Creates unhandled error event with `severity: 'error'`

**Vue-specific context (shown in "Vue" tab on dashboard):**

- `component` -- from `$options.name`, falls back to `'Anonymous'`, returns `'App'` for root
- `errorInfo` -- maps Vue's internal error codes to human-readable strings (e.g., `'render function'`,
  `'setup function'`, `'watcher callback'`, `'mounted hook'`)
- `props` -- component props from `vm.$options.propsData`

**Does NOT offer:** component tree trace, error boundary, Vue Router integration, state management integration,
configurable options beyond standard Bugsnag config.

### Datadog

**No dedicated Vue package.** Framework-agnostic RUM SDK (`@datadog/browser-rum`).

- Recommends manual `app.config.errorHandler` wiring to `datadogRum.addError(error)`
- Manual SPA route tracking via `trackViewsManually: true`
- No automatic Vue component context collection
- Does offer React `ErrorBoundary` / `TracingErrorBoundary` components, but nothing for Vue

### Rollbar

**No dedicated Vue package.** Documentation shows manual integration only:

```javascript
app.config.errorHandler = (error, vm, info) => {
    rollbar.error(error, { info });
};
```

No automatic component name/props extraction, no error boundary, no router integration.

---

## Comparison matrix

| Feature                        | Sentry | Bugsnag | Datadog | Rollbar | Flare (current) |
|--------------------------------|--------|---------|---------|---------|------------------|
| Dedicated Vue package          | Yes    | Yes     | No      | No      | Yes              |
| Error handler hook             | Yes    | Yes     | Manual  | Manual  | Yes              |
| Component name capture         | Yes    | Yes     | No      | No      | Yes (basic)      |
| Props capture                  | Yes    | Yes     | No      | No      | No               |
| Lifecycle hook info            | Yes    | Yes     | No      | No      | Yes (raw string) |
| Component tree trace           | Yes    | No      | No      | No      | No               |
| Error boundary component       | No     | No      | No      | No      | No               |
| Vue Router integration         | Yes    | No      | Manual  | No      | No               |
| Pinia/Vuex integration         | Yes    | No      | No      | No      | No               |
| Component perf tracking        | Yes    | No      | No      | No      | No               |
| `attachProps` option           | Yes    | N/A     | N/A     | N/A     | No               |
| `logErrors` option             | Yes    | N/A     | N/A     | N/A     | No               |

---

## Vue 3 built-in error handling capabilities

### `app.config.errorHandler`

- Global error handler for the entire app
- Signature: `(error: Error, instance: ComponentPublicInstance | null, info: string) => void`
- `info` indicates where the error was captured (e.g., `'render function'`, `'setup function'`, `'mounted hook'`,
  `'watcher callback'`)
- Catches: component renders, lifecycle hooks, watchers, template event handlers, setup function, custom directive hooks
- Does NOT catch: `setTimeout`, `Promise.catch`, native `addEventListener` callbacks

### `onErrorCaptured` composable / `errorCaptured` lifecycle hook

- Called when an error propagating from a descendant component is captured
- Signature: `(err: Error, instance: ComponentPublicInstance | null, info: string) => boolean | void`
- Returning `false` stops propagation (to parent `onErrorCaptured` hooks and `app.config.errorHandler`)
- Propagation: child `onErrorCaptured` -> parent `onErrorCaptured` -> ... -> `app.config.errorHandler`
- This is the mechanism used to build error boundary components in Vue

### `<Suspense>` (still experimental)

- Does NOT provide error handling -- no `#error` slot exists
- Only handles loading states via `#default` and `#fallback` slots
- Error handling for async components inside `<Suspense>` must be done via `onErrorCaptured` in a parent

### What Vue does NOT provide built-in

- No error boundary component (must be built manually using `onErrorCaptured`)
- No error recovery/reset mechanism
- No fallback UI rendering on error

---

## Standalone Vue error boundary libraries

### `vu-error-boundary` (by liaoliao666)

Most feature-complete Vue 3 error boundary, modeled after `react-error-boundary`:

- Props: `FallbackComponent`, `onError`, `onReset`
- Scoped slot: `#fallback` receives `{ error, resetErrorBoundary }`
- Events: `@reset`, `@error`
- `useErrorHandler()` composable: handles errors that Vue cannot catch (event handlers, async code), propagates them to
  the nearest `ErrorBoundary`
- TypeScript support

### `vue-error-boundary` (by dillonchanis)

- Older library, Vue 2/3 compatible
- Catches errors in child components and displays fallback UI

### `@kong-ui-public/error-boundary` (by Kong)

- Actively maintained
- Uses `onErrorCaptured` internally
- Fallback UI support with error callback

### Key limitation of all Vue error boundaries

Vue's `onErrorCaptured` only catches errors thrown during Vue lifecycle hooks, render functions, watchers, and template
event handlers. It does NOT catch:

- Plain `addEventListener` callbacks
- `setTimeout`/`setInterval` callbacks
- Async code outside Vue's setup/lifecycle context
- Errors in code not associated with a component

---

## What maps over from the React improvements

### FlareErrorBoundary component

The biggest opportunity and a **genuine differentiator** -- no competitor offers a Vue error boundary component. Built
using `onErrorCaptured`.

Vue-idiomatic API uses **scoped slots** instead of render function props:

```vue
<FlareErrorBoundary>
    <template #default>
        <App />
    </template>
    <template #fallback="{ error, resetErrorBoundary }">
        <p>Something went wrong: {{ error.message }}</p>
        <button @click="resetErrorBoundary">Try again</button>
    </template>
</FlareErrorBoundary>
```

Feature mapping from React:

| React                     | Vue equivalent                                       |
|---------------------------|------------------------------------------------------|
| `fallback` prop/function  | `#fallback` scoped slot (`{ error, resetErrorBoundary }`) |
| `onError` prop            | `onError` prop or `@error` event                     |
| `beforeCapture` prop      | `beforeCapture` prop or `@before-capture` event      |
| `onReset` prop            | `onReset` prop or `@reset` event (receives prev error) |
| `resetKeys` prop          | `resetKeys` prop (watched via Vue's reactivity)      |

### `useErrorHandler()` composable

No direct React equivalent, but fills the same gap as `flareReactErrorHandler`. Propagates errors from outside Vue's
error handling scope to the nearest `FlareErrorBoundary`:

```ts
const handleError = useErrorHandler();

async function fetchData() {
    try {
        await api.get('/users');
    } catch (e) {
        handleError(e); // Propagates to nearest FlareErrorBoundary
    }
}
```

### `flareReactErrorHandler` equivalent

Not needed. Vue doesn't have React 19-style root error hooks. The `app.config.errorHandler` already serves as the
global catch-all, and `flareVue()` hooks into it.

---

## Vue-specific improvements (no React equivalent)

### Improved `flareVue()` with configuration options

| Option                  | Default | Description                                                |
|-------------------------|---------|------------------------------------------------------------|
| `attachProps`           | `true`  | Capture component `$props` and attach to error context     |
| `attachComponentTrace`  | `true`  | Walk `$parent` references to build component hierarchy     |

```ts
flareVue(app, {
    attachProps: true,
    attachComponentTrace: true,
});
```

### Better component name extraction

Current implementation only checks `instance.$options.name`. Should also resolve from:

- `$options.__name` (used by `<script setup>`)
- `$options.__file` (strip `.vue` extension, convert to PascalCase)
- Fall back to `<Root>` for root component, `<Anonymous>` for unnamed components

This is what Sentry does and it catches many more components (since `<script setup>` components often don't have an
explicit `name` but do have `__name`).

### Component tree trace

Walk `$parent` references to build a full component ancestry, like Sentry does:

```
----> <ChildComponent>
       <ParentComponent>
       <App>
```

Detect recursive components and annotate with repetition counts.

---

## Out of scope

- **Vue Router integration** -- performance/tracing focused, not error tracking
- **Pinia/Vuex integration** -- tangential to error reporting
- **Component performance tracking** -- not related to error handling

---

## Summary: proposed features

| Feature                                               | Competitor parity    | Differentiator? |
|-------------------------------------------------------|----------------------|-----------------|
| `FlareErrorBoundary` component with `#fallback` slot  | No competitor offers | Yes             |
| `onError`, `beforeCapture`, `onReset` props            | N/A                  | Yes             |
| `resetKeys` prop                                       | N/A                  | Yes             |
| `useErrorHandler()` composable                         | N/A                  | Yes             |
| `attachProps` option on `flareVue()`                   | Sentry, Bugsnag      | Parity          |
| Component tree trace                                   | Sentry only          | Near-parity     |
| Better component name extraction                       | Sentry, Bugsnag      | Parity          |
