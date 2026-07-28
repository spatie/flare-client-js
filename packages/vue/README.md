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

Strings match the component name exactly. Regular expressions match by `test()`. `true` profiles every named
component, which is useful when exploring but will hit the 1024 span per trace cap on a real page and bury the
spans you care about.

Names come from the same resolution the error reports use: the name the SFC compiler derives from the filename,
then an explicit `name` option, then `AnonymousComponent`. Renaming a component silently stops profiling it.

Only mounts are recorded. Updates, `<KeepAlive>` reactivation and unmounts are not.

A component that mounts later inside an already-mounted profiled ancestor still nests under that ancestor, whose
own span closed when it finished mounting. The tree is correct, but the waterfall shows the child starting after
its parent ended. A page body swapped inside a persistent layout is the usual way to see this.

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
