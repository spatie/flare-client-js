# React improvements

## Completed tasks

- [x] FlareErrorBoundary supports `fallback` property
- [x] FlareErrorBoundary supports fallback with a reset method for resetting the Error Boundary
- [x] FlareErrorBoundary fallback passes `componentStack`
- [x] FlareErrorBoundary supports `beforeEvaluate` callback
- [x] FlareErrorBoundary supports `beforeSubmit` callback
- [x] FlareErrorBoundary supports `afterSubmit` callback
- [x] FlareErrorBoundary supports `onReset` property
- [x] FlareErrorBoundary `onReset` passes previous error
- [x] FlareErrorBoundary supports `resetKeys` property
- [x] Add `flareReactErrorHandler` with `beforeEvaluate`, `beforeSubmit`, and `afterSubmit` callbacks
- [x] Structured component stack parsing with sourcemap-ready frames

## FlareErrorBoundary: `fallback` property

### Why

Without a `fallback` prop, the error boundary rendered nothing when an error was caught, giving users no way to
show a recovery UI.

Our implementation combines the static and render function approaches into a single `fallback` prop, and
passes `componentStack` as a parsed string array rather than a raw string.

The `fallback` prop accepts either a static `ReactNode` or a render function. The render function receives the caught
`error`, the parsed `componentStack` (as a string array), and a `resetErrorBoundary` function to clear the error state.

```tsx
// Static fallback
<FlareErrorBoundary fallback={<p>Something went wrong.</p>}>
    <App />
</FlareErrorBoundary>

// Render function fallback with error details and reset
<FlareErrorBoundary
    fallback={({ error, componentStack, resetErrorBoundary }) => (
        <div>
            <h2>Something went wrong</h2>
            <p>{error.message}</p>
            <pre>{componentStack.join('\n')}</pre>
            <button onClick={resetErrorBoundary}>Try again</button>
        </div>
    )}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `beforeEvaluate` callback

### Why

Fires *before* the component stack context is built, giving developers a chance to attach custom context, tags, or
user information to the Flare report. This is the pragmatic answer to "how do we capture component props/state" -- let
the developer decide what to include rather than trying to automatically serialize React internals.

```tsx
<FlareErrorBoundary
    beforeEvaluate={({ error, errorInfo }) => {
        flare.addContext('user', { id: currentUser.id });
        flare.addContext('feature-flags', getActiveFlags());
    }}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `beforeSubmit` callback

### Why

Fires after the component stack context is built but *before* the error is reported to Flare. The callback receives
the `context` and must return a (possibly modified) context object. Use this to filter or enrich the report context.

```tsx
<FlareErrorBoundary
    beforeSubmit={({ error, errorInfo, context }) => {
        return {
            ...context,
            react: {
                ...context.react,
                componentStack: context.react.componentStack.filter(
                    (line) => !line.includes('ThirdPartyWrapper'),
                ),
            },
        };
    }}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `afterSubmit` callback

### Why

Developers need a hook to perform side effects when an error is caught -- logging to a secondary service,
showing a toast, updating app state, etc. This fires *after* the error has been reported to Flare. The callback
receives the final context that was submitted.

```tsx
<FlareErrorBoundary
    afterSubmit={({ error, errorInfo, context }) => {
        console.error('Caught by FlareErrorBoundary:', error);
        console.error('Component stack:', errorInfo.componentStack);
        console.error('Reported context:', context);
    }}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `onReset` property (with previous error)

### Why

When the error boundary resets (either via `resetErrorBoundary()` from the fallback or via `resetKeys`
changing), developers often need to clean up -- clear caches, reset form state, re-fetch data. Passing the previous
error allows conditional cleanup based on what went wrong.

