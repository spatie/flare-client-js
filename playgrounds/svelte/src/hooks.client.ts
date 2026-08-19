import { initFlareClient } from '$lib/flare.client';
import { startNavProbe } from '$lib/navProbe.svelte';
import { handleErrorWithFlare, traceSvelteKitRouter } from '@flareapp/sveltekit/client';

initFlareClient();
traceSvelteKitRouter();
startNavProbe();

export const handleError = handleErrorWithFlare();
