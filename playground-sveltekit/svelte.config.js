import { flarePreprocessor } from '@flareapp/svelte/preprocessor';
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: [flarePreprocessor()],
    kit: {
        adapter: adapter(),
    },
};

export default config;
