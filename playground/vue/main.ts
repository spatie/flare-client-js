import { flareVue } from '@flareapp/vue';
import { createApp } from 'vue';

import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';

import App from './App.vue';
import { router } from './router';

initFlare(import.meta.env.VITE_FLARE_VUE_KEY);

createSidebar();

const app = createApp(App);

app.use(router);

app.use(flareVue, {
    captureWarnings: true,
    beforeEvaluate: ({ error, info }) => {
        console.log(`[flareVue] beforeEvaluate: ${error.message} (${info})`);
    },
    beforeSubmit: ({ error, context }) => {
        console.log(`[flareVue] beforeSubmit: ${error.message}`);
        return context;
    },
    afterSubmit: ({ error, info }) => {
        console.log(`[flareVue] afterSubmit: ${error.message} (${info}) reported to Flare`);
    },
});

app.mount('#root');