```tsx
<FlareErrorBoundary
    onReset={(error) => {
        console.log('Recovering from:', error?.message);
        queryClient.invalidateQueries();
    }}
    fallback={({ resetErrorBoundary }) => (
        <button onClick={resetErrorBoundary}>Retry</button>
    )}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `resetKeys` property

### Why

Allows automatic reset of the error boundary when certain values change. Common use case: resetting the
boundary when the user navigates to a different page or when some external state changes. Without this, the only way to
reset is to call `resetErrorBoundary()` manually or remount the component.

When any value in the `resetKeys` array changes between renders (compared via `Object.is`), the boundary automatically
resets and re-renders its children.

```tsx
function App() {
    const location = useLocation();

    return (
        <FlareErrorBoundary
            resetKeys={[location.pathname]}
            onReset={(error) => {
                console.log('Navigated away from error, previous error:', error?.message);
            }}
            fallback={<p>Something went wrong.</p>}
        >
            <Routes />
        </FlareErrorBoundary>
    );
}
```

## `flareReactErrorHandler`

### Why

React 19 introduced `onCaughtError`, `onUncaughtError`, and `onRecoverableError` callbacks on `createRoot`.
These are root-level error handlers that catch errors *without* requiring an ErrorBoundary wrapper.

`flareReactErrorHandler` is a wrapper function that accepts an optional options object with `beforeEvaluate`,
`beforeSubmit`, and `afterSubmit` callbacks -- the same callback pattern used by `FlareErrorBoundary`. It also handles
non-Error values (strings, objects) by converting them to proper Error instances via `convertToError()`, making it more
resilient to edge cases.

### Callback lifecycle

1. **`beforeEvaluate`** -- called after the error is converted to an `Error`, before building the component stack context. Use this to attach custom context to Flare (e.g. user info, feature flags).
2. **`beforeSubmit`** -- called with the built context, must return a (possibly modified) context object. Use this to filter or enrich the report context before it is sent.
3. **`flare.report()`** -- the error is reported to Flare.
4. **`afterSubmit`** -- called after the report is sent. Use this for side effects like logging or showing a toast.

```tsx
import { flareReactErrorHandler } from '@flareapp/react';

const root = createRoot(document.getElementById('root')!, {
    // Errors caught by an Error Boundary
    onCaughtError: flareReactErrorHandler({
        afterSubmit: ({ error, errorInfo }) => {
            console.warn('Caught error:', error);
        },
    }),

    // Errors NOT caught by any Error Boundary
    onUncaughtError: flareReactErrorHandler({
        beforeEvaluate: ({ error }) => {
            flare.addContext('user', { id: currentUser.id });
        },
        afterSubmit: ({ error }) => {
            console.error('Uncaught error:', error);
        },
    }),

    // Errors React recovers from automatically (e.g. hydration mismatches)
    onRecoverableError: flareReactErrorHandler(),
});

root.render(<App />);
```

## Structured component stack parsing with sourcemap-ready frames

### Why

React's `ErrorInfo.componentStack` is a raw multiline string whose format differs between browser engines:

- **Chromium** (Chrome, Edge, Opera, Brave): `at ComponentName (http://localhost:5173/src/App.tsx:12:9)`
- **Firefox/Safari** (Gecko, WebKit): `ComponentName@http://localhost:5173/src/App.tsx:12:9`

Previously, `formatComponentStack()` just split this string by newlines into a `string[]`, giving the Flare dashboard
nothing structured to work with. By parsing each line into `{ component, file, line, column }` objects, we give the
backend clean structured data for sourcemap resolution and rich dashboard rendering (clickable source links, component
tree views, searchable component names) -- without requiring the backend to re-parse a raw string.

Both `componentStack` (original `string[]`) and `componentStackFrames` (new `ComponentStackFrame[]`) are sent in the
report context for backwards compatibility. The backend can adopt the structured format when ready.

### Report context structure

```json
{
  "context": {
    "react": {
      "componentStack": [
        "at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)",
        "at div",
        "at App (http://localhost:5173/src/App.tsx:5:3)"
      ],
      "componentStackFrames": [
        {
          "component": "ErrorComponent",
          "file": "http://localhost:5173/src/App.tsx",
          "line": 12,
          "column": 9
        },
        {
          "component": "div",
          "file": null,
          "line": null,
          "column": null
        },
        {
          "component": "App",
          "file": "http://localhost:5173/src/App.tsx",
          "line": 5,
          "column": 3
        }
      ]
    }
  }
}
```

### Backend requirements

The Flare backend/dashboard needs to:

1. Read `componentStackFrames` from the report context
2. Apply sourcemap resolution to each frame's `file`/`line`/`column`
3. Render the component stack as a structured list in the dashboard
