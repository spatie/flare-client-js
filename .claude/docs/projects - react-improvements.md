# React improvements

## Completed tasks

- [x] FlareErrorBoundary supports `fallback` property
- [x] FlareErrorBoundary supports fallback with a reset method for resetting the Error Boundary
- [x] FlareErrorBoundary fallback passes `componentStack`
- [x] FlareErrorBoundary supports `onError` callback
- [x] FlareErrorBoundary supports `beforeCapture` callback
- [x] FlareErrorBoundary supports `onReset` property
- [x] FlareErrorBoundary `onReset` passes previous error
- [x] FlareErrorBoundary supports `resetKeys` property
- [x] Add `flareReactErrorHandler`
- [x] Structured component stack parsing with sourcemap-ready frames

## FlareErrorBoundary: `fallback` property

### Inspiration

- [Sentry ErrorBoundary
  `fallback`](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/#fallback-ui-options) --
  supports a static element and a render function receiving `{ error, componentStack, resetError }`
- [react-error-boundary](https://github.com/bvaughn/react-error-boundary) -- the most popular standalone error boundary
  library, supports `fallback`, `fallbackRender`, and `FallbackComponent` as three separate props

### Why

Without a `fallback` prop, the error boundary rendered nothing when an error was caught, giving users no way to
show a recovery UI. Every major competitor supports this.

Our implementation combines the static and render function approaches into a single `fallback` prop (like Sentry), and
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

## FlareErrorBoundary: `onError` callback

### Inspiration

- [Sentry ErrorBoundary
  `onError`](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/#options-reference) --
  called when the boundary encounters an error
- [react-error-boundary `onError`](https://github.com/bvaughn/react-error-boundary?tab=readme-ov-file#onerror) -- same
  concept, receives `(error, info)`

### Why

Developers need a hook to perform side effects when an error is caught -- logging to a secondary service,
showing a toast, updating app state, etc. This fires *after* the error has been reported to Flare.

```tsx
<FlareErrorBoundary
    onError={({ error, errorInfo }) => {
        console.error('Caught by FlareErrorBoundary:', error);
        console.error('Component stack:', errorInfo.componentStack);
    }}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `beforeCapture` callback

### Inspiration

- [Sentry ErrorBoundary
  `beforeCapture`](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/#options-reference) --
  the only competitor that offers this; receives the Sentry scope to set tags and context before the event is sent

No other competitor (Datadog, Bugsnag, Rollbar, LogRocket) provides an equivalent hook.

### Why

Fires *before* the error is reported to Flare, giving developers a chance to attach custom context, tags, or
user information to the Flare report. This is the pragmatic answer to "how do we capture component props/state" -- let
the developer decide what to include rather than trying to automatically serialize React internals.

```tsx
<FlareErrorBoundary
    beforeCapture={({ error, errorInfo }) => {
        flare.addContext('user', { id: currentUser.id });
        flare.addContext('feature-flags', getActiveFlags());
    }}
>
    <App />
</FlareErrorBoundary>
```

## FlareErrorBoundary: `onReset` property (with previous error)

### Inspiration

- [react-error-boundary `onReset`](https://github.com/bvaughn/react-error-boundary?tab=readme-ov-file#onreset) -- the
  primary inspiration; called when the boundary resets, receives details about what triggered the reset
- [Sentry ErrorBoundary
  `onReset`](https://github.com/getsentry/sentry-javascript/blob/master/packages/react/src/errorboundary.tsx) -- exists
  in Sentry's source code (receives `error, componentStack, eventId`) but is not documented in their official docs

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

### Inspiration

- [react-error-boundary `resetKeys`](https://github.com/bvaughn/react-error-boundary?tab=readme-ov-file#resetkeys) --
  the sole source for this pattern; Sentry does not offer it

This is a feature unique to react-error-boundary that neither Sentry nor any other error tracking competitor provides.
When any value in the `resetKeys` array changes between renders (compared via `Object.is`), the boundary automatically
resets and re-renders its children.

### Why

Allows automatic reset of the error boundary when certain values change. Common use case: resetting the
boundary when the user navigates to a different page or when some external state changes. Without this, the only way to
reset is to call `resetErrorBoundary()` manually or remount the component.

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

### Inspiration

- [Sentry
  `reactErrorHandler`](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/#error-hooks-vs-errorboundary) --
  provides `Sentry.reactErrorHandler()` for all three React 19 root error hooks, with an optional callback parameter
- [React 19 `createRoot` error handling docs](https://react.dev/reference/react-dom/client/createRoot#parameters) -- the
  React docs describing `onCaughtError`, `onUncaughtError`, and `onRecoverableError`

Our API mirrors Sentry's approach: a wrapper function that accepts an optional callback. The key difference is that
`flareReactErrorHandler` also handles non-Error values (strings, objects) by converting them to proper Error instances
via `convertToError()`, making it more resilient to edge cases.

### Why

React 19 introduced `onCaughtError`, `onUncaughtError`, and `onRecoverableError` callbacks on `createRoot`.
These are root-level error handlers that catch errors *without* requiring an ErrorBoundary wrapper. At the time of
implementation, only Sentry and Datadog supported this -- Bugsnag, Rollbar, and LogRocket did not. This puts Flare ahead
of most competitors for React 19 support.

```tsx
import { flareReactErrorHandler } from '@flareapp/react';

const root = createRoot(document.getElementById('root')!, {
    // Errors caught by an Error Boundary
    onCaughtError: flareReactErrorHandler((error, errorInfo) => {
        console.warn('Caught error:', error);
    }),

    // Errors NOT caught by any Error Boundary
    onUncaughtError: flareReactErrorHandler((error, errorInfo) => {
        console.error('Uncaught error:', error);
    }),

    // Errors React recovers from automatically (e.g. hydration mismatches)
    onRecoverableError: flareReactErrorHandler(),
});

root.render(<App />);
```

## Structured component stack parsing with sourcemap-ready frames

### Inspiration

- [Sentry
  `captureReactException`](https://github.com/getsentry/sentry-javascript/blob/master/packages/react/src/error.ts) --
  creates a synthetic Error with the raw `componentStack` as its `.stack` property and links it to the original error
  via `error.cause`; server-side sourcemap processing then applies to this synthetic stack trace
- [Bugsnag `formatComponentStack`](https://github.com/bugsnag/bugsnag-js/tree/main/packages/plugin-react) -- only trims
  whitespace; sends componentStack as raw metadata; has
  an [open feature request (issue #2097)](https://github.com/bugsnag/bugsnag-js/issues/2097) to apply sourcemaps to it
- Rollbar and LogRocket do not parse or sourcemap the componentStack at all

### Why

React's `ErrorInfo.componentStack` is a raw multiline string whose format differs between browser engines:

- **Chromium** (Chrome, Edge, Opera, Brave): `at ComponentName (http://localhost:5173/src/App.tsx:12:9)`
- **Firefox/Safari** (Gecko, WebKit): `ComponentName@http://localhost:5173/src/App.tsx:12:9`

Previously, `formatComponentStack()` just split this string by newlines into a `string[]`, giving the Flare dashboard
nothing structured to work with. By parsing each line into `{ component, file, line, column }` objects, we give the
backend clean structured data for sourcemap resolution and rich dashboard rendering (clickable source links, component
tree views, searchable component names) -- without requiring the backend to re-parse a raw string or a synthetic stack
trace like Sentry does.

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