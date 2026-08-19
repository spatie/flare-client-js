import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { flareSourcemapsForPlayground, mockApi, playgroundAllowedHosts } from '../shared/src/vite';

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss(), mockApi(), flareSourcemapsForPlayground(mode)],
    server: {
        port: 5185,
        strictPort: true,
        allowedHosts: playgroundAllowedHosts,
    },
    preview: {
        port: 5185,
        strictPort: true,
        allowedHosts: playgroundAllowedHosts,
    },
    build: {
        sourcemap: true,
    },
}));
