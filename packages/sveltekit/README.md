# @flareapp/sveltekit

SvelteKit integration for [Flare](https://flareapp.io) error tracking. Wraps SvelteKit's client and server `handleError`
hooks to report unexpected errors with route context. Also provides manual capture helpers and route tracking for
browser-side reports.

## Installation

```bash
npm install @flareapp/sveltekit @flareapp/svelte @flareapp/js
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

## Documentation

Full documentation on `handleErrorWithFlare`, `captureError`, `trackRouteContext`, lifecycle callbacks, and more is
available at [flareapp.io/docs/svelte/general/installation](https://flareapp.io/docs/svelte/general/installation).

## Compatibility

- Svelte 5.3+
- SvelteKit 2.12+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
