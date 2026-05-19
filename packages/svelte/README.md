# @flareapp/svelte

Svelte 5 integration for [Flare](https://flareapp.io) error tracking. It provides a native Svelte error boundary and a
handler factory for custom `<svelte:boundary>` usage. It builds on top of `@flareapp/js`, which still handles the core
Flare client configuration, global browser errors, manual reports, custom context, and glows.

## Installation

Install both the core Flare client and the Svelte integration:

```bash
npm install @flareapp/js @flareapp/svelte
# or
yarn add @flareapp/js @flareapp/svelte
# or
pnpm add @flareapp/js @flareapp/svelte
```

`@flareapp/svelte` supports Svelte 5.3 and higher.

If your app is bundled for production, also configure sourcemap uploads with `@flareapp/vite` so Flare can show readable
stack traces and code snippets.

## Setting up the Flare client

Initialize the Flare client as early as possible in your application, typically in `main.ts`:

```ts
import { flare } from '@flareapp/js';
import { mount } from 'svelte';

import App from './App.svelte';

if (import.meta.env.PROD) {
    flare.light('YOUR PROJECT PUBLIC KEY');
}

mount(App, {
    target: document.getElementById('app')!,
});
```

Use your project's public key from the JavaScript installation section in your Flare project settings.

If you use the sourcemap plugin, you do not need to pass a public key to `flare.light()`. The plugin injects the project
key during your build.

## Error boundary

`FlareErrorBoundary` wraps Svelte's native `<svelte:boundary>`. It catches errors from the component tree below it,
reports them to Flare, and can render your fallback snippet.

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';

    import Root from './Root.svelte';
</script>

<FlareErrorBoundary>
    <Root />

    {#snippet failed(error, reset)}
        <section>
            <h2>Something went wrong</h2>
            <p>{error.message}</p>
            <button onclick={reset}>Try again</button>
        </section>
    {/snippet}
</FlareErrorBoundary>
```

Without a `failed` snippet, the boundary still catches and reports the error, but it renders nothing for the failed
subtree.

### Resetting the boundary

Call the `reset` function passed to the `failed` snippet to clear the boundary state and retry rendering the children:

```svelte
<FlareErrorBoundary>
    <CheckoutForm />

    {#snippet failed(error, reset)}
        <p>{error.message}</p>
        <button onclick={reset}>Retry checkout</button>
    {/snippet}
</FlareErrorBoundary>
```

You can also reset automatically when values in `resetKeys` change. Values are compared by index with `Object.is`, and a
length change also triggers a reset.

```svelte
<FlareErrorBoundary
    resetKeys={[currentRoute, selectedAccountId]}
    onReset={(error) => {
        console.log('Recovered from:', error?.message);
    }}
>
    <AccountPage />

    {#snippet failed(error, reset)}
        <p>{error.message}</p>
        <button onclick={reset}>Try again</button>
    {/snippet}
</FlareErrorBoundary>
```

`onReset` runs when the user calls `reset` from the fallback snippet or when `resetKeys` changes while the boundary is in
an error state. It receives the previous error, or `null` if no error was stored.

## Lifecycle callbacks

The boundary exposes three callbacks around the Svelte-specific reporting flow.

```svelte
<script lang="ts">
    import { flare } from '@flareapp/js';
    import { FlareErrorBoundary, type FlareSvelteContext } from '@flareapp/svelte';
</script>

<FlareErrorBoundary
    beforeEvaluate={({ error }) => {
        flare.addContext('feature', 'checkout');
        flare.addContext('errorMessage', error.message);
    }}
    beforeSubmit={({ context }: { context: FlareSvelteContext }) => {
        return {
            ...context,
            svelte: {
                ...context.svelte,
                componentHierarchy: context.svelte.componentHierarchy.filter(
                    (component) => component !== 'ThirdPartyWrapper',
                ),
            },
        };
    }}
    afterSubmit={({ error, context }) => {
        console.error('Reported Svelte error:', error);
        console.debug('Svelte context:', context);
    }}
>
    <Root />
</FlareErrorBoundary>
```

Callback order:

1. `beforeEvaluate` runs after the thrown value is converted to an `Error`, before Svelte context is built.
2. `beforeSubmit` runs after Svelte context is built. Return the context object that should be attached to the report.
3. `afterSubmit` runs after Flare reporting is started. The network request is asynchronous.

These callbacks are not wrapped in `try`/`catch`. If one throws, the error can bubble out of the boundary handler.

### Filtering errors

The boundary callbacks are for adding context and running side effects. They do not suppress reports.

To filter, suppress, or modify the final Flare report, use the core JavaScript client hooks:

```ts
import { flare } from '@flareapp/js';

flare.configure({
    beforeEvaluate: (error) => {
        if (error.message.includes('Ignored validation error')) {
            return false;
        }

        return error;
    },
});
```

The execution order when both boundary callbacks and core client hooks are configured is:

1. Boundary `beforeEvaluate`
2. Boundary `beforeSubmit`
3. Internal `flare.reportSilently()` call
4. Client `beforeEvaluate` from `flare.configure()`
5. Client `beforeSubmit` from `flare.configure()`
6. Report is sent to Flare
7. Boundary `afterSubmit`

## Svelte context

When the Svelte integration reports an error, it attaches Svelte-specific context under `context.custom.svelte`.

```ts
interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: 'render' | 'event' | 'effect' | 'unknown';
    };
}
```

Field details:

| Field                | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `componentName`      | Best-effort name of the component closest to the thrown error.   |
| `componentHierarchy` | Component names ordered from inner component to outer component. |
| `errorOrigin`        | Best-effort classification of where the error came from.         |

Component context is extracted from `.svelte` stack frames. In production bundles, function names and filenames may be
minified. Configure sourcemaps so Flare can resolve the original source code on the backend.

## Event handlers and async errors

Svelte boundaries do not catch every kind of browser error. Errors thrown in event handlers and unhandled promise
rejections are handled by the global listeners installed by `@flareapp/js`, not by `FlareErrorBoundary`.

```svelte
<button
    onclick={() => {
        throw new Error('Clicked button failed');
    }}
>
    Trigger event error
</button>
```

The error above is still reported if the core Flare client is initialized, but it will not render the boundary fallback
UI.

## Custom boundary usage

Use `createFlareErrorHandler()` when you want to wire Flare into your own `<svelte:boundary>` instead of using
`FlareErrorBoundary`.

```svelte
<script lang="ts">
    import { createFlareErrorHandler } from '@flareapp/svelte';

    const reportToFlare = createFlareErrorHandler({
        afterSubmit: ({ error }) => {
            console.error('Reported through custom boundary:', error);
        },
    });
</script>

<svelte:boundary onerror={reportToFlare}>
    <Root />

    {#snippet failed(error, reset)}
        <p>{error.message}</p>
        <button onclick={reset}>Retry</button>
    {/snippet}
</svelte:boundary>
```

The returned function matches the Svelte boundary `onerror` signature:

```ts
(error: unknown, reset: () => void) => void | Promise<void>;
```

It converts non-`Error` values, builds Svelte context from the stack trace, reports through the core Flare client, and
runs the lifecycle callbacks described above.

## Manual reports, context, and glows

The Svelte integration builds on the core JavaScript client. Use `@flareapp/js` directly for manual reporting, client
hooks, custom context, and glows:

```ts
import { flare } from '@flareapp/js';

flare.addContext('user', { id: '123' });
flare.glow('checkout', 'Payment method selected');

try {
    await submitOrder();
} catch (error) {
    flare.report(error);
}
```

Useful shared documentation:

- [Reporting errors](https://flareapp.io/docs/javascript/errors/reporting-errors)
- [Client hooks](https://flareapp.io/docs/javascript/errors/client-hooks)
- [Adding custom context](https://flareapp.io/docs/javascript/data-collection/adding-custom-context)
- [Adding glows](https://flareapp.io/docs/javascript/data-collection/adding-glows)

## Resolving bundled code

Production Svelte apps are usually minified and bundled, which makes raw stack traces hard to read. Configure sourcemap
uploads with `@flareapp/vite` so Flare can map stack frames back to your original `.svelte` files.

The Svelte integration uses the same sourcemap plugin as the JavaScript and React clients. See the
[JavaScript resolving bundled code documentation](https://flareapp.io/docs/javascript/general/resolving-bundled-code)
for the Vite, Webpack, Laravel Mix, and manual upload setup.

## Verifying your setup

The core client is available as `window.flare` in the browser. Build your app for production and run this in the browser
console:

```js
flare.test();
```

This sends a test error to your Flare project.

If nothing appears in Flare, enable debug mode:

```ts
flare.light('YOUR PROJECT PUBLIC KEY', true);
// or
flare.configure({ debug: true });
```

If `flare.light()` has not been called, for example because your production guard is false, reports are silently ignored.

## API reference

```ts
import { FlareErrorBoundary, createFlareErrorHandler } from '@flareapp/svelte';

import type { FlareErrorHandlerOptions, FlareSvelteContext, SvelteErrorOrigin } from '@flareapp/svelte';
```

Exports:

| Export                    | Description                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `FlareErrorBoundary`      | Svelte component that catches boundary errors, reports them to Flare, and renders an optional fallback snippet. |
| `createFlareErrorHandler` | Factory that returns a Svelte boundary `onerror` callback for custom boundary usage.                            |

Types:

| Type                       | Description                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `FlareErrorHandlerOptions` | Lifecycle callback options accepted by `createFlareErrorHandler` and `FlareErrorBoundary`. |
| `FlareSvelteContext`       | Shape of the Svelte context passed to `beforeSubmit` and `afterSubmit`.                    |
| `SvelteErrorOrigin`        | Union of possible origin values: `'render'`, `'event'`, `'effect'`, and `'unknown'`.       |

### `FlareErrorBoundary` props

| Prop             | Type                                         | Description                                                           |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `children`       | `Snippet`                                    | Child snippet rendered inside the boundary.                           |
| `failed`         | `Snippet<[error: Error, reset: () => void]>` | Optional fallback snippet rendered after an error is caught.          |
| `resetKeys`      | `unknown[]`                                  | Values that reset the boundary when changed while an error is stored. |
| `beforeEvaluate` | `({ error }) => void`                        | Runs before Svelte context is built.                                  |
| `beforeSubmit`   | `({ error, context }) => FlareSvelteContext` | Runs before reporting. Return the context to attach.                  |
| `afterSubmit`    | `({ error, context }) => void`               | Runs after reporting is started.                                      |
| `onReset`        | `(error: Error &#124; null) => void`         | Runs when the boundary is reset.                                      |

## SvelteKit

For SvelteKit apps, install `@flareapp/sveltekit` as well. It adds client and server `handleError` helpers, manual
SvelteKit capture helpers, route context, and re-exports the Svelte boundary component for convenience.

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
