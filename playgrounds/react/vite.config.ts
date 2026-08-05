import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { flareSourcemapsForPlayground, mockApi } from '../shared/src/vite';

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss(), mockApi(), flareSourcemapsForPlayground(mode)],
    server: {
        port: 5181,
        strictPort: true,
    },
    preview: {
        port: 5181,
        strictPort: true,
    },
    build: {
        sourcemap: true,
    },
}));
