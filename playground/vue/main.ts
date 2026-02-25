import { flareVue } from '@flareapp/vue';
import { createApp } from 'vue';

import { createSidebar } from '../shared/create-sidebar';
import '../shared/flare';

import App from './App.vue';

createSidebar();

const app = createApp(App);

flareVue(app);

app.mount('#root');
