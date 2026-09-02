# @flareapp/react

React integration for [Flare](https://flareapp.io) error tracking and logging. Provides an error boundary component and
a React 19+ error handler for catching and reporting React component errors to Flare.

## Installation

```bash
npm install @flareapp/react @flareapp/js
```

## Quick start

Initialize the Flare client and wrap your component tree with the error boundary:

```tsx
import { flare } from '@flareapp/js';
import { FlareErrorBoundary } from '@flareapp/react';

flare.light('YOUR_FLARE_API_KEY');

function App() {
    return (
        <FlareErrorBoundary fallback={<p>Something went wrong.</p>}>
            <MyComponent />
        </FlareErrorBoundary>
    );
}
```

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of the
eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```tsx
import { flare } from '@flareapp/js';

flare.configure({ enableLogs: true });

flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
```

## Minified production errors

In production, React throws minified errors like `Minified React error #418; visit https://react.dev/errors/418?args[]=Foo`.
The client parses these into a single self-contained field, `flare.exception.react_minified_error`, carrying the running
React version alongside the parsed pieces:

```ts
'flare.exception.react_minified_error': {
    number: 418,
    args: ['Foo', 'Bar'],
    url: 'https://react.dev/errors/418?args[]=Foo&args[]=Bar',
    react_version: '19.0.0',
}
```

Flare reads this field on the backend to look up React's error-code map (keyed on `react_version`) and surface the full,
human-readable message. It is a Flare-internal field, not part of the display context, so it is emitted only when an
error actually parses as a minified React error and cannot be stripped by a `beforeSubmit` hook. No error-code map is
bundled into the client. Non-minified errors are reported unchanged.

`context.custom.react` continues to carry `componentStack`, `componentStackFrames` and `version` for display.

## Identifying users

```tsx
import { flare } from '@flareapp/js';

flare.setUser({ id: 123, email: 'jane@example.com', fullName: 'Jane Doe' });
```

See the [JavaScript identifying-users docs](https://flareapp.io/docs/javascript/data-collection/identifying-users) for the full field list. Pass `null` to clear.

## Documentation

Full documentation on the error boundary, the React 19+ error handler, lifecycle callbacks, and more is available
at [flareapp.io/docs/react/general/installation](https://flareapp.io/docs/react/general/installation).

## Compatibility

- React 16, 17, 18, 19
- `flareReactErrorHandler` requires React 19+
- `withFlareProfiler` forwards `ref` on React 19 only

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.

## Component profiler (`@flareapp/react/profiler`)

Opt-in mount profiling: wrap a component to record a `browser_component` span for
its mount, nested under the active page-load / navigation trace. Requires tracing to be
enabled (`enableTracing: true`).

```tsx
import { FlareProfiler, withFlareProfiler } from '@flareapp/react/profiler';

// Wrap at the definition:
export default withFlareProfiler(ProductPage);

// Or wrap an inline subtree:
<FlareProfiler name="Gallery">
    <ProductGallery />
</FlareProfiler>;
```

Spans nest into a tree: a profiled child nests under its nearest profiled ancestor;
unprofiled components in between are transparent. A component with no active trace
(tracing off, or no page-load/navigation root) records nothing and renders normally.

A component that mounts later inside an already-mounted profiled ancestor still nests
under that ancestor, whose own span closed when it finished mounting. The tree is
correct, but the waterfall shows the child starting after its parent ended. A page body
swapped inside a persistent layout is the usual way to see this.

### Self time

Every component span carries `flare.component.self_time_ns`: the span's duration minus the time its own
profiled children account for. Children that overlap in time are counted once, so the value never goes
below zero.

A child that mounts after its parent's span closed is not subtracted. Its work happened outside the
parent's window, so the parent keeps its full duration.

React starts every component during render and ends them all during commit, so sibling spans overlap in
time. The self times of one tree therefore add up to more than the root span's duration.

**Import the main entry somewhere too.** `@flareapp/react/profiler` is deliberately dependency-free, so
it does not register React as the framework. That identity (`flare.framework.name`) is what tells Flare a
component span came from React, and importing `@flareapp/react` anywhere in the app sets it. An app that
uses only the `/profiler` entry reports `js` instead, and its component spans are attributed to plain
JavaScript rather than React.

**Naming:** the span name is `name` (prop or `withFlareProfiler(Component, { name })`),
then `Component.displayName`, then `Component.name`. Minified production builds can
mangle `Component.name`, so pass an explicit `name` or set `displayName` for production.

**Suspense (v1 limitation):** a `<Suspense>` boundary inside a profiled subtree can end a
parent span before a suspended child resumes, so the child may appear outside its parent
in the waterfall, and its duration includes the data wait. If the wait outlasts the
trace's idle window the child span is dropped rather than attached to a closed trace.

**Render-phase start:** the span starts when the component first renders, not when React commits it. A
render React defers or discards (`useDeferredValue`, an interrupted transition, an `<Activity mode="hidden">`
prerender revealed later) bills that whole gap to the component.

**Refs and statics:** the wrapper is a plain function component. It forwards no `ref` through `forwardRef`
and hoists no statics. On React 19 `ref` is a normal prop and passes straight through, so this only affects
the React 16-18 half of the peer range; there, wrap with `FlareProfiler` inside the component instead of
applying `withFlareProfiler` to it.
