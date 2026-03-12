import { flareVue } from '@flareapp/vue';
import { createApp } from 'vue';

import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';

import App from './App.vue';

initFlare(import.meta.env.VITE_FLARE_VUE_KEY);

createSidebar();

const app = createApp(App);

app.use(flareVue);

app.mount('#root');
