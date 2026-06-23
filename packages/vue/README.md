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

## Compatibility

- Vue 3

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
