# Vue improvements

## Planned tasks (mirrored from React)

- [x] `FlareErrorBoundary` component with `fallback` slot
- [x] `FlareErrorBoundary` fallback with `reset` method
- [x] `FlareErrorBoundary` fallback passes component hierarchy info
- [x] `FlareErrorBoundary` supports `beforeEvaluate` callback
- [x] `FlareErrorBoundary` supports `beforeSubmit` callback
- [x] `FlareErrorBoundary` supports `afterSubmit` callback
- [x] `FlareErrorBoundary` supports `onReset` prop
- [x] `FlareErrorBoundary` `onReset` passes previous error
- [x] `FlareErrorBoundary` supports `resetKeys` prop (via watchers)
- [x] Enhance `flareVue()` with `beforeEvaluate`, `beforeSubmit`, and `afterSubmit` callbacks
- [x] Structured component hierarchy parsing (`componentHierarchyFrames` with file/props)

## Planned tasks (Vue-only features)

- [x] Capture component props from the erroring component instance
- [x] Capture lifecycle hook / origin info (where the error occurred) — `info` string is sent as `context.vue.info`,
  normalized `errorOrigin` category maps info to `setup`, `render`, `lifecycle`, `event`, `watcher`, or `unknown`
- [x] Component hierarchy traversal via `$parent` chain
- [x] `app.config.warnHandler` integration for capturing Vue warnings
- [x] Vue Router integration: capture current route as context

---

## `FlareErrorBoundary` component with `fallback` slot

### Why

The current `flareVue()` plugin only sets `app.config.errorHandler`, which reports errors to Flare but gives developers
no way to show a recovery UI when a child component throws. Vue does not have a built-in error boundary primitive like
React's class-based `componentDidCatch`. However, Vue 3's `onErrorCaptured` composition hook captures errors from
descendant components and can prevent them from propagating, which is enough to build an error boundary.

The component uses `onErrorCaptured` to catch errors from its slot children, stores the error in reactive state, and
switches rendering from the default slot to a `fallback` scoped slot.

The `fallback` slot is a scoped slot. It receives `error`, `componentHierarchy`, `componentHierarchyFrames` (see
"Structured component hierarchy parsing" below), `componentProps` (only when `attachProps` is enabled and the
erroring component had props), and a `resetErrorBoundary` function. For simple cases, a static fallback can be
provided via the default content of the `fallback` slot.

```vue
<!-- Static fallback -->
<FlareErrorBoundary>
    <App />
    <template #fallback>
        <p>Something went wrong.</p>
    </template>
</FlareErrorBoundary>

<!-- Scoped slot fallback with error details and reset -->
<FlareErrorBoundary>
    <App />
    <template #fallback="{ error, componentHierarchy, resetErrorBoundary }">
        <div>
            <h2>Something went wrong</h2>
            <p>{{ error.message }}</p>
            <pre>{{ componentHierarchy.join('\n') }}</pre>
            <button @click="resetErrorBoundary">Try again</button>
        </div>
    </template>
</FlareErrorBoundary>
```

### Implementation notes

Vue's `onErrorCaptured` hook receives `(err, instance, info)`:

- `err`: the error object
- `instance`: the component instance that threw the error (or `null`)
- `info`: a string describing where the error was captured (e.g. `"setup function"`, `"render function"`,
  `"watcher getter"`, `"component event handler"`, etc.)

Returning `false` from `onErrorCaptured` prevents the error from propagating to `app.config.errorHandler`. The
error boundary should return `false` to stop propagation after reporting to Flare, similar to how React's
`componentDidCatch` catches the error and prevents it from crashing the app.

The key difference from React: Vue's `onErrorCaptured` works with the Composition API and functional-style
components, so the error boundary itself will be a `<script setup>` component rather than a class component.

## `FlareErrorBoundary`: `beforeEvaluate` callback

### Why

Same rationale as React. Fires before the component hierarchy context is built, letting developers attach custom
context,
tags, or user information to the Flare report before the error is evaluated.

```vue

<FlareErrorBoundary
    :before-evaluate="({ error, instance, info }) => {
        flare.addContext('user', { id: currentUser.id });
        flare.addContext('feature-flags', getActiveFlags());
    }"
>
    <App />
</FlareErrorBoundary>
```

### Difference from React

The callback receives `instance` (the Vue component instance that threw) and `info` (the lifecycle hook string)
instead of React's `errorInfo`. This gives Vue users direct access to the component instance at error time, which is
richer than what React provides.

## `FlareErrorBoundary`: `beforeSubmit` callback

### Why

Fires after the component hierarchy context is built but before the error is reported to Flare. The callback receives
the `context` and must return a (possibly modified) context object. Use this to filter or enrich the report context.

