import { flare } from '@flareapp/js';
import { flareVue } from '@flareapp/vue';
import { createApp } from 'vue';

import App from './App.vue';

flare.light(import.meta.env.VITE_FLARE_KEY, true);

const app = createApp(App);

flareVue(app);

app.mount('#app');
