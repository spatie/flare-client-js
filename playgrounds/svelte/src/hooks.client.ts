import { initFlareClient } from '$lib/flare.client';
import { handleErrorWithFlare } from '@flareapp/sveltekit/client';

initFlareClient();
export const handleError = handleErrorWithFlare();
