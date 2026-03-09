import flareSourcemapUploader from '@flareapp/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    return {
        resolve: {
            alias: {
                '@flareapp/js': resolve(__dirname, '../packages/js/src/index.ts'),
                '@flareapp/react': resolve(__dirname, '../packages/react/src/index.ts'),
                '@flareapp/vue': resolve(__dirname, '../packages/vue/src/index.ts'),
            },
        },
        plugins: [
            tailwindcss(),
            react(),
            vue(),
            flareSourcemapUploader({
                key: env.VITE_FLARE_API_KEY,
            }),
        ],
        build: {
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    js: resolve(__dirname, 'js/index.html'),
                    react: resolve(__dirname, 'react/index.html'),
                    vue: resolve(__dirname, 'vue/index.html'),
                },
            },
        },
    };
});
