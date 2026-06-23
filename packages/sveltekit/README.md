# @flareapp/sveltekit

SvelteKit integration for [Flare](https://flareapp.io) error tracking and logging. Wraps SvelteKit's client and server
`handleError` hooks to report unexpected errors with route context. Also provides manual capture helpers and route
tracking for browser-side reports.

## Installation

```bash
npm install @flareapp/sveltekit @flareapp/js
```

## Quick start

Set up Flare in your SvelteKit hooks:

```ts
// src/hooks.client.ts
import { dev } from '$app/environment';
import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/client';

if (!dev) {
    flare.light('YOUR_FLARE_API_KEY');
}

export const handleError = handleErrorWithFlare();
```

```ts
// src/hooks.server.ts
import { dev } from '$app/environment';
import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

if (!dev) {
    flare.light('YOUR_FLARE_API_KEY');
}

export const handleError = handleErrorWithFlare();
```

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of the
eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```ts
import { flare } from '@flareapp/js';

flare.configure({ enableLogs: true });

flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
```

## Identifying users

```ts
import { flare } from '@flareapp/js';

flare.setUser({ id: 123, email: 'jane@example.com', fullName: 'Jane Doe' });
```

See the [JavaScript identifying-users docs](https://flareapp.io/docs/javascript/data-collection/identifying-users) for the full field list. Pass `null` to clear.

## Documentation

Full documentation on `handleErrorWithFlare`, `captureError`, `trackRouteContext`, lifecycle callbacks, and more is
available at [flareapp.io/docs/svelte/general/installation](https://flareapp.io/docs/svelte/general/installation).

## Compatibility

- Svelte 5.3+
- SvelteKit 2.12+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