```vue

<FlareErrorBoundary
    :before-submit="({ error, instance, info, context }) => {
        return {
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: context.vue.componentHierarchy.filter(
                    (entry) => !entry.includes('ThirdPartyWrapper'),
                ),
            },
        };
    }"
>
    <App />
</FlareErrorBoundary>
```

## `FlareErrorBoundary`: `afterSubmit` callback

### Why

Developers need a hook to perform side effects after an error is reported. This fires after the error has been
reported to Flare.

```vue

<FlareErrorBoundary
    :after-submit="({ error, instance, info, context }) => {
        console.error('Caught by FlareErrorBoundary:', error);
        console.error('Lifecycle info:', info);
        console.error('Reported context:', context);
    }"
>
    <App />
</FlareErrorBoundary>
```

## `FlareErrorBoundary`: `onReset` prop (with previous error)

### Why

Same rationale as React. When the error boundary resets, developers often need to clean up. Passing the previous error
allows conditional cleanup based on what went wrong.

```vue

<FlareErrorBoundary
    :on-reset="(error) => {
        console.log('Recovering from:', error?.message);
        queryClient.invalidateQueries();
    }"
>
    <App />
    <template #fallback="{ resetErrorBoundary }">
        <button @click="resetErrorBoundary">Retry</button>
    </template>
</FlareErrorBoundary>
```

## `FlareErrorBoundary`: `resetKeys` prop

### Why

Same rationale as React. Allows automatic reset of the error boundary when certain values change.

The implementation differs from React under the hood: React's version uses `componentDidUpdate` to compare previous
and next key arrays. Vue's version uses a `watch` on the `resetKeys` prop with `deep: false`, comparing values via
`Object.is` the same way React does.

```vue

<script setup>
    import { useRoute } from 'vue-router';

    const route = useRoute();
</script>

<template>
    <FlareErrorBoundary
        :reset-keys="[route.path]"
        :on-reset="(error) => {
            console.log('Navigated away from error, previous error:', error?.message);
        }"
    >
        <RouterView />
        <template #fallback>
            <p>Something went wrong.</p>
        </template>
    </FlareErrorBoundary>
</template>
```

## Enhance `flareVue()` with `beforeEvaluate`, `beforeSubmit`, and `afterSubmit`

### Why

The current `flareVue()` plugin sets `app.config.errorHandler` but provides no way for developers to hook into the
error reporting lifecycle. This is the Vue equivalent of React's `flareReactErrorHandler`.

Unlike React 19's root-level handlers (`onCaughtError`, `onUncaughtError`, `onRecoverableError`), Vue has a single
`app.config.errorHandler`. So instead of a factory function that returns a callback, we add the callbacks as options
to the existing `flareVue()` plugin function.

The current `flareVue()` signature is `flareVue(app: App): void`. The new signature adds an optional options object:

```ts
type FlareVueOptions = {
    beforeEvaluate?: (params: { error: Error; instance: ComponentPublicInstance | null; info: string }) => void;
    beforeSubmit?: (params: {
        error: Error;
        instance: ComponentPublicInstance | null;
        info: string;
        context: FlareVueContext;
    }) => FlareVueContext;
    afterSubmit?: (params: {
        error: Error;
        instance: ComponentPublicInstance | null;
        info: string;
        context: FlareVueContext;
    }) => void;
};

function flareVue(app: App, options?: FlareVueOptions): void;
```

```ts
import { flareVue } from '@flareapp/vue';

const app = createApp(App);

flareVue(app, {
    beforeEvaluate: ({ error, instance, info }) => {
        flare.addContext('user', { id: currentUser.id });
    },
    beforeSubmit: ({ error, instance, info, context }) => {
        return {
            ...context,
            vue: {
                ...context.vue,
                customField: 'value',
            },
        };
    },
    afterSubmit: ({ error, instance, info, context }) => {
        console.error('Error reported to Flare:', error.message);
    },
});
```

### Callback lifecycle

1. **`beforeEvaluate`** -- called after the error is caught, before building the component hierarchy context. Use this
   to attach custom context to Flare (e.g. user info, feature flags).
2. **`beforeSubmit`** -- called with the built context, must return a (possibly modified) context object. Use this to
   filter or enrich the report context before it is sent.
3. **`flare.report()`** -- the error is reported to Flare.
4. **`afterSubmit`** -- called after the report is sent. Use this for side effects like logging or showing a toast.

## Structured component hierarchy parsing

### Why

React's `ErrorInfo.componentStack` is a raw string that we parse into structured `ComponentStackFrame[]` objects. Vue
does not have an equivalent `componentStack` string, but it provides something potentially more useful: the actual
component instance via `onErrorCaptured(err, instance, info)`.

