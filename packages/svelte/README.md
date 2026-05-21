# @flareapp/svelte

Svelte 5 integration for [Flare](https://flareapp.io) error tracking. Provides an error boundary component that catches
component errors and reports them to Flare with Svelte-specific context (component name, hierarchy, error origin).

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

## Documentation

Full documentation on the error boundary, lifecycle callbacks, reset keys, custom boundary usage, and more is available
at [flareapp.io/docs/svelte/general/installation](https://flareapp.io/docs/svelte/general/installation).

## SvelteKit

For SvelteKit apps, install `@flareapp/sveltekit` as well. It adds client and server `handleError` helpers, route
context tracking, and re-exports the Svelte boundary component.

## Compatibility

- Svelte 5.3+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
