import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import { flareSourcemapsForPlayground } from '../shared/src/vite';

export default defineConfig(({ mode }) => ({
    plugins: [tailwindcss(), sveltekit(), flareSourcemapsForPlayground(mode)],
    server: { port: 5183, strictPort: true },
    preview: { port: 5183, strictPort: true },
}));