From the instance, we can traverse the `$parent` chain to build a component hierarchy. Each entry captures the
component's name (from `$options.name` or `$options.__name` for `<script setup>` components), its file path (from
`$options.__file` when available in development builds), and its position in the tree.

Both `componentHierarchy` (a `string[]` for display) and `componentHierarchyFrames` (structured
`ComponentHierarchyFrame[]`) are sent in the report context, mirroring the React approach of providing both raw and
structured data.

### Report context structure

```json
{
  "context": {
    "vue": {
      "info": "setup function",
      "componentName": "BuggyComponent",
      "componentHierarchy": [
        "BuggyComponent",
        "ParentPage",
        "AppLayout",
        "App"
      ],
      "componentHierarchyFrames": [
        {
          "component": "BuggyComponent",
          "file": "src/components/BuggyComponent.vue",
          "props": {
            "userId": 42
          }
        },
        {
          "component": "ParentPage",
          "file": "src/pages/ParentPage.vue",
          "props": {}
        },
        {
          "component": "AppLayout",
          "file": "src/layouts/AppLayout.vue",
          "props": {}
        },
        {
          "component": "App",
          "file": "src/App.vue",
          "props": {}
        }
      ]
    }
  }
}
```

### Implementation notes

- `$options.__name` is set by Vue's SFC compiler for `<script setup>` components. It is more reliable than
  `$options.name` for modern Vue code.
- `$options.__file` is only available in development builds and is stripped in production. The `file` field will be
  `null` in production.
- The hierarchy traversal stops at the app root (where `$parent` is `null`).

---

## Vue-only features

These features take advantage of Vue-specific APIs that have no React equivalent.

### Capture component props from the erroring component instance

#### Why

Vue's `onErrorCaptured` provides the component instance that threw the error. From the instance, we can read `$props`
directly. This is something React fundamentally cannot do: React's `componentDidCatch` only receives the error and
component stack string, not the component instance or its props.

Props capture is opt-in via an `attachProps` option (default `false`) because props may contain sensitive data. When
enabled, the props of the erroring component are attached both as `componentProps` on the top level of the report
context *and* per-frame on `componentHierarchyFrames` (each frame gets its own `props`, serialized with the same
settings).

```ts
// In FlareErrorBoundary
<FlareErrorBoundary :attach-props="true">
    <App />
</FlareErrorBoundary>

// In flareVue()
flareVue(app, { attachProps: true });
```

Props are serialized with a depth limit to prevent circular references and excessive payload size. Functions are
replaced with `"[Function]"`, symbols with `"[Symbol]"`, bigints with their string form, circular references with
`"[Circular]"`, and non-plain objects (class instances, `Date`, `RegExp`, `Map`, `Set`, etc.) with `"[Object]"`.
Symbol-keyed properties are dropped.

- `propsMaxDepth` (default `2`): how deep nested objects and arrays are serialized before collapsing to
  `"[Object]"` / `"[Array]"`.
- `propsDenylist` (default `DEFAULT_PROPS_DENYLIST`): a `RegExp` used to decide which keys are redacted to
  `"[Redacted]"`. Applied at every depth. A custom value *replaces* the default rather than extending it.
- `DEFAULT_PROPS_DENYLIST` is exported from `@flareapp/vue` so consumers can compose it with their own terms
  (e.g. `new RegExp(`${DEFAULT_PROPS_DENYLIST.source}|internalId`, 'i')`).

### Component hierarchy depth cap

Parent-chain traversal is bounded by a `MAX_HIERARCHY_DEPTH = 50` constant in `constants.ts`. Both
`componentHierarchy` and `componentHierarchyFrames` stop at 50 entries regardless of the actual tree size. This is
also a safety net against pathological `$parent` cycles.

#### Report context structure

```json
{
  "context": {
    "vue": {
      "info": "render function",
      "componentName": "UserProfile",
      "componentProps": {
        "userId": 42,
        "settings": {
          "theme": "dark"
        }
      }
    }
  }
}
```

### Capture lifecycle hook / origin info

#### Why

Vue's error handler receives an `info` string that tells you exactly where the error occurred within the component
lifecycle. This is already partially captured by the current `flareVue()` implementation, but it is not structured or
documented.

Vue provides values like:

- `"setup function"` -- error in `<script setup>` or `setup()`
- `"render function"` -- error during template rendering
- `"watcher getter"` / `"watcher callback"` -- error in a `watch` or `watchEffect`
- `"component event handler"` -- error in a `@click` or similar handler
- `"mounted hook"` / `"updated hook"` -- error in lifecycle hooks
- `"native event handler"` -- error in a native DOM event listener

