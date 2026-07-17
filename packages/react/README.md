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

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
