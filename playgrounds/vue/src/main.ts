import { flareVue, FlareErrorBoundary } from '@flareapp/vue';
import { createApp } from 'vue';

import Layout from './components/Layout.vue';
import { initFlare } from './flare';
import { router } from './router';
import '@flareapp/playgrounds-shared/styles.css';

initFlare();

const app = createApp(Layout);
app.use(router);
app.use(flareVue, { router });
app.component('FlareErrorBoundary', FlareErrorBoundary);
app.mount('#app');