This is richer than React's error info, which only tells you that the error happened somewhere in a child tree.

The `info` string is already sent as `context.vue.info` in the current implementation. The improvement is to also
map it to a structured `errorOrigin` field with a normalized category (e.g. `"lifecycle"`, `"render"`, `"event"`,
`"watcher"`, `"setup"`) for easier filtering and grouping on the Flare dashboard.

```json
{
  "context": {
    "vue": {
      "info": "mounted hook",
      "errorOrigin": "lifecycle"
    }
  }
}
```

### Component hierarchy traversal via `$parent` chain

This is described above in "Structured component hierarchy parsing." The key point for this section: React can only
parse a string. Vue gives us the actual component instances, so we can extract richer data (names, file paths, props)
directly rather than parsing text with regex.

### `app.config.warnHandler` integration

#### Why

Vue has `app.config.warnHandler`, which fires for Vue-specific runtime warnings in development mode. These warnings
often indicate bugs that will become errors (e.g. invalid prop types, missing required props, mutating props directly,
etc.).

React has no equivalent. React warnings go to `console.warn` and are indistinguishable from other console output
without string matching.

This is opt-in via a `captureWarnings` option on `flareVue()` (default `false`). When enabled, Vue warnings are
reported to Flare as non-fatal events with a `"warning"` message level, using `flare.reportMessage()` rather than
`flare.report()`.

```ts
flareVue(app, { captureWarnings: true });
```

Worth noting: `warnHandler` only fires in development mode. In production Vue builds, warnings are compiled out. This
feature is primarily useful during development and staging, not production.

#### Report context structure

```json
{
  "context": {
    "vue": {
      "type": "warning",
      "info": "Invalid prop: type check failed for prop \"count\". Expected Number, got String.",
      "componentName": "Counter",
      "componentTrace": "found in\n---> <Counter> at src/Counter.vue\n       <App> at src/App.vue"
    }
  }
}
```

### Vue Router integration: capture current route as context

#### Why

Vue Router is the de facto routing solution for Vue apps. When an error occurs, knowing which route the user was on,
what route params were active, and the full matched route chain is critical for debugging.

React Router is a third-party library with no standardized integration point. Vue Router is deeply integrated into
Vue's plugin system and can be detected via `app.config.globalProperties.$router`.

This is opt-in. If Vue Router is detected on the app instance, the current route information is automatically included
in the error context. No extra configuration needed.

```ts
// Automatic detection, no config needed
flareVue(app);
// The plugin detects app.config.globalProperties.$router and adds route context
```

#### Report context structure

```json
{
  "context": {
    "vue": {
      "route": {
        "name": "user-profile",
        "path": "/users/42",
        "fullPath": "/users/42?tab=settings",
        "params": {
          "id": "42"
        },
        "query": {
          "tab": "settings"
        },
        "hash": "",
        "matched": [
          "AppLayout",
          "UserProfile"
        ]
      }
    }
  }
}
```

---

## Types

```ts
export type ErrorOrigin = 'setup' | 'render' | 'lifecycle' | 'event' | 'watcher' | 'unknown';

export type ComponentHierarchyFrame = {
    component: string;
    file: string | null;
    props?: Record<string, unknown>;
};

export type RouteParamValue = string | string[];

export type RouteQueryValue = string | null;

export type RouteContext = {
    name: string | null;
    path: string;
    fullPath: string;
    params: Record<string, RouteParamValue>;
    query: Record<string, RouteQueryValue | RouteQueryValue[]>;
    hash: string;
    matched: string[];
};

export type FlareVueContext = {
    vue: {
        info: string;
        errorOrigin: ErrorOrigin;
        componentName: string;
        componentProps?: Record<string, unknown>;
        componentHierarchy: string[];
        componentHierarchyFrames: ComponentHierarchyFrame[];
        route?: RouteContext;
    };
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentProps?: Record<string, unknown>;
    componentHierarchy: string[];
    componentHierarchyFrames: ComponentHierarchyFrame[];
    resetErrorBoundary: () => void;
};
```

The `params` / `query` types mirror Vue Router's `LocationQuery` / route param shape, where a single key can carry
either a single value or an array (e.g. `?tab=a&tab=b`). `query` values can additionally be `null` to represent
keys without a value (`?flag`).

## Backend requirements

The Flare backend/dashboard needs to:

1. Read `componentHierarchyFrames` from the Vue report context
2. Render the component hierarchy as a structured list in the dashboard (similar to React's component stack)
3. Display the `errorOrigin` category for quick filtering
4. Display `componentProps` when present (with a toggle, since props can be large)
5. Display `route` information when present
