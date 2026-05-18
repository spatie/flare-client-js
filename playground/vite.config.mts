import { resolve } from 'path';

import flareSourcemap from '@flareapp/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    return {
        resolve: {
            alias: {
                '@flareapp/js': resolve(__dirname, '../packages/js/src/index.ts'),
                '@flareapp/react': resolve(__dirname, '../packages/react/src/index.ts'),
                '@flareapp/svelte': resolve(__dirname, '../packages/svelte/src/index.ts'),
                '@flareapp/vue': resolve(__dirname, '../packages/vue/src/index.ts'),
            },
        },
        plugins: [
            tailwindcss(),
            react(),
            vue(),
            svelte(),
            flareSourcemap({
                apiKey: env.VITE_FLARE_JS_KEY,
            }),
            flareSourcemap({
                apiKey: env.VITE_FLARE_REACT_KEY,
            }),
            flareSourcemap({
                apiKey: env.VITE_FLARE_VUE_KEY,
            }),
            flareSourcemap({
                apiKey: env.VITE_FLARE_SVELTE_KEY,
            }),
        ],
        build: {
            rollupOptions: {
                external: ['$app/state'],
                input: {
                    main: resolve(__dirname, 'index.html'),
                    js: resolve(__dirname, 'js/index.html'),
                    react: resolve(__dirname, 'react/index.html'),
                    svelte: resolve(__dirname, 'svelte/index.html'),
                    vue: resolve(__dirname, 'vue/index.html'),
                },
            },
        },
    };
});
