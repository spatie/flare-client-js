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
The client parses these into structured fields and attaches them, along with the running React version, to the report
context:

```ts
react: {
    version: '19.0.0',
    minifiedError: {
        number: 418,
        args: ['Foo', 'Bar'],
        url: 'https://react.dev/errors/418?args[]=Foo&args[]=Bar',
    },
}
```

Flare uses `react.minifiedError` and `react.version` on the backend to look up React's error-code map and surface the
full, human-readable message. No error-code map is bundled into the client. Non-minified errors are reported unchanged.

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

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.

## Component profiler (`@flareapp/react/profiler`)

Opt-in mount profiling: wrap a component to record a `browser_react_component` span for
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

**Naming:** the span name is `name` (prop or `withFlareProfiler(Component, { name })`),
then `Component.displayName`, then `Component.name`. Minified production builds can
mangle `Component.name`, so pass an explicit `name` or set `displayName` for production.

**Suspense (v1 limitation):** a `<Suspense>` boundary inside a profiled subtree can end a
parent span before a suspended child resumes, so the child may appear outside its parent
in the waterfall, and its duration includes the data wait. If the wait outlasts the
trace's idle window the child span is dropped rather than attached to a closed trace.
