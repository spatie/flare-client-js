import { handleErrorWithFlare } from '@flareapp/sveltekit/server';
import '$lib/flare.server';

export const handleError = handleErrorWithFlare();
