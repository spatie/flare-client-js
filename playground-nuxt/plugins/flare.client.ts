import { flare } from '@flareapp/js';
import { flareVue } from '@flareapp/vue';

export default defineNuxtPlugin({
    name: 'flare',
    enforce: 'post',
    setup(nuxtApp) {
        const config = useRuntimeConfig();

        flare.light(config.public.flareKey as string, true);

        nuxtApp.vueApp.use(flareVue, {
            captureWarnings: true,
            attachProps: true,
        });
    },
});
