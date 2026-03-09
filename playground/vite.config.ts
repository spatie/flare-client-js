import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), react(), vue()],
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
});
