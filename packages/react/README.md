# @flareapp/react

React integration for [Flare](https://flareapp.io) error tracking. Provides an error boundary component and a React 19+
error handler for catching and reporting React component errors to Flare.

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

## Documentation

Full documentation on the error boundary, the React 19+ error handler, lifecycle callbacks, and more is available
at [flareapp.io/docs/react/general/installation](https://flareapp.io/docs/react/general/installation).

## Compatibility

- React 16, 17, 18, 19
- `flareReactErrorHandler` requires React 19+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
