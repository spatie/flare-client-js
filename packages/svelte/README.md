# @flareapp/svelte

Svelte 5 integration for [Flare](https://flareapp.io) error tracking and logging. Provides an error boundary component
that catches component errors and reports them to Flare with Svelte-specific context (component name, hierarchy, error
origin).

## Installation

```bash
npm install @flareapp/svelte @flareapp/js
```

## Quick start

Initialize the Flare client and wrap your component tree with the error boundary:

```svelte
<script lang="ts">
    import { flare } from '@flareapp/js';
    import { FlareErrorBoundary } from '@flareapp/svelte';

    import Root from './Root.svelte';

    if (import.meta.env.PROD) {
        flare.light('YOUR_FLARE_API_KEY');
    }
</script>

<FlareErrorBoundary>
    <Root />

    {#snippet failed(error, reset)}
        <p>{error.message}</p>
        <button onclick={reset}>Try again</button>
    {/snippet}
</FlareErrorBoundary>
```

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of the
eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```svelte
<script lang="ts">
    import { flare } from '@flareapp/js';

    flare.configure({ enableLogs: true });

    flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
</script>
```

## Identifying users

```ts
import { flare } from '@flareapp/js';

flare.setUser({ id: 123, email: 'jane@example.com', fullName: 'Jane Doe' });
```

See the [JavaScript identifying-users docs](https://flareapp.io/docs/javascript/data-collection/identifying-users) for the full field list. Pass `null` to clear.

## Documentation

Full documentation on the error boundary, lifecycle callbacks, reset keys, custom boundary usage, and more is available
at [flareapp.io/docs/svelte/general/installation](https://flareapp.io/docs/svelte/general/installation).

## Compatibility

- Svelte 5.3+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
