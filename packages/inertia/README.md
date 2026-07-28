# @flareapp/inertia

Performance tracing for [Inertia.js](https://inertiajs.com) apps, reporting to
[flareapp.io](https://flareapp.io).

Every Inertia visit opens a `browser_navigation` span named after the page component, so navigations show up
in Flare's performance monitoring the same way a server request does. Works with every Inertia adapter: the
router is passed in, so the Vue, React and Svelte adapters all use the identical call.

## Installation

```bash
npm install @flareapp/inertia
```

`@flareapp/js` is a peer dependency and must be installed and initialized separately.

## Usage

Call `traceInertiaRouter` once at boot, **before** `createInertiaApp` runs.

Vue:

```js
import { createInertiaApp, router } from '@inertiajs/vue3';
import { flare } from '@flareapp/js';
import { traceInertiaRouter } from '@flareapp/inertia';
import { createApp, h } from 'vue';

flare.configure({ enableTracing: true, tracesSampleRate: 1 });
flare.light('YOUR_FLARE_API_KEY');

traceInertiaRouter(router);

createInertiaApp({
    resolve: (name) => {
        const pages = import.meta.glob('./Pages/**/*.vue');
        return pages[`./Pages/${name}.vue`]();
    },
    setup({ el, App, props, plugin }) {
        createApp({ render: () => h(App, props) })
            .use(plugin)
            .mount(el);
    },
});
```

React, identical apart from the import:

```jsx
import { createInertiaApp, router } from '@inertiajs/react';
import { flare } from '@flareapp/js';
import { traceInertiaRouter } from '@flareapp/inertia';
import { createRoot } from 'react-dom/client';

flare.configure({ enableTracing: true, tracesSampleRate: 1 });
flare.light('YOUR_FLARE_API_KEY');

traceInertiaRouter(router);

createInertiaApp({
    resolve: (name) => {
        const pages = import.meta.glob('./Pages/**/*.jsx', { eager: true });
        return pages[`./Pages/${name}.jsx`];
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />);
    },
});
```

## Why the call has to come first

Inertia fires a `navigate` event for the initial page load. That event is how the integration learns the name
of the page the browser landed on. Calling `traceInertiaRouter` after Inertia has booted misses it, and the
first back/forward step is then mistaken for the initial load.

## Span naming

Navigation spans are named after the page component from Inertia's page object, for example `Products/Show`.
That keeps names low-cardinality so Flare can aggregate them, unlike the raw URL `/products/42`. When a
response carries no component name, the URL path is used instead.

## What does not get a navigation span

Inertia sends a request for plenty of things that do not move you to another page. None of these open a
navigation span:

- prefetches, including `<Link prefetch>` on hover, mount or viewport
- deferred props loaded after the page arrives
- polling, via `usePoll` or `router.poll`
- infinite scroll fetching the next page
- any other `router.reload()`

The requests themselves are still traced. Inertia sends them over XHR, which Flare instruments, so each one
shows up as a child span under whichever page it belongs to, with its real timing.

An asynchronous visit that does take you to a different page, such as
`router.visit('/cart', { async: true })`, is a navigation and does open a span.

Clicking a second link before the first page arrives is also one navigation, not two. The span runs from the
first click to the page that actually loaded, which is what the person waiting for it experienced.

## Prefetched navigations report near-zero duration

A click on a `<Link prefetch>` that is served from Inertia's prefetch cache is currently reported as an instant
navigation. Inertia fires neither `start` nor `finish` for it, only `navigate` and `success`, so the integration
cannot tell it apart from a back/forward step and opens and settles the span in the same tick. The navigation
still shows up as a `browser_navigation` span, but its duration should not be read as the time the user actually
waited. `<Link prefetch>` defaults to hover as its trigger, so this is a common path, not an edge case.

## Cleanup

`traceInertiaRouter` returns a function that removes its listeners:

```js
const stopTracing = traceInertiaRouter(router);

stopTracing();
```

Calling `traceInertiaRouter` twice on the same router replaces the first instrumentation rather than stacking
a second set of listeners, so Vite HMR does not accumulate them.

## Requirements

- `@flareapp/js` with `enableTracing: true`
- Inertia v1 or v2 (any adapter)

## Documentation

Full documentation on performance tracing is available at
[flareapp.io/docs/javascript/general/installation](https://flareapp.io/docs/javascript/general/installation).

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
