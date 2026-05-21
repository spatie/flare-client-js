import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss()],
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
});
