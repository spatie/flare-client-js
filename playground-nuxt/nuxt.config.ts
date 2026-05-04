import flareSourcemapUploader from '@flareapp/vite';

export default defineNuxtConfig({
    compatibilityDate: '2025-01-01',

    sourcemap: { client: true },

    runtimeConfig: {
        public: {
            flareKey: process.env.FLARE_KEY || '',
        },
    },

    vite: {
        plugins: [
            flareSourcemapUploader({
                key: process.env.FLARE_KEY!,
            }),
        ],
    },
});
