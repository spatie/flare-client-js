# @flareapp/sveltekit

SvelteKit integration for [Flare](https://flareapp.io) error tracking. It adds client and server `handleError` helpers,
manual SvelteKit capture helpers, route context, and the `trackRouteContext()` helper for attaching route information to
browser reports. It also re-exports the `@flareapp/svelte` error boundary from the package root.

## Experimental SvelteKit support

The SvelteKit integration is experimental. Client-side SvelteKit errors use the normal browser stack trace and sourcemap
flow, and can be resolved with `@flareapp/vite`.

Server-side SvelteKit errors are reported with status, message, and route context, but Flare can not yet resolve
SvelteKit server stack traces or server sourcemaps.

## Installation

Install the core Flare client, the Svelte client, and the SvelteKit integration:

```bash
npm install @flareapp/js @flareapp/svelte @flareapp/sveltekit
# or
yarn add @flareapp/js @flareapp/svelte @flareapp/sveltekit
# or
pnpm add @flareapp/js @flareapp/svelte @flareapp/sveltekit
```

`@flareapp/sveltekit` supports Svelte 5.3 and higher and SvelteKit 2.12 and higher.

If your app is bundled for production, also configure sourcemap uploads with `@flareapp/vite` so Flare can show readable
client-side stack traces and code snippets.

## Package entry points

Use the environment-specific subpaths for SvelteKit hooks:

```ts
import { handleErrorWithFlare } from '@flareapp/sveltekit/client';
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';
```

The package root only re-exports `@flareapp/svelte`:

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/sveltekit';
</script>
```

Do not import `handleErrorWithFlare`, `captureError`, or `trackRouteContext` from the package root. Use `/client` or
`/server` so SvelteKit can keep browser and server code separate.

## Setting up the Flare client

Initialize the core Flare client in each runtime where you want to report errors.

Client-side setup:

```ts
// src/hooks.client.ts
import { dev } from '$app/environment';
import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/client';

if (!dev) {
    flare.light('YOUR PROJECT PUBLIC KEY');
}

export const handleError = handleErrorWithFlare();
```

Server-side setup:

```ts
// src/hooks.server.ts
import { dev } from '$app/environment';
import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

if (!dev) {
    flare.light('YOUR PROJECT PUBLIC KEY');
}

export const handleError = handleErrorWithFlare();
```

Use your project's public key from the JavaScript installation section in your Flare project settings.

If you use the sourcemap plugin, you do not need to pass a public key to `flare.light()`. The plugin injects the project
key during your build.

## Using the Svelte error boundary

The SvelteKit root export re-exports `FlareErrorBoundary` from `@flareapp/svelte`, so you can use the boundary without a
second import path:

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/sveltekit';

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

Use the boundary when you want fallback UI and reset behavior for a component subtree. Use the SvelteKit
`handleErrorWithFlare` helpers for framework-level client and server errors.

## `handleErrorWithFlare`

`handleErrorWithFlare()` returns a function compatible with SvelteKit's `handleError` hook. It reports unexpected errors
to Flare with SvelteKit route context.

```ts
// src/hooks.server.ts
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

export const handleError = handleErrorWithFlare();
```

The client and server exports have the same public API, but collect route context from different places:

| Export                       | Route source               |
| ---------------------------- | -------------------------- |
| `@flareapp/sveltekit/client` | `$app/state`               |
| `@flareapp/sveltekit/server` | SvelteKit's `event` object |

### Error filtering

`handleErrorWithFlare()` skips 4xx errors because SvelteKit uses them for expected application responses such as 404s
and validation failures. It reports 5xx and unexpected errors.

If you pass your own handler, it is still called for skipped 4xx errors:

```ts
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

export const handleError = handleErrorWithFlare(({ error, status, message }) => {
    console.error('SvelteKit handled error:', { error, status, message });

    return {
        message,
    };
});
```

### Lifecycle callbacks

Pass an options object to run callbacks around the SvelteKit reporting flow:

```ts
import { flare } from '@flareapp/js';
import { handleErrorWithFlare } from '@flareapp/sveltekit/server';

export const handleError = handleErrorWithFlare({
    beforeEvaluate: ({ error, status, message }) => {
        flare.addContext('svelteKitStatus', status);
        flare.addContext('svelteKitMessage', message);
        flare.addContext('errorMessage', error.message);
    },
    beforeSubmit: ({ context }) => {
        if (!context.svelte.svelteKit) {
            return context;
        }

        return {
            ...context,
            svelte: {
                ...context.svelte,
                svelteKit: {
                    ...context.svelte.svelteKit,
                    params: {},
                },
            },
        };
    },
    afterSubmit: ({ error, context }) => {
        console.error('Reported SvelteKit error:', error);
        console.debug('SvelteKit context:', context);
    },
});
```

Callback order:

1. `beforeEvaluate` runs after the thrown value is converted to an `Error`.
2. Route context is built from `$app/state` or the server `event`.
3. `beforeSubmit` runs with the SvelteKit context. Return the context object that should be attached to the report.
4. Internal `flare.reportSilently()` is called.
5. `afterSubmit` runs after Flare reporting is started. The network request is asynchronous.

The callbacks are not wrapped in `try`/`catch`. If one throws, the error can bubble out of the hook.

The hook accepts either a custom SvelteKit handler function or an options object. If you need fully custom control, use
`captureError()` inside your own `handleError` implementation.

## Manual SvelteKit capture

Use `captureError()` when you want to report manually from SvelteKit hook code.

Server-side:

```ts
// src/hooks.server.ts
import { captureError } from '@flareapp/sveltekit/server';

export function handleError({ error, event, status, message }) {
    captureError(error, { event, status, message });

    return {
        message,
    };
}
```

Client-side:

```ts
// src/hooks.client.ts
import { captureError } from '@flareapp/sveltekit/client';

export function handleError({ error, status, message }) {
    captureError(error, { status, message });
}
```

Unlike `handleErrorWithFlare()`, `captureError()` reports whatever you pass to it. It does not skip 4xx errors for you.

## Route context

SvelteKit reports include route context under `context.custom.svelte.svelteKit`.

```ts
interface SvelteKitRouteContext {
    routeId: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
    status?: number;
    message?: string;
}
```

Field details:

| Field     | Description                                                  |
| --------- | ------------------------------------------------------------ |
| `routeId` | Parameterized SvelteKit route ID, for example `/users/[id]`. |
| `url`     | Request or page pathname without the origin.                 |
| `params`  | Route params from SvelteKit.                                 |
| `query`   | Query-string values with sensitive keys redacted.            |
| `status`  | SvelteKit error status when available.                       |
| `message` | SvelteKit error message when available.                      |

Query parameter values are redacted when their keys match the default URL denylist from `@flareapp/js`, including names
such as `password`, `token`, `secret`, `authorization`, `cookie`, `api_key`, `session`, and `csrf`.

The full SvelteKit context is nested inside the base Svelte context:

```ts
{
    svelte: {
        componentName: null,
        componentHierarchy: [],
        errorOrigin: 'unknown',
        svelteKit: {
            routeId: '/users/[id]',
            url: '/users/42',
            params: { id: '42' },
            query: { tab: 'settings', token: '[redacted]' },
            status: 500,
            message: 'Internal Error',
        },
    },
}
```

## Tracking route context for all client reports

`trackRouteContext()` syncs the current SvelteKit route into the core Flare client context as
`context.custom.svelteKit`. After it is enabled, every browser-side report includes the current route, including manual
`flare.report()` calls and global browser errors caught by `@flareapp/js`.

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
    import { trackRouteContext } from '@flareapp/sveltekit/client';

    let { children } = $props();

    trackRouteContext();
</script>

{@render children()}
```

Calling `handleErrorWithFlare()` from `@flareapp/sveltekit/client` also starts route tracking automatically.
`trackRouteContext()` is safe to call more than once; later calls are ignored.

## Manual reports, context, and glows

Use `@flareapp/js` directly for manual browser or server reports that do not need SvelteKit hook handling:

```ts
import { flare } from '@flareapp/js';

flare.addContext('tenant', { id: 'acme' });
flare.glow('navigation', 'Opened billing page');
flare.report(new Error('Manual SvelteKit report'));
```

Useful shared documentation:

- [Reporting errors](https://flareapp.io/docs/javascript/errors/reporting-errors)
- [Client hooks](https://flareapp.io/docs/javascript/errors/client-hooks)
- [Adding custom context](https://flareapp.io/docs/javascript/data-collection/adding-custom-context)
- [Adding glows](https://flareapp.io/docs/javascript/data-collection/adding-glows)

## Resolving bundled code

Production SvelteKit apps are usually minified and bundled, which makes raw browser stack traces hard to read. Configure
sourcemap uploads with `@flareapp/vite` so Flare can map client-side stack frames back to your original `.svelte` and
`.ts` files.

SvelteKit server errors are reported, but Flare can not yet resolve their stack traces or sourcemaps.

The client-side SvelteKit integration uses the same sourcemap plugin as the JavaScript and React clients. See the
[JavaScript resolving bundled code documentation](https://flareapp.io/docs/javascript/general/resolving-bundled-code)
for the Vite, Webpack, Laravel Mix, and manual upload setup.

## Verifying your setup

The browser client is available as `window.flare` after initialization. Build your app for production and run this in the
browser console:

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

Root export:

```ts
import { FlareErrorBoundary, createFlareErrorHandler } from '@flareapp/sveltekit';

import type { FlareErrorHandlerOptions, FlareSvelteContext, SvelteErrorOrigin } from '@flareapp/sveltekit';
```

The root export is a convenience re-export of `@flareapp/svelte`.

Client export:

```ts
import { captureError, handleErrorWithFlare, trackRouteContext } from '@flareapp/sveltekit/client';

import type { CaptureErrorOptions, HandleErrorWithFlareOptions } from '@flareapp/sveltekit/client';
```

Server export:

```ts
import { captureError, handleErrorWithFlare } from '@flareapp/sveltekit/server';

import type { CaptureErrorOptions, HandleErrorWithFlareOptions } from '@flareapp/sveltekit/server';
```

Exports:

| Export                    | Entry point                                                | Description                                                                 |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `FlareErrorBoundary`      | `@flareapp/sveltekit`                                      | Svelte error boundary component re-exported from `@flareapp/svelte`.        |
| `createFlareErrorHandler` | `@flareapp/sveltekit`                                      | Custom Svelte boundary handler factory re-exported from `@flareapp/svelte`. |
| `handleErrorWithFlare`    | `@flareapp/sveltekit/client`, `@flareapp/sveltekit/server` | Factory that returns a SvelteKit `handleError` hook.                        |
| `captureError`            | `@flareapp/sveltekit/client`, `@flareapp/sveltekit/server` | Manual SvelteKit-aware error reporting helper.                              |
| `trackRouteContext`       | `@flareapp/sveltekit/client`                               | Syncs browser route state into Flare context for every client-side report.  |

Types:

| Type                          | Entry point                                                | Description                                                                     |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `CaptureErrorOptions`         | `@flareapp/sveltekit/client`, `@flareapp/sveltekit/server` | Options accepted by `captureError()`: `event`, `status`, and `message`.         |
| `HandleErrorWithFlareOptions` | `@flareapp/sveltekit/client`, `@flareapp/sveltekit/server` | Lifecycle callback options accepted by `handleErrorWithFlare()`.                |
| `FlareErrorHandlerOptions`    | `@flareapp/sveltekit`                                      | Svelte boundary lifecycle callback options re-exported from `@flareapp/svelte`. |
| `FlareSvelteContext`          | `@flareapp/sveltekit`                                      | Base Svelte context type re-exported from `@flareapp/svelte`.                   |
| `SvelteErrorOrigin`           | `@flareapp/sveltekit`                                      | Base Svelte error origin type re-exported from `@flareapp/svelte`.              |

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
