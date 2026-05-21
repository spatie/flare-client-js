import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
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
});
