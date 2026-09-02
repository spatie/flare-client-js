# @flareapp/vue

Vue integration for [Flare](https://flareapp.io) error tracking and logging. Installs a Vue error handler that catches component errors and reports them to Flare with Vue-specific context (component name, lifecycle info).

## Installation

```bash
npm install @flareapp/vue @flareapp/js
```

## Quick start

Initialize the Flare client and register the Vue error handler:

```js
import { createApp } from 'vue';
import { flare } from '@flareapp/js';
import { flareVue } from '@flareapp/vue';

import App from './App.vue';

flare.light('YOUR_FLARE_API_KEY');

const app = createApp(App);

flareVue(app);

app.mount('#app');
```

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of the eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```js
import { flare } from '@flareapp/js';

flare.configure({ enableLogs: true });

flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
```

## Identifying users

```js
import { flare } from '@flareapp/js';

flare.setUser({ id: 123, email: 'jane@example.com', fullName: 'Jane Doe' });
```

See the [JavaScript identifying-users docs](https://flareapp.io/docs/javascript/data-collection/identifying-users) for the full field list. Pass `null` to clear.

## Documentation

Full documentation on the Vue error handler and its options is available at [flareapp.io/docs/vue/general/installation](https://flareapp.io/docs/vue/general/installation).

## Component profiling

Record a span per component mount, nested under the active page-load or navigation trace. Requires tracing
(`enableTracing: true`) and an allowlist:

```js
app.use(flareVue, {
    router,
    profileComponents: ['ProductPage', 'CartPage', /^Checkout/],
});
```

`app.use(flareVue, …)` and `flare.configure({ enableTracing: true })` can run in either order. Installing
the plugin first is fine: the router guards and the profiler hook stay idle until tracing is on.

Strings match the component name exactly. Regular expressions match by `test()`. `true` profiles every named
component, which is useful when exploring but will hit the 1024 span per trace cap on a real page and bury the
spans you care about.

Names come from the same resolution the error reports use: the name the SFC compiler derives from the filename,
then an explicit `name` option, then `AnonymousComponent`. Renaming a component silently stops profiling it.

Only mounts are recorded. Updates, `<KeepAlive>` reactivation and unmounts are not.

A component that mounts later inside an already-mounted profiled ancestor still nests under that ancestor, whose
own span closed when it finished mounting. The tree is correct, but the waterfall shows the child starting after
its parent ended. A page body swapped inside a persistent layout is the usual way to see this.

**Async components and `<Suspense>`:** Vue treats a component as mounted once its _synchronous_ children
are mounted. A component with an async `setup()`, or one inside a `<Suspense>` boundary, therefore mounts
after its profiled ancestor's span has closed, so it appears after its parent in the waterfall. If the
whole trace closed by then, the span is dropped rather than attached to a finished trace.

### Self time

Every component span carries `flare.component.self_time_ns`: the span's duration minus the time its own
profiled children account for. Children that overlap in time are counted once, so the value never goes
below zero.

A child that mounts after its parent's span closed is not subtracted. Its work happened outside the
parent's window, so the parent keeps its full duration.

A layout is the usual example. `vue-router` resolves the first route after the layout mounted, so the page
component's work falls outside the layout's window.

### Naming with Inertia

Inertia names navigation spans after the page component from its page object, so a root reads `Products/Show`.
Vue names components after the file, so `./Pages/Products/Show.vue` is `Show`, and `./Pages/Orders/Show.vue` is
also `Show`. Set the name explicitly on page components if you want the two to read the same:

```vue
<script setup>
defineOptions({ name: 'Products/Show' });
</script>
```

Without it, spans use the bare filename, which is usually still readable because the root span disambiguates.

## Compatibility

- Vue 3

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
