import { flareVue } from '@flareapp/vue';
import { createApp } from 'vue';

import { createSidebar } from '../shared/create-sidebar';
import { initFlare } from '../shared/init-flare';

import App from './App.vue';

initFlare(import.meta.env.VITE_FLARE_VUE_KEY);

createSidebar();

const app = createApp(App);

flareVue(app);

app.mount('#root');
