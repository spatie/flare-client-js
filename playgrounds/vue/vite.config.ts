import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import { flareSourcemapsForPlayground, mockApi } from '../shared/src/vite';

export default defineConfig(({ mode }) => ({
    plugins: [vue(), tailwindcss(), mockApi(), flareSourcemapsForPlayground(mode)],
    server: { port: 5182, strictPort: true },
    preview: { port: 5182, strictPort: true },
    build: { sourcemap: true },
}));
