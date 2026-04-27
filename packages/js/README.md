# @flareapp/js

The core JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking. Captures frontend errors, parses
stack traces, collects browser context, and reports everything to the Flare backend.

## Installation

```bash
npm install @flareapp/js
```

## Quick start

```js
import { flare } from '@flareapp/js';

flare.light('YOUR_FLARE_API_KEY');
```

That is all you need. The client automatically listens for uncaught exceptions and unhandled promise rejections,
collects browser context, and sends error reports to Flare.

## Documentation

Full documentation on configuration, hooks, context, breadcrumbs, solution providers, and more is available
at [flareapp.io/docs/javascript/general/installation](https://flareapp.io/docs/javascript/general/installation).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
