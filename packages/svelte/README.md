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

## Component profiling

Records one span per component mount, nested under the active pageload or navigation trace, so you can
see which components dominate a page's render time. Requires tracing to be enabled (`enableTracing:
true`).

Turn it on in `svelte.config.js` with an allowlist:

```js
import { withFlareConfig } from '@flareapp/svelte/config';
import adapter from '@sveltejs/adapter-node';

export default withFlareConfig(
    { kit: { adapter: adapter() } },
    { profileComponents: [/\+(page|layout)(@[^/]*)?$/, 'AddToCartButton'] },
);
```

`profileComponents` accepts:

- **nothing** (the default): no components are profiled.
- **an array** of strings and regular expressions. Strings match exactly, regexes by `test()`.
- **`true`**: every component. This is a debugging aid, not a production setting. A real page will hit
  the 1024 span cap and bury the spans you care about among icons and list items.

Profiling and component tracking are independent. You can run either on its own:

```js
withFlareConfig(config, { componentTracking: false, profileComponents: [/\+page$/] });
```

### Preprocessor ordering

Both features are injected by a Svelte preprocessor, which `withFlareConfig` installs for you. It parses
each file with `svelte/compiler` to find the component's own instance script, which is the only reliable
way to tell that script apart from a `<script>` nested in your markup. So it has to be handed Svelte
syntax.

That only constrains you if you also run a markup preprocessor that converts another template language
(pug and the like) into Svelte. `withFlareConfig` puts the Flare preprocessor first, where it would see
the untransformed template, so in that setup wire it up yourself and place it after the one that
produces Svelte:

```js
import { flarePreprocessor } from '@flareapp/svelte/config';

export default {
    preprocess: [templateToSvelte(), flarePreprocessor({ profileComponents: [/\+page$/] })],
};
```

Style blocks are not affected. `<style lang="scss">` and friends are handled regardless of ordering.

A file the preprocessor cannot parse is left exactly as it was, with a warning naming the file. You lose
that component's registration, never the build.

### Component names

Names come from the filename, and route files carry their route directory so they stay distinguishable:

| File                                   | Name                 |
| -------------------------------------- | -------------------- |
| `src/lib/ProductGallery.svelte`        | `ProductGallery`     |
| `src/routes/+page.svelte`              | `+page`              |
| `src/routes/product/[id]/+page.svelte` | `product/[id]/+page` |
| `src/routes/product/+layout.svelte`    | `product/+layout`    |

Without the route prefix every route in a SvelteKit app would be called `+page`, and the allowlist could
not target one of them. The allowlist matches the same string the span reports, so what you write is what
you see. Renaming or moving a file silently stops it being profiled.

Layout-breakout files (`+page@.svelte`, `+page@(app).svelte`, `+layout@.svelte`, and so on) keep their
`@` suffix in the span name, for example `foo/+page@(app)`.

### What the tree shows

Only components you matched produce spans. A matched component nests under the nearest **matched**
ancestor, skipping anything unmatched in between, so the tree reflects your allowlist rather than the
real component tree.

### Two shapes, both correct

A layout mounts once and does not re-mount when you navigate, so it records a span on the load where it
mounted and not on later navigations. Expect the full tree on a pageload:

```
browser_pageload  /product/[id]        312ms
 └─ +layout                            290ms
     └─ product/[id]/+page             240ms
         └─ AddToCartButton             12ms
```

and a flatter one after a client-side navigation:

```
browser_navigation  /product/[other]   180ms
 └─ product/[other]/+page              140ms
     └─ AddToCartButton                 11ms
```

The missing layout span is expected, not a dropped span.

### Waits in `{#await}` are not included

A component does not wait for a pending `{#await}` branch before it finishes mounting. Read a parent's
duration as the time to mount its own synchronous subtree, not as time-to-interactive. A component
rendered inside `{:then}` can therefore start after its parent has already ended.

### No update spans

Only mounts are recorded. Svelte 5 disallows `beforeUpdate` and `afterUpdate` in runes mode, so there is
no reliable way to time an update from outside a component.

## Compatibility

- Svelte 5.3+

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
