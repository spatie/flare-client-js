# Research: Improving `@flareapp/react` Context Collection

## Current State

The `FlareErrorBoundary` currently captures:
- The error object
- `componentStack` string from React's `ErrorInfo` (formatted)
- Standard browser context via `@flareapp/js` (URL, user agent, cookies, query params)

That's about it. There's room to grow.

---

## What Competitors Actually Capture

| Feature | Sentry | Datadog | Bugsnag | Rollbar | LogRocket |
|---|---|---|---|---|---|
| Component stack | Yes (linked via `error.cause`) | Yes | Yes | Yes | No |
| Component names in breadcrumbs | Yes (Babel plugin) | Yes (context provider) | No | No | Click only |
| Component props/state | **No** | **No** | **No** | **No** | **No** |
| Redux/store state | Separate pkg | No | No | No | Separate pkg |
| React Router integration | v3-v7 + TanStack | Yes (RumRoute) | No | Manual | No |
| React 19 root error handlers | Yes | Yes | No | No | No |
| Component interaction trail | Via Babel annotations | Yes (context provider) | No | No | No |
| `beforeCapture` scope hook | Yes | No | No | No | No |
| User feedback dialog | Yes | No | No | No | No |
| Component profiling | Yes (mount/render/update spans) | No | No | No | No |

**Key finding: Nobody automatically captures component props or state.** Despite the theoretical possibility via React fiber internals, every tool either ignores these or provides manual hooks. Reasons: serialization complexity (circular refs, functions, React elements), performance cost of fiber tree traversal, and privacy risks (leaking PII/tokens).

---

## What's Worth Implementing (Prioritized)

### Tier 1 -- Baseline improvements (low effort, high value)

1. **Better component stack formatting and sourcemap-decoded display** -- currently just splitting by newline. Could parse into structured data (component name, file, line) for better Flare dashboard rendering.

2. **`beforeCapture` callback on ErrorBoundary** -- like Sentry's `beforeCapture(scope, error, componentStack)`. Lets users attach custom tags, component props, or state to the error before it's sent. This is the pragmatic answer to "how do we capture state" -- let the developer decide what to include.

3. **React 19 `createRoot` error handlers** -- provide a `flareReactErrorHandler()` function for the new `onCaughtError`/`onUncaughtError`/`onRecoverableError` hooks. Only Sentry and Datadog support this today. Gets you error capture *without* requiring an ErrorBoundary wrapper.

### Tier 2 -- Differentiating features (moderate effort)

4. **Component name annotation via build plugin** -- Sentry uses a Babel plugin to inject `data-sentry-component` and `data-sentry-source-file` attributes onto DOM nodes at build time. These survive minification. Since Flare already has `@flareapp/vite`, this could be a Vite plugin addition or a separate Babel plugin. Component names would then appear in breadcrumbs/glows.

5. **React Router integration** -- capture parameterized route names (`/users/:id` instead of `/users/12345`) as context. Add navigation breadcrumbs on route changes. Support React Router v6/v7 and TanStack Router.

6. **State management integration** -- provide a Redux middleware and/or Zustand middleware that attaches store state snapshots to error reports. Sentry does this with `createReduxEnhancer()` with `stateTransformer` for sanitization. This is where "capture state" actually becomes practical -- at the store level, not the component level.

### Tier 3 -- Nice-to-have (higher effort)

7. **Component interaction breadcrumbs** -- like Datadog's `RumComponentContextProvider`, track which components the user interacted with before the error. This gives a "user journey through components" trail.

8. **Component profiling** -- `withProfiler()` HOC / `useProfiler()` hook that tracks mount/render/update timing. Useful for correlating errors with performance, but requires a tracing infrastructure.

---

## What's NOT Worth Pursuing

- **Automatic props/state via fiber internals** -- no competitor does this. Internal API instability across React versions, serialization nightmares, privacy risks, performance cost. The fiber tree (`memoizedProps`, `memoizedState`) is unstable and undocumented.
- **`captureOwnerStack()`** -- React 19 API that returns `null` in production. Development-only, useless for error tracking.
- **Session replay** -- massive scope, framework-agnostic, not a React package concern.

---

## Recommended Implementation Order

For the `@flareapp/react` package specifically:

1. `beforeCapture` callback on `FlareErrorBoundary` -- quick win, gives users control
2. React 19 `createRoot` error handler utility -- forward-looking, puts Flare ahead of Bugsnag/Rollbar
3. Structured component stack parsing -- better data for the Flare dashboard
4. Vite/Babel plugin for component name annotations -- builds on existing `@flareapp/vite`
5. React Router integration (v6/v7)
6. Redux/Zustand middleware (could be separate packages)
