# @flareapp/vue

Vue integration for [Flare](https://flareapp.io) error tracking. Installs a Vue error handler that catches component errors and reports them to Flare with Vue-specific context (component name, lifecycle info).

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

## Documentation

Full documentation on the Vue error handler and its options is available at [flareapp.io/docs/vue/general/installation](https://flareapp.io/docs/vue/general/installation).

## Compatibility

- Vue 2 and Vue 3

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
