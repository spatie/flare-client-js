import { flarePreprocessor } from '@flareapp/svelte/preprocessor';
import adapter from '@sveltejs/adapter-node';

export default {
    preprocess: [flarePreprocessor()],
    kit: { adapter: adapter() },
};
