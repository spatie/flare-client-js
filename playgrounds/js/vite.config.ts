import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import { flareSourcemapsForPlayground, mockApi } from '../shared/src/vite';

export default defineConfig(({ mode }) => ({
    plugins: [tailwindcss(), mockApi(), flareSourcemapsForPlayground(mode)],
    server: {
        port: 5180,
        strictPort: true,
    },
    preview: {
        port: 5180,
        strictPort: true,
    },
    build: {
        sourcemap: true,
    },
}));
