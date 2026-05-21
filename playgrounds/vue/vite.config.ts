import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    server: { port: 5182, strictPort: true },
    preview: { port: 5182, strictPort: true },
    build: { sourcemap: true },
});
